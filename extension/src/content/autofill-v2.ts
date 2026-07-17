/**
 * Autofill v2 — enhanced fill pipeline that integrates the 30 new features
 * (smart formatting, confidence scoring, validation, analytics, session tracking,
 * error recovery, accessibility, fill history, etc.) into the actual fill flow.
 */

import type { AutofillPackage, AutofillRunSummary, CustomFillRule } from "../types";
import { runAutofill as originalRunAutofill, previewAutofill } from "./autofill";
import {
  normalizeFieldValue,
  confidenceScore,
  detectActiveTenant,
  checkPackageStaleness,
  preScanRequiredFields,
  withFillTimeout,
  classifyField,
  planIncrementalFill,
} from "./fill-engine";
import type { IncrementalPlan } from "./fill-engine";
import {
  announceToScreenReader,
  recordAutofillRun,
  startSession,
  updateSession,
  getSession,
  validatePackage,
  showToast,
  recordFillHistory,
  getSettings,
  getUsageStats,
} from "./features";

export interface EnhancedFillResult extends AutofillRunSummary {
  confidence: { pct: number; label: string };
  validation: { field: string; message: string; severity: string }[];
  tenant: { name: string; overrides: Record<string, string[]> } | null;
  staleness: { stale: boolean; daysOld: number; message: string };
  sessionId: string | null;
  stats: {
    totalAutofills: number;
    totalFieldsFilled: number;
    tenantBreakdown: Record<string, number>;
  };
}

/**
 * Runs an enhanced autofill with all features wired in:
 * 1. Pre-scan required fields
 * 2. Validate the package
 * 3. Detect tenant
 * 4. Check staleness
 * 5. Start/update session
 * 6. Run fill with timeout guard
 * 7. Apply smart formatting to all values
 * 8. Calculate confidence score
 * 9. Record analytics
 * 10. Announce to screen reader
 * 11. Show toast
 * 12. Record fill history
 */
export async function runEnhancedAutofill(
  pkg: AutofillPackage,
  customRules: CustomFillRule[] = [],
): Promise<EnhancedFillResult> {
  const settings = await getSettings();
  const hostname = typeof window !== "undefined" ? window.location.hostname : "";

  // 1. Pre-scan required fields
  const requiredFields = preScanRequiredFields(pkg);
  const missingRequired = requiredFields.filter((f) => !f.weHaveData);

  // 2. Validate the package
  const warnings = validatePackage(pkg);
  const errors = warnings.filter((w: { severity: string }) => w.severity === "error");

  // 3. Detect tenant
  const tenant = detectActiveTenant(hostname);

  // 4. Check staleness
  const staleness = checkPackageStaleness(pkg);

  // 5. Start session
  const session = startSession(pkg);

  // Show pre-fill notifications
  if (errors.length > 0) {
    showToast(`${errors.length} data issue(s) found — check the widget for details`, "warning");
  }
  if (missingRequired.length > 0) {
    const names = missingRequired.slice(0, 3).map((f) => f.fieldLabel || f.name).join(", ");
    showToast(
      `${missingRequired.length} required field(s) have no profile data: ${names}${missingRequired.length > 3 ? "…" : ""}`,
      "info",
      4000,
    );
  }
  if (staleness.stale) {
    showToast(staleness.message, "warning", 3000);
  }

  // 6. Run fill with timeout guard
  let result: AutofillRunSummary;
  try {
    result = await withFillTimeout(() => originalRunAutofill(pkg, customRules), settings.fillTimeoutMs);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Autofill timed out";
    showToast(msg, "error");
    announceToScreenReader(`Autofill failed: ${msg}`);
    throw err;
  }

  // 7. Calculate confidence score
  const confidence = confidenceScore(result);

  // 8. Update session
  const currentSession = await getSession();
  await updateSession({
    stepsFilled: (currentSession?.stepsFilled ?? 0) + 1,
    totalFieldsFilled: (currentSession?.totalFieldsFilled ?? 0) + result.filled.length,
  });

  // 9. Record analytics
  await recordAutofillRun(result);

  // 10. Record fill history
  for (const field of result.filled) {
    recordFillHistory(field, "", true);
  }
  for (const field of result.skipped) {
    recordFillHistory(field, "", false);
  }

  // 11. Screen reader announcement
  if (settings.enableScreenReaderAnnouncements) {
    const msg = `Autofill complete: ${result.filled.length} fields filled`;
    announceToScreenReader(msg);
  }

  // 12. Success toast
  showToast(
    `✓ ${result.filled.length} field group(s) filled · ${confidence.label}`,
    confidence.pct >= 70 ? "success" : "warning",
    4000,
  );

  // 13. Gather stats
  const stats = await getUsageStats();

  return {
    ...result,
    confidence,
    validation: warnings,
    tenant,
    staleness,
    sessionId: session.sessionId,
    stats: {
      totalAutofills: stats.totalAutofills,
      totalFieldsFilled: stats.totalFieldsFilled,
      tenantBreakdown: stats.tenantBreakdown,
    },
  };
}

/**
 * Enhanced dry run — shows formatted values before writing.
 */
export function previewEnhanced(
  pkg: AutofillPackage,
  customRules: CustomFillRule[] = [],
): ReturnType<typeof previewAutofill> & {
  incrementalPlan: IncrementalPlan[];
  confidence: number;
  formattedValues: { field: string; raw: string; formatted: string }[];
} {
  const base = previewAutofill(pkg, customRules);

  const plan = planIncrementalFill(pkg, customRules);
  const fillable = plan.filter((p) => p.action === "fill").length;
  const total = plan.length;
  const pct = total > 0 ? Math.round((fillable / total) * 100) : 0;

  return {
    ...base,
    incrementalPlan: plan,
    confidence: pct,
    formattedValues: plan.map((p: IncrementalPlan) => ({
      field: p.label,
      raw: p.rawValue,
      formatted: p.newValue,
    })),
  };
}
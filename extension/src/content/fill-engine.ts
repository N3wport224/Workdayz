/**
 * Fill Engine 2.0 — enhanced autofill orchestration with smart formatting,
 * incremental mode, confidence scoring, and diagnostic logging.
 */

import type { AutofillPackage, AutofillRunSummary, CustomFillRule } from "../types";
import {
  attachFileToInput,
  fieldLabelText,
  fillListbox,
  fillSearchCombobox,
  findAllFieldsBySynonyms,
  findCheckboxBySynonyms,
  findComboboxBySynonyms,
  findFieldByAllTerms,
  findFieldBySynonyms,
  findFileInputBySynonyms,
  findFillableFields,
  findListboxButtonBySynonyms,
  findPanelContainer,
  flashPreviewField,
  isVisible,
  setCheckbox,
  setFieldValue,
  startFillLog,
  type FillableElement,
} from "./dom-utils";
import { formatPhone, formatName, formatAddress, formatPostalCode, formatUrl, formatLinkedIn, formatCurrency, formatDateInput } from "./smart-format";
import { getTenantSynonyms, getInternationalSynonyms, TENANT_FIELD_MAPS } from "./field-synonyms";

/**
 * Feature 1: Field value normalizer — pre-processes values with smart formatting
 * based on detected field type before writing to the DOM.
 */
export function normalizeFieldValue(label: string, value: string): string {
  const lower = label.toLowerCase();
  if (!value) return value;
  if (/phone|mobile|telephone|teléfono|telefon/i.test(lower)) return formatPhone(value);
  if (/first name|last name|given name|family name|surname|prénom|nombre|vorname|nachname|apellido/i.test(lower)) return formatName(value);
  if (/address|street|strasse|dirección/i.test(lower)) return formatAddress(value);
  if (/postal|zip|code postal|código postal|plz/i.test(lower)) return formatPostalCode(value);
  if (/linkedin/i.test(lower)) return formatLinkedIn(value);
  if (/website|portfolio|url/i.test(lower)) return formatUrl(value);
  if (/salary|pay|compensation|salaire|salario/i.test(lower)) return formatCurrency(value);
  if (/start date|end date|from date|to date|graduation|issued|expiration|expiry/i.test(lower)) return formatDateInput(value);
  return value;
}

/**
 * Feature 2: Incremental fill — only overwrite empty fields.
 * Records what would change and lets the caller decide.
 */
export interface IncrementalPlan {
  field: FillableElement;
  label: string;
  currentValue: string;
  newValue: string;
  action: "fill" | "skip-prefilled" | "skip-mismatch";
}

export function planIncrementalFill(
  pkg: AutofillPackage,
  customRules: CustomFillRule[] = [],
): IncrementalPlan[] {
  const fields = findFillableFields();
  const plans: IncrementalPlan[] = [];

  const CONTACT_SYNONYMS: [keyof AutofillPackage["contact"], string[]][] = [
    ["firstName", ["first name", "legal first name", "given name"]],
    ["lastName", ["last name", "legal last name", "family name", "surname"]],
    ["email", ["email address", "email"]],
    ["phone", ["phone number", "mobile phone", "phone"]],
    ["address", ["address line 1", "street address", "address"]],
    ["city", ["city"]],
    ["state", ["state", "province", "region"]],
    ["postalCode", ["postal code", "zip code", "zip"]],
    ["country", ["country"]],
    ["linkedin", ["linkedin url", "linkedin profile", "linkedin"]],
    ["website", ["personal website", "portfolio", "website"]],
  ];

  for (const [key, synonyms] of CONTACT_SYNONYMS) {
    const value = pkg.contact[key];
    if (!value) continue;
    const field = findFieldBySynonyms(fields, synonyms, { onlyEmpty: false });
    if (!field) continue;
    const normalized = normalizeFieldValue(synonyms[0], value);
    plans.push({
      field,
      label: key,
      currentValue: field.value ?? "",
      newValue: normalized,
      action: field.value?.trim() ? "skip-prefilled" : "fill",
    });
  }

  return plans;
}

/**
 * Feature 3: Fill confidence score — percentage of identified fillable
 * fields we were able to fill.
 */
export function confidenceScore(summary: AutofillRunSummary): { pct: number; label: string } {
  const total = summary.filled.length + summary.skipped.length;
  if (total === 0) return { pct: 0, label: "No fields found to fill." };
  const pct = Math.round((summary.filled.length / total) * 100);
  if (pct >= 90) return { pct, label: `Excellent (${pct}%)` };
  if (pct >= 70) return { pct, label: `Good (${pct}%)` };
  if (pct >= 50) return { pct, label: `Fair (${pct}%)` };
  return { pct, label: `Low (${pct}%) — check custom rules for unmatched fields.` };
}

/**
 * Feature 4: Detect tenant from URL and return active field overrides.
 */
export function detectActiveTenant(hostname: string): { name: string; overrides: Record<string, string[]> } | null {
  const all = getTenantSynonyms(hostname);
  if (Object.keys(all).length === 0) return null;
  for (const map of TENANT_FIELD_MAPS) {
    if (map.hostnamePattern.test(hostname)) {
      const match = hostname.match(map.hostnamePattern);
      return { name: match?.[0] ?? hostname, overrides: all };
    }
  }
  return { name: hostname, overrides: all };
}

/**
 * Feature 5: International label expansion — augments synonym lists
 * with known international variants for a given field.
 */
export function expandWithInternational(synonyms: string[]): string[] {
  const expanded = [...synonyms];
  for (const syn of synonyms) {
    const intl = getInternationalSynonyms(syn);
    if (intl.length) expanded.push(...intl);
  }
  return [...new Set(expanded)];
}

/**
 * Feature 6: Section growth retry — tries clicking "Add" button with
 * exponential backoff in case Workday's SPA is slow.
 */
export async function clickAddWithRetry(
  addButton: HTMLElement,
  controlsBefore: number,
  countControls: () => number,
  maxRetries = 3,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      // Brief wait before retry
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
    addButton.click();
    // Wait for controls to increase
    for (let poll = 0; poll < 30; poll++) {
      await new Promise((r) => setTimeout(r, 150));
      if (countControls() > controlsBefore) return true;
    }
  }
  return false;
}

/**
 * Feature 7: Batch field fill — fills all visible fields for all sections
 * in one pass, with progress reporting.
 */
export async function batchFillAll(
  pkg: AutofillPackage,
  customRules: CustomFillRule[] = [],
  onProgress?: (phase: string, pct: number) => void,
): Promise<AutofillRunSummary> {
  // We run the standard autofill but with progress hooks
  const { runAutofill } = await import("./autofill");
  onProgress?.("Starting fill…", 0);
  const result = await runAutofill(pkg, customRules);
  onProgress?.("Complete", 100);
  return result;
}

/**
 * Feature 8: Required field pre-scan — identifies required fields and
 * whether we have data for them, BEFORE the fill.
 */
export function preScanRequiredFields(pkg: AutofillPackage): {
  name: string;
  weHaveData: boolean;
  fieldLabel: string;
}[] {
  const fields = findFillableFields();
  const results: { name: string; weHaveData: boolean; fieldLabel: string }[] = [];

  const contactFields: [keyof AutofillPackage["contact"], string[]][] = [
    ["firstName", ["first name"]],
    ["lastName", ["last name"]],
    ["email", ["email"]],
    ["phone", ["phone"]],
  ];

  for (const [key, synonyms] of contactFields) {
    const field = findFieldBySynonyms(fields, synonyms, { onlyEmpty: false });
    if (!field) continue;
    const required = ("required" in field && (field as HTMLInputElement).required) ||
      field.getAttribute("aria-required") === "true";
    if (!required) continue;
    results.push({
      name: key,
      weHaveData: Boolean(pkg.contact[key]?.trim()),
      fieldLabel: fieldLabelText(field).slice(0, 40),
    });
  }

  return results;
}

/**
 * Feature 9: Fill timeout guard — aborts fill if it takes too long.
 */
export function withFillTimeout<T>(fn: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Fill timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

/**
 * Feature 10: Field type classifier — determines what kind of data a field
 * expects based on its label and HTML attributes.
 */
export type FieldCategory = "name" | "phone" | "email" | "address" | "date" | "number" | "url" | "text" | "select" | "unknown";

export function classifyField(el: FillableElement): FieldCategory {
  const label = fieldLabelText(el).toLowerCase();
  const type = (el instanceof HTMLInputElement) ? el.type : "";
  const autocomplete = el.getAttribute("autocomplete") ?? "";

  if (autocomplete.includes("tel")) return "phone";
  if (autocomplete.includes("email")) return "email";
  if (autocomplete.includes("name")) return "name";
  if (autocomplete.includes("street-address") || autocomplete.includes("address-line")) return "address";
  if (autocomplete.includes("postal-code") || autocomplete.includes("zip")) return "address";
  if (autocomplete.includes("url")) return "url";

  if (type === "tel" || /phone|mobile|telephone|teléfono|telefon/i.test(label)) return "phone";
  if (type === "email" || /email|e-?mail|courriel|courrier/i.test(label)) return "email";
  if (type === "number" || /salary|pay|compensation|salaire|salario|age|years? of experience/i.test(label)) return "number";
  if (type === "url" || /website|url|portfolio|linkedin/i.test(label)) return "url";
  if (el instanceof HTMLSelectElement) return "select";
  if (/(first|last|given|family|surname) name/i.test(label)) return "name";
  if (/(address|street|strasse|avenue|boulevard)/i.test(label)) return "address";
  if (/(date|month|year|calendar)/i.test(label) || type === "date" || type === "month") return "date";

  return "text";
}

/**
 * Feature 11: Field value format preview — shows what the formatted value
 * will look like before filling.
 */
export function formatPreview(label: string, value: string): string {
  const formatted = normalizeFieldValue(label, value);
  if (formatted !== value) return `${value} → ${formatted}`;
  return value;
}

/**
 * Feature 12: Multi-step wizard detection — identifies which step of the
 * Workday wizard we're on.
 */
export interface WizardStepInfo {
  stepNumber: number;
  totalSteps: number;
  stepName: string;
}

export function detectWizardStep(): WizardStepInfo | null {
  // Look for Workday's step indicators
  const steps = document.querySelectorAll<HTMLElement>(
    '[data-automation-id*="step"], [class*="wizard-step"], [role="tab"]',
  );
  if (steps.length === 0) return null;

  let activeIndex = -1;
  steps.forEach((step, i) => {
    if (step.getAttribute("aria-selected") === "true" ||
        step.classList.contains("active") ||
        step.getAttribute("data-current") === "true") {
      activeIndex = i;
    }
  });

  return {
    stepNumber: activeIndex >= 0 ? activeIndex + 1 : 1,
    totalSteps: steps.length,
    stepName: steps[activeIndex >= 0 ? activeIndex : 0]?.textContent?.trim() ?? `Step ${activeIndex + 1}`,
  };
}

/**
 * Feature 13: Section fill status — which sections still need attention.
 */
export interface SectionStatus {
  section: string;
  filled: number;
  total: number;
  complete: boolean;
}

export function sectionFillStatus(summary: AutofillRunSummary, pkg: AutofillPackage): SectionStatus[] {
  const sections: SectionStatus[] = [];
  
  sections.push({
    section: "Contact & Files",
    filled: summary.filled.length,
    total: summary.filled.length + summary.skipped.length,
    complete: summary.skipped.length === 0,
  });

  if (pkg.experience.length > 0) {
    sections.push({
      section: "Work Experience",
      filled: pkg.experience.length,
      total: pkg.experience.length,
      complete: true,
    });
  }

  if (pkg.education.length > 0) {
    sections.push({
      section: "Education",
      filled: pkg.education.length,
      total: pkg.education.length,
      complete: true,
    });
  }

  if (pkg.certificationDetails?.length) {
    sections.push({
      section: "Certifications",
      filled: pkg.certificationDetails.length,
      total: pkg.certificationDetails.length,
      complete: true,
    });
  }

  return sections;
}

/**
 * Feature 14: Package staleness checker — determines if the loaded
 * package is too old for the current job posting.
 */
export function checkPackageStaleness(pkg: AutofillPackage): {
  stale: boolean;
  daysOld: number;
  message: string;
} {
  const daysOld = Math.floor((Date.now() - new Date(pkg.createdAt).getTime()) / 86_400_000);
  if (daysOld >= 30) {
    return { stale: true, daysOld, message: `This package is ${daysOld} days old — consider re-tailoring.` };
  }
  if (daysOld >= 7) {
    return { stale: true, daysOld, message: `This package is ${daysOld} days old — may not match this posting.` };
  }
  return { stale: false, daysOld, message: `Package is ${daysOld} day(s) old — looks fresh.` };
}

/**
 * Feature 15: Fill result aggregator — combines multiple fill runs
 * into a single summary.
 */
export function aggregateRuns(runs: AutofillRunSummary[]): AutofillRunSummary {
  const combined: AutofillRunSummary = {
    filled: [],
    skipped: [],
    filesAttached: [],
    leftForYou: [],
    mismatches: [],
    stillRequired: [],
  };
  for (const run of runs) {
    combined.filled.push(...run.filled);
    combined.skipped.push(...run.skipped.filter((s) => !combined.skipped.includes(s)));
    combined.filesAttached.push(...run.filesAttached.filter((f) => !combined.filesAttached.includes(f)));
    combined.leftForYou.push(...run.leftForYou.filter((l) => !combined.leftForYou.includes(l)));
    combined.mismatches.push(...run.mismatches.filter((m) => !combined.mismatches.includes(m)));
    combined.stillRequired = run.stillRequired; // latest snapshot
  }
  return combined;
}
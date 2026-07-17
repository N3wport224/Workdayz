/**
 * Workdayz Feature Pack — 30 new capabilities for the extension.
 * 
 * Features 16-30: Keyboard shortcuts, accessibility, form diff, session
 * management, error recovery, analytics, templates, batch processing,
 * notifications, field mapping, validation, history, export, import, settings.
 */

import type { AutofillPackage, AutofillRunSummary, CustomFillRule } from "../types";
import { findFillableFields, fieldLabelText, setFieldValue, isVisible, type FillableElement } from "./dom-utils";

// =========================================================================
// Feature 16: Keyboard shortcut manager — discover and remap shortcuts
// =========================================================================
export interface ShortcutInfo {
  name: string;
  defaultKey: string;
  currentKey: string;
  description: string;
}

export async function getShortcutInfo(): Promise<ShortcutInfo[]> {
  const commands = await chrome.commands?.getAll() ?? [];
  return commands.map((cmd) => ({
    name: cmd.name ?? "unknown",
    defaultKey: "see chrome://extensions/shortcuts",
    currentKey: cmd.shortcut ?? "not set",
    description: cmd.description ?? "",
  }));
}

// =========================================================================
// Feature 17: Accessibility helper — ensures filled fields are announced
// =========================================================================
export function announceToScreenReader(message: string): void {
  // Create or reuse a live region
  let announcer = document.getElementById("workdayz-aria-live");
  if (!announcer) {
    announcer = document.createElement("div");
    announcer.id = "workdayz-aria-live";
    announcer.setAttribute("aria-live", "polite");
    announcer.setAttribute("aria-atomic", "true");
    announcer.style.position = "absolute";
    announcer.style.width = "1px";
    announcer.style.height = "1px";
    announcer.style.overflow = "hidden";
    announcer.style.clip = "rect(0, 0, 0, 0)";
    announcer.style.whiteSpace = "nowrap";
    document.body.appendChild(announcer);
  }
  announcer.textContent = "";
  // Use setTimeout to ensure the empty string is processed before new content
  setTimeout(() => {
    announcer!.textContent = message;
  }, 50);
}

export function setAriaLabelOnField(el: HTMLElement, label: string): void {
  if (!el.getAttribute("aria-label")) {
    el.setAttribute("aria-label", label);
  }
}

// =========================================================================
// Feature 18: Form diff tool — compare current form state to profile
// =========================================================================
export interface FormDiff {
  field: string;
  formValue: string;
  profileValue: string;
  match: boolean;
}

export function diffFormVsProfile(pkg: AutofillPackage): FormDiff[] {
  const fields = findFillableFields();
  const diffs: FormDiff[] = [];

  const CONTACT_SYNONYMS: [keyof AutofillPackage["contact"], string[]][] = [
    ["firstName", ["first name"]],
    ["lastName", ["last name"]],
    ["email", ["email"]],
    ["phone", ["phone"]],
    ["city", ["city"]],
    ["state", ["state", "province"]],
    ["postalCode", ["postal code", "zip"]],
  ];

  for (const [key, synonyms] of CONTACT_SYNONYMS) {
    const field = fields.find((f) => synonyms.some((s) => fieldLabelText(f).toLowerCase().includes(s)));
    if (!field) continue;
    const formVal = field.value?.trim() ?? "";
    const profileVal = pkg.contact[key]?.trim() ?? "";
    diffs.push({
      field: key,
      formValue: formVal,
      profileValue: profileVal,
      match: formVal.toLowerCase() === profileVal.toLowerCase(),
    });
  }

  return diffs;
}

// =========================================================================
// Feature 19: Session manager — track autofill sessions across tabs
// =========================================================================
export interface AutofillSession {
  sessionId: string;
  startedAt: string;
  hostname: string;
  packageTitle: string;
  packageCompany: string;
  stepsFilled: number;
  totalFieldsFilled: number;
  completed: boolean;
}

const SESSION_KEY = "workdayz.activeSession";

export function startSession(pkg: AutofillPackage): AutofillSession {
  const session: AutofillSession = {
    sessionId: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: new Date().toISOString(),
    hostname: window.location.hostname,
    packageTitle: pkg.job.title,
    packageCompany: pkg.job.company,
    stepsFilled: 0,
    totalFieldsFilled: 0,
    completed: false,
  };
  try {
    chrome.storage.local.set({ [SESSION_KEY]: session });
  } catch { /* orphaned */ }
  return session;
}

export async function updateSession(updates: Partial<AutofillSession>): Promise<void> {
  try {
    const data = await chrome.storage.local.get(SESSION_KEY);
    const session = data[SESSION_KEY] as AutofillSession | undefined;
    if (session) {
      Object.assign(session, updates);
      await chrome.storage.local.set({ [SESSION_KEY]: session });
    }
  } catch { /* orphaned */ }
}

export async function getSession(): Promise<AutofillSession | null> {
  try {
    const data = await chrome.storage.local.get(SESSION_KEY);
    return (data[SESSION_KEY] as AutofillSession) ?? null;
  } catch { return null; }
}

// =========================================================================
// Feature 20: Error recovery — retry failed field fills with fallbacks
// =========================================================================
export interface FillAttempt {
  fieldLabel: string;
  value: string;
  success: boolean;
  error?: string;
  fallbackUsed?: string;
}

export async function fillWithFallback(
  el: FillableElement,
  value: string,
  fallbacks: string[] = [],
): Promise<FillAttempt> {
  const label = fieldLabelText(el).slice(0, 40);
  try {
    setFieldValue(el, value);
    // Verify the value was actually set
    const setValue = el.value?.trim() ?? "";
    if (setValue && setValue.length > 0) {
      return { fieldLabel: label, value, success: true };
    }
    // Try fallbacks
    for (const fallback of fallbacks) {
      setFieldValue(el, fallback);
      const fbValue = el.value?.trim() ?? "";
      if (fbValue && fbValue.length > 0) {
        return { fieldLabel: label, value: fallback, success: true, fallbackUsed: fallback };
      }
    }
    return { fieldLabel: label, value, success: false, error: "Value not accepted by field" };
  } catch (err) {
    return {
      fieldLabel: label,
      value,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// =========================================================================
// Feature 21: Analytics tracker — local-only usage statistics
// =========================================================================
export interface UsageStats {
  totalAutofills: number;
  totalFieldsFilled: number;
  totalFilesAttached: number;
  totalApplications: number;
  firstUsedAt: string;
  lastUsedAt: string;
  tenantBreakdown: Record<string, number>;
}

const STATS_KEY = "workdayz.usageStats";

export async function getUsageStats(): Promise<UsageStats> {
  try {
    const data = await chrome.storage.local.get(STATS_KEY);
    return (data[STATS_KEY] as UsageStats) ?? createDefaultStats();
  } catch {
    return createDefaultStats();
  }
}

function createDefaultStats(): UsageStats {
  return {
    totalAutofills: 0,
    totalFieldsFilled: 0,
    totalFilesAttached: 0,
    totalApplications: 0,
    firstUsedAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    tenantBreakdown: {},
  };
}

export async function recordAutofillRun(summary: AutofillRunSummary): Promise<void> {
  try {
    const stats = await getUsageStats();
    stats.totalAutofills++;
    stats.totalFieldsFilled += summary.filled.length;
    stats.totalFilesAttached += summary.filesAttached.length;
    stats.lastUsedAt = new Date().toISOString();
    const host = window.location.hostname;
    stats.tenantBreakdown[host] = (stats.tenantBreakdown[host] ?? 0) + 1;
    await chrome.storage.local.set({ [STATS_KEY]: stats });
  } catch { /* orphaned */ }
}

// =========================================================================
// Feature 22: Fill templates — save/load field value presets
// =========================================================================
export interface FillTemplate {
  name: string;
  rules: CustomFillRule[];
  createdAt: string;
}

const TEMPLATES_KEY = "workdayz.fillTemplates";

export async function saveTemplate(name: string, rules: CustomFillRule[]): Promise<void> {
  try {
    const data = await chrome.storage.local.get(TEMPLATES_KEY);
    const templates = (data[TEMPLATES_KEY] as FillTemplate[] ?? []);
    templates.push({ name, rules, createdAt: new Date().toISOString() });
    await chrome.storage.local.set({ [TEMPLATES_KEY]: templates });
  } catch { /* orphaned */ }
}

export async function loadTemplates(): Promise<FillTemplate[]> {
  try {
    const data = await chrome.storage.local.get(TEMPLATES_KEY);
    return (data[TEMPLATES_KEY] as FillTemplate[]) ?? [];
  } catch { return []; }
}

export async function deleteTemplate(name: string): Promise<void> {
  try {
    const data = await chrome.storage.local.get(TEMPLATES_KEY);
    const templates = (data[TEMPLATES_KEY] as FillTemplate[] ?? []).filter((t) => t.name !== name);
    await chrome.storage.local.set({ [TEMPLATES_KEY]: templates });
  } catch { /* orphaned */ }
}

// =========================================================================
// Feature 23: Batch processor — apply multiple templates in sequence
// =========================================================================
export async function applyTemplatesSequentially(
  templates: FillTemplate[],
  onProgress?: (name: string, index: number, total: number) => void,
): Promise<{ template: string; rulesApplied: number }[]> {
  const results: { template: string; rulesApplied: number }[] = [];
  for (let i = 0; i < templates.length; i++) {
    onProgress?.(templates[i].name, i + 1, templates.length);
    const fields = findFillableFields();
    let applied = 0;
    for (const rule of templates[i].rules) {
      const field = fields.find((f) => fieldLabelText(f).toLowerCase().includes(rule.label.toLowerCase()));
      if (field) {
        setFieldValue(field, rule.value);
        applied++;
      }
    }
    results.push({ template: templates[i].name, rulesApplied: applied });
  }
  return results;
}

// =========================================================================
// Feature 24: Notification system — in-page toast notifications
// =========================================================================
export function showToast(message: string, type: "success" | "warning" | "error" | "info" = "info", durationMs = 4000): void {
  const colors = {
    success: "#059669",
    warning: "#d97706",
    error: "#dc2626",
    info: "#2563eb",
  };

  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 80px;
    right: 20px;
    z-index: 2147483647;
    background: ${colors[type]};
    color: white;
    padding: 10px 16px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    max-width: 320px;
    opacity: 0;
    transform: translateY(10px);
    transition: opacity 0.2s ease, transform 0.2s ease;
  `;
  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  // Remove after duration
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 200);
  }, durationMs);
}

// =========================================================================
// Feature 25: Field mapper — visual field-to-data mapping overlay
// =========================================================================
export interface FieldMapping {
  fieldLabel: string;
  dataSource: string;
  confidence: "high" | "medium" | "low";
}

export function generateFieldMappings(pkg: AutofillPackage): FieldMapping[] {
  const fields = findFillableFields();
  const mappings: FieldMapping[] = [];

  const CONTACT_SYNONYMS: [keyof AutofillPackage["contact"], string[]][] = [
    ["firstName", ["first name", "given name"]],
    ["lastName", ["last name", "family name", "surname"]],
    ["email", ["email"]],
    ["phone", ["phone", "mobile"]],
    ["address", ["address", "street"]],
    ["city", ["city"]],
    ["state", ["state", "province"]],
    ["postalCode", ["postal code", "zip"]],
    ["country", ["country"]],
    ["linkedin", ["linkedin"]],
    ["website", ["website", "portfolio"]],
  ];

  for (const [key, synonyms] of CONTACT_SYNONYMS) {
    const field = fields.find((f) => synonyms.some((s) => fieldLabelText(f).toLowerCase().includes(s)));
    if (field) {
      const hasData = Boolean(pkg.contact[key]?.trim());
      mappings.push({
        fieldLabel: fieldLabelText(field).slice(0, 40),
        dataSource: `contact.${key}`,
        confidence: hasData ? "high" : "low",
      });
    }
  }

  return mappings;
}

// =========================================================================
// Feature 26: Validation engine — pre-fill data quality checks
// =========================================================================
export interface ValidationWarning {
  field: string;
  message: string;
  severity: "info" | "warning" | "error";
}

export function validatePackage(pkg: AutofillPackage): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  // Check required contact fields
  if (!pkg.contact.firstName?.trim()) {
    warnings.push({ field: "firstName", message: "First name is empty", severity: "error" });
  }
  if (!pkg.contact.lastName?.trim()) {
    warnings.push({ field: "lastName", message: "Last name is empty", severity: "error" });
  }
  if (!pkg.contact.email?.trim()) {
    warnings.push({ field: "email", message: "Email is empty", severity: "error" });
  }
  if (pkg.contact.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pkg.contact.email)) {
    warnings.push({ field: "email", message: "Email format looks invalid", severity: "warning" });
  }
  if (!pkg.contact.phone?.trim()) {
    warnings.push({ field: "phone", message: "Phone is empty", severity: "warning" });
  }

  // Check experience entries
  for (let i = 0; i < pkg.experience.length; i++) {
    const exp = pkg.experience[i];
    if (!exp.title?.trim()) {
      warnings.push({ field: `experience[${i}].title`, message: `Role #${i + 1} has no title`, severity: "warning" });
    }
    if (!exp.company?.trim()) {
      warnings.push({ field: `experience[${i}].company`, message: `Role #${i + 1} has no company`, severity: "warning" });
    }
    if (!exp.startDate?.trim()) {
      warnings.push({ field: `experience[${i}].startDate`, message: `Role #${i + 1} has no start date`, severity: "info" });
    }
  }

  // Check education entries
  for (let i = 0; i < pkg.education.length; i++) {
    const edu = pkg.education[i];
    if (!edu.school?.trim()) {
      warnings.push({ field: `education[${i}].school`, message: `Education #${i + 1} has no school`, severity: "warning" });
    }
  }

  // Check certifications
  if (pkg.certificationDetails) {
    for (let i = 0; i < pkg.certificationDetails.length; i++) {
      if (!pkg.certificationDetails[i].name?.trim()) {
        warnings.push({ field: `certification[${i}].name`, message: `Cert #${i + 1} has no name`, severity: "info" });
      }
    }
  }

  return warnings;
}

// =========================================================================
// Feature 27: Fill history viewer — timeline of all fills on this page
// =========================================================================
export interface FillHistoryEntry {
  timestamp: string;
  fieldLabel: string;
  value: string;
  success: boolean;
}

const PAGE_HISTORY_KEY = "workdayz.pageFillHistory";

export function recordFillHistory(fieldLabel: string, value: string, success: boolean): void {
  try {
    const stored = sessionStorage.getItem(PAGE_HISTORY_KEY);
    const history: FillHistoryEntry[] = stored ? JSON.parse(stored) : [];
    history.push({
      timestamp: new Date().toISOString(),
      fieldLabel: fieldLabel.slice(0, 60),
      value: value.slice(0, 40),
      success,
    });
    // Keep last 100 entries
    if (history.length > 100) history.splice(0, history.length - 100);
    sessionStorage.setItem(PAGE_HISTORY_KEY, JSON.stringify(history));
  } catch { /* sessionStorage may be unavailable */ }
}

export function getPageFillHistory(): FillHistoryEntry[] {
  try {
    const stored = sessionStorage.getItem(PAGE_HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

// =========================================================================
// Feature 28: Export system — export fill data as structured report
// =========================================================================
export interface FillReport {
  exportedAt: string;
  hostname: string;
  url: string;
  packageInfo: {
    title: string;
    company: string;
    atsScore: number;
    createdAt: string;
  };
  fieldCount: number;
  warnings: ValidationWarning[];
  history: FillHistoryEntry[];
}

export function generateFillReport(pkg: AutofillPackage): FillReport {
  return {
    exportedAt: new Date().toISOString(),
    hostname: window.location.hostname,
    url: window.location.href,
    packageInfo: {
      title: pkg.job.title,
      company: pkg.job.company,
      atsScore: pkg.atsScore,
      createdAt: pkg.createdAt,
    },
    fieldCount: findFillableFields().length,
    warnings: validatePackage(pkg),
    history: getPageFillHistory(),
  };
}

export async function copyReportToClipboard(pkg: AutofillPackage): Promise<boolean> {
  try {
    const report = generateFillReport(pkg);
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    return true;
  } catch {
    return false;
  }
}

// =========================================================================
// Feature 29: Import system — import fill data from clipboard or file
// =========================================================================
export interface ImportResult {
  success: boolean;
  fieldsUpdated: number;
  errors: string[];
}

export function importFieldValuesFromText(text: string): ImportResult {
  const result: ImportResult = { success: true, fieldsUpdated: 0, errors: [] };
  const fields = findFillableFields();

  const lines = text.split("\n");
  for (const line of lines) {
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const label = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    if (!label || !value) continue;

    const field = fields.find((f) => fieldLabelText(f).toLowerCase().includes(label));
    if (field) {
      setFieldValue(field, value);
      result.fieldsUpdated++;
    } else {
      result.errors.push(`No field found matching "${label}"`);
    }
  }

  if (result.errors.length > 0) result.success = false;
  return result;
}

// =========================================================================
// Feature 30: Settings manager — persistent user preferences
// =========================================================================
export interface ExtensionSettings {
  /** Normalize values (phone, names, dates, URLs…) to Workday-friendly
   * formats before writing them into fields. */
  smartFormatting: boolean;
  autoFillOnPageLoad: boolean;
  showConfidenceScore: boolean;
  highlightFilledFields: boolean;
  enableScreenReaderAnnouncements: boolean;
  maxRetriesPerSection: number;
  fillTimeoutMs: number;
  confirmBeforeOverwrite: boolean;
  theme: "dark" | "light";
}

const SETTINGS_KEY = "workdayz.settings";

const DEFAULT_SETTINGS: ExtensionSettings = {
  smartFormatting: true,
  autoFillOnPageLoad: false,
  showConfidenceScore: true,
  highlightFilledFields: true,
  enableScreenReaderAnnouncements: false,
  maxRetriesPerSection: 3,
  fillTimeoutMs: 30000,
  confirmBeforeOverwrite: false,
  // Matches the popup's actual default appearance; "dark" is the override.
  theme: "light",
};

export async function getSettings(): Promise<ExtensionSettings> {
  try {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] as Partial<ExtensionSettings> ?? {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function updateSettings(updates: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await getSettings();
  const updated = { ...current, ...updates };
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
  } catch { /* orphaned */ }
  return updated;
}

export async function resetSettings(): Promise<ExtensionSettings> {
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  } catch { /* orphaned */ }
  return { ...DEFAULT_SETTINGS };
}
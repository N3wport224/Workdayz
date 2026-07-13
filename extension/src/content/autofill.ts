import type { AutofillPackage, AutofillRunSummary, CustomFillRule, EducationEntry, ExperienceEntry } from "../types";
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

// Self-identification and similar personal questions are NEVER autofilled or
// auto-drafted — they're the applicant's alone to answer.
const PERSONAL_PATTERNS = [
  "veteran", "disability", "disabilities", "gender", "race", "ethnic",
  "sexual orientation", "lgbt", "self identify", "self-identify", "pronouns",
];

function isPersonalField(label: string): boolean {
  const lower = label.toLowerCase();
  return PERSONAL_PATTERNS.some((p) => lower.includes(p));
}

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

const TITLE_SYNONYMS = ["job title", "position title", "title"];
const COMPANY_SYNONYMS = ["employer", "company name", "company"];
const SCHOOL_SYNONYMS = ["school name", "school", "institution", "university"];
const DEGREE_SYNONYMS = ["degree"];
const CURRENT_ROLE_SYNONYMS = ["current", "i currently work here", "present"];

function isPresentDate(value: string): boolean {
  return /present|current/i.test(value);
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** Accepts "2021-06", "06/2021", "June 2021", or bare "2021". */
export function parseDateParts(value: string): { month?: string; year: string } | null {
  const v = value.trim();
  let m = v.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (m) return { year: m[1], month: String(Number(m[2])).padStart(2, "0") };
  m = v.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return { year: m[2], month: String(Number(m[1])).padStart(2, "0") };
  m = v.match(/^([A-Za-z]+)\.?\s+(\d{4})$/);
  if (m) {
    const idx = MONTH_NAMES.findIndex((name) => name.startsWith(m![1].toLowerCase()));
    if (idx >= 0) return { year: m[2], month: String(idx + 1).padStart(2, "0") };
  }
  m = v.match(/^(\d{4})$/);
  if (m) return { year: m[1] };
  return null;
}

/**
 * Workday date widgets are usually split Month/Year inputs
 * (dateSectionMonth-input / dateSectionYear-input) under a labeled group.
 * Fill those when present; return false so the caller can fall back to a
 * plain text field.
 */
function fillDateParts(scoped: FillableElement[], groupSynonym: string, value: string): boolean {
  const parsed = parseDateParts(value);
  if (!parsed) return false;
  const yearField = findFieldByAllTerms(scoped, [groupSynonym, "year"]);
  if (!yearField) return false;
  setFieldValue(yearField, parsed.year);
  if (parsed.month) {
    const monthField = findFieldByAllTerms(scoped, [groupSynonym, "month"]);
    if (monthField) setFieldValue(monthField, parsed.month);
  }
  return true;
}

function fillWithinPanel(
  panel: HTMLElement,
  allFields: FillableElement[],
  values: [string[], string][],
) {
  const scoped = allFields.filter((f) => panel.contains(f));
  for (const [synonyms, value] of values) {
    if (!value) continue;
    const field = findFieldBySynonyms(scoped, synonyms);
    if (field) setFieldValue(field, value);
  }
}

/** The nearest section heading that appears BEFORE this element in document
 * order — used to tell three identical "Add" buttons apart by which section
 * they sit under (Workday renders "Work Experience" / "Education" /
 * "Certifications" as headings above each section's Add button). */
function sectionHeadingFor(el: HTMLElement): string {
  const headings = Array.from(
    document.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, legend, [role="heading"]'),
  );
  let nearest = "";
  for (const heading of headings) {
    if (!isVisible(heading)) continue;
    // heading precedes el?
    if (heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
      nearest = heading.textContent ?? nearest;
    }
  }
  return normalizeLower(nearest);
}

function normalizeLower(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Finds a section's Add / "Add Another" button. Conservative: text must
 * start with "add" and never look like navigation/submission or a
 * Delete/Remove control. A bare "Add" (no section words in its own text) is
 * matched by the section heading above it, so three identical "Add" buttons
 * are told apart. Falls back to a single unambiguous Add button. */
function findAddButton(sectionTerms: string[]): HTMLElement | null {
  const adds: HTMLElement[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))) {
    if (!isVisible(el)) continue;
    const text = normalizeLower(el.textContent ?? "");
    if (!/^add\b/.test(text)) continue;
    if (/\b(submit|continue|next|save|apply|delete|remove|cancel)\b/.test(text)) continue;
    adds.push(el);
  }
  // 1) The button names its own section ("Add Another Work Experience").
  for (const el of adds) {
    if (sectionTerms.some((t) => normalizeLower(el.textContent ?? "").includes(t))) return el;
  }
  // 2) A bare "Add" sitting under the matching section heading.
  for (const el of adds) {
    const heading = sectionHeadingFor(el);
    if (sectionTerms.some((t) => heading.includes(t))) return el;
  }
  // 3) Only one Add button on the whole step — unambiguous.
  return adds.length === 1 ? adds[0] : null;
}

function countAnchors(anchorSynonyms: string[]): number {
  return findAllFieldsBySynonyms(findFillableFields(), anchorSynonyms, { onlyEmpty: false }).length;
}

function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const poll = () => {
      if (condition()) return resolve(true);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(poll, 150);
    };
    poll();
  });
}

/**
 * Fills one panel per profile entry, matching in DOM order. Panels already
 * rendered are filled first; for the rest it clicks the section's "Add
 * Another" button (strict label allowlist) and fills each new panel as it
 * appears. Reports entries it still couldn't place.
 */
async function fillRepeatedSection<T extends ExperienceEntry | EducationEntry>(
  entries: T[],
  anchorSynonyms: string[],
  sectionTerms: string[],
  fillEntry: (panel: HTMLElement, entry: T, scoped: FillableElement[]) => void,
): Promise<{ filledCount: number; remaining: number }> {
  if (entries.length === 0) return { filledCount: 0, remaining: 0 };

  const usedPanels: HTMLElement[] = [];
  let pool = findFillableFields();
  const anchors = findAllFieldsBySynonyms(pool, anchorSynonyms, { onlyEmpty: false });

  let entryIndex = 0;
  for (let i = 0; i < anchors.length && entryIndex < entries.length; i++) {
    const panel = findPanelContainer(anchors[i], pool, anchors);
    fillEntry(panel, entries[entryIndex], pool.filter((f) => panel.contains(f)));
    usedPanels.push(panel);
    entryIndex++;
    // Remove this panel's fields from the pool so later panels can't be
    // matched to the same fields if panel boundaries happened to overlap.
    pool = pool.filter((f) => !panel.contains(f));
  }

  // Grow the section for the remaining entries.
  let safety = 10;
  while (entryIndex < entries.length && safety-- > 0) {
    const addButton = findAddButton(sectionTerms);
    if (!addButton) break;
    const before = countAnchors(anchorSynonyms);
    addButton.click();
    const appeared = await waitFor(() => countAnchors(anchorSynonyms) > before, 3000);
    if (!appeared) break;
    pool = findFillableFields().filter((f) => !usedPanels.some((p) => p.contains(f)));
    const fresh = findAllFieldsBySynonyms(pool, anchorSynonyms, { onlyEmpty: false });
    if (fresh.length === 0) break;
    // Boundary detection uses every anchor on the page (incl. already-used
    // panels) so the new panel's walk can't climb past its siblings.
    const allAnchors = findAllFieldsBySynonyms(findFillableFields(), anchorSynonyms, { onlyEmpty: false });
    const panel = findPanelContainer(fresh[0], pool, allAnchors);
    fillEntry(panel, entries[entryIndex], pool.filter((f) => panel.contains(f)));
    usedPanels.push(panel);
    entryIndex++;
  }

  return { filledCount: entryIndex, remaining: entries.length - entryIndex };
}

/**
 * Fills whatever contact fields, experience/education panels, and
 * resume/cover-letter file inputs are visible on the CURRENT step of the
 * Workday wizard. Deliberately does not click Next/Continue/Submit or "Add
 * Another" — the user advances the wizard themselves and re-runs this once
 * per step, which doubles as their review checkpoint.
 */
export async function runAutofill(
  pkg: AutofillPackage,
  customRules: CustomFillRule[] = [],
): Promise<AutofillRunSummary> {
  const summary: AutofillRunSummary = {
    filled: [],
    skipped: [],
    filesAttached: [],
    leftForYou: [],
    mismatches: [],
    stillRequired: [],
  };
  startFillLog();
  const fields = findFillableFields();

  // Surface (never touch) self-identification questions on this step.
  for (const el of fields) {
    const raw = fieldLabelText(el);
    if (raw && isPersonalField(raw)) {
      summary.leftForYou.push(raw.slice(0, 60));
    }
  }

  for (const [key, synonyms] of CONTACT_SYNONYMS) {
    const value = pkg.contact[key];
    if (!value) continue;
    const field = findFieldBySynonyms(fields, synonyms);
    if (field) {
      setFieldValue(field, value);
      summary.filled.push(key);
      continue;
    }
    // Field exists but is already filled: don't overwrite, but flag when the
    // employer-prefilled value differs from the profile (stale phone, etc.).
    const prefilled = findFieldBySynonyms(fields, synonyms, { onlyEmpty: false });
    if (prefilled && prefilled.value?.trim() && prefilled.value.trim() !== value.trim()) {
      summary.mismatches.push(`${key}: form has "${prefilled.value.trim().slice(0, 40)}", profile has "${value.slice(0, 40)}"`);
      continue;
    }
    // No text input matched — Workday renders country/state/phone-type as
    // custom listbox buttons or type-ahead search comboboxes. Sequential
    // awaits: only one popup at a time.
    const listbox = findListboxButtonBySynonyms(document, synonyms);
    if (listbox && (await fillListbox(listbox, value))) {
      summary.filled.push(key);
      continue;
    }
    const combobox = findComboboxBySynonyms(document, synonyms);
    if (combobox && (await fillSearchCombobox(combobox, value))) {
      summary.filled.push(key);
    } else {
      summary.skipped.push(key);
    }
  }

  // User-defined answers ("Desired salary = 85000", the how-did-you-hear
  // default, ...). Self-ID questions stay off-limits even via custom rules.
  for (const rule of customRules) {
    const label = rule.label.trim();
    if (!label || !rule.value || isPersonalField(label)) continue;
    const field = findFieldBySynonyms(fields, [label.toLowerCase()]);
    if (field) {
      setFieldValue(field, rule.value);
      summary.filled.push(`custom: ${label.slice(0, 40)}`);
      continue;
    }
    const listbox = findListboxButtonBySynonyms(document, [label.toLowerCase()]);
    if (listbox && (await fillListbox(listbox, rule.value))) {
      summary.filled.push(`custom: ${label.slice(0, 40)}`);
      continue;
    }
    const combobox = findComboboxBySynonyms(document, [label.toLowerCase()]);
    if (combobox && (await fillSearchCombobox(combobox, rule.value))) {
      summary.filled.push(`custom: ${label.slice(0, 40)}`);
    }
  }

  // A base-profile fill source has no generated PDFs — never attach empty files.
  const resumeInput = pkg.resumePdfBase64
    ? findFileInputBySynonyms(["resume", "cv", "upload resume"], { allowSoleFallback: true })
    : null;
  if (resumeInput) {
    attachFileToInput(resumeInput, pkg.resumePdfBase64, pkg.resumeFileName);
    summary.filesAttached.push("resume");
  }

  const coverLetterInput = pkg.coverLetterPdfBase64
    ? findFileInputBySynonyms(["cover letter", "upload cover letter"])
    : null;
  if (coverLetterInput && coverLetterInput !== resumeInput) {
    attachFileToInput(coverLetterInput, pkg.coverLetterPdfBase64, pkg.coverLetterFileName);
    summary.filesAttached.push("cover letter");
  }

  // Some tenants ask for the cover letter as a textarea instead of a file.
  const coverLetterTextarea = findFieldBySynonyms(
    fields.filter((f) => f instanceof HTMLTextAreaElement),
    ["cover letter"],
  );
  if (coverLetterTextarea && pkg.coverLetterText) {
    setFieldValue(coverLetterTextarea, pkg.coverLetterText);
    summary.filled.push("cover letter text");
  }

  const experienceResult = await fillRepeatedSection(pkg.experience, TITLE_SYNONYMS, ["work experience", "experience", "job history"], (panel, entry, scoped) => {
    fillWithinPanel(panel, scoped, [
      [TITLE_SYNONYMS, entry.title],
      [COMPANY_SYNONYMS, entry.company],
      [["location", "city"], entry.location],
    ]);
    if (!fillDateParts(scoped, "start date", entry.startDate)) {
      fillWithinPanel(panel, scoped, [[["start date"], entry.startDate]]);
    }
    if (isPresentDate(entry.endDate)) {
      const checkbox = findCheckboxBySynonyms(panel, CURRENT_ROLE_SYNONYMS);
      if (checkbox) setCheckbox(checkbox, true);
    } else if (!fillDateParts(scoped, "end date", entry.endDate)) {
      fillWithinPanel(panel, scoped, [[["end date"], entry.endDate]]);
    }
    const description = findFieldBySynonyms(scoped, ["role description", "job description", "description"]);
    if (description) setFieldValue(description, entry.bullets.map((b) => `• ${b}`).join("\n"));
  });
  if (experienceResult.filledCount) summary.filled.push(`${experienceResult.filledCount} work experience panel(s)`);
  if (experienceResult.remaining) {
    summary.skipped.push(
      `${experienceResult.remaining} more work experience entr${experienceResult.remaining === 1 ? "y" : "ies"} (couldn't find/grow this section's "Add Another" button — add the panel manually and re-run)`,
    );
  }

  const educationResult = await fillRepeatedSection(pkg.education, SCHOOL_SYNONYMS, ["education"], (panel, entry, scoped) => {
    fillWithinPanel(panel, scoped, [
      [SCHOOL_SYNONYMS, entry.school],
      [DEGREE_SYNONYMS, entry.degree],
      [["field of study", "major"], entry.fieldOfStudy],
      [["gpa"], entry.gpa ?? ""],
    ]);
    if (!fillDateParts(scoped, "start date", entry.startDate)) {
      fillWithinPanel(panel, scoped, [[["start date"], entry.startDate]]);
    }
    if (!fillDateParts(scoped, "end date", entry.endDate)) {
      fillWithinPanel(panel, scoped, [[["end date", "graduation date"], entry.endDate]]);
    }
  });
  if (educationResult.filledCount) summary.filled.push(`${educationResult.filledCount} education panel(s)`);
  if (educationResult.remaining) {
    summary.skipped.push(
      `${educationResult.remaining} more education entr${educationResult.remaining === 1 ? "y" : "ies"} (couldn't find/grow this section's "Add Another" button — add the panel manually and re-run)`,
    );
  }

  summary.stillRequired = findEmptyRequiredFields();
  return summary;
}

export interface AutofillPreview {
  wouldFill: string[];
  files: string[];
  experiencePanels: number;
  educationPanels: number;
}

/**
 * Dry run: highlights (dashed amber) the text fields autofill would write,
 * WITHOUT writing anything. Dropdowns/comboboxes/dates resolve at fill time
 * and aren't previewed — the summary says so.
 */
export function previewAutofill(pkg: AutofillPackage, customRules: CustomFillRule[] = []): AutofillPreview {
  const fields = findFillableFields();
  const wouldFill: string[] = [];

  for (const [key, synonyms] of CONTACT_SYNONYMS) {
    if (!pkg.contact[key]) continue;
    const field = findFieldBySynonyms(fields, synonyms);
    if (field) {
      wouldFill.push(key);
      flashPreviewField(field);
    }
  }
  for (const rule of customRules) {
    const label = rule.label.trim();
    if (!label || !rule.value || isPersonalField(label)) continue;
    const field = findFieldBySynonyms(fields, [label.toLowerCase()]);
    if (field) {
      wouldFill.push(`custom: ${label.slice(0, 40)}`);
      flashPreviewField(field);
    }
  }

  const files: string[] = [];
  if (pkg.resumePdfBase64 && findFileInputBySynonyms(["resume", "cv", "upload resume"], { allowSoleFallback: true })) {
    files.push("resume");
  }
  if (pkg.coverLetterPdfBase64 && findFileInputBySynonyms(["cover letter", "upload cover letter"])) {
    files.push("cover letter");
  }

  const experienceAnchors = findAllFieldsBySynonyms(fields, TITLE_SYNONYMS, { onlyEmpty: false }).length;
  const educationAnchors = findAllFieldsBySynonyms(fields, SCHOOL_SYNONYMS, { onlyEmpty: false }).length;

  return {
    wouldFill,
    files,
    experiencePanels: Math.min(experienceAnchors, pkg.experience.length),
    educationPanels: Math.min(educationAnchors, pkg.education.length),
  };
}

/** Labels of required fields on this step that are still empty — the
 * checklist of what the user must handle before advancing the wizard. */
export function findEmptyRequiredFields(): string[] {
  const labels: string[] = [];
  for (const el of findFillableFields()) {
    if (el.value?.trim()) continue;
    const required =
      ("required" in el && (el as HTMLInputElement).required) ||
      el.getAttribute("aria-required") === "true";
    if (!required) continue;
    const label = fieldLabelText(el).trim();
    if (label) labels.push(label.slice(0, 60));
  }
  return labels.slice(0, 12);
}

export interface QuestionField {
  label: string;
  el: FillableElement;
}

/**
 * Finds unanswered free-text question fields on the current step: empty
 * textareas with a real label, plus text inputs whose label reads like a
 * question. Excludes cover-letter fields (filled from the package directly).
 */
export function findQuestionFields(): QuestionField[] {
  const results: QuestionField[] = [];
  for (const el of findFillableFields()) {
    if (el.value?.trim()) continue;
    const isTextarea = el instanceof HTMLTextAreaElement;
    const raw = fieldLabelText(el).trim();
    if (!raw || raw.length < 12) continue;
    if (/cover letter/i.test(raw)) continue;
    if (isPersonalField(raw)) continue; // self-ID questions are never auto-drafted
    if (isTextarea || raw.includes("?")) {
      results.push({ label: raw.slice(0, 300), el });
    }
  }
  return results.slice(0, 15);
}

/** Fills drafted answers back into their fields by position. */
export function applyAnswers(
  fields: QuestionField[],
  answers: { question: string; answer: string }[],
): number {
  let filled = 0;
  for (let i = 0; i < fields.length && i < answers.length; i++) {
    if (!answers[i].answer) continue;
    setFieldValue(fields[i].el, answers[i].answer);
    filled++;
  }
  return filled;
}

/** True when this label matches something autofill already knows how to
 * fill (a contact synonym or a repeated-section field). */
function matchesKnownSynonyms(label: string): boolean {
  const lower = label.toLowerCase();
  const known = [
    ...CONTACT_SYNONYMS.flatMap(([, synonyms]) => synonyms),
    ...TITLE_SYNONYMS,
    ...COMPANY_SYNONYMS,
    ...SCHOOL_SYNONYMS,
    ...DEGREE_SYNONYMS,
    "field of study", "major", "gpa", "location", "start date", "end date",
    "graduation date", "description", "cover letter", "resume", "cv",
  ];
  return known.some((syn) => lower.includes(syn));
}

/** Debug report for tuning field synonyms: every visible fillable field's
 * label plus whether it currently holds a value, then ready-to-paste custom
 * rule stubs for the empty fields autofill has no synonym for. Contains NO
 * user data — only the employer's form labels. */
export function buildFieldReport(): string {
  const fields = findFillableFields();
  const lines = fields.map((el) => {
    const kind = el.tagName.toLowerCase() + (el instanceof HTMLInputElement ? `[${el.type}]` : "");
    const state = el.value?.trim() ? "filled" : "empty";
    return `- (${kind}, ${state}) ${fieldLabelText(el).slice(0, 160)}`;
  });

  // Empty + unmatched + not personal + not an essay question → the exact
  // fields a custom rule can pick up tonight without a code change.
  const suggestions: string[] = [];
  for (const el of fields) {
    if (el.value?.trim()) continue;
    const label = fieldLabelText(el).trim();
    if (!label || isPersonalField(label) || label.includes("?")) continue;
    if (el instanceof HTMLTextAreaElement) continue; // question drafting handles these
    if (matchesKnownSynonyms(label)) continue;
    suggestions.push(`${label.slice(0, 80)} = `);
    if (suggestions.length >= 10) break;
  }

  return [
    `Workdayz field report`,
    `page: ${location.hostname}${location.pathname}`,
    `fields (${lines.length}):`,
    ...lines,
    ...(suggestions.length
      ? [
          ``,
          `UNMATCHED — paste these into the extension popup's custom answers,`,
          `fill in the right-hand side, save, and re-run autofill:`,
          ...suggestions,
        ]
      : []),
  ].join("\n");
}

export function looksLikeApplicationForm(): boolean {
  if (/\/apply\b/i.test(window.location.pathname)) return true;
  const fields = findFillableFields();
  const hasName = findFieldBySynonyms(fields, ["first name"], { onlyEmpty: false });
  const hasEmail = findFieldBySynonyms(fields, ["email"], { onlyEmpty: false });
  return Boolean(hasName && hasEmail);
}

import type { AutofillPackage, AutofillRunSummary, CertificationEntry, CustomFillRule, EducationEntry, ExperienceEntry } from "../types";
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
  setFillHighlight,
  startFillLog,
  type FillableElement,
} from "./dom-utils";
import { normalizeFieldValue, expandWithInternational } from "./fill-engine";
import { getSettings } from "./features";
import { STORAGE_KEYS } from "../types";

/** Item 60: labels the user chose to never autofill on this tenant. */
async function loadSkipSet(): Promise<Set<string>> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEYS.skipFields);
    const map = (data[STORAGE_KEYS.skipFields] ?? {}) as Record<string, string[]>;
    return new Set((map[location.hostname] ?? []).map((s) => s.toLowerCase()));
  } catch {
    return new Set();
  }
}

function isSkipped(skip: Set<string>, label: string): boolean {
  const lower = label.toLowerCase();
  for (const s of skip) if (lower.includes(s)) return true;
  return false;
}

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

// Specific keys BEFORE generic ones: label matching is substring-based, so
// "preferred first name" must be claimed by preferredName before firstName's
// "first name" synonym reaches it (same for workPhone vs phone).
const CONTACT_SYNONYMS: [keyof AutofillPackage["contact"], string[]][] = [
  ["preferredName", ["preferred name", "preferred first name", "goes by", "nickname"]],
  ["firstName", ["first name", "legal first name", "given name"]],
  ["lastName", ["last name", "legal last name", "family name", "surname"]],
  ["email", ["email address", "email"]],
  ["workPhone", ["work phone", "business phone", "secondary phone", "alternate phone"]],
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
const CERT_NAME_SYNONYMS = ["certification", "certificate", "license", "credential", "accreditation"];
const ISSUER_SYNONYMS = ["issuing organization", "issued by", "issuer", "issuing body", "certifying body"];
const ISSUED_DATE_TERMS = ["issued date", "issue date", "issued", "date acquired", "date obtained", "certification date", "credential date"];
const EXPIRATION_DATE_TERMS = ["expiration date", "expiry date", "expires", "expiration", "valid until", "renewal date"];

function isPresentDate(value: string): boolean {
  return /present|current/i.test(value);
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function expandTwoDigitYear(yy: string): string {
  const n = Number(yy);
  const currentYY = new Date().getFullYear() % 100;
  // "06" -> 2006, "95" -> 1995 (anything beyond next year is last century).
  return String(n <= currentYY + 1 ? 2000 + n : 1900 + n);
}

/**
 * Parses a wide range of resume date strings into { month?, year } so the
 * autofill can fill Workday's Month/Year fields. Accepts: "2021-06",
 * "2021-06-15", "06/2021", "6/2021", "06/21", "June 2021", "Jun 2021",
 * "Sept. 2019", and bare "2021". Returns null for "Present"/"Current" (the
 * caller checks the current-role box instead) and anything unrecognized.
 */
export function parseDateParts(value: string): { month?: string; year: string } | null {
  const v = (value ?? "").trim();
  if (!v || /^(present|current|now|ongoing|to date|n\/?a)$/i.test(v)) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const validMonth = (n: number) => (n >= 1 && n <= 12 ? pad(n) : undefined);

  // 2021-06, 2021/06, or 2021-06-15 (ISO, optional day)
  let m = v.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/);
  if (m) return { year: m[1], month: validMonth(Number(m[2])) };
  // 06/2021 or 6-2021
  m = v.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return { year: m[2], month: validMonth(Number(m[1])) };
  // 06/21 (two-digit year)
  m = v.match(/^(\d{1,2})[-/.](\d{2})$/);
  if (m) return { year: expandTwoDigitYear(m[2]), month: validMonth(Number(m[1])) };
  // June 2021 / Jun 2021 / Sept. 2019
  m = v.match(/^([A-Za-z]{3,})\.?\s+(\d{4})$/);
  if (m) {
    const abbr = m[1].toLowerCase().slice(0, 3);
    const idx = MONTH_NAMES.findIndex((name) => name.startsWith(abbr));
    if (idx >= 0) return { year: m[2], month: pad(idx + 1) };
  }
  m = v.match(/^(\d{4})$/);
  if (m) return { year: m[1] };
  return null;
}

// Workday's Experience/Education date fields are labeled inconsistently
// across tenants: "Start Date"/"End Date" on some, "From"/"To" on Xcel and
// many others. Try every alias.
const START_DATE_TERMS = ["start date", "from date", "from"];
const END_DATE_TERMS = ["end date", "to date", "graduation date", "to"];

/** The field-group container whose label matches a date group ("From"/"To"/
 * "Start Date"). Workday puts that label on a wrapper ABOVE the actual date
 * inputs, so a per-input label lookup misses it — find the label, return the
 * wrapper that holds both it and the inputs. */
function findDateContainer(panel: HTMLElement, groupSynonyms: string[]): HTMLElement | null {
  for (const lbl of Array.from(panel.querySelectorAll<HTMLElement>("label, legend"))) {
    const t = normalizeLower((lbl.textContent ?? "").replace(/\*/g, " "));
    if (!t) continue;
    if (!groupSynonyms.some((g) => t === g || t.startsWith(`${g} `))) continue;
    const container = lbl.closest<HTMLElement>("[data-automation-id]");
    if (container && container.querySelector("input")) return container;
    if (lbl.parentElement?.querySelector("input")) return lbl.parentElement as HTMLElement;
  }
  // Some tenants put the label on a sibling or parent div, not a <label> element.
  // Look for elements with data-automation-id whose text matches and contains date inputs.
  // Narrow scope: only match elements that have a data-automation-id attribute to avoid
  // matching arbitrary divs that happen to contain the word "from" or "to".
  for (const el of Array.from(panel.querySelectorAll<HTMLElement>("[data-automation-id], span, fieldset"))) {
    const t = normalizeLower((el.textContent ?? "").replace(/\*/g, " "));
    if (!t) continue;
    if (!groupSynonyms.some((g) => t === g || t.startsWith(`${g} `))) continue;
    if (el.querySelector("input")) return el;
  }
  return null;
}

/** Fills the date input(s) inside a group container. Handles a single
 * "MM / YYYY" box or split Month/Year segments, and — unlike the normal
 * field path — deliberately writes to READONLY inputs (Workday's date
 * widgets are readonly + picker; the native value setter still commits and
 * the change events make the SPA accept it). */
function fillDateInContainer(container: HTMLElement, value: string): boolean {
  const parsed = parseDateParts(value);
  if (!parsed) return false;
  const inputs = Array.from(container.querySelectorAll<HTMLInputElement>("input")).filter(
    (el) => el.type !== "hidden" && !el.disabled && isVisible(el),
  );
  if (inputs.length === 0) return false;
  const mmyyyy = parsed.month ? `${parsed.month}/${parsed.year}` : parsed.year;
  if (inputs.length === 1) {
    setFieldValue(inputs[0], mmyyyy);
    return true;
  }
  const attrs = (el: HTMLInputElement) =>
    `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("data-automation-id") ?? ""} ${el.getAttribute("placeholder") ?? ""} ${el.getAttribute("name") ?? ""} ${el.className ?? ""}`;
  const yearEl = inputs.find((el) => /year|yyyy/i.test(attrs(el)));
  const monthEl = inputs.find((el) => el !== yearEl && /month|\bmm\b/i.test(attrs(el)));
  if (yearEl) {
    setFieldValue(yearEl, parsed.year);
    if (monthEl && parsed.month) setFieldValue(monthEl, parsed.month);
    return true;
  }
  // Some tenants use day/month/year triple inputs — fill month and year, skip day
  const dayEl = inputs.find((el) => /day|dd\b/i.test(attrs(el)));
  if (dayEl && monthEl && yearEl) {
    setFieldValue(dayEl, "15");
    setFieldValue(monthEl, parsed.month ?? "01");
    setFieldValue(yearEl, parsed.year);
    return true;
  }
  // Fallback: try to identify by position (first = month, second = year)
  if (inputs.length === 2) {
    setFieldValue(inputs[0], parsed.month ?? "01");
    setFieldValue(inputs[1], parsed.year);
    return true;
  }
  return false;
}

/**
 * Fills a date group, trying (1) the labeled group container — the robust
 * path that also reaches readonly single/segmented Workday date widgets,
 * (2) split segments whose own label carries the group word, (3) a plain
 * single field. Returns false if nothing matched.
 */
function tryFillDateOnce(panel: HTMLElement, scoped: FillableElement[], groupSynonyms: string[], value: string): boolean {
  const container = findDateContainer(panel, groupSynonyms);
  if (container && fillDateInContainer(container, value)) return true;

  const parsed = parseDateParts(value);
  if (parsed) {
    for (const groupSynonym of groupSynonyms) {
      const yearField = findFieldByAllTerms(scoped, [groupSynonym, "year"]);
      if (!yearField) continue;
      setFieldValue(yearField, parsed.year);
      if (parsed.month) {
        const monthField = findFieldByAllTerms(scoped, [groupSynonym, "month"]);
        if (monthField) setFieldValue(monthField, parsed.month);
      }
      return true;
    }
  }

  const field = findFieldBySynonyms(scoped, groupSynonyms);
  if (field) {
    setFieldValue(field, value);
    return true;
  }
  return false;
}

/** True when SOME input in the date group actually holds a value. */
function dateStuck(panel: HTMLElement, groupSynonyms: string[]): boolean {
  const container = findDateContainer(panel, groupSynonyms);
  if (!container) return true; // no group widget — nothing to verify against
  return Array.from(container.querySelectorAll("input")).some((i) => i.value.trim() !== "");
}

/** Item 61: Workday sometimes re-renders a date widget right as we write to
 * it, dropping the value. Verify the write landed and retry once after the
 * SPA settles — the same resilience the Add-button path already has. */
async function tryFillDate(panel: HTMLElement, scoped: FillableElement[], groupSynonyms: string[], value: string): Promise<boolean> {
  const filled = tryFillDateOnce(panel, scoped, groupSynonyms, value);
  if (!filled) return false;
  if (dateStuck(panel, groupSynonyms)) return true;
  await new Promise((r) => setTimeout(r, 350));
  tryFillDateOnce(panel, scoped, groupSynonyms, value);
  return dateStuck(panel, groupSynonyms);
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

let addButtonCache: { buttons: HTMLElement[]; timestamp: number } | null = null;
const ADD_BUTTON_CACHE_TTL = 2000; // 2 seconds

/** Finds a section's Add / "Add Another" button. Conservative: text must
 * start with "add" and never look like navigation/submission or a
 * Delete/Remove control. A bare "Add" (no section words in its own text) is
 * matched by the section heading above it, so three identical "Add" buttons
 * are told apart. Falls back to a single unambiguous Add button.
 * Caches the button query for 2s to avoid re-scanning all buttons on every
 * call during section growth (the button element stays the same). */
function findAddButton(sectionTerms: string[]): HTMLElement | null {
  // Use cached result if fresh enough
  const now = Date.now();
  let adds: HTMLElement[];
  if (addButtonCache && (now - addButtonCache.timestamp) < ADD_BUTTON_CACHE_TTL) {
    adds = addButtonCache.buttons;
  } else {
    adds = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))) {
      if (!isVisible(el)) continue;
      const text = normalizeLower(el.textContent ?? "");
      if (!/^add\b/.test(text)) continue;
      if (/\b(submit|continue|next|save|apply|delete|remove|cancel)\b/.test(text)) continue;
      adds.push(el);
    }
    addButtonCache = { buttons: adds, timestamp: now };
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

/** Every interactive control on the page: plain fields PLUS Workday's
 * type-ahead comboboxes and listbox-button dropdowns (which findFillableFields
 * deliberately excludes). A newly rendered panel always increases this, so it
 * is a reliable "a panel appeared" signal even for a panel whose only anchor
 * is a combobox (e.g. Education's "School or University"). */
function sectionControlEls(): Element[] {
  return [
    ...findFillableFields(),
    ...Array.from(
      document.querySelectorAll('input[role="combobox"], input[aria-autocomplete], button[aria-haspopup="listbox"]'),
    ).filter((el) => isVisible(el)),
  ];
}

function countFormControls(): number {
  return sectionControlEls().length;
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
 * rendered are filled first; for the rest it clicks the section's "Add" /
 * "Add Another" button and fills each new panel as it appears.
 *
 * `findAnchorEls` returns one element per panel used to locate that panel's
 * container — it may return comboboxes (Education's "School" is a type-ahead
 * combobox, not a plain input), so panels are detected/grown even when their
 * key field isn't a normal text box. `fillEntry` may be async (it awaits
 * dropdown/combobox popups).
 */
async function fillRepeatedSection<T extends ExperienceEntry | EducationEntry | CertificationEntry>(
  entries: T[],
  findAnchorEls: () => HTMLElement[],
  sectionTerms: string[],
  fillEntry: (panel: HTMLElement, entry: T, scoped: FillableElement[]) => void | Promise<void>,
): Promise<{ filledCount: number; remaining: number }> {
  if (entries.length === 0) return { filledCount: 0, remaining: 0 };

  const usedPanels: HTMLElement[] = [];
  let entryIndex = 0;

  const fillAt = async (anchor: HTMLElement) => {
    const controls = sectionControlEls().filter((c) => !usedPanels.some((p) => p.contains(c)));
    const pool = findFillableFields().filter((f) => !usedPanels.some((p) => p.contains(f)));
    // Boundary = anchors from EVERY repeated section, so a panel with only
    // one counted control (a certification's name combobox — its readonly
    // date boxes don't count) can't climb past its section and swallow
    // another section's fields.
    const panel = findPanelContainer(anchor, controls, allRepeatedAnchors());
    await fillEntry(panel, entries[entryIndex], pool.filter((f) => panel.contains(f)));
    usedPanels.push(panel);
    entryIndex++;
  };

  // 1) Fill panels already on the page.
  for (const anchor of findAnchorEls()) {
    if (entryIndex >= entries.length) break;
    if (usedPanels.some((p) => p.contains(anchor))) continue;
    await fillAt(anchor);
  }

  // 2) Grow the section for the rest. Reuse the same Add button element across
  // iterations (Workday relabels it "Add Another" and moves it down but keeps
  // the element); only re-find it if it detaches. A new panel is detected by a
  // rise in total control count, which works even for combobox-only panels.
  let addButton = findAddButton(sectionTerms);
  let safety = 12;
  while (entryIndex < entries.length && safety-- > 0) {
    if (!addButton || !addButton.isConnected || !isVisible(addButton)) {
      addButton = findAddButton(sectionTerms);
    }
    if (!addButton) break;
    const before = countFormControls();
    addButton.click();
    const grew = await waitFor(() => countFormControls() > before, 4500);
    if (!grew) break;
    const fresh = findAnchorEls().find((a) => !usedPanels.some((p) => p.contains(a)));
    if (!fresh) break;
    await fillAt(fresh);
  }

  return { filledCount: entryIndex, remaining: entries.length - entryIndex };
}

/** Anchors from every repeated section (experience/education/certifications)
 * — used only as the panel-boundary guard so one section's panel can't
 * absorb another's controls. */
function allRepeatedAnchors(): HTMLElement[] {
  return [...anchorEls(TITLE_SYNONYMS), ...anchorEls(SCHOOL_SYNONYMS), ...anchorEls(CERT_NAME_SYNONYMS)];
}

/** Anchor elements for a repeated section: plain-input matches first, else
 * visible type-ahead comboboxes whose label matches (Education's School). */
function anchorEls(synonyms: string[]): HTMLElement[] {
  const textAnchors = findAllFieldsBySynonyms(findFillableFields(), synonyms, { onlyEmpty: false });
  if (textAnchors.length) return textAnchors;
  return Array.from(
    document.querySelectorAll<HTMLElement>('input[role="combobox"], input[aria-autocomplete]'),
  ).filter((el) => {
    if (!isVisible(el)) return false;
    const label = fieldLabelText(el).toLowerCase();
    return synonyms.some((s) => label.includes(s));
  });
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
  // Feature settings gate behavior for the whole run: smart formatting
  // normalizes values to Workday-friendly shapes before writing; the
  // highlight toggle controls the fill-flash effect.
  const settings = await getSettings();
  setFillHighlight(settings.highlightFilledFields);
  const smartValue = (label: string, value: string): string =>
    settings.smartFormatting ? normalizeFieldValue(label, value) : value;
  const skipSet = await loadSkipSet(); // item 60
  const fields = findFillableFields();
  // Fields THIS run has written — a later synonym that substring-matches one
  // of them ("address" ⊂ "email address") must not report a fake mismatch.
  const filledThisRun = new Set<FillableElement>();

  // Surface (never touch) self-identification questions on this step.
  for (const el of fields) {
    const raw = fieldLabelText(el);
    if (raw && isPersonalField(raw)) {
      summary.leftForYou.push(raw.slice(0, 60));
    }
  }

  for (const [key, rawSynonyms] of CONTACT_SYNONYMS) {
    const value = pkg.contact[key];
    if (!value) continue;
    // Item 57: augment with known international label variants (prénom,
    // apellido, PLZ…) so non-English tenants match too.
    const synonyms = expandWithInternational(rawSynonyms);
    // Item 60: user-skipped fields on this tenant are never touched.
    if (isSkipped(skipSet, synonyms[0])) {
      summary.skipped.push(`${key} (skipped by you on this site)`);
      continue;
    }
    // Normalize by the field's primary label ("phone number" → formatPhone…).
    // Only text inputs get the formatted value — listbox/combobox selection
    // must match the raw option text.
    const formatted = smartValue(rawSynonyms[0], value);
    const field = findFieldBySynonyms(fields, synonyms);
    if (field) {
      setFieldValue(field, formatted);
      filledThisRun.add(field);
      summary.filled.push(key);
      continue;
    }
    // Field exists but is already filled: don't overwrite, but flag when the
    // employer-prefilled value differs from the profile (stale phone, etc.).
    // Either the raw or the smart-formatted shape counts as a match — and a
    // field we filled ourselves is never a mismatch.
    const prefilled = findFieldBySynonyms(fields, synonyms, { onlyEmpty: false });
    if (prefilled && prefilled.value?.trim()) {
      if (!filledThisRun.has(prefilled)) {
        const existing = prefilled.value.trim();
        if (existing !== value.trim() && existing !== formatted.trim()) {
          summary.mismatches.push(`${key}: form has "${existing.slice(0, 40)}", profile has "${value.slice(0, 40)}"`);
        }
      }
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
      // Smart formatting applies label-based ("desired salary" → currency,
      // "available start date" → MM/YYYY…); dropdown paths use the raw value.
      setFieldValue(field, smartValue(label, rule.value));
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

  // Item 82: never quietly upload documents over plain HTTP (localhost is the
  // test harness). Real Workday tenants are always HTTPS, so this only fires
  // on something suspicious.
  const insecure = location.protocol === "http:" && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (insecure && (pkg.resumePdfBase64 || pkg.coverLetterPdfBase64 || pkg.extraFile?.base64)) {
    summary.mismatches.push("This page is NOT using HTTPS — documents were not attached. Check the address bar.");
  }

  // A base-profile fill source has no generated PDFs — never attach empty files.
  const resumeInput = !insecure && pkg.resumePdfBase64
    ? findFileInputBySynonyms(["resume", "cv", "upload resume"], { allowSoleFallback: true })
    : null;
  if (resumeInput) {
    attachFileToInput(resumeInput, pkg.resumePdfBase64, pkg.resumeFileName);
    summary.filesAttached.push("resume");
  }

  const coverLetterInput = !insecure && pkg.coverLetterPdfBase64
    ? findFileInputBySynonyms(["cover letter", "upload cover letter"])
    : null;
  if (coverLetterInput && coverLetterInput !== resumeInput) {
    attachFileToInput(coverLetterInput, pkg.coverLetterPdfBase64, pkg.coverLetterFileName);
    summary.filesAttached.push("cover letter");
  }

  // Item 63: extra document (writing sample, portfolio…) — only into inputs
  // that aren't the resume/cover-letter ones.
  if (!insecure && pkg.extraFile?.base64) {
    const extraInput = findFileInputBySynonyms([
      "writing sample", "portfolio", "work sample", "additional document", "other document", "supporting document",
    ]);
    if (extraInput && extraInput !== resumeInput && extraInput !== coverLetterInput) {
      attachFileToInput(extraInput, pkg.extraFile.base64, pkg.extraFile.name);
      summary.filesAttached.push(pkg.extraFile.name);
    }
  }

  // Item 64: first professional reference (single-panel best effort — extra
  // reference panels vary too much per tenant to grow blindly).
  const ref = pkg.references?.find((r) => r.name?.trim());
  if (ref) {
    const refPairs: [string[], string | undefined][] = [
      [["reference name", "referee name", "name of reference"], ref.name],
      [["reference title", "referee title"], ref.title],
      [["reference company", "reference organization", "referee company"], ref.company],
      [["reference email", "referee email"], ref.email],
      [["reference phone", "referee phone"], ref.phone],
      [["relationship to you", "relationship"], ref.relationship],
    ];
    let refFilled = 0;
    const fresh = findFillableFields();
    for (const [syns, val] of refPairs) {
      if (!val?.trim()) continue;
      const f = findFieldBySynonyms(fresh, syns);
      if (f) {
        setFieldValue(f, val);
        refFilled += 1;
      }
    }
    if (refFilled > 0) summary.filled.push(`reference: ${ref.name} (${refFilled} field(s))`);
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

  const experienceResult = await fillRepeatedSection(pkg.experience, () => anchorEls(TITLE_SYNONYMS), ["work experience", "experience", "job history"], async (panel, entry, scoped) => {
    fillWithinPanel(panel, scoped, [
      [TITLE_SYNONYMS, entry.title],
      [COMPANY_SYNONYMS, entry.company],
      [["location", "city"], entry.location],
    ]);
    // Company/title are occasionally type-ahead comboboxes rather than inputs.
    if (!findFieldBySynonyms(scoped, COMPANY_SYNONYMS, { onlyEmpty: false }) && entry.company) {
      const companyCombo = findComboboxBySynonyms(panel, COMPANY_SYNONYMS);
      if (companyCombo) await fillSearchCombobox(companyCombo, entry.company);
    }
    await tryFillDate(panel, scoped, START_DATE_TERMS, entry.startDate);
    if (isPresentDate(entry.endDate)) {
      const checkbox = findCheckboxBySynonyms(panel, CURRENT_ROLE_SYNONYMS);
      if (checkbox) setCheckbox(checkbox, true);
    } else {
      await tryFillDate(panel, scoped, END_DATE_TERMS, entry.endDate);
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

  const educationResult = await fillRepeatedSection(pkg.education, () => anchorEls(SCHOOL_SYNONYMS), ["education"], async (panel, entry, scoped) => {
    // School: a plain input on some tenants, a type-ahead combobox on Xcel.
    const schoolInput = findFieldBySynonyms(scoped, SCHOOL_SYNONYMS);
    if (schoolInput) {
      setFieldValue(schoolInput, entry.school);
    } else if (entry.school) {
      const schoolCombo = findComboboxBySynonyms(panel, SCHOOL_SYNONYMS);
      if (schoolCombo) await fillSearchCombobox(schoolCombo, entry.school);
    }
    // Degree: input, listbox button ("Select One"), or combobox.
    const degreeInput = findFieldBySynonyms(scoped, DEGREE_SYNONYMS);
    if (degreeInput) {
      setFieldValue(degreeInput, entry.degree);
    } else if (entry.degree) {
      const degreeListbox = findListboxButtonBySynonyms(panel, DEGREE_SYNONYMS);
      if (degreeListbox && !(await fillListbox(degreeListbox, entry.degree))) {
        const degreeCombo = findComboboxBySynonyms(panel, DEGREE_SYNONYMS);
        if (degreeCombo) await fillSearchCombobox(degreeCombo, entry.degree);
      } else if (!degreeListbox) {
        const degreeCombo = findComboboxBySynonyms(panel, DEGREE_SYNONYMS);
        if (degreeCombo) await fillSearchCombobox(degreeCombo, entry.degree);
      }
    }
    fillWithinPanel(panel, scoped, [
      [["field of study", "major"], entry.fieldOfStudy],
      [["gpa"], entry.gpa ?? ""],
    ]);
    await tryFillDate(panel, scoped, START_DATE_TERMS, entry.startDate);
    await tryFillDate(panel, scoped, END_DATE_TERMS, entry.endDate);
  });
  if (educationResult.filledCount) summary.filled.push(`${educationResult.filledCount} education panel(s)`);
  if (educationResult.remaining) {
    summary.skipped.push(
      `${educationResult.remaining} more education entr${educationResult.remaining === 1 ? "y" : "ies"} (couldn't find/grow this section's "Add Another" button — add the panel manually and re-run)`,
    );
  }

  const certifications: CertificationEntry[] = Array.isArray(pkg.certificationDetails)
    ? pkg.certificationDetails.filter((c) => c && c.name?.trim())
    : [];
  const certResult = await fillRepeatedSection(
    certifications,
    () => anchorEls(CERT_NAME_SYNONYMS),
    ["certification", "license", "certifications licenses"],
    async (panel, entry, scoped) => {
      // Certification name: plain input, type-ahead combobox, or listbox.
      const nameInput = findFieldBySynonyms(scoped, CERT_NAME_SYNONYMS);
      if (nameInput) {
        setFieldValue(nameInput, entry.name);
      } else {
        const nameCombo = findComboboxBySynonyms(panel, CERT_NAME_SYNONYMS);
        if (nameCombo) {
          await fillSearchCombobox(nameCombo, entry.name);
        } else {
          const nameListbox = findListboxButtonBySynonyms(panel, CERT_NAME_SYNONYMS);
          if (nameListbox) await fillListbox(nameListbox, entry.name);
        }
      }
      if (entry.issuer) fillWithinPanel(panel, scoped, [[ISSUER_SYNONYMS, entry.issuer]]);
      if (entry.issueDate) await tryFillDate(panel, scoped, ISSUED_DATE_TERMS, entry.issueDate);
      if (entry.expirationDate) await tryFillDate(panel, scoped, EXPIRATION_DATE_TERMS, entry.expirationDate);
    },
  );
  if (certResult.filledCount) summary.filled.push(`${certResult.filledCount} certification panel(s)`);
  if (certResult.remaining) {
    summary.skipped.push(
      `${certResult.remaining} more certification entr${certResult.remaining === 1 ? "y" : "ies"} (couldn't find/grow this section's "Add" button — add the panel manually and re-run)`,
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
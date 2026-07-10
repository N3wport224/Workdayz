import type { AutofillPackage, AutofillRunSummary, EducationEntry, ExperienceEntry } from "../types";
import {
  attachFileToInput,
  fillListbox,
  findAllFieldsBySynonyms,
  findCheckboxBySynonyms,
  findFieldBySynonyms,
  findFileInputBySynonyms,
  findFillableFields,
  findListboxButtonBySynonyms,
  findPanelContainer,
  setCheckbox,
  setFieldValue,
  type FillableElement,
} from "./dom-utils";

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

/**
 * Fills as many repeated panels (one per work-experience/education entry) as
 * are currently rendered on the page, matching profile entries to panels in
 * DOM order. Does not click "Add Another" — if there are more profile
 * entries than visible panels, those are reported back so the user can add
 * more panels themselves and re-run.
 */
function fillRepeatedSection<T extends ExperienceEntry | EducationEntry>(
  entries: T[],
  anchorSynonyms: string[],
  fillEntry: (panel: HTMLElement, entry: T, scoped: FillableElement[]) => void,
): { filledCount: number; remaining: number } {
  if (entries.length === 0) return { filledCount: 0, remaining: 0 };

  let pool = findFillableFields();
  const anchors = findAllFieldsBySynonyms(pool, anchorSynonyms, { onlyEmpty: false });

  let filledCount = 0;
  for (let i = 0; i < anchors.length && i < entries.length; i++) {
    const panel = findPanelContainer(anchors[i], pool);
    const scoped = pool.filter((f) => panel.contains(f));
    fillEntry(panel, entries[i], scoped);
    filledCount++;
    // Remove this panel's fields from the pool so later panels can't be
    // matched to the same fields if panel boundaries happened to overlap.
    pool = pool.filter((f) => !panel.contains(f));
  }

  return { filledCount, remaining: Math.max(0, entries.length - anchors.length) };
}

/**
 * Fills whatever contact fields, experience/education panels, and
 * resume/cover-letter file inputs are visible on the CURRENT step of the
 * Workday wizard. Deliberately does not click Next/Continue/Submit or "Add
 * Another" — the user advances the wizard themselves and re-runs this once
 * per step, which doubles as their review checkpoint.
 */
export async function runAutofill(pkg: AutofillPackage): Promise<AutofillRunSummary> {
  const summary: AutofillRunSummary = { filled: [], skipped: [], filesAttached: [] };
  const fields = findFillableFields();

  for (const [key, synonyms] of CONTACT_SYNONYMS) {
    const value = pkg.contact[key];
    if (!value) continue;
    const field = findFieldBySynonyms(fields, synonyms);
    if (field) {
      setFieldValue(field, value);
      summary.filled.push(key);
      continue;
    }
    // No text input matched — Workday renders country/state/phone-type as
    // custom listbox buttons. Sequential awaits: only one popup at a time.
    const listbox = findListboxButtonBySynonyms(document, synonyms);
    if (listbox && (await fillListbox(listbox, value))) {
      summary.filled.push(key);
    } else {
      summary.skipped.push(key);
    }
  }

  const resumeInput = findFileInputBySynonyms(["resume", "cv", "upload resume"], {
    allowSoleFallback: true,
  });
  if (resumeInput) {
    attachFileToInput(resumeInput, pkg.resumePdfBase64, pkg.resumeFileName);
    summary.filesAttached.push("resume");
  }

  const coverLetterInput = findFileInputBySynonyms(["cover letter", "upload cover letter"]);
  if (coverLetterInput && coverLetterInput !== resumeInput) {
    attachFileToInput(coverLetterInput, pkg.coverLetterPdfBase64, pkg.coverLetterFileName);
    summary.filesAttached.push("cover letter");
  }

  const experienceResult = fillRepeatedSection(pkg.experience, TITLE_SYNONYMS, (panel, entry, scoped) => {
    fillWithinPanel(panel, scoped, [
      [TITLE_SYNONYMS, entry.title],
      [COMPANY_SYNONYMS, entry.company],
      [["location", "city"], entry.location],
      [["start date"], entry.startDate],
    ]);
    if (isPresentDate(entry.endDate)) {
      const checkbox = findCheckboxBySynonyms(panel, CURRENT_ROLE_SYNONYMS);
      if (checkbox) setCheckbox(checkbox, true);
    } else {
      fillWithinPanel(panel, scoped, [[["end date"], entry.endDate]]);
    }
    const description = findFieldBySynonyms(scoped, ["role description", "job description", "description"]);
    if (description) setFieldValue(description, entry.bullets.map((b) => `• ${b}`).join("\n"));
  });
  if (experienceResult.filledCount) summary.filled.push(`${experienceResult.filledCount} work experience panel(s)`);
  if (experienceResult.remaining) {
    summary.skipped.push(
      `${experienceResult.remaining} more work experience entr${experienceResult.remaining === 1 ? "y" : "ies"} (click "Add Another Work Experience" and re-run)`,
    );
  }

  const educationResult = fillRepeatedSection(pkg.education, SCHOOL_SYNONYMS, (panel, entry, scoped) => {
    fillWithinPanel(panel, scoped, [
      [SCHOOL_SYNONYMS, entry.school],
      [DEGREE_SYNONYMS, entry.degree],
      [["field of study", "major"], entry.fieldOfStudy],
      [["start date"], entry.startDate],
      [["end date", "graduation date"], entry.endDate],
      [["gpa"], entry.gpa ?? ""],
    ]);
  });
  if (educationResult.filledCount) summary.filled.push(`${educationResult.filledCount} education panel(s)`);
  if (educationResult.remaining) {
    summary.skipped.push(
      `${educationResult.remaining} more education entr${educationResult.remaining === 1 ? "y" : "ies"} (click "Add Another Education" and re-run)`,
    );
  }

  return summary;
}

export function looksLikeApplicationForm(): boolean {
  if (/\/apply\b/i.test(window.location.pathname)) return true;
  const fields = findFillableFields();
  const hasName = findFieldBySynonyms(fields, ["first name"], { onlyEmpty: false });
  const hasEmail = findFieldBySynonyms(fields, ["email"], { onlyEmpty: false });
  return Boolean(hasName && hasEmail);
}

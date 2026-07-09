import type { AutofillPackage, AutofillRunSummary } from "../types";
import { attachFileToInput, findFieldBySynonyms, findFileInputBySynonyms, findFillableFields, setFieldValue } from "./dom-utils";

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

/**
 * Fills whatever contact fields and resume/cover-letter file inputs are
 * visible on the CURRENT step of the Workday wizard. Deliberately does not
 * click Next/Continue/Submit — the user advances the wizard themselves and
 * re-runs this once per step, which doubles as their review checkpoint.
 */
export function runAutofill(pkg: AutofillPackage): AutofillRunSummary {
  const summary: AutofillRunSummary = { filled: [], skipped: [], filesAttached: [] };
  const fields = findFillableFields();

  for (const [key, synonyms] of CONTACT_SYNONYMS) {
    const value = pkg.contact[key];
    if (!value) continue;
    const field = findFieldBySynonyms(fields, synonyms);
    if (field) {
      setFieldValue(field, value);
      summary.filled.push(key);
    } else {
      summary.skipped.push(key);
    }
  }

  const resumeInput = findFileInputBySynonyms(["resume", "cv", "upload resume"]);
  if (resumeInput) {
    attachFileToInput(resumeInput, pkg.resumePdfBase64, pkg.resumeFileName);
    summary.filesAttached.push("resume");
  }

  const coverLetterInput = findFileInputBySynonyms(["cover letter", "upload cover letter"]);
  if (coverLetterInput && coverLetterInput !== resumeInput) {
    attachFileToInput(coverLetterInput, pkg.coverLetterPdfBase64, pkg.coverLetterFileName);
    summary.filesAttached.push("cover letter");
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

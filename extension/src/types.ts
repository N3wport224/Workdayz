// Mirrors web/lib/types.ts — kept in sync manually since the web app and
// extension build separately and don't share a package.

export interface ContactInfo {
  firstName: string;
  lastName: string;
  /** "Goes by" name some Workday tenants ask for. */
  preferredName?: string;
  email: string;
  phone: string;
  /** Secondary/work phone — Workday sometimes asks for both. */
  workPhone?: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  linkedin: string;
  website: string;
}

export interface ExperienceEntry {
  id: string;
  company: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  bullets: string[];
}

export interface EducationEntry {
  id: string;
  school: string;
  degree: string;
  fieldOfStudy: string;
  startDate: string;
  endDate: string;
  gpa?: string;
}

export interface CertificationEntry {
  id: string;
  name: string;
  issuer?: string;
  issueDate?: string;
  expirationDate?: string;
}

export interface JobPosting {
  title: string;
  company: string;
  location: string;
  description: string;
  sourceUrl?: string;
}

/** Which resume a package was built from — mirrored from web/lib/types.ts.
 * Shown in the popup and widget so the user always knows the fill source. */
export interface ResumeSource {
  kind: "tailored" | "variant" | "profile";
  label: string;
}

/** A professional reference (item 64) — filled into Workday reference panels. */
export interface ReferenceEntry {
  id: string;
  name: string;
  title?: string;
  company?: string;
  email?: string;
  phone?: string;
  relationship?: string;
}

export interface AutofillPackage {
  version: 1;
  createdAt: string;
  job: JobPosting;
  contact: ContactInfo;
  summary: string;
  skills: string[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  certifications: string[];
  certificationDetails?: CertificationEntry[];
  resumeSource?: ResumeSource;
  references?: ReferenceEntry[];
  /** Item 63: an extra document (writing sample, portfolio PDF…). */
  extraFile?: { name: string; base64: string };
  coverLetterText: string;
  resumePdfBase64: string;
  resumeFileName: string;
  coverLetterPdfBase64: string;
  coverLetterFileName: string;
  atsScore: number;
}

// The base resume profile synced from the web app's /profile page — lets
// contact/history autofill work before any job-specific package exists.
export interface BaseProfile {
  contact: ContactInfo;
  summary: string;
  skills: string[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  certifications: string[];
  certificationDetails?: CertificationEntry[];
  references?: ReferenceEntry[];
  /** Set by the background worker when the web app syncs the profile. */
  syncedAt?: string;
}

/** A user-defined answer: any field whose label contains `label`
 * (case-insensitive) gets filled with `value`. Lets users teach the
 * autofill about tenant-specific fields without a code change. */
export interface CustomFillRule {
  label: string;
  value: string;
}

// chrome.storage.local keys
export const STORAGE_KEYS = {
  webAppOrigin: "workdayz.webAppOrigin",
  scrapedJob: "workdayz.scrapedJob",
  autofillPackage: "workdayz.autofillPackage",
  baseProfile: "workdayz.baseProfile",
  customRules: "workdayz.customRules",
  hearAboutUs: "workdayz.hearAboutUs",
  widgetPosition: "workdayz.widgetPosition",
  /** Record<hostname, CustomFillRule[]> — rules that apply on one tenant only. */
  tenantRules: "workdayz.tenantRules",
  /** Record<pageKey, { at: string; filled: number }> — which application
   * pages have already been autofilled (capped, most recent kept). */
  fillHistory: "workdayz.fillHistory",
  /** "tailored" (default: job package first, base profile fallback) or
   * "profile" (always fill from the base profile). Set from the popup. */
  fillSource: "workdayz.fillSource",
  /** Item 60 — Record<hostname, string[]>: field labels the user never wants
   * autofilled on that tenant. */
  skipFields: "workdayz.skipFields",
  /** Item 58 — Record<hostname, string[]>: the form-label fingerprint from
   * the last successful fill, to detect tenant DOM changes. */
  tenantFingerprints: "workdayz.tenantFingerprints",
  /** Active autofill session tracking */
  activeSession: "workdayz.activeSession",
  /** Local usage analytics */
  usageStats: "workdayz.usageStats",
  /** Saved fill templates */
  fillTemplates: "workdayz.fillTemplates",
  /** User extension settings */
  settings: "workdayz.settings",
} as const;

// window.postMessage protocol with the web app (see web/lib/extension-bridge.ts)
export const MESSAGE_TYPES = {
  extensionReady: "WORKDAYZ_EXTENSION_READY",
  autofillPackage: "WORKDAYZ_AUTOFILL_PACKAGE",
  requestScrapedJob: "WORKDAYZ_REQUEST_SCRAPED_JOB",
  scrapedJob: "WORKDAYZ_SCRAPED_JOB",
  packageStored: "WORKDAYZ_PACKAGE_STORED",
  profile: "WORKDAYZ_PROFILE",
  ping: "WORKDAYZ_PING",
} as const;

// chrome.runtime message protocol between content scripts, popup, and background
export type RuntimeMessage =
  | { type: "STORE_SCRAPED_JOB"; payload: JobPosting }
  | { type: "GET_SCRAPED_JOB" }
  | { type: "STORE_AUTOFILL_PACKAGE"; payload: AutofillPackage }
  | { type: "GET_AUTOFILL_PACKAGE" }
  | { type: "OPEN_APPLY_TAB" }
  | { type: "REGISTER_WEB_APP_ORIGIN"; origin: string }
  | { type: "RUN_AUTOFILL" }
  | { type: "ANSWER_QUESTIONS"; questions: string[] }
  | { type: "STORE_PROFILE"; payload: BaseProfile }
  | { type: "GET_PROFILE" }
  | { type: "SET_BADGE"; count: number; stillRequired?: number };

export interface QuestionAnswer {
  question: string;
  answer: string;
}

export interface AutofillRunSummary {
  filled: string[];
  skipped: string[];
  filesAttached: string[];
  /** Self-identification / personal questions deliberately left untouched. */
  leftForYou: string[];
  /** Prefilled form values that differ from the profile (e.g. an old phone). */
  mismatches: string[];
  /** Required fields on this step that are still empty after the run. */
  stillRequired: string[];
}

// Mirrors web/lib/types.ts — kept in sync manually since the web app and
// extension build separately and don't share a package.

export interface ContactInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
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

export interface JobPosting {
  title: string;
  company: string;
  location: string;
  description: string;
  sourceUrl?: string;
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
  | { type: "SET_BADGE"; count: number };

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

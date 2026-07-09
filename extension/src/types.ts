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

// chrome.storage.local keys
export const STORAGE_KEYS = {
  webAppOrigin: "workdayz.webAppOrigin",
  scrapedJob: "workdayz.scrapedJob",
  autofillPackage: "workdayz.autofillPackage",
} as const;

// window.postMessage protocol with the web app (see web/lib/extension-bridge.ts)
export const MESSAGE_TYPES = {
  extensionReady: "WORKDAYZ_EXTENSION_READY",
  autofillPackage: "WORKDAYZ_AUTOFILL_PACKAGE",
  requestScrapedJob: "WORKDAYZ_REQUEST_SCRAPED_JOB",
  scrapedJob: "WORKDAYZ_SCRAPED_JOB",
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
  | { type: "RUN_AUTOFILL" };

export interface AutofillRunSummary {
  filled: string[];
  skipped: string[];
  filesAttached: string[];
}

// Core data model shared conceptually with extension/src/types.ts.
// Keep the two in sync manually — the web app and the extension build
// separately, so there is no shared package.

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

export interface WorkExperience {
  id: string;
  company: string;
  title: string;
  location: string;
  startDate: string; // e.g. "2021-06"
  endDate: string; // e.g. "2023-09" or "Present"
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

export interface ResumeProfile {
  contact: ContactInfo;
  summary: string;
  skills: string[];
  experience: WorkExperience[];
  education: EducationEntry[];
  certifications: string[];
}

export interface JobPosting {
  title: string;
  company: string;
  location: string;
  description: string;
  sourceUrl?: string;
}

export interface TailoredExperience {
  id: string; // matches WorkExperience.id from the source profile
  bullets: string[];
}

export interface TailoredResume {
  summary: string;
  skills: string[];
  experience: TailoredExperience[];
}

export interface AtsScoreBreakdown {
  score: number; // 0-100
  matchedKeywords: string[];
  missingKeywords: string[];
  formattingIssues: string[];
  notes: string;
}

export interface FitAnalysis {
  verdict: string;
  strengths: string[];
  gaps: string[];
}

export interface TailorResult {
  tailoredResume: TailoredResume;
  coverLetter: string;
  atsScore: AtsScoreBreakdown;
  fitAnalysis: FitAnalysis;
}

export interface InterviewQuestion {
  question: string;
  category: string; // e.g. "behavioral", "technical", "role-specific", "screening"
  talkingPoints: string[];
}

export interface InterviewPrep {
  generatedAt: string;
  questions: InterviewQuestion[];
}

export type ApplicationStatus = "draft" | "applied" | "interviewing" | "rejected" | "offer";

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "draft",
  "applied",
  "interviewing",
  "rejected",
  "offer",
];

// A saved snapshot of a tailored application, for the /applications tracker.
// Deliberately does not store the rendered PDFs (could bloat localStorage
// across many applications) — those are regenerated on demand from this
// snapshot via /api/resume-pdf and /api/cover-letter-pdf.
export interface SavedApplication {
  id: string;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
  job: JobPosting;
  contact: ContactInfo;
  summary: string;
  skills: string[];
  experience: (WorkExperience & { bullets: string[] })[];
  education: EducationEntry[];
  certifications: string[];
  coverLetterText: string;
  atsScore: AtsScoreBreakdown;
  fitAnalysis?: FitAnalysis;
  interviewPrep?: InterviewPrep;
  notes?: string;
  statusHistory?: { status: ApplicationStatus; at: string }[];
}

// The package handed off to the browser extension for autofilling Workday.
export interface AutofillPackage {
  version: 1;
  createdAt: string;
  job: JobPosting;
  contact: ContactInfo;
  summary: string;
  skills: string[];
  experience: (WorkExperience & { bullets: string[] })[];
  education: EducationEntry[];
  certifications: string[];
  coverLetterText: string;
  resumePdfBase64: string;
  resumeFileName: string;
  coverLetterPdfBase64: string;
  coverLetterFileName: string;
  atsScore: number;
}

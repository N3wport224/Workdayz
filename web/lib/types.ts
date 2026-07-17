// Mirrors extension/src/types.ts — kept in sync manually since the web app and
// extension build separately and don't share a package.

export interface ContactInfo {
  firstName: string;
  lastName: string;
  /** "Goes by" name some Workday tenants ask for (item 20). */
  preferredName?: string;
  email: string;
  phone: string;
  /** Secondary/work phone — Workday sometimes asks for both (item 19). */
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

export interface ProjectEntry {
  id: string;
  name: string;
  description: string;
  url?: string;
  technologies: string[];
}

export interface JobPosting {
  title: string;
  company: string;
  location: string;
  description: string;
  sourceUrl?: string;
}

/** Which resume a package was built from — displayed by the web app, the
 * extension popup, and the on-page widget so the user always knows exactly
 * what data is about to be filled. */
export interface ResumeSource {
  kind: "tailored" | "variant" | "profile";
  label: string;
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
  coverLetterText: string;
  resumePdfBase64: string;
  resumeFileName: string;
  coverLetterPdfBase64: string;
  coverLetterFileName: string;
  atsScore: number;
}

export interface ResumeProfile {
  contact: ContactInfo;
  summary: string;
  skills: string[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  projects: ProjectEntry[];
  certifications: CertificationEntry[];
  /** Optional headshot (small data URL). Stored for regions whose employers
   * expect one; NEVER rendered into the ATS-safe PDF (item 18). */
  photoDataUrl?: string;
}

export interface TailoredApplication {
  id: string;
  createdAt: string;
  job: JobPosting;
  profile: ResumeProfile;
  tailoredSummary: string;
  tailoredSkills: string[];
  tailoredBullets: { id: string; original: string; tailored: string }[];
  coverLetter: string;
  atsScore: number;
  atsBreakdown: AtsBreakdown;
  fitAnalysis?: FitAnalysis;
  variants?: TailoredVariant[];
  status: ApplicationStatus;
  notes?: string;
  followUpDate?: string;
  comp?: string;
  interviewPrep?: InterviewPrep[];
  outreachMessages?: OutreachMessages;
  /** Item 31: which resume/variant was actually sent to the extension. */
  sentResume?: string;
  /** Item 44: every status change with its timestamp. */
  statusHistory?: { status: ApplicationStatus; at: string }[];
  /** Item 46: hidden from the default tracker view without deleting. */
  archived?: boolean;
  updatedAt?: string;
}

export interface TailoredVariant {
  id: string;
  label: string;
  tailoredSummary: string;
  tailoredSkills: string[];
  tailoredBullets: { id: string; original: string; tailored: string }[];
  coverLetter: string;
  atsScore: number;
}

export interface AtsBreakdown {
  totalKeywords: number;
  matchedKeywords: number;
  matched: string[];
  missing: string[];
  score: number;
  integrityFlags: string[];
}

export interface FitAnalysis {
  strengths: string[];
  gaps: string[];
  verdict: string;
}

export type ApplicationStatus =
  | "draft" | "applied" | "screening" | "interview" | "offer" | "rejected" | "accepted" | "archived";

export interface InterviewPrep {
  question: string;
  talkingPoints: string[];
  honestGapFraming?: string;
}

export interface OutreachMessages {
  thankYouEmail?: string;
  followUpEmail?: string;
  linkedinDM?: string;
}

export interface ApplicationStats {
  total: number;
  byStatus: Record<ApplicationStatus, number>;
  averageAts: number;
  medianDaysToResponse: number;
  weeklyVolume: number;
}

export interface BaseProfile {
  contact: ContactInfo;
  summary: string;
  skills: string[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  projects?: ProjectEntry[];
  certifications: string[];
  certificationDetails?: CertificationEntry[];
  syncedAt?: string;
}

export const STORAGE_KEYS = {
  profile: "workdayz.profile",
  applications: "workdayz.applications",
  settings: "workdayz.settings",
} as const;

// Mirrors web/lib/types.ts — kept in sync manually since the web app and
// extension build separately and don't share a package.

/**
 * True for any Workday-family hostname (myworkdayjobs.com career sites,
 * or the internal myworkday.com / workday.com portal). The web-app bridge
 * (background.ts registerBridgeForOrigin, popup.ts's Connect button) must
 * never register on one of these: that bridge trusts any postMessage with
 * {source: "workdayz-web"} on the page it's injected into and silently
 * writes it as the user's stored profile/package. myworkdayjobs.com is
 * already a required host permission, so chrome.permissions.request()
 * for it succeeds with no prompt — without this guard, connecting to a
 * Workday tenant by mistake would let that tenant's own page script
 * (or a compromised/malicious one) forge profile-store messages.
 */
export function isWorkdayDomain(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "myworkdayjobs.com" || h.endsWith(".myworkdayjobs.com") ||
    h === "myworkday.com" || h.endsWith(".myworkday.com") ||
    h === "workday.com" || h.endsWith(".workday.com")
  );
}

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
  /** Record<name, BaseProfile> — every named profile synced from the web
   * app's /profile page, so the widget can offer a picker between them. */
  profiles: "workdayz.profiles",
  /** Which entry in `profiles` is currently selected as `baseProfile`. */
  activeProfileName: "workdayz.activeProfileName",
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
  /** Record<normalizedQuestion, RememberedAnswer> — screening answers captured
   * from past applications and recalled on later ones. Never holds self-ID
   * questions; see content/answer-memory.ts. */
  answerMemory: "workdayz.answerMemory",
  /** Record<confirmationKey, { at: string }> — submissions already logged, so a
   * reload or back-navigation to a confirmation page can't double-log. */
  confirmationLog: "workdayz.confirmationLog",
  /** ConfirmationEvent[] — a durable queue drained by the web app. Needed
   * because a submission usually happens with the web app closed, and a
   * fire-and-forget relay would lose it entirely. */
  pendingConfirmations: "workdayz.pendingConfirmations",
  /** BackupSnapshot[] — backups pushed by the web app, newest last. Stored here
   * because chrome.storage.local is a separate store from the web app's
   * localStorage, so these survive a localStorage wipe. */
  backupSnapshots: "workdayz.backupSnapshots",
  /** ISO timestamp of the newest snapshot, for cheap staleness checks. */
  lastSnapshotAt: "workdayz.lastSnapshotAt",
  /** { enabled, intervalDays } — the scheduled-audit cadence. */
  backupSettings: "workdayz.backupSettings",
  /** { at, stale } — result of the last alarm-driven audit. */
  lastBackupAudit: "workdayz.lastBackupAudit",
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
  /** The full set of named profiles, so the widget can offer a picker. */
  profileList: "WORKDAYZ_PROFILE_LIST",
  ping: "WORKDAYZ_PING",
  /** Items 74/77: web app asks what the extension currently holds. */
  requestSyncStatus: "WORKDAYZ_REQUEST_SYNC_STATUS",
  syncStatus: "WORKDAYZ_SYNC_STATUS",
  /** Item 76: profile-store confirmation incl. what it replaced. */
  profileStored: "WORKDAYZ_PROFILE_STORED",
  /** Item 78: a fill finished on a Workday tab. */
  fillCompleted: "WORKDAYZ_FILL_COMPLETED",
  /** An application was submitted — the web app moves it to "Applied". */
  applicationConfirmed: "WORKDAYZ_APPLICATION_CONFIRMED",
  /** Web app asks for confirmations queued while it was closed. */
  requestPendingConfirmations: "WORKDAYZ_REQUEST_PENDING_CONFIRMATIONS",
  pendingConfirmations: "WORKDAYZ_PENDING_CONFIRMATIONS",
  /** Web app reports which queued confirmations it has committed to the tracker. */
  confirmationsAcknowledged: "WORKDAYZ_CONFIRMATIONS_ACKNOWLEDGED",
  /** Web app pushes a (usually encrypted) backup snapshot for durable storage. */
  backupSnapshot: "WORKDAYZ_BACKUP_SNAPSHOT",
  backupSnapshotStored: "WORKDAYZ_BACKUP_SNAPSHOT_STORED",
  /** Web app asks how fresh the stored snapshots are. */
  requestBackupStatus: "WORKDAYZ_REQUEST_BACKUP_STATUS",
  backupStatus: "WORKDAYZ_BACKUP_STATUS",
  /** Web app asks for a stored snapshot's payload back, to restore from it. */
  requestBackupSnapshot: "WORKDAYZ_REQUEST_BACKUP_SNAPSHOT",
  backupSnapshotPayload: "WORKDAYZ_BACKUP_SNAPSHOT_PAYLOAD",
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
  | { type: "STORE_PROFILE_LIST"; payload: { profiles: Record<string, BaseProfile>; activeName: string } }
  | { type: "GET_PROFILE_LIST" }
  | { type: "SET_ACTIVE_PROFILE"; name: string }
  | { type: "SET_BADGE"; count: number; stillRequired?: number }
  | { type: "GET_SYNC_STATUS" }
  | { type: "FILL_COMPLETED_RELAY"; count: number; stillRequired: number }
  | { type: "RECORD_CONFIRMATION"; payload: ApplicationConfirmation }
  | { type: "GET_PENDING_CONFIRMATIONS" }
  | { type: "ACK_CONFIRMATIONS"; keys: string[] }
  | { type: "CONFIRMATION_RELAY"; payload: ApplicationConfirmation }
  | { type: "STORE_BACKUP_SNAPSHOT"; payload: BackupSnapshot }
  | { type: "GET_BACKUP_STATUS" }
  | { type: "GET_BACKUP_SNAPSHOT"; createdAt?: string }
  | { type: "SET_BACKUP_SETTINGS"; enabled?: boolean; intervalDays?: number }
  | { type: "RUN_BACKUP_AUDIT" };

/**
 * A backup pushed by the web app. `payload` is a JSON string — the
 * EncryptedBackup envelope when the user set a passphrase, otherwise the plain
 * FullBackup. The extension never decrypts and never holds a passphrase; see
 * background/backup-alarm.ts for why encryption happens web-side.
 */
export interface BackupSnapshot {
  version: 1;
  createdAt: string;
  /** False means the user chose not to set a passphrase — surfaced in the UI. */
  encrypted: boolean;
  payload: string;
  /** Counts for display, so the UI can describe a snapshot it cannot read. */
  applications: number;
  profiles: number;
}

/** Snapshot description without the payload — safe to hand to a page. */
export interface BackupSnapshotMeta {
  createdAt: string;
  encrypted: boolean;
  applications: number;
  profiles: number;
  bytes: number;
}

/** A submitted application, detected on a Workday confirmation page.
 * Mirrors content/confirmation.ts's ConfirmationEvent. */
export interface ApplicationConfirmation {
  key: string;
  company: string;
  title: string;
  jobId: string;
  submittedAt: string;
  sourceUrl: string;
  hostname: string;
  via: "url" | "dom";
  evidence: string;
}

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

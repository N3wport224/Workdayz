/**
 * When to nudge the user about backups, and what to say.
 *
 * Two independent clocks, because they protect against different losses:
 *
 *   - **Last file download.** A file on disk is the only backup that survives
 *     this browser being wiped, reinstalled, or replaced. This is the one that
 *     earns a visible nudge.
 *   - **Last extension snapshot.** chrome.storage.local is a separate store
 *     from localStorage, so a snapshot survives the tracker's localStorage
 *     being cleared — the common case — but not the browser going away.
 *
 * Pure functions over timestamps: no storage access, no DOM, so the nudge rules
 * are testable without a browser.
 */

const MS_PER_DAY = 86_400_000;

export const DEFAULT_BACKUP_INTERVAL_DAYS = 7;

/** Below a day the nudge would fire constantly; above a year it never fires. */
export const MIN_BACKUP_INTERVAL_DAYS = 1;
export const MAX_BACKUP_INTERVAL_DAYS = 365;

export function clampBackupIntervalDays(value: unknown): number {
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : DEFAULT_BACKUP_INTERVAL_DAYS;
  return Math.min(MAX_BACKUP_INTERVAL_DAYS, Math.max(MIN_BACKUP_INTERVAL_DAYS, n));
}

/**
 * Whole days between `iso` and `now`.
 *
 * Returns null for a missing or unparseable timestamp — the caller must decide
 * what "never" means, since "never backed up with data to lose" and "never
 * backed up because there's nothing yet" want different messages.
 *
 * A future timestamp clamps to 0 rather than going negative: clock skew
 * shouldn't make a stale backup look permanently fresh.
 */
export function daysSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  return Math.max(0, (now - then) / MS_PER_DAY);
}

export type NudgeLevel = "none" | "suggest" | "overdue";

export interface BackupNudge {
  level: NudgeLevel;
  /** Sentence for the banner. Empty when level is "none". */
  message: string;
  daysSinceDownload: number | null;
  daysSinceSnapshot: number | null;
  /** True when there is nothing worth backing up yet. */
  nothingToBackUp: boolean;
}

export interface NudgeInput {
  lastDownloadAt: string | null | undefined;
  lastSnapshotAt: string | null | undefined;
  /** How much is at stake — no nudge when the tracker is empty. */
  applicationCount: number;
  profileCount: number;
  intervalDays?: number;
  now?: number;
}

/** Twice the interval reads as neglected rather than merely due. */
const OVERDUE_MULTIPLIER = 2;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Rounds for display: "0.4 days ago" is noise; "today" is what people say. */
function describeAge(days: number): string {
  const whole = Math.floor(days);
  if (whole <= 0) return "today";
  if (whole === 1) return "yesterday";
  return `${plural(whole, "day")} ago`;
}

/**
 * Decides whether to nudge, and how loudly.
 *
 * Ordering matters: an empty tracker never nudges (there's nothing to lose),
 * and "never downloaded" outranks "download is old" because the first time is
 * the one that actually leaves you exposed.
 */
export function backupNudge(input: NudgeInput): BackupNudge {
  const intervalDays = clampBackupIntervalDays(input.intervalDays);
  const now = input.now ?? Date.now();
  const daysSinceDownload = daysSince(input.lastDownloadAt, now);
  const daysSinceSnapshot = daysSince(input.lastSnapshotAt, now);

  // Nagging someone with an empty tracker to back up nothing is pure noise.
  const nothingToBackUp = input.applicationCount === 0 && input.profileCount === 0;
  if (nothingToBackUp) {
    return { level: "none", message: "", daysSinceDownload, daysSinceSnapshot, nothingToBackUp: true };
  }

  const stake = `${plural(input.applicationCount, "application")} and ${plural(input.profileCount, "resume profile")}`;

  if (daysSinceDownload === null) {
    // The extension snapshot softens this but does not remove it: it lives in
    // the same browser, so it dies with the browser.
    const snapshotNote =
      daysSinceSnapshot === null
        ? ""
        : ` The extension holds a snapshot from ${describeAge(daysSinceSnapshot)}, but that lives in this browser too — a file on disk is what survives losing it.`;
    return {
      level: "overdue",
      message: `You've never downloaded a backup. ${stake} exist only in this browser.${snapshotNote}`,
      daysSinceDownload,
      daysSinceSnapshot,
      nothingToBackUp: false,
    };
  }

  if (daysSinceDownload >= intervalDays * OVERDUE_MULTIPLIER) {
    return {
      level: "overdue",
      message: `Your last backup download was ${describeAge(daysSinceDownload)} — well past your ${plural(intervalDays, "day")} reminder. ${stake} are only in this browser.`,
      daysSinceDownload,
      daysSinceSnapshot,
      nothingToBackUp: false,
    };
  }

  if (daysSinceDownload >= intervalDays) {
    return {
      level: "suggest",
      message: `Last backup download was ${describeAge(daysSinceDownload)}. Worth grabbing a fresh one — ${stake} tracked.`,
      daysSinceDownload,
      daysSinceSnapshot,
      nothingToBackUp: false,
    };
  }

  return { level: "none", message: "", daysSinceDownload, daysSinceSnapshot, nothingToBackUp: false };
}

/**
 * Filename for a downloaded backup. Date-stamped so several backups coexist in
 * a downloads folder instead of becoming "backup (3).json".
 *
 * The `.encrypted.json` suffix is load-bearing, not decoration: it's the
 * established convention here, the restore UI tells people to look for it, and
 * it's how you tell at a glance whether a file in a cloud drive is safe to be
 * sitting there. An unencrypted export says so even louder.
 */
export function backupFilename(now: Date = new Date(), encrypted: boolean = true): string {
  const stamp = now.toISOString().slice(0, 10);
  return `workdayz-backup-${stamp}${encrypted ? ".encrypted" : ".UNENCRYPTED"}.json`;
}

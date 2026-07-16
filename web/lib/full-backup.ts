// One-file backup of EVERYTHING Workdayz stores in this browser: all
// profiles, tracked applications, drafts, and the usage log. (The
// extension's chrome.storage copy is separate — its popup has its own
// clear/export story.)

const BACKUP_VERSION = 1;

export interface FullBackup {
  workdayzBackup: true;
  version: number;
  exportedAt: string;
  entries: Record<string, string>;
}

/** Both prefixes are live: legacy code used "workdayz." (dot), the current
 * storage layer uses "workdayz-" (dash). Back up and restore both. */
function isWorkdayzKey(key: string): boolean {
  return key.startsWith("workdayz.") || key.startsWith("workdayz-");
}

export function buildFullBackup(): FullBackup {
  const entries: Record<string, string> = {};
  for (const key of Object.keys(window.localStorage)) {
    if (!isWorkdayzKey(key)) continue;
    const value = window.localStorage.getItem(key);
    if (value !== null) entries[key] = value;
  }
  return {
    workdayzBackup: true,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    entries,
  };
}

export function isFullBackup(parsed: unknown): parsed is FullBackup {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as FullBackup).workdayzBackup === true &&
    typeof (parsed as FullBackup).entries === "object"
  );
}

/** Replaces this browser's Workdayz data with the backup's. Returns how many
 * keys were restored. Only workdayz-prefixed keys are ever written. */
export function restoreFullBackup(backup: FullBackup): number {
  // Clear current state first so deleted-in-backup keys don't linger.
  for (const key of Object.keys(window.localStorage)) {
    if (isWorkdayzKey(key)) window.localStorage.removeItem(key);
  }
  let restored = 0;
  for (const [key, value] of Object.entries(backup.entries)) {
    if (!isWorkdayzKey(key) || typeof value !== "string") continue;
    window.localStorage.setItem(key, value);
    restored += 1;
  }
  return restored;
}

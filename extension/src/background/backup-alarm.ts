/**
 * Scheduled backup snapshots, driven by chrome.alarms.
 *
 * WHO ENCRYPTS, AND WHY IT ISN'T THIS FILE
 * ----------------------------------------
 * The web app encrypts; the extension only stores ciphertext. That inversion is
 * deliberate, for two reasons that rule out doing it here:
 *
 *   1. The data isn't reachable from here. The application tracker lives in the
 *      WEB APP's localStorage, which no extension surface can read. An alarm
 *      firing at 3am with no tab open has nothing to snapshot.
 *   2. Unattended AES-GCM has nowhere safe to keep a passphrase. Storing one
 *      (or a derived key) in chrome.storage.local — next to the ciphertext —
 *      means anything that can read the backup can read the key. That protects
 *      against nothing while claiming AES-256-GCM protection, which is worse
 *      than being plainly unencrypted.
 *
 * So the web app encrypts with the user's passphrase (real PBKDF2-600k +
 * AES-256-GCM, via web/lib/crypto-backup.ts) at a moment the user is present,
 * and pushes the ciphertext here. This file never sees a passphrase.
 *
 * What the alarm actually does, then: rotate stored snapshots, audit their
 * freshness, and surface a nudge when they age out. It cannot manufacture data
 * it can't read — so "scheduled backup" means "scheduled staleness check plus
 * durable off-localStorage storage", and the UI says exactly that.
 *
 * The value is real regardless: chrome.storage.local is a SEPARATE store from
 * localStorage, so these snapshots survive the web app's localStorage being
 * cleared — which is the actual way people lose this data.
 */

import { STORAGE_KEYS, type BackupSnapshot, type BackupSnapshotMeta } from "../types";

export const BACKUP_ALARM_NAME = "workdayz-backup-audit";

/** Default cadence. Configurable from the popup; see clampIntervalDays. */
export const DEFAULT_INTERVAL_DAYS = 7;

/** Chrome rejects sub-minute periods, and a cadence over a year is
 * indistinguishable from "off" — the user should disable it instead. */
export const MIN_INTERVAL_DAYS = 1;
export const MAX_INTERVAL_DAYS = 365;

/**
 * How many snapshots to keep. More than one matters: if the newest snapshot was
 * written from an already-corrupted localStorage, the previous one is the only
 * way back.
 */
export const MAX_SNAPSHOTS = 3;

/**
 * Chrome's storage quota is ~5MB for the whole extension, shared with the
 * profile, answer memory, and rules. A snapshot that would crowd those out is
 * refused rather than silently evicting working state.
 */
export const MAX_SNAPSHOT_BYTES = 1_000_000;

const MS_PER_DAY = 86_400_000;

export function clampIntervalDays(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_INTERVAL_DAYS;
  return Math.min(MAX_INTERVAL_DAYS, Math.max(MIN_INTERVAL_DAYS, n));
}

export interface BackupSettings {
  enabled: boolean;
  intervalDays: number;
}

export async function getBackupSettings(): Promise<BackupSettings> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEYS.backupSettings);
    const raw = (data[STORAGE_KEYS.backupSettings] ?? {}) as Partial<BackupSettings>;
    return {
      // Opt-out rather than opt-in: the snapshot is data the user already has,
      // stored where it survives a localStorage wipe. Nothing leaves the browser.
      enabled: raw.enabled !== false,
      intervalDays: clampIntervalDays(raw.intervalDays),
    };
  } catch {
    return { enabled: true, intervalDays: DEFAULT_INTERVAL_DAYS };
  }
}

export async function setBackupSettings(next: Partial<BackupSettings>): Promise<BackupSettings> {
  const current = await getBackupSettings();
  const merged: BackupSettings = {
    enabled: next.enabled ?? current.enabled,
    intervalDays: clampIntervalDays(next.intervalDays ?? current.intervalDays),
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.backupSettings]: merged });
  await scheduleBackupAlarm(merged);
  return merged;
}

/**
 * (Re)registers the alarm. Chrome persists alarms across service-worker
 * restarts, so this is idempotent — creating one with an existing name replaces
 * it rather than stacking duplicates.
 */
export async function scheduleBackupAlarm(settings?: BackupSettings): Promise<void> {
  const { enabled, intervalDays } = settings ?? (await getBackupSettings());
  try {
    if (!enabled) {
      await chrome.alarms.clear(BACKUP_ALARM_NAME);
      return;
    }
    const periodInMinutes = intervalDays * 24 * 60;
    await chrome.alarms.create(BACKUP_ALARM_NAME, { periodInMinutes, delayInMinutes: periodInMinutes });
  } catch {
    /* alarms unavailable (e.g. permission removed) — auditing just won't fire */
  }
}

// ---------------------------------------------------------------------------
// Snapshot storage
// ---------------------------------------------------------------------------

/** Rough byte size of a stored snapshot. */
export function snapshotBytes(snapshot: Pick<BackupSnapshot, "payload">): number {
  return new TextEncoder().encode(snapshot.payload).length;
}

export async function loadSnapshots(): Promise<BackupSnapshot[]> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEYS.backupSnapshots);
    const raw = data[STORAGE_KEYS.backupSnapshots];
    return Array.isArray(raw) ? (raw as BackupSnapshot[]) : [];
  } catch {
    return [];
  }
}

export interface StoreSnapshotResult {
  ok: boolean;
  reason?: "too-large" | "empty";
  kept?: number;
  bytes?: number;
}

/**
 * Stores a snapshot pushed by the web app, newest last, rotating out the
 * oldest beyond MAX_SNAPSHOTS.
 */
export async function storeSnapshot(snapshot: BackupSnapshot): Promise<StoreSnapshotResult> {
  if (!snapshot?.payload) return { ok: false, reason: "empty" };

  const bytes = snapshotBytes(snapshot);
  if (bytes > MAX_SNAPSHOT_BYTES) {
    // Refuse rather than evict the profile/answer-memory to make room.
    return { ok: false, reason: "too-large", bytes };
  }

  const existing = await loadSnapshots();
  const next = [...existing, snapshot].slice(-MAX_SNAPSHOTS);
  await chrome.storage.local.set({
    [STORAGE_KEYS.backupSnapshots]: next,
    [STORAGE_KEYS.lastSnapshotAt]: snapshot.createdAt,
  });
  return { ok: true, kept: next.length, bytes };
}

/** Metadata only — never the payload, so a status check can't leak ciphertext
 * (or, for an unencrypted snapshot, the data itself) into a page. */
export function toMeta(snapshot: BackupSnapshot): BackupSnapshotMeta {
  return {
    createdAt: snapshot.createdAt,
    encrypted: snapshot.encrypted,
    applications: snapshot.applications,
    profiles: snapshot.profiles,
    bytes: snapshotBytes(snapshot),
  };
}

// ---------------------------------------------------------------------------
// Staleness audit
// ---------------------------------------------------------------------------

export interface BackupAudit {
  enabled: boolean;
  intervalDays: number;
  /** Newest snapshot's timestamp, or null when none has ever been pushed. */
  lastSnapshotAt: string | null;
  ageDays: number | null;
  /** True when there is no snapshot, or the newest is older than the interval. */
  stale: boolean;
  snapshotCount: number;
  snapshots: BackupSnapshotMeta[];
}

export async function auditBackups(now: number = Date.now()): Promise<BackupAudit> {
  const settings = await getBackupSettings();
  const snapshots = await loadSnapshots();
  const newest = snapshots.length ? snapshots[snapshots.length - 1] : null;

  const lastMs = newest ? Date.parse(newest.createdAt) : NaN;
  // A future timestamp (clock skew) reads as age 0, not as a negative age that
  // would make a stale snapshot look fresh forever.
  const ageDays = Number.isFinite(lastMs) ? Math.max(0, (now - lastMs) / MS_PER_DAY) : null;

  return {
    enabled: settings.enabled,
    intervalDays: settings.intervalDays,
    lastSnapshotAt: newest?.createdAt ?? null,
    ageDays: ageDays === null ? null : Math.round(ageDays * 10) / 10,
    stale: ageDays === null || ageDays >= settings.intervalDays,
    snapshotCount: snapshots.length,
    snapshots: snapshots.map(toMeta),
  };
}

/**
 * What the alarm does when it fires. Deliberately does NOT try to produce a
 * snapshot — it has no access to the tracker data. It records the audit so the
 * web app and popup can nudge, and badges the toolbar when backups have aged
 * out, which is the only user-visible signal available with no tab open.
 */
export async function runBackupAudit(now: number = Date.now()): Promise<BackupAudit> {
  const audit = await auditBackups(now);
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.lastBackupAudit]: { at: new Date(now).toISOString(), stale: audit.stale } });
  } catch {
    /* best effort */
  }

  try {
    if (audit.enabled && audit.stale) {
      // Global (not per-tab) badge: the point is to be visible with nothing open.
      await chrome.action.setBadgeBackgroundColor({ color: "#d97706" });
      await chrome.action.setBadgeText({ text: "!" });
    }
    // Never clear here: a fresh-backup state shouldn't wipe the per-tab fill
    // count badge that autofill sets.
  } catch {
    /* action API unavailable */
  }

  return audit;
}

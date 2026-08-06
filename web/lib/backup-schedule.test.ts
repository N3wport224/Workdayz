import { describe, expect, it } from "vitest";
import {
  backupFilename,
  backupNudge,
  clampBackupIntervalDays,
  DEFAULT_BACKUP_INTERVAL_DAYS,
  MAX_BACKUP_INTERVAL_DAYS,
  MIN_BACKUP_INTERVAL_DAYS,
  daysSince,
} from "./backup-schedule";

const NOW = Date.UTC(2026, 2, 20, 12, 0, 0);
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe("clampBackupIntervalDays", () => {
  it("defaults to a week", () => {
    expect(clampBackupIntervalDays(undefined)).toBe(7);
    expect(DEFAULT_BACKUP_INTERVAL_DAYS).toBe(7);
  });

  it("accepts a valid interval", () => {
    expect(clampBackupIntervalDays(14)).toBe(14);
  });

  it("clamps below the floor and above the ceiling", () => {
    expect(clampBackupIntervalDays(0)).toBe(MIN_BACKUP_INTERVAL_DAYS);
    expect(clampBackupIntervalDays(-5)).toBe(MIN_BACKUP_INTERVAL_DAYS);
    expect(clampBackupIntervalDays(99_999)).toBe(MAX_BACKUP_INTERVAL_DAYS);
  });

  it("ignores non-numeric input", () => {
    expect(clampBackupIntervalDays("7")).toBe(DEFAULT_BACKUP_INTERVAL_DAYS);
    expect(clampBackupIntervalDays(NaN)).toBe(DEFAULT_BACKUP_INTERVAL_DAYS);
    expect(clampBackupIntervalDays(Infinity)).toBe(DEFAULT_BACKUP_INTERVAL_DAYS);
    expect(clampBackupIntervalDays(null)).toBe(DEFAULT_BACKUP_INTERVAL_DAYS);
  });
});

describe("daysSince", () => {
  it("measures elapsed days", () => {
    expect(daysSince(daysAgo(3), NOW)).toBeCloseTo(3, 5);
  });

  it("returns null for missing or unparseable timestamps", () => {
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince(undefined, NOW)).toBeNull();
    expect(daysSince("", NOW)).toBeNull();
    expect(daysSince("not-a-date", NOW)).toBeNull();
  });

  it("clamps a future timestamp to zero rather than going negative", () => {
    // Clock skew must not make a stale backup look fresh forever.
    expect(daysSince(new Date(NOW + 5 * 86_400_000).toISOString(), NOW)).toBe(0);
  });
});

describe("backupNudge — staying quiet when it should", () => {
  it("says nothing when there is no data to lose", () => {
    const nudge = backupNudge({
      lastDownloadAt: null,
      lastSnapshotAt: null,
      applicationCount: 0,
      profileCount: 0,
      now: NOW,
    });
    expect(nudge.level).toBe("none");
    expect(nudge.message).toBe("");
    expect(nudge.nothingToBackUp).toBe(true);
  });

  it("says nothing when the download is recent", () => {
    const nudge = backupNudge({
      lastDownloadAt: daysAgo(2),
      lastSnapshotAt: null,
      applicationCount: 5,
      profileCount: 1,
      now: NOW,
    });
    expect(nudge.level).toBe("none");
  });

  it("stays quiet right up to the interval boundary", () => {
    const justUnder = backupNudge({
      lastDownloadAt: daysAgo(6.9),
      lastSnapshotAt: null,
      applicationCount: 3,
      profileCount: 1,
      now: NOW,
    });
    expect(justUnder.level).toBe("none");
  });
});

describe("backupNudge — escalation", () => {
  it("suggests once the interval has elapsed", () => {
    const nudge = backupNudge({
      lastDownloadAt: daysAgo(7),
      lastSnapshotAt: null,
      applicationCount: 4,
      profileCount: 2,
      now: NOW,
    });
    expect(nudge.level).toBe("suggest");
    expect(nudge.message).toContain("4 applications");
    expect(nudge.message).toContain("2 resume profiles");
  });

  it("escalates to overdue at twice the interval", () => {
    const nudge = backupNudge({
      lastDownloadAt: daysAgo(14),
      lastSnapshotAt: null,
      applicationCount: 4,
      profileCount: 1,
      now: NOW,
    });
    expect(nudge.level).toBe("overdue");
    expect(nudge.message).toContain("14 days ago");
  });

  it("treats never-downloaded as overdue regardless of age", () => {
    const nudge = backupNudge({
      lastDownloadAt: null,
      lastSnapshotAt: null,
      applicationCount: 1,
      profileCount: 1,
      now: NOW,
    });
    expect(nudge.level).toBe("overdue");
    expect(nudge.message).toContain("never downloaded");
  });

  it("respects a custom interval", () => {
    const input = {
      lastDownloadAt: daysAgo(20),
      lastSnapshotAt: null,
      applicationCount: 3,
      profileCount: 1,
      now: NOW,
    };
    expect(backupNudge({ ...input, intervalDays: 30 }).level).toBe("none");
    expect(backupNudge({ ...input, intervalDays: 14 }).level).toBe("suggest");
    expect(backupNudge({ ...input, intervalDays: 7 }).level).toBe("overdue");
  });

  it("nudges when only profiles exist and no applications yet", () => {
    const nudge = backupNudge({
      lastDownloadAt: null,
      lastSnapshotAt: null,
      applicationCount: 0,
      profileCount: 1,
      now: NOW,
    });
    expect(nudge.level).toBe("overdue");
  });
});

describe("backupNudge — extension snapshot is not a substitute", () => {
  it("still nudges when a fresh snapshot exists but no file was ever downloaded", () => {
    // The snapshot lives in the same browser, so it dies with the browser. It
    // softens the wording but must not silence the nudge.
    const nudge = backupNudge({
      lastDownloadAt: null,
      lastSnapshotAt: daysAgo(0),
      applicationCount: 8,
      profileCount: 1,
      now: NOW,
    });
    expect(nudge.level).toBe("overdue");
    expect(nudge.message).toContain("lives in this browser too");
  });

  it("mentions the snapshot's age when one exists", () => {
    const nudge = backupNudge({
      lastDownloadAt: null,
      lastSnapshotAt: daysAgo(3),
      applicationCount: 2,
      profileCount: 1,
      now: NOW,
    });
    expect(nudge.message).toContain("3 days ago");
  });

  it("omits the snapshot clause when there is no snapshot", () => {
    const nudge = backupNudge({
      lastDownloadAt: null,
      lastSnapshotAt: null,
      applicationCount: 2,
      profileCount: 1,
      now: NOW,
    });
    expect(nudge.message).not.toContain("extension");
  });

  it("reports both clocks for the UI", () => {
    const nudge = backupNudge({
      lastDownloadAt: daysAgo(10),
      lastSnapshotAt: daysAgo(2),
      applicationCount: 2,
      profileCount: 1,
      now: NOW,
    });
    expect(nudge.daysSinceDownload).toBeCloseTo(10, 5);
    expect(nudge.daysSinceSnapshot).toBeCloseTo(2, 5);
  });
});

describe("backupNudge — wording", () => {
  it("singularizes correctly", () => {
    const nudge = backupNudge({
      lastDownloadAt: daysAgo(8),
      lastSnapshotAt: null,
      applicationCount: 1,
      profileCount: 1,
      now: NOW,
    });
    expect(nudge.message).toContain("1 application ");
    expect(nudge.message).toContain("1 resume profile");
    expect(nudge.message).not.toContain("1 applications");
  });

  it("says 'yesterday' rather than '1 day ago'", () => {
    const nudge = backupNudge({
      lastDownloadAt: daysAgo(1.2),
      lastSnapshotAt: null,
      applicationCount: 2,
      profileCount: 1,
      intervalDays: 1,
      now: NOW,
    });
    expect(nudge.level).toBe("suggest");
    expect(nudge.message).toContain("yesterday");
    expect(nudge.message).not.toContain("1 day ago");
  });

  it("says 'today' for a snapshot taken hours ago", () => {
    // The download clock can never read "today" — it must be at least a full
    // interval old to nudge at all. The snapshot clause is the reachable path.
    const nudge = backupNudge({
      lastDownloadAt: null,
      lastSnapshotAt: daysAgo(0.2),
      applicationCount: 2,
      profileCount: 1,
      now: NOW,
    });
    expect(nudge.message).toContain("snapshot from today");
  });

  it("rounds a fractional age down instead of showing decimals", () => {
    const nudge = backupNudge({
      lastDownloadAt: daysAgo(9.8),
      lastSnapshotAt: null,
      applicationCount: 2,
      profileCount: 1,
      now: NOW,
    });
    expect(nudge.message).toContain("9 days ago");
    expect(nudge.message).not.toContain("9.8");
  });
});

describe("backupFilename", () => {
  it("date-stamps so backups don't collide in a downloads folder", () => {
    expect(backupFilename(new Date("2026-03-20T12:00:00Z"), true)).toBe(
      "workdayz-backup-2026-03-20.encrypted.json",
    );
  });

  it("keeps the .encrypted.json suffix the restore UI tells people to look for", () => {
    // Changing this silently broke the journey suite once already — the suffix
    // is the convention, not cosmetic.
    expect(backupFilename(new Date(), true).endsWith(".encrypted.json")).toBe(true);
  });

  it("marks an unencrypted file loudly", () => {
    expect(backupFilename(new Date("2026-03-20T12:00:00Z"), false)).toBe(
      "workdayz-backup-2026-03-20.UNENCRYPTED.json",
    );
  });
});

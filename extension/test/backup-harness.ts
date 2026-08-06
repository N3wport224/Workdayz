// Bundled by test/backup-alarm.test.mjs so the REAL alarm/snapshot logic runs
// against a shimmed chrome.alarms + chrome.storage.local.

import {
  auditBackups,
  clampIntervalDays,
  getBackupSettings,
  loadSnapshots,
  runBackupAudit,
  scheduleBackupAlarm,
  setBackupSettings,
  storeSnapshot,
  toMeta,
} from "../src/background/backup-alarm";

export {
  auditBackups,
  clampIntervalDays,
  getBackupSettings,
  loadSnapshots,
  runBackupAudit,
  scheduleBackupAlarm,
  setBackupSettings,
  storeSnapshot,
  toMeta,
};

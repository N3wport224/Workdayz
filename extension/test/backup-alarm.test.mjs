// The alarm-driven backup audit and snapshot store.
//
// Worth stating what this does NOT test, because the spec asked for it: the
// alarm does not produce a snapshot. It can't — the application tracker lives in
// the web app's localStorage, unreachable from any extension surface, so an
// alarm firing with no tab open has nothing to read. And unattended AES-GCM has
// nowhere safe to keep a passphrase; storing one beside the ciphertext in the
// same chrome.storage.local would protect against nothing while claiming to.
//
// So the web app encrypts (user present, real passphrase) and pushes ciphertext;
// the alarm rotates, audits staleness, and badges. That's what's verified here,
// including that no passphrase ever reaches this side.
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const here = path.dirname(fileURLToPath(import.meta.url));
const CHROMIUM_CANDIDATES = [process.env.WORKDAYZ_CHROMIUM, "/opt/pw-browsers/chromium"].filter(Boolean);
const executablePath = CHROMIUM_CANDIDATES.find((p) => existsSync(p));

const failures = [];
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else { failures.push(name); console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

// chrome.* shim. alarms/action calls are recorded so the test can assert
// scheduling and badging without a real browser extension host.
const CHROME_SHIM = `
window.__storage = {};
window.__alarms = {};
window.__badge = [];
window.__alarmListeners = [];
window.chrome = {
  runtime: {
    getManifest: () => ({ version: "1.0.0-test" }),
    lastError: null,
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} },
  },
  storage: {
    local: {
      get: (keys) => new Promise((resolve) => {
        if (keys == null) return resolve({ ...window.__storage });
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of list) if (k in window.__storage) out[k] = window.__storage[k];
        resolve(out);
      }),
      set: (obj) => new Promise((resolve) => { Object.assign(window.__storage, obj); resolve(); }),
    },
  },
  alarms: {
    create: (name, info) => { window.__alarms[name] = info; return Promise.resolve(); },
    clear: (name) => { delete window.__alarms[name]; return Promise.resolve(true); },
    onAlarm: { addListener: (fn) => { window.__alarmListeners.push(fn); } },
  },
  action: {
    setBadgeText: (o) => { window.__badge.push(o); return Promise.resolve(); },
    setBadgeBackgroundColor: () => Promise.resolve(),
  },
  tabs: { query: () => Promise.resolve([]), sendMessage: () => Promise.resolve({}), create: () => Promise.resolve({}) },
  commands: { onCommand: { addListener: () => {} } },
  scripting: { getRegisteredContentScripts: () => Promise.resolve([]), registerContentScripts: () => Promise.resolve(), updateContentScripts: () => Promise.resolve() },
  permissions: { contains: () => Promise.resolve(true) },
};
`;

const bundle = await esbuild.build({
  entryPoints: [path.join(here, "backup-harness.ts")],
  bundle: true,
  format: "iife",
  globalName: "BackupHarness",
  write: false,
  target: "chrome110",
});

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage();
await page.setContent("<!doctype html><html><body></body></html>");
await page.addScriptTag({ content: CHROME_SHIM });

const shimOk = await page.evaluate(
  () => typeof window.__storage === "object" && typeof window.chrome?.alarms?.create === "function",
);
check("chrome shim installed", shimOk);
if (!shimOk) { await browser.close(); process.exit(1); }

await page.addScriptTag({ content: bundle.outputFiles[0].text });

const H = (fn, ...args) => page.evaluate(({ fn, args }) => window.BackupHarness[fn](...args), { fn, args });
const store = (key) => page.evaluate((k) => window.__storage[k], key);
const reset = () => page.evaluate(() => { window.__storage = {}; window.__alarms = {}; window.__badge = []; });

function snapshot(over = {}) {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    encrypted: true,
    payload: JSON.stringify({ workdayzEncrypted: true, version: 1, salt: "c2FsdA==", iv: "aXY=", ciphertext: "Y2lwaGVy", iterations: 600000 }),
    applications: 3,
    profiles: 1,
    ...over,
  };
}

// --- interval clamping ---------------------------------------------------
const clamp = await page.evaluate(() => {
  const c = window.BackupHarness.clampIntervalDays;
  return { def: c(undefined), valid: c(14), zero: c(0), negative: c(-9), huge: c(99999), str: c("7"), nan: c(NaN) };
});
check("interval defaults to 7 days", clamp.def === 7, String(clamp.def));
check("interval accepts a valid value", clamp.valid === 14);
check("interval floors at 1 day (chrome rejects sub-minute periods)", clamp.zero === 1 && clamp.negative === 1);
check("interval ceilings at a year", clamp.huge === 365);
check("interval ignores non-numeric input", clamp.str === 7 && clamp.nan === 7);

// --- scheduling ----------------------------------------------------------
await reset();
await H("scheduleBackupAlarm");
const alarms = await page.evaluate(() => window.__alarms);
check("registers the audit alarm by default", Boolean(alarms["workdayz-backup-audit"]), JSON.stringify(alarms));
check(
  "period matches 7 days in minutes",
  alarms["workdayz-backup-audit"]?.periodInMinutes === 7 * 24 * 60,
  String(alarms["workdayz-backup-audit"]?.periodInMinutes),
);

// Re-registering must not stack duplicates — chrome replaces by name, and the
// shim mirrors that, so the key count staying at 1 is the assertion.
await H("scheduleBackupAlarm");
await H("scheduleBackupAlarm");
check("re-registering is idempotent", Object.keys(await page.evaluate(() => window.__alarms)).length === 1);

const settings14 = await H("setBackupSettings", { intervalDays: 14 });
check("settings change persists the interval", settings14.intervalDays === 14, JSON.stringify(settings14));
check(
  "settings change reschedules the alarm",
  (await page.evaluate(() => window.__alarms["workdayz-backup-audit"]?.periodInMinutes)) === 14 * 24 * 60,
);

await H("setBackupSettings", { enabled: false });
check("disabling clears the alarm", Object.keys(await page.evaluate(() => window.__alarms)).length === 0);
const reEnabled = await H("setBackupSettings", { enabled: true });
check("re-enabling restores it", Boolean((await page.evaluate(() => window.__alarms))["workdayz-backup-audit"]));
check("re-enabling keeps the chosen interval", reEnabled.intervalDays === 14, JSON.stringify(reEnabled));

// --- snapshot storage ----------------------------------------------------
await reset();
const stored = await H("storeSnapshot", snapshot());
check("stores a pushed snapshot", stored.ok === true, JSON.stringify(stored));
check("records how many are kept", stored.kept === 1);
check("stamps lastSnapshotAt for cheap staleness checks", typeof (await store("workdayz.lastSnapshotAt")) === "string");

const empty = await H("storeSnapshot", snapshot({ payload: "" }));
check("refuses an empty payload", empty.ok === false && empty.reason === "empty", JSON.stringify(empty));

const huge = await H("storeSnapshot", snapshot({ payload: "x".repeat(1_100_000) }));
check(
  "refuses an oversized snapshot rather than evicting the profile to fit",
  huge.ok === false && huge.reason === "too-large",
  JSON.stringify(huge),
);
check("the refused snapshot did not replace the good one", (await store("workdayz.backupSnapshots"))?.length === 1);

// --- rotation ------------------------------------------------------------
await reset();
const rotated = await page.evaluate(async () => {
  for (let i = 0; i < 5; i++) {
    await window.BackupHarness.storeSnapshot({
      version: 1,
      createdAt: `2026-03-1${i}T00:00:00.000Z`,
      encrypted: true,
      payload: JSON.stringify({ n: i }),
      applications: i,
      profiles: 1,
    });
  }
  const list = window.__storage["workdayz.backupSnapshots"];
  return { length: list.length, first: list[0].createdAt, last: list[list.length - 1].createdAt };
});
check("keeps at most 3 snapshots", rotated.length === 3, String(rotated.length));
check("keeps the newest", rotated.last === "2026-03-14T00:00:00.000Z", rotated.last);
check(
  "keeps more than one, so a snapshot taken from corrupted data isn't the only option",
  rotated.first === "2026-03-12T00:00:00.000Z",
  rotated.first,
);

// --- audit ---------------------------------------------------------------
await reset();
const noneAudit = await H("auditBackups");
check("with no snapshot, audit reports stale", noneAudit.stale === true, JSON.stringify(noneAudit));
check("with no snapshot, age is null rather than 0", noneAudit.ageDays === null);
check("with no snapshot, count is 0", noneAudit.snapshotCount === 0);

await H("storeSnapshot", snapshot({ createdAt: new Date().toISOString() }));
const freshAudit = await H("auditBackups");
check("a just-pushed snapshot is not stale", freshAudit.stale === false, JSON.stringify(freshAudit));
check("age rounds to one decimal", freshAudit.ageDays !== null && freshAudit.ageDays < 0.1);

const NOW = Date.parse("2026-03-20T12:00:00.000Z");
await reset();
await H("storeSnapshot", snapshot({ createdAt: new Date(NOW - 3 * 86_400_000).toISOString() }));
check("3 days old with a 7-day interval is fresh", (await H("auditBackups", NOW)).stale === false);
await reset();
await H("storeSnapshot", snapshot({ createdAt: new Date(NOW - 8 * 86_400_000).toISOString() }));
const staleAudit = await H("auditBackups", NOW);
check("8 days old with a 7-day interval is stale", staleAudit.stale === true, JSON.stringify(staleAudit));
check("reports the age in days", Math.round(staleAudit.ageDays) === 8, String(staleAudit.ageDays));

// A future timestamp must read as age 0, not a negative age that would make a
// stale snapshot look permanently fresh.
await reset();
await H("storeSnapshot", snapshot({ createdAt: new Date(NOW + 5 * 86_400_000).toISOString() }));
const skewed = await H("auditBackups", NOW);
check("clock skew clamps age to 0 instead of going negative", skewed.ageDays === 0, String(skewed.ageDays));
check("a future-stamped snapshot reads as fresh, not stale-forever", skewed.stale === false);

// --- metadata only, never payload ---------------------------------------
await reset();
await H("storeSnapshot", snapshot());
const meta = (await H("auditBackups")).snapshots;
check("audit exposes snapshot metadata", meta.length === 1 && meta[0].applications === 3, JSON.stringify(meta));
check(
  "audit NEVER includes the payload — a status check must not leak ciphertext into a page",
  !("payload" in meta[0]) && !JSON.stringify(meta).includes("ciphertext"),
  JSON.stringify(meta),
);
check("audit reports byte size for the UI", typeof meta[0].bytes === "number" && meta[0].bytes > 0);

// --- the alarm's actual job ---------------------------------------------
await reset();
await H("storeSnapshot", snapshot({ createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString() }));
const ranStale = await H("runBackupAudit");
check("the audit run reports stale", ranStale.stale === true);
check("the audit run records its result", Boolean(await store("workdayz.lastBackupAudit")));
const badge = await page.evaluate(() => window.__badge);
check("a stale backup badges the toolbar (visible with no tab open)", badge.some((b) => b.text === "!"), JSON.stringify(badge));

await reset();
await H("storeSnapshot", snapshot({ createdAt: new Date().toISOString() }));
const ranFresh = await H("runBackupAudit");
check("a fresh backup does not badge", (await page.evaluate(() => window.__badge)).length === 0);
check("the fresh audit still records", ranFresh.stale === false);

// Disabled means no badge even when stale — the user opted out.
await reset();
await H("setBackupSettings", { enabled: false });
await H("storeSnapshot", snapshot({ createdAt: new Date(Date.now() - 60 * 86_400_000).toISOString() }));
await H("runBackupAudit");
check("a disabled schedule never badges", (await page.evaluate(() => window.__badge)).length === 0);

// --- no passphrase ever reaches this side -------------------------------
await reset();
await H("setBackupSettings", { enabled: true });
await H("storeSnapshot", snapshot());
const allStorage = await page.evaluate(() => JSON.stringify(window.__storage));
check(
  "extension storage holds no passphrase, key, or derived material",
  !/passphrase|derivedKey|"secret"|pbkdf2Key/i.test(allStorage),
  allStorage.slice(0, 200),
);
check(
  "the stored payload is the ciphertext envelope, not plaintext",
  allStorage.includes("workdayzEncrypted") && allStorage.includes("ciphertext"),
);

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} backup-alarm check(s) failed.`);
  process.exit(1);
}
console.log("\nAll backup-alarm checks passed.");

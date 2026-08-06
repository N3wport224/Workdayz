// The background worker's confirmation dedupe + durable queue.
//
// Two properties this suite exists to prove:
//   1. Reloading or navigating back to a confirmation page cannot double-log.
//      In-memory state can't do this — a reload builds a brand-new content
//      script — so the guard has to live in persisted storage.
//   2. A confirmation survives the web app being CLOSED. That's the normal
//      case (submit, close the tab, check the tracker later), and a
//      fire-and-forget relay would lose it silently. Hence the queue, and
//      hence acknowledgement-based removal rather than clear-on-read.
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

// chrome.* shim. tabs.sendMessage records relay attempts so the test can assert
// the live-relay path fires without needing a real web-app tab.
const CHROME_SHIM = `
window.__storage = {};
window.__relayed = [];
window.__tabs = [{ id: 1, url: "http://localhost:3000/applications" }];
window.chrome = {
  runtime: { getManifest: () => ({ version: "1.0.0-test" }), lastError: null, onInstalled: { addListener: () => {} }, onMessage: { addListener: () => {} } },
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
  tabs: {
    query: () => Promise.resolve(window.__tabs),
    sendMessage: (tabId, msg) => { window.__relayed.push({ tabId, msg }); return Promise.resolve({ ok: true }); },
    create: () => Promise.resolve({ id: 2 }),
  },
  action: { setBadgeText: () => Promise.resolve(), setBadgeBackgroundColor: () => Promise.resolve() },
  commands: { onCommand: { addListener: () => {} } },
  scripting: { getRegisteredContentScripts: () => Promise.resolve([]), registerContentScripts: () => Promise.resolve(), updateContentScripts: () => Promise.resolve() },
  permissions: { contains: () => Promise.resolve(true) },
};
`;

const bundle = await esbuild.build({
  entryPoints: [path.join(here, "background-harness.ts")],
  bundle: true,
  format: "iife",
  globalName: "BgHarness",
  write: false,
  target: "chrome110",
});
const harnessJs = bundle.outputFiles[0].text;

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage();
await page.setContent("<!doctype html><html><body></body></html>");
await page.addScriptTag({ content: CHROME_SHIM });

const shimOk = await page.evaluate(
  () => typeof window.__storage === "object" && typeof window.chrome?.storage?.local?.set === "function",
);
check("chrome shim installed", shimOk);
if (!shimOk) { await browser.close(); process.exit(1); }

await page.addScriptTag({ content: harnessJs });

const KEY = "acme.myworkdayjobs.com|acme|jr-1234";
function event(over = {}) {
  return {
    key: KEY,
    company: "Acme",
    title: "Platform Engineer",
    jobId: "JR-1234",
    submittedAt: new Date().toISOString(),
    sourceUrl: "https://acme.myworkdayjobs.com/job-apply/confirmation",
    hostname: "acme.myworkdayjobs.com",
    via: "url",
    evidence: "/job-apply/confirmation",
    ...over,
  };
}

const send = (msg) => page.evaluate((m) => window.BgHarness.handleMessage(m, {}), msg);
const storage = (key) => page.evaluate((k) => window.__storage[k], key);
const reset = () => page.evaluate(() => { window.__storage = {}; window.__relayed = []; });

// Configure a connected web app so the relay path is reachable.
await page.evaluate(() => { window.__storage["workdayz.webAppOrigin"] = "http://localhost:3000"; });

// --- first record ---------------------------------------------------------
const first = await send({ type: "RECORD_CONFIRMATION", payload: event() });
check("records a new confirmation", first?.ok === true && first.duplicate === false, JSON.stringify(first));
check("queues it for the web app", (await storage("workdayz.pendingConfirmations"))?.length === 1);
check("writes a dedupe log entry", Boolean((await storage("workdayz.confirmationLog"))?.[KEY]));

const relayed = await page.evaluate(() => window.__relayed);
check("relays live to an open web-app tab", relayed.length === 1 && relayed[0].msg.type === "CONFIRMATION_RELAY", JSON.stringify(relayed));

// --- duplicate guard -----------------------------------------------------
const second = await send({ type: "RECORD_CONFIRMATION", payload: event() });
check("a repeat view is reported as a duplicate", second?.duplicate === true, JSON.stringify(second));
check("duplicate does not grow the queue", (await storage("workdayz.pendingConfirmations"))?.length === 1);
check("duplicate reports when it was first seen", typeof second?.firstSeenAt === "string");

// Simulating a page reload: the content script is gone, but storage persists.
// This is exactly the case in-memory dedupe cannot catch.
const third = await send({ type: "RECORD_CONFIRMATION", payload: event({ submittedAt: new Date().toISOString() }) });
check("a reload with a fresh timestamp is still a duplicate", third?.duplicate === true, JSON.stringify(third));
check("queue still holds exactly one", (await storage("workdayz.pendingConfirmations"))?.length === 1);

// --- a genuinely different application -----------------------------------
const other = await send({
  type: "RECORD_CONFIRMATION",
  payload: event({ key: "globex.myworkdayjobs.com|globex|jr-999", company: "Globex", jobId: "JR-999" }),
});
check("a different application is not a duplicate", other?.duplicate === false);
check("queue now holds two", (await storage("workdayz.pendingConfirmations"))?.length === 2);

// --- re-application after the window ------------------------------------
await page.evaluate((k) => {
  // Backdate the log entry past the 24h window.
  const log = window.__storage["workdayz.confirmationLog"];
  log[k] = { at: new Date(Date.now() - 25 * 3_600_000).toISOString() };
  window.__storage["workdayz.confirmationLog"] = log;
}, KEY);
const reapply = await send({ type: "RECORD_CONFIRMATION", payload: event() });
check("re-applying after 24h records again", reapply?.duplicate === false, JSON.stringify(reapply));
check("re-application replaces rather than duplicates its queue entry", (await storage("workdayz.pendingConfirmations"))?.length === 2);

// --- drain + acknowledge -------------------------------------------------
const pending = await send({ type: "GET_PENDING_CONFIRMATIONS" });
check("web app can drain the queue", pending?.confirmations?.length === 2, JSON.stringify(pending?.confirmations?.length));

// Partial ack: only what the web app actually committed is dropped.
const ackOne = await send({ type: "ACK_CONFIRMATIONS", keys: [KEY] });
check("acknowledging one removes only that one", ackOne?.remaining === 1, JSON.stringify(ackOne));
const afterPartial = await storage("workdayz.pendingConfirmations");
check("the unacknowledged confirmation is still queued", afterPartial?.[0]?.company === "Globex", JSON.stringify(afterPartial));

// An empty ack must not clear the queue — that's the "web app failed to write"
// path, and dropping the queue there would lose a real submission.
const ackNone = await send({ type: "ACK_CONFIRMATIONS", keys: [] });
check("an empty acknowledgement clears nothing", ackNone?.remaining === 1);
const ackGarbage = await send({ type: "ACK_CONFIRMATIONS", keys: undefined });
check("a missing keys array clears nothing", ackGarbage?.remaining === 1);

// --- reading does not consume -------------------------------------------
const reread = await send({ type: "GET_PENDING_CONFIRMATIONS" });
check("draining twice returns the same queue (read is not consume)", reread?.confirmations?.length === 1);

// --- survives with no web app connected ---------------------------------
await reset();
const offline = await send({ type: "RECORD_CONFIRMATION", payload: event() });
check("records with no web-app origin configured", offline?.ok === true && offline.duplicate === false);
check("still queues it for later", (await storage("workdayz.pendingConfirmations"))?.length === 1);
check("no relay attempted with nothing connected", (await page.evaluate(() => window.__relayed)).length === 0);

// --- relay failure must not lose the confirmation ------------------------
await reset();
await page.evaluate(() => {
  window.__storage["workdayz.webAppOrigin"] = "http://localhost:3000";
  window.chrome.tabs.sendMessage = () => Promise.reject(new Error("no receiver"));
});
const relayFailed = await send({ type: "RECORD_CONFIRMATION", payload: event() });
check("a failed relay still succeeds overall", relayFailed?.ok === true, JSON.stringify(relayFailed));
check("a failed relay still leaves it queued", (await storage("workdayz.pendingConfirmations"))?.length === 1);

// --- queue cap -----------------------------------------------------------
await reset();
const capped = await page.evaluate(async () => {
  for (let i = 0; i < 210; i++) {
    await window.BgHarness.handleMessage({
      type: "RECORD_CONFIRMATION",
      payload: {
        key: `host|co|jr-${i}`, company: "Co", title: `Role ${i}`, jobId: `JR-${i}`,
        submittedAt: new Date().toISOString(), sourceUrl: "u", hostname: "h", via: "url", evidence: "e",
      },
    }, {});
  }
  const q = window.__storage["workdayz.pendingConfirmations"];
  return { length: q.length, firstKey: q[0].key, lastKey: q[q.length - 1].key };
});
check("queue is capped so it cannot exhaust the storage quota", capped.length === 200, String(capped.length));
check("the cap keeps the NEWEST confirmations", capped.lastKey === "host|co|jr-209", capped.lastKey);
check("the oldest were evicted", capped.firstKey === "host|co|jr-10", capped.firstKey);

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} confirmation-sync check(s) failed.`);
  process.exit(1);
}
console.log("\nAll confirmation-sync checks passed.");

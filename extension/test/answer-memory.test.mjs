// Tests the answer-memory bank against real mock-Workday markup in a real
// browser, because the interesting behavior is DOM-coupled: which fields
// count as questions, which get written, and which are refused outright.
//
// The load-bearing assertion here is the self-ID one. Veteran/disability/
// gender/race questions must never be captured NOR recalled, no matter how
// they're worded — that's a promise the README makes and the whole reason
// isPersonalField is shared rather than duplicated.
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const here = path.dirname(fileURLToPath(import.meta.url));

// Same resolution order as run-e2e.mjs: an explicit override, else the
// preinstalled browser, else whatever playwright-core finds on its own.
const CHROMIUM_CANDIDATES = [
  process.env.WORKDAYZ_CHROMIUM,
  "/opt/pw-browsers/chromium",
].filter(Boolean);
const executablePath = CHROMIUM_CANDIDATES.find((p) => existsSync(p));

const failures = [];
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else { failures.push(name); console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

// Same in-page chrome.storage.local shim shape as popup-verify.mjs: a plain
// object behind an async get/set, so the real module runs unmodified.
// Injected via addScriptTag rather than addInitScript because addInitScript
// does not fire for setContent — and Chromium ships its own window.chrome,
// so a silently-absent shim looks present until the first storage call.
const CHROME_SHIM = `
window.__storage = {};
window.chrome = {
  runtime: { getManifest: () => ({ version: "1.0.0-test" }), lastError: null },
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
      remove: (keys) => new Promise((resolve) => {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) delete window.__storage[k];
        resolve();
      }),
    },
  },
};
`;

// A screening step: ordinary questions plus two self-ID questions that MUST be
// refused. Body-only markup: the two phases swap it inside one JS context, so
// the shimmed store survives between them the way chrome.storage.local does
// across a real navigation.
const PAGE = `
  <label for="q1">How many years of Python experience do you have?</label>
  <input id="q1" type="text" />

  <label for="q2">Do you hold an active security clearance?</label>
  <input id="q2" type="text" />

  <!-- Worded WITH a "?" on purpose: that makes it pass the question-shape
       test, so only isPersonalField can stop it. A label without "?" would be
       filtered for the wrong reason and the assertion would prove nothing. -->
  <label for="q3">What gender do you self-identify as?</label>
  <input id="q3" type="text" />

  <label for="q4">Are you a protected veteran?</label>
  <input id="q4" type="text" />

  <label for="q5">What are your salary expectations for this role?</label>
  <input id="q5" type="text" />

  <label for="first">First Name</label>
  <input id="first" type="text" />`;

const bundle = await esbuild.build({
  entryPoints: [path.join(here, "memory-harness.ts")],
  bundle: true,
  format: "iife",
  globalName: "MemHarness",
  write: false,
  target: "chrome110",
});
const harnessJs = bundle.outputFiles[0].text;

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage();
await page.setContent("<!doctype html><html><body></body></html>");
await page.addScriptTag({ content: CHROME_SHIM });
await page.addScriptTag({ content: harnessJs });

// Guard against the failure mode that made this suite look green while the
// shim was absent: Chromium's own window.chrome has no .storage.
const shimOk = await page.evaluate(
  () => typeof window.__storage === "object" && typeof window.chrome?.storage?.local?.set === "function",
);
check("chrome.storage.local shim is actually installed", shimOk);
if (!shimOk) {
  await browser.close();
  console.error("\nAborting: without the shim every storage assertion below is vacuous.");
  process.exit(1);
}

/** Swaps in a form without tearing down the JS context (so memory persists). */
async function loadForm(bodyHtml) {
  await page.evaluate((html) => { document.body.innerHTML = html; }, bodyHtml);
}

await loadForm(PAGE);

// --- capture -------------------------------------------------------------
// Answer the ordinary questions AND the self-ID ones, then capture. The
// self-ID answers are present on the page, so if the filter were missing they
// WOULD be stored — this is a real test of the exclusion, not a vacuous one.
await page.fill("#q1", "6 years");
await page.fill("#q2", "Yes — active Secret clearance");
await page.fill("#q3", "Prefer not to say");
await page.fill("#q4", "No");
await page.fill("#q5", "$120,000");

const captured = await page.evaluate(() => window.MemHarness.captureAnswersFromPage());
check("captures ordinary screening answers", captured.saved.length === 3, JSON.stringify(captured.saved));

const stored = await page.evaluate(() => window.__storage["workdayz.answerMemory"]);
const storedLabels = Object.values(stored || {}).map((e) => e.label.toLowerCase());

check("remembered the years-of-experience answer", storedLabels.some((l) => l.includes("python")));
check("remembered the clearance answer", storedLabels.some((l) => l.includes("clearance")));
check("remembered the salary answer", storedLabels.some((l) => l.includes("salary")));

// The invariant.
check(
  "NEVER stored the gender self-ID question",
  !storedLabels.some((l) => l.includes("gender") || l.includes("self-identify") || l.includes("self identify")),
  JSON.stringify(storedLabels),
);
check(
  "NEVER stored the veteran self-ID question",
  !storedLabels.some((l) => l.includes("veteran")),
  JSON.stringify(storedLabels),
);
check("did not store the plain contact field as a question", !storedLabels.some((l) => l.includes("first name")));

// --- recall --------------------------------------------------------------
// Fresh page, same questions worded with different punctuation/casing, to
// prove normalization matches across tenants. #q2 arrives pre-answered.
const RECALL_PAGE = PAGE
  .replace("How many years of Python experience do you have?", "HOW MANY YEARS OF PYTHON EXPERIENCE DO YOU HAVE??")
  .replace('<input id="q2" type="text" />', '<input id="q2" type="text" value="Already answered by me" />');

await loadForm(RECALL_PAGE);

const preview = await page.evaluate(() => window.MemHarness.previewRememberedAnswers());
check("preview reports what memory would answer", preview.length >= 2, JSON.stringify(preview));
const previewWroteNothing = await page.evaluate(() => document.querySelector("#q1").value === "");
check("preview writes nothing", previewWroteNothing);

const recalled = await page.evaluate(() => window.MemHarness.applyRememberedAnswers());
check("recall filled at least the two empty remembered questions", recalled.filled.length >= 2, JSON.stringify(recalled.filled));

const values = await page.evaluate(() => ({
  q1: document.querySelector("#q1").value,
  q2: document.querySelector("#q2").value,
  q3: document.querySelector("#q3").value,
  q4: document.querySelector("#q4").value,
  q5: document.querySelector("#q5").value,
}));

check("matched across casing/punctuation differences", values.q1 === "6 years", values.q1);
check("did NOT overwrite the already-answered question", values.q2 === "Already answered by me", values.q2);
check("recalled the salary answer", values.q5 === "$120,000", values.q5);

// The invariant, other direction: even if a self-ID answer somehow got into
// storage, recall must refuse to write it.
check("NEVER auto-filled the gender self-ID question", values.q3 === "", values.q3);
check("NEVER auto-filled the veteran self-ID question", values.q4 === "", values.q4);

// --- key normalization ---------------------------------------------------
const keyChecks = await page.evaluate(() => {
  const k = window.MemHarness.memoryKey;
  return {
    punctuation: k("How many years?") === k("How many years"),
    casing: k("SALARY Expectations") === k("salary expectations"),
    whitespace: k("a   b\n c") === "a b c",
    trims: k("  padded  ") === "padded",
  };
});
check("key ignores punctuation", keyChecks.punctuation);
check("key ignores casing", keyChecks.casing);
check("key collapses whitespace", keyChecks.whitespace);
check("key trims", keyChecks.trims);

// --- refusals ------------------------------------------------------------
const refusals = await page.evaluate(async () => ({
  tooShort: await window.MemHarness.rememberAnswer("Age?", "30"),
  emptyAnswer: await window.MemHarness.rememberAnswer("What is your greatest strength?", "   "),
  selfId: await window.MemHarness.rememberAnswer("Do you identify as a protected veteran?", "No"),
  coverLetter: await window.MemHarness.rememberAnswer("Paste your cover letter below", "Dear hiring manager"),
  valid: await window.MemHarness.rememberAnswer("Why do you want this role specifically?", "Because of the mission"),
}));
check("refuses a too-short question label", refusals.tooShort === false);
check("refuses an empty answer", refusals.emptyAnswer === false);
check("refuses a self-ID question even when asked directly", refusals.selfId === false);
check("refuses to remember a cover letter", refusals.coverLetter === false);
check("accepts a legitimate question", refusals.valid === true);

// --- forget / clear ------------------------------------------------------
const cleared = await page.evaluate(async () => {
  await window.MemHarness.clearAnswerMemory();
  return (await window.MemHarness.listRememberedAnswers()).length;
});
check("clearAnswerMemory empties the bank", cleared === 0, String(cleared));

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} answer-memory check(s) failed.`);
  process.exit(1);
}
console.log("\nAll answer-memory checks passed.");

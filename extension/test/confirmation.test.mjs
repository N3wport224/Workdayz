// Confirmation-page detection, run in a real browser against mock-Workday
// markup because detection is DOM-coupled.
//
// The assertions that matter most are the NEGATIVE ones. A false positive marks
// a job as applied when it never was submitted — the user then stops chasing a
// real application. That's much worse than a missed detection they can fix with
// one click, so the false-positive guards below are the point of this suite.
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

const bundle = await esbuild.build({
  entryPoints: [path.join(here, "confirmation-harness.ts")],
  bundle: true,
  format: "iife",
  globalName: "ConfHarness",
  write: false,
  target: "chrome110",
});
const harnessJs = bundle.outputFiles[0].text;

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage();
await page.setContent("<!doctype html><html><body></body></html>");
await page.addScriptTag({ content: harnessJs });

async function loadBody(html) {
  await page.evaluate((h) => { document.body.innerHTML = h; }, html);
}
const detect = (href) => page.evaluate((u) => window.ConfHarness.detectConfirmation(u), href);

const CONFIRMED = `<h1>Your application has been submitted</h1><p>We will be in touch.</p>`;

// --- URL detection -------------------------------------------------------
await loadBody(`<p>Nothing special here.</p>`);

for (const url of [
  "https://acme.wd1.myworkdayjobs.com/en-US/careers/job-apply/confirmation",
  "https://acme.myworkdayjobs.com/application/confirmation",
  "https://acme.myworkdayjobs.com/apply/submitted",
  "https://acme.myworkdayjobs.com/apply/thank-you",
  "https://acme.myworkdayjobs.com/apply/thankyou",
  "https://acme.myworkdayjobs.com/application-submitted",
]) {
  const result = await detect(url);
  check(`detects confirmation URL ${new URL(url).pathname}`, result?.via === "url", JSON.stringify(result));
}

// --- URL non-detection ---------------------------------------------------
for (const url of [
  "https://acme.myworkdayjobs.com/en-US/careers/job/Platform-Engineer_JR-1234",
  "https://acme.myworkdayjobs.com/en-US/careers",
  "https://acme.myworkdayjobs.com/apply",
  "https://acme.myworkdayjobs.com/my-applications",
]) {
  const result = await detect(url);
  check(`does NOT fire on ${new URL(url).pathname}`, result === null, JSON.stringify(result));
}

// --- DOM heading detection ----------------------------------------------
const NEUTRAL_URL = "https://acme.myworkdayjobs.com/en-US/careers/page";

for (const heading of [
  "Your application has been submitted",
  "Application submitted",
  "Thank you for applying",
  "Thank you for your application",
  "We have received your application",
  "Your application is complete",
  "Submission successful",
]) {
  await loadBody(`<h2>${heading}</h2>`);
  const result = await detect(NEUTRAL_URL);
  check(`detects heading "${heading}"`, result?.via === "dom", JSON.stringify(result));
}

await loadBody(`<div role="heading">Thank you for applying</div>`);
check('detects role="heading"', (await detect(NEUTRAL_URL))?.via === "dom");

await loadBody(`<div data-automation-id="confirmationPage"><span>Application submitted</span></div>`);
check("detects Workday confirmationPage automation-id", (await detect(NEUTRAL_URL))?.via === "dom");

// --- DOM false-positive guards ------------------------------------------
// The my-applications page is full of "Application Submitted" as row text.
await loadBody(`
  <h1>My Applications</h1>
  <table>
    <tr><td>Platform Engineer</td><td>Application submitted</td></tr>
    <tr><td>Data Scientist</td><td>Application submitted</td></tr>
  </table>`);
check(
  "does NOT fire on 'Application submitted' as table-cell text",
  (await detect("https://acme.myworkdayjobs.com/my-applications")) === null,
);

await loadBody(`<p>Once your application has been submitted you will receive an email.</p>`);
check(
  "does NOT fire on body copy describing what will happen",
  (await detect(NEUTRAL_URL)) === null,
);

await loadBody(`<div>Thank you for applying</div>`);
check(
  "does NOT fire on a bare div (not a heading)",
  (await detect(NEUTRAL_URL)) === null,
);

// A whole page crammed into one h1 is not a heading.
await loadBody(`<h1>${"filler text ".repeat(40)} your application has been submitted ${"more ".repeat(20)}</h1>`);
check(
  "does NOT fire on an over-long pseudo-heading",
  (await detect(NEUTRAL_URL)) === null,
);

// --- application-form veto ----------------------------------------------
// A page still offering fields has not been submitted, however it's worded.
// This is the strongest guard: it beats even a confirmation URL.
const FORM_WITH_SUCCESS_TEXT = `
  <h1>Your application has been submitted</h1>
  <label for="first">First Name</label><input id="first" type="text" />
  <label for="last">Last Name</label><input id="last" type="text" />
  <label for="email">Email</label><input id="email" type="text" />
  <label for="phone">Phone</label><input id="phone" type="text" />
  <label for="addr">Address Line 1</label><input id="addr" type="text" />
  <label for="city">City</label><input id="city" type="text" />
  <button>Save and Continue</button>`;

await loadBody(FORM_WITH_SUCCESS_TEXT);
const formIsForm = await page.evaluate(() => window.ConfHarness.looksLikeApplicationForm());
check("sanity: the fixture really does look like an application form", formIsForm);
check(
  "does NOT fire on a fillable form, even with success copy present",
  (await detect(NEUTRAL_URL)) === null,
);
check(
  "does NOT fire on a fillable form, even at a confirmation URL",
  (await detect("https://acme.myworkdayjobs.com/job-apply/confirmation")) === null,
);

// --- metadata ------------------------------------------------------------
await loadBody(`${CONFIRMED}<div data-automation-id="requisitionId">JR-55501</div>`);
const event = await page.evaluate(() =>
  window.ConfHarness.buildConfirmationEvent(
    { via: "url", evidence: "/job-apply/confirmation" },
    { title: "Senior Platform Engineer", company: "Acme Corp" },
    "https://acme.wd1.myworkdayjobs.com/job-apply/confirmation",
    "2026-03-10T15:00:00.000Z",
  ),
);
check("captures the title from stored context", event.title === "Senior Platform Engineer", event.title);
check("captures the company from stored context", event.company === "Acme Corp", event.company);
check("scrapes the requisition id from the page", event.jobId === "JR-55501", event.jobId);
check("records the submission timestamp", event.submittedAt === "2026-03-10T15:00:00.000Z");
check("records the hostname", event.hostname === "acme.wd1.myworkdayjobs.com", event.hostname);
check("records the source URL", event.sourceUrl.includes("/job-apply/confirmation"));
check("carries the detection evidence through", event.via === "url" && event.evidence.includes("confirmation"));

// Falls back to the hostname-derived company when no context is available.
await loadBody(CONFIRMED);
const noContext = await page.evaluate(() =>
  window.ConfHarness.buildConfirmationEvent(
    { via: "dom", evidence: "Application submitted" },
    {},
    "https://globex-industries.wd5.myworkdayjobs.com/apply/submitted",
    "2026-03-10T15:00:00.000Z",
  ),
);
check(
  "derives a company from the tenant hostname when context is empty",
  noContext.company.toLowerCase().includes("globex"),
  noContext.company,
);
check("never leaves the title empty", noContext.title.length > 0, noContext.title);

// Requisition id from the URL when the DOM has none.
const urlReq = await page.evaluate(() =>
  window.ConfHarness.buildConfirmationEvent(
    { via: "url", evidence: "x" },
    { title: "T", company: "C" },
    "https://acme.myworkdayjobs.com/job/Platform-Engineer_JR-98765/apply/submitted",
    "2026-03-10T15:00:00.000Z",
  ),
);
check("falls back to a requisition id in the URL", urlReq.jobId === "JR-98765", urlReq.jobId);

// The regex can't use \b before the prefix — underscore is a word character, so
// the common "Role_JR-12345" slug form would never match. These pin both sides
// of that fix: underscore-adjacent ids match, mid-word ones do not.
const reqIdCases = await page.evaluate(() => {
  const build = (href) =>
    window.ConfHarness.buildConfirmationEvent({ via: "url", evidence: "x" }, { title: "T", company: "C" }, href, "2026-03-10T15:00:00.000Z").jobId;
  return {
    underscore: build("https://a.myworkdayjobs.com/job/Platform-Engineer_JR-98765/apply/submitted"),
    slash: build("https://a.myworkdayjobs.com/job/JR12345/apply/submitted"),
    query: build("https://a.myworkdayjobs.com/apply/submitted?jobId=JR_4321"),
    shortRPrefix: build("https://a.myworkdayjobs.com/job/R-4455/apply/submitted"),
    midWord: build("https://a.myworkdayjobs.com/job/SENIOR-12345/apply/submitted"),
    noId: build("https://a.myworkdayjobs.com/apply/submitted"),
  };
});
check("req id after an underscore separator", reqIdCases.underscore === "JR-98765", reqIdCases.underscore);
check("req id after a slash", reqIdCases.slash === "JR12345", reqIdCases.slash);
check("req id in a query parameter", reqIdCases.query === "JR_4321", reqIdCases.query);
check("bare R- prefix form", reqIdCases.shortRPrefix === "R-4455", reqIdCases.shortRPrefix);
check(
  "does NOT extract 'R-12345' from inside SENIOR-12345",
  reqIdCases.midWord === "",
  reqIdCases.midWord,
);
check("no req id yields an empty string", reqIdCases.noId === "", reqIdCases.noId);

// --- dedupe key ----------------------------------------------------------
const keys = await page.evaluate(() => {
  const k = window.ConfHarness.confirmationKey;
  const base = { hostname: "acme.myworkdayjobs.com", jobId: "JR-1", title: "Platform Engineer", company: "Acme" };
  return {
    stable: k(base) === k({ ...base }),
    ignoresCase: k(base) === k({ ...base, jobId: "jr-1", company: "ACME" }),
    ignoresTitleWhenJobIdPresent: k(base) === k({ ...base, title: "Totally Different Title" }),
    titleUsedWithoutJobId:
      k({ ...base, jobId: "" }) !== k({ ...base, jobId: "", title: "Other Role" }),
    differsByHost: k(base) !== k({ ...base, hostname: "globex.myworkdayjobs.com" }),
    differsByCompany: k(base) !== k({ ...base, company: "Globex" }),
    differsByJobId: k(base) !== k({ ...base, jobId: "JR-2" }),
  };
});
check("key is stable for identical input", keys.stable);
check("key ignores case", keys.ignoresCase);
check("key prefers the requisition id over the title", keys.ignoresTitleWhenJobIdPresent);
check("key falls back to the title when there is no requisition id", keys.titleUsedWithoutJobId);
check("key distinguishes different tenants", keys.differsByHost);
check("key distinguishes different companies", keys.differsByCompany);
check("key distinguishes different requisitions", keys.differsByJobId);

// --- dedupe window -------------------------------------------------------
const dupe = await page.evaluate(() => {
  const { isDuplicate, DEDUPE_WINDOW_MS } = window.ConfHarness;
  const now = Date.parse("2026-03-10T15:00:00.000Z");
  const hoursAgo = (h) => new Date(now - h * 3_600_000).toISOString();
  return {
    windowIs24h: DEDUPE_WINDOW_MS === 24 * 60 * 60 * 1000,
    neverSeen: isDuplicate(undefined, now),
    justNow: isDuplicate(hoursAgo(0), now),
    oneHourAgo: isDuplicate(hoursAgo(1), now),
    twentyThreeHours: isDuplicate(hoursAgo(23), now),
    twentyFiveHours: isDuplicate(hoursAgo(25), now),
    monthsAgo: isDuplicate(hoursAgo(24 * 90), now),
    garbage: isDuplicate("not-a-date", now),
    // A clock that jumped backwards must not unlock a duplicate log.
    future: isDuplicate(new Date(now + 3_600_000).toISOString(), now),
  };
});
check("dedupe window matches the background worker's 24h", dupe.windowIs24h);
check("a never-seen key is not a duplicate", dupe.neverSeen === false);
check("an immediate re-view IS a duplicate (reload guard)", dupe.justNow === true);
check("an hour later is still a duplicate", dupe.oneHourAgo === true);
check("23 hours later is still a duplicate", dupe.twentyThreeHours === true);
check("25 hours later is NOT a duplicate (genuine re-application)", dupe.twentyFiveHours === false);
check("months later is NOT a duplicate", dupe.monthsAgo === false);
check("an unparseable timestamp is not treated as a duplicate", dupe.garbage === false);
check("a backwards clock jump does not unlock a duplicate", dupe.future === true);

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} confirmation check(s) failed.`);
  process.exit(1);
}
console.log("\nAll confirmation checks passed.");

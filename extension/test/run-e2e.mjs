// DOM-heuristics test: bundles the real autofill code, loads the mock
// Workday fixture in Chromium, runs autofill, and asserts on the DOM.
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const here = path.dirname(fileURLToPath(import.meta.url));

const CHROMIUM_CANDIDATES = [
  process.env.WORKDAYZ_CHROMIUM,
  "/opt/pw-browsers/chromium",
].filter(Boolean);

const bundle = await esbuild.build({
  entryPoints: [path.join(here, "harness.ts")],
  bundle: true,
  format: "iife",
  write: false,
  target: "chrome110",
});
const harnessJs = bundle.outputFiles[0].text;

const executablePath = CHROMIUM_CANDIDATES.find((p) => existsSync(p));
const browser = await chromium.launch(
  executablePath ? { executablePath } : {},
);

const failures = [];
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

try {
  const page = await browser.newPage();
  await page.goto("file://" + path.join(here, "fixture.html"));
  await page.addScriptTag({ content: harnessJs });

  const pkg = {
    version: 1,
    createdAt: new Date().toISOString(),
    job: { title: "Senior Engineer", company: "Acme", location: "Austin, TX", description: "x".repeat(60) },
    contact: {
      firstName: "Alex",
      lastName: "Perez",
      email: "aperezjobs@gmail.com",
      phone: "555-0100",
      address: "1 Main St",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      country: "United States of America",
      linkedin: "",
      website: "",
    },
    summary: "Summary",
    skills: ["TypeScript"],
    experience: [
      {
        id: "e1",
        company: "Acme Corp",
        title: "Senior Engineer",
        location: "Austin, TX",
        startDate: "2021-06",
        endDate: "Present",
        bullets: ["Did a thing", "Did another thing"],
      },
      {
        id: "e2",
        company: "Globex",
        title: "Engineer",
        location: "Remote",
        startDate: "2018-01",
        endDate: "2021-05",
        bullets: ["Built stuff"],
      },
      {
        id: "e3",
        company: "Initech",
        title: "Junior Engineer",
        location: "",
        startDate: "2016",
        endDate: "2017",
        bullets: [],
      },
    ],
    education: [],
    certifications: [],
    coverLetterText: "Dear team, hire me.",
    resumePdfBase64: "JVBERi0xLjM=", // "%PDF-1.3"
    resumeFileName: "Alex_Perez_Resume.pdf",
    coverLetterPdfBase64: "JVBERi0xLjM=",
    coverLetterFileName: "Alex_Perez_Cover_Letter.pdf",
    atsScore: 90,
  };

  const customRules = [
    { label: "Desired salary", value: "85000" },
    { label: "how did you hear", value: "LinkedIn" },
    { label: "veteran", value: "should never fill" }, // self-ID stays off-limits
  ];

  // Field report on the untouched page: unmatched empty fields become
  // ready-to-paste custom-rule stubs; self-ID and known fields never do.
  const report = await page.evaluate(() => window.WorkdayzTest.buildFieldReport());
  check("report suggests rule stub for unmatched field", report.includes("Employee ID = "), report.slice(-400));
  check("report suggests rule stub for salary field", report.includes("Desired Salary = "));
  check(
    "report never suggests self-ID or known fields as rules",
    !report.includes("veteran = ") && !/First Name = /.test(report),
    report.slice(-400),
  );

  // Dry-run preview first: highlights targets but writes NOTHING.
  const preview = await page.evaluate(
    ({ p, rules }) => window.WorkdayzTest.previewAutofill(p, rules),
    { p: pkg, rules: customRules },
  );
  check("preview reports targets", preview.wouldFill.length >= 5, JSON.stringify(preview));
  check("preview reports resume attach", preview.files.includes("resume"));
  check("preview writes nothing", (await page.$eval("#firstName", (el) => el.value)) === "");

  // Security regression: a Workday tenant (any *.myworkdayjobs.com site,
  // not just a trusted one) fully controls its own form field values. The
  // "Compare form vs profile" / fill-history widgets used to interpolate
  // that text into innerHTML unescaped — a crafted field value could run
  // script in the content script's page context. Confirm escapeHtml()
  // neutralizes it and that mounting the real widget with escaped output
  // never creates a live element from the payload.
  const xssResult = await page.evaluate((p) => {
    const payload = '<img src=x onerror="window.__xssFired=true">';
    document.getElementById("firstName").value = payload;
    const diffs = window.WorkdayzTest.diffFormVsProfile(p);
    const firstNameDiff = diffs.find((d) => d.field === "firstName");
    // Not sliced to the real code's 20-char display limit: escaping, not
    // truncation, is the actual control, so the proof must not lean on it.
    const escaped = window.WorkdayzTest.escapeHtml(firstNameDiff.formValue);
    const rawWidget = window.WorkdayzTest.mountWidget("XSS regression check (raw)");
    rawWidget.showExtendedInfo(`<div class="result-detail">${firstNameDiff.formValue}</div>`);
    const rawHasLiveImg = rawWidget.resultArea.querySelector("img") !== null;
    const safeWidget = window.WorkdayzTest.mountWidget("XSS regression check (escaped)");
    safeWidget.showExtendedInfo(`<div class="result-detail">${escaped}</div>`);
    const safeHasLiveImg = safeWidget.resultArea.querySelector("img") !== null;
    document.getElementById("firstName").value = "";
    return { rawFormValue: firstNameDiff.formValue, escaped, rawHasLiveImg, safeHasLiveImg };
  }, pkg);
  check("diffFormVsProfile captures the raw (unsafe) form value", xssResult.rawFormValue.includes("<img"), xssResult.rawFormValue);
  check("unescaped interpolation DOES create a live <img> (proves the threat is real)", xssResult.rawHasLiveImg);
  check("escapeHtml neutralizes angle brackets", !xssResult.escaped.includes("<img"), xssResult.escaped);
  check("escaped interpolation creates no live <img> element", !xssResult.safeHasLiveImg);

  const summary = await page.evaluate(
    async ({ p, rules }) => window.WorkdayzTest.runAutofill(p, rules),
    { p: pkg, rules: customRules },
  );
  console.log("autofill summary:", JSON.stringify(summary));

  const val = (sel) => page.$eval(sel, (el) => el.value);

  check("first name", (await val("#firstName")) === "Alex");
  check("last name", (await val("#lastName")) === "Perez");
  check(
    "prefilled email NOT overwritten",
    (await val("#email")) === "prefilled@example.com",
    `got "${await val("#email")}"`,
  );
  check("phone", (await val("#phone")) === "555-0100");
  check("city", (await val("#city")) === "Austin");
  check("postal code", (await val("#postal")) === "78701");

  const countryCommitted = await page.$eval("#country-input", (el) => el.dataset.committed ?? "");
  check(
    "country search-combobox committed via option click",
    countryCommitted === "United States of America",
    `got "${countryCommitted}"`,
  );

  const stateText = await page.$eval("#state-btn", (el) => el.textContent);
  check('state "TX" expands to "Texas" option', stateText === "Texas", `got "${stateText}"`);

  check("panel 1 job title", (await val("#jobTitle1")) === "Senior Engineer");
  check("panel 1 company", (await val("#company1")) === "Acme Corp");
  const p1Month = await page.$eval('[data-automation-id="formField-startDate-1"] [aria-label="Month"]', (el) => el.value);
  const p1Year = await page.$eval('[data-automation-id="formField-startDate-1"] [aria-label="Year"]', (el) => el.value);
  check("panel 1 start month", p1Month === "06", `got "${p1Month}"`);
  check("panel 1 start year", p1Year === "2021", `got "${p1Year}"`);
  check("panel 1 current checkbox", await page.$eval("#current1", (el) => el.checked));
  const desc1 = await val("#desc1");
  check("panel 1 description bullets", desc1.includes("Did a thing") && desc1.includes("Did another thing"), `got "${desc1}"`);

  check("panel 2 job title", (await val("#jobTitle2")) === "Engineer");
  check("panel 2 company", (await val("#company2")) === "Globex");
  const p2Month = await page.$eval('[data-automation-id="formField-endDate-2"] [aria-label="Month"]', (el) => el.value);
  const p2Year = await page.$eval('[data-automation-id="formField-endDate-2"] [aria-label="Year"]', (el) => el.value);
  check("panel 2 end month", p2Month === "05", `got "${p2Month}"`);
  check("panel 2 end year", p2Year === "2021", `got "${p2Year}"`);

  check(
    "resume attached to the labeled input",
    (await page.$eval("#resumeUpload", (el) => el.files.length)) === 1,
  );
  check(
    "portfolio input left alone",
    (await page.$eval("#portfolioUpload", (el) => el.files.length)) === 0,
  );

  check(
    "third experience filled via Add Another (async panel)",
    (await val("#jobTitle3")) === "Junior Engineer" && (await val("#company3")) === "Initech",
    `jobTitle3="${await val("#jobTitle3")}"`,
  );
  check(
    "all three experience panels reported filled",
    summary.filled.some((s) => s.includes("3 work experience panel")),
    JSON.stringify(summary.filled),
  );
  check(
    "no experience reported as remaining",
    !summary.skipped.some((s) => s.includes("more work experience")),
    JSON.stringify(summary.skipped),
  );

  const questions = await page.evaluate(() =>
    window.WorkdayzTest.findQuestionFields().map((q) => q.label),
  );
  check("question scrape finds the essay question", questions.some((q) => q.includes("Acme Corp")), JSON.stringify(questions));
  check("question scrape skips short/non-questions", questions.length === 1, JSON.stringify(questions));

  const filledCount = await page.evaluate(() => {
    const fields = window.WorkdayzTest.findQuestionFields();
    return window.WorkdayzTest.applyAnswers(fields, [
      { question: fields[0]?.label ?? "", answer: "Because I love the mission." },
    ]);
  });
  check("answer applied", filledCount === 1);
  check("answer landed in the textarea", (await val("#q1")) === "Because I love the mission.");

  const dateChecks = await page.evaluate(() => {
    const p = window.WorkdayzTest.parseDateParts;
    return {
      iso: JSON.stringify(p("2021-06")) === '{"year":"2021","month":"06"}',
      isoDay: JSON.stringify(p("2021-06-15")) === '{"year":"2021","month":"06"}',
      mmYYYY: JSON.stringify(p("06/2021")) === '{"year":"2021","month":"06"}',
      mYYYY: JSON.stringify(p("6/2021")) === '{"year":"2021","month":"06"}',
      twoDigitYear: JSON.stringify(p("06/21")) === '{"year":"2021","month":"06"}',
      monthName: JSON.stringify(p("June 2021")) === '{"year":"2021","month":"06"}',
      monthAbbr: JSON.stringify(p("Jun 2021")) === '{"year":"2021","month":"06"}',
      sept: JSON.stringify(p("Sept. 2019")) === '{"year":"2019","month":"09"}',
      yearOnly: JSON.stringify(p("2021")) === '{"year":"2021"}',
      present: p("Present") === null,
      current: p("Current") === null,
      na: p("N/A") === null,
    };
  });
  check("parseDateParts handles all formats", Object.values(dateChecks).every(Boolean), JSON.stringify(dateChecks));

  const nextBtn = await page.$eval('[data-automation-id="bottom-navigation-next-button"]', (el) => el.textContent);
  check("navigation button untouched", nextBtn === "Save and Continue");

  check(
    "self-ID question surfaced as left-for-you, never filled",
    summary.leftForYou.some((l) => l.toLowerCase().includes("veteran")) &&
      (await val("#veteran")) === "",
    JSON.stringify(summary.leftForYou),
  );
  check(
    "prefilled email mismatch flagged",
    summary.mismatches.some((m) => m.startsWith("email")),
    JSON.stringify(summary.mismatches),
  );

  check("custom rule fills text field", (await val("#salary")) === "85000");
  const hearText = await page.$eval("#hear-btn", (el) => el.textContent);
  check("custom rule fills listbox (hear-about-us default)", hearText === "LinkedIn", `got "${hearText}"`);
  check(
    "custom rule NEVER fills self-ID fields",
    (await val("#veteran")) === "",
    `veteran="${await val("#veteran")}"`,
  );
  check(
    "still-required report lists the empty required field",
    summary.stillRequired.some((l) => l.includes("Employee ID")),
    JSON.stringify(summary.stillRequired),
  );
  check(
    "still-required report omits filled fields",
    !summary.stillRequired.some((l) => l.toLowerCase().includes("salary")),
    JSON.stringify(summary.stillRequired),
  );

  // Profile-only fill source (no tailored package): contact fills, but no
  // empty PDF may be attached to the resume input.
  await page.reload();
  await page.addScriptTag({ content: harnessJs });
  const profilePkg = { ...pkg, coverLetterText: "", resumePdfBase64: "", resumeFileName: "", coverLetterPdfBase64: "", coverLetterFileName: "" };
  await page.evaluate(async (p) => window.WorkdayzTest.runAutofill(p), profilePkg);
  check("profile-only: contact fills", (await val("#firstName")) === "Alex");
  check(
    "profile-only: no empty file attached",
    (await page.$eval("#resumeUpload", (el) => el.files.length)) === 0,
  );

  // Undo restores everything the last run wrote.
  const restored = await page.evaluate(() => window.WorkdayzTest.undoFill());
  check("undo restores fields", restored > 0 && (await val("#firstName")) === "", `restored=${restored}, firstName="${await val("#firstName")}"`);

  // --- Empty-sections page (Xcel layout): sections start with a bare "Add"
  // button, three identical ones told apart only by their heading. ---
  const sectionsPage = await browser.newPage();
  await sectionsPage.goto("file://" + path.join(here, "fixture-sections.html"));
  await sectionsPage.addScriptTag({ content: harnessJs });
  const sval = (sel) => sectionsPage.$eval(sel, (el) => el.value);

  const sectionsPkg = {
    ...pkg,
    experience: [
      { id: "e1", company: "Acme Corp", title: "Senior Engineer", location: "", startDate: "2021-06", endDate: "Present", bullets: ["Did a thing"] },
      { id: "e2", company: "Globex", title: "Engineer", location: "", startDate: "2018-01", endDate: "2021-05", bullets: ["Built stuff"] },
      { id: "e3", company: "Initech", title: "Analyst", location: "", startDate: "2015", endDate: "2018", bullets: ["Analyzed"] },
    ],
    education: [
      { id: "ed1", school: "State University", degree: "Bachelor of Science", fieldOfStudy: "CS", startDate: "2011", endDate: "2015", gpa: "" },
      { id: "ed2", school: "City College", degree: "Bachelor of Arts", fieldOfStudy: "History", startDate: "2009", endDate: "2011", gpa: "" },
    ],
    certificationDetails: [
      { id: "c1", name: "PMP - PMI", issuer: "PMI", issueDate: "05/2024", expirationDate: "05/2026" },
      { id: "c2", name: "CSM - Scrum Alliance", issuer: "Scrum Alliance", issueDate: "01/2023", expirationDate: "" },
    ],
    resumePdfBase64: "", resumeFileName: "", coverLetterPdfBase64: "", coverLetterFileName: "", coverLetterText: "",
  };
  const sSummary = await sectionsPage.evaluate(async (p) => window.WorkdayzTest.runAutofill(p), sectionsPkg);
  console.log("sections summary:", JSON.stringify(sSummary));

  // Work: three panels, each requiring a fresh Add click; button relabels to
  // "Add Another" after the first (same element, reused).
  check("bare Add: work panel 1 filled", (await sval("#wt1")) === "Senior Engineer", `wt1="${await sval("#wt1")}"`);
  check("bare Add: work panel 1 company", (await sval("#wc1")) === "Acme Corp");
  check("relabeled Add Another: work panel 2 filled", (await sval("#wt2")) === "Engineer", `wt2="${await sval("#wt2")}"`);
  check("relabeled Add Another: work panel 3 filled", (await sval("#wt3")) === "Analyst", `wt3="${await sval("#wt3")}"`);
  check("all three work panels reported", sSummary.filled.some((s) => s.includes("3 work experience panel")), JSON.stringify(sSummary.filled));

  // Dates: single READONLY "MM / YYYY" boxes labeled "From *"/"To *" on the
  // wrapper (Xcel's real widget) — findFillableFields excludes readonly, so
  // this only works via the group-container path.
  check('readonly "From" box filled MM/YYYY', (await sval("#wf1")) === "06/2021", `wf1="${await sval("#wf1")}"`);
  check("Present -> current-role checkbox checked, To left empty", (await sectionsPage.$eval("#wcur1", (el) => el.checked)) && (await sval("#wtd1")) === "");
  check('readonly "To" box filled MM/YYYY', (await sval("#wtd2")) === "05/2021", `wtd2="${await sval("#wtd2")}"`);
  check('panel 2 "From" box filled', (await sval("#wf2")) === "01/2018", `wf2="${await sval("#wf2")}"`);

  // Education: School is a type-ahead combobox, Degree a listbox — panels must
  // still be detected/grown and both controls committed.
  const es1Committed = await sectionsPage.$eval("#es1", (el) => el.dataset.committed ?? "");
  check("education combobox anchor: School committed via option click", es1Committed === "State University", `got "${es1Committed}"`);
  const ed1Degree = await sectionsPage.$eval("#edb1", (el) => el.textContent);
  check("education listbox: Degree selected", ed1Degree === "Bachelor of Science", `got "${ed1Degree}"`);
  const es2Committed = await sectionsPage.$eval("#es2", (el) => el.dataset.committed ?? "").catch(() => "MISSING");
  check("education grew to a SECOND panel (combobox-only section)", es2Committed === "City College", `got "${es2Committed}"`);
  check("both education panels reported", sSummary.filled.some((s) => s.includes("2 education panel")), JSON.stringify(sSummary.filled));

  // Certifications: name combobox + readonly Issued/Expiration MM/YYYY boxes,
  // grown across two panels.
  const cc1 = await sectionsPage.$eval("#cc1", (el) => el.dataset.committed ?? "");
  check("cert 1 name committed via combobox", cc1 === "PMP - PMI", `got "${cc1}"`);
  check("cert 1 issued date filled", (await sval("#ci1")) === "05/2024", `ci1="${await sval("#ci1")}"`);
  check("cert 1 expiration date filled", (await sval("#ce1")) === "05/2026", `ce1="${await sval("#ce1")}"`);
  const cc2 = await sectionsPage.$eval("#cc2", (el) => el.dataset.committed ?? "").catch(() => "MISSING");
  check("cert section grew to a 2nd panel", cc2 === "CSM - Scrum Alliance", `got "${cc2}"`);
  check("cert 2 no expiration left empty", (await sval("#ce2")) === "", `ce2="${await sval("#ce2")}"`);
  check("both certification panels reported", sSummary.filled.some((s) => s.includes("2 certification panel")), JSON.stringify(sSummary.filled));

  // --- Tenant 2 (item 86): international labels, preferred/work-phone
  // ordering, and the references block -------------------------------------
  const t2Page = await browser.newPage();
  await t2Page.goto("file://" + path.join(here, "fixture-tenant2.html"));
  await t2Page.addScriptTag({ content: harnessJs });
  const t2val = (sel) => t2Page.$eval(sel, (el) => el.value);

  const t2Pkg = {
    ...pkg,
    contact: {
      ...pkg.contact,
      firstName: "Alex",
      lastName: "Perez",
      preferredName: "Lex",
      phone: "555-010-0100",
      workPhone: "555-222-3333",
    },
    references: [
      { id: "r1", name: "Dana Manager", email: "dana@example.com", relationship: "Former manager" },
    ],
    experience: [], education: [], certificationDetails: [], certifications: [],
    resumePdfBase64: "", resumeFileName: "", coverLetterPdfBase64: "", coverLetterFileName: "", coverLetterText: "",
  };
  const t2Summary = await t2Page.evaluate(async (p) => window.WorkdayzTest.runAutofill(p), t2Pkg);
  console.log("tenant2 summary:", JSON.stringify(t2Summary));

  check('intl label "Prénom" filled with first name', (await t2val("#t2first")) === "Alex", `t2first="${await t2val("#t2first")}"`);
  check('intl label "Apellido" filled with last name', (await t2val("#t2last")) === "Perez", `t2last="${await t2val("#t2last")}"`);
  check("preferred name got preferredName, not firstName", (await t2val("#t2pref")) === "Lex", `t2pref="${await t2val("#t2pref")}"`);
  check("work phone got workPhone (smart-formatted)", (await t2val("#t2work")) === "(555) 222-3333", `t2work="${await t2val("#t2work")}"`);
  check("mobile phone got the primary phone", (await t2val("#t2mobile")) === "(555) 010-0100", `t2mobile="${await t2val("#t2mobile")}"`);
  check("reference name filled", (await t2val("#t2refname")) === "Dana Manager", `t2refname="${await t2val("#t2refname")}"`);
  check("reference email filled", (await t2val("#t2refemail")) === "dana@example.com", `t2refemail="${await t2val("#t2refemail")}"`);
  check("reference relationship filled", (await t2val("#t2refrel")) === "Former manager", `t2refrel="${await t2val("#t2refrel")}"`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll e2e checks passed.");

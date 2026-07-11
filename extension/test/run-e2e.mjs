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

  const summary = await page.evaluate(async (p) => window.WorkdayzTest.runAutofill(p), pkg);
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
    "third experience reported as remaining",
    summary.skipped.some((s) => s.includes("1 more work experience")),
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
    return [
      JSON.stringify(p("2021-06")) === '{"year":"2021","month":"06"}',
      JSON.stringify(p("06/2021")) === '{"year":"2021","month":"06"}',
      JSON.stringify(p("June 2021")) === '{"year":"2021","month":"06"}',
      JSON.stringify(p("2021")) === '{"year":"2021"}',
      p("Present") === null,
    ];
  });
  check("parseDateParts formats", dateChecks.every(Boolean), JSON.stringify(dateChecks));

  const nextBtn = await page.$eval('[data-automation-id="bottom-navigation-next-button"]', (el) => el.textContent);
  check("navigation button untouched", nextBtn === "Save and Continue");

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
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll e2e checks passed.");

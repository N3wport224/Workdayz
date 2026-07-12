// UI verification: drives the REAL apply page (production build) in
// Chromium with mocked LLM API responses, exercising the state-heavy flows
// unit tests can't reach — variants, the bullet editor with revert, JD
// keyword highlights, the cost note, the batch queue, and tracker
// persistence. Run `npx next build` first; this script starts/stops its own
// `next start` on port 3459.
import { spawn } from "child_process";
import { existsSync } from "fs";
import { chromium } from "playwright-core";

const PORT = 3459;
const BASE = `http://localhost:${PORT}`;
// Prefer a preinstalled Chromium; otherwise let playwright-core resolve its
// own installed browser (the CI path).
const CHROMIUM = [process.env.WORKDAYZ_CHROMIUM, "/opt/pw-browsers/chromium"]
  .filter(Boolean)
  .find((p) => existsSync(p));

const failures = [];
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures.push(name);
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("next start never became ready");
}

const profile = {
  contact: {
    firstName: "Alex", lastName: "Perez", email: "test@example.com", phone: "555-0100",
    address: "", city: "Austin", state: "TX", postalCode: "78701", country: "United States",
    linkedin: "", website: "",
  },
  summary: "Operations analyst with forecasting experience.",
  skills: ["Excel", "SQL"],
  experience: [
    { id: "e1", company: "Acme", title: "Ops Analyst", location: "Austin", startDate: "2021-06", endDate: "Present",
      bullets: ["Built the demand forecast.", "Cut reporting time."] },
  ],
  education: [],
  certifications: [],
  projects: [],
};

function tailorResult(tag) {
  return {
    tailoredResume: {
      summary: `${tag} tailored summary for the role with plenty of relevant detail packed in.`,
      skills: ["SQL", "Excel", "Forecasting", "Dashboards", "Reporting"],
      experience: [{ id: "e1", bullets: [`${tag}: Rebuilt the demand forecast, improving accuracy.`, "Cut reporting time."] }],
    },
    coverLetter: `${tag} cover letter body.`,
    atsScore: {
      score: 78, matchedKeywords: ["SQL", "forecast"], missingKeywords: ["Tableau"],
      formattingIssues: [], notes: "2/3 job keywords found in your tailored resume.",
    },
    fitAnalysis: { verdict: "Decent fit.", strengths: ["Forecasting"], gaps: ["No Tableau"] },
    usage: { model: "claude-sonnet-5", inputTokens: 3000, outputTokens: 1200 },
  };
}

// textarea values aren't text content — collect them via the DOM.
const textareaValues = (page) =>
  page.evaluate(() => Array.from(document.querySelectorAll("textarea")).map((t) => t.value));

const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "ui-test-placeholder" },
  stdio: "ignore",
});

const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
try {
  await waitForServer(30_000);
  const context = await browser.newContext();
  await context.addInitScript((p) => {
    try {
      window.localStorage.setItem(
        "workdayz.profiles.v1",
        JSON.stringify({ activeId: "default", entries: [{ id: "default", name: "Default", profile: p }] }),
      );
    } catch {}
  }, profile);

  const page = await context.newPage();
  let tailorCalls = 0;
  await page.route("**/api/tailor", async (route) => {
    tailorCalls++;
    await route.fulfill({ json: tailorResult(tailorCalls === 1 ? "A" : "B") });
  });
  await page.route("**/api/fetch-job", async (route) => {
    await route.fulfill({
      json: { job: { title: "Batch Analyst", company: "Globex", location: "Remote", description: "x".repeat(200), sourceUrl: "https://globex.wd1.myworkdayjobs.com/x" } },
    });
  });

  await page.goto(`${BASE}/apply`);
  await page.fill("input[required]", "Ops Analyst II");
  await page.locator("form input").nth(1).fill("Acme Corp");
  await page.fill("form textarea", "We need SQL and forecast skills. Tableau required. ".repeat(10));
  await page.click('button[type="submit"]');

  await page.waitForSelector("text=Variant A · ATS 78");
  check("variant A tab appears", true);
  check("cost note shows run + lifetime", (await page.textContent("body")).includes("Est. AI cost:"));

  let values = await textareaValues(page);
  check(
    "tailored summary + bullet render in editors",
    values.some((v) => v.startsWith("A tailored summary")) &&
      values.some((v) => v.startsWith("A: Rebuilt the demand forecast")),
    JSON.stringify(values),
  );

  // Bullet revert: first bullet differs from the original.
  const revert = page.locator("button", { hasText: "↺ original" }).first();
  check("changed bullet offers revert", (await revert.count()) >= 1);
  await revert.click();
  values = await textareaValues(page);
  check(
    "revert restores the original bullet",
    values.some((v) => v === "Built the demand forecast."),
    JSON.stringify(values),
  );

  // JD highlights
  await page.click("text=Job description with keyword highlights");
  check("matched keyword marked", (await page.locator("pre mark", { hasText: "SQL" }).count()) >= 1);
  check("missing keyword marked", (await page.locator("pre mark", { hasText: "Tableau" }).count()) >= 1);

  // Variant B
  await page.click("text=+ Variant (different emphasis)");
  await page.waitForSelector("text=Variant B · ATS 78");
  values = await textareaValues(page);
  check(
    "variant B content adopted",
    values.some((v) => v.startsWith("B tailored summary")),
    JSON.stringify(values.slice(0, 3)),
  );
  await page.click("text=Variant A · ATS 78");
  values = await textareaValues(page);
  check(
    "switching back restores variant A content",
    values.some((v) => v.startsWith("A tailored summary")),
    JSON.stringify(values.slice(0, 3)),
  );

  // Exactly one tracker entry for this job (variant switches update in place)
  const apps = await page.evaluate(() => JSON.parse(window.localStorage.getItem("workdayz.applications.v1") ?? "[]"));
  check("one tracker entry after tailor+variant+switch", apps.length === 1, `got ${apps.length}`);
  check("tracker entry carries variant A summary", apps[0]?.summary?.startsWith("A tailored summary"), apps[0]?.summary);

  // Batch queue: 2 URLs -> 2 draft entries
  await page.click("text=Batch tailor from URLs");
  await page.fill('textarea[placeholder*="myworkdayjobs"]', "https://a.wd5.myworkdayjobs.com/1\nhttps://b.wd5.myworkdayjobs.com/2");
  await page.click("text=Fetch & tailor all");
  await page.waitForSelector("text=Review the drafts in your tracker", { timeout: 15000 });
  const apps2 = await page.evaluate(() => JSON.parse(window.localStorage.getItem("workdayz.applications.v1") ?? "[]"));
  check("batch added 2 draft entries", apps2.length === 3, `got ${apps2.length}`);
  check("batch entries are drafts", apps2.filter((a) => a.status === "draft").length >= 2);

  // Tracker page renders with the new panels
  await page.goto(`${BASE}/applications`);
  await page.waitForSelector("text=Application tracker");
  check("tracker board toggle present", await page.isVisible("text=Board"));
} finally {
  await browser.close();
  server.kill();
}

if (failures.length) {
  console.error(`\n${failures.length} UI check(s) failed.`);
  process.exit(1);
}
console.log("\nAll UI checks passed.");

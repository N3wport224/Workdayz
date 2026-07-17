// UI verification: drives the REAL apply page (production build) in
// Chromium with mocked LLM API responses, exercising the state-heavy flows
// unit tests can't reach — the tailor flow, variant tabs, JD keyword
// highlights, the bullet editor with live re-scoring, the batch queue, and
// tracker persistence. Run `npx next build` first; this script starts/stops
// its own `next start` on port 3459.
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

// Flat shape of the real /api/tailor response (see app/api/tailor/route.ts).
function tailorResult(tag) {
  const bullets = [
    { id: "e1", original: "Built the demand forecast.", tailored: `${tag}: Rebuilt the demand forecast, improving accuracy.` },
  ];
  return {
    summary: `${tag} tailored summary for the role with plenty of relevant detail packed in.`,
    skills: ["SQL", "Excel", "Forecasting", "Dashboards", "Tableau"],
    bullets,
    coverLetter: `${tag} cover letter body.`,
    fitAnalysis: { verdict: "Decent fit.", strengths: ["Forecasting"], gaps: ["No Tableau"] },
    variants: [
      {
        id: "v1", label: "Different emphasis",
        tailoredSummary: `${tag}-variant summary emphasising dashboards instead.`,
        tailoredSkills: ["Dashboards", "SQL"],
        tailoredBullets: bullets,
        coverLetter: `${tag}-variant cover letter.`,
        atsScore: 71,
      },
    ],
    atsScore: 78,
    atsBreakdown: {
      totalKeywords: 3, matchedKeywords: 2,
      matched: ["SQL", "forecast"], missing: ["Tableau"],
      score: 78, integrityFlags: [],
    },
    estimatedCost: "0.0450",
  };
}

// detached => own process group, so we can kill the whole tree even if this
// script crashes mid-run (a lone `server.kill()` leaves next-server alive).
const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "ui-test-placeholder" },
  stdio: "ignore",
  detached: true,
});
const stopServer = () => {
  try { process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ }
};
process.on("exit", stopServer);

const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
try {
  await waitForServer(30_000);
  const context = await browser.newContext();
  // Seed the profile under the real storage keys (lib/storage.ts).
  await context.addInitScript((p) => {
    try {
      window.localStorage.setItem("workdayz-profile", JSON.stringify(p));
    } catch {}
  }, profile);

  const page = await context.newPage();
  await page.route("**/api/tailor", async (route) => {
    const body = route.request().postDataJSON();
    const tag = body?.job?.company === "Globex" ? "Batch" : "A";
    await route.fulfill({ json: tailorResult(tag) });
  });
  await page.route("**/api/fetch-job", async (route) => {
    await route.fulfill({
      json: { title: "Batch Analyst", company: "Globex", location: "Remote", description: "We need SQL. ".repeat(20) },
    });
  });

  await page.goto(`${BASE}/apply`);
  await page.fill("input[required]", "Ops Analyst II");
  await page.locator("form input").nth(1).fill("Acme Corp");
  await page.fill("form textarea", "We need SQL and forecast skills. Tableau required. ".repeat(10));
  await page.click('button[type="submit"]');

  await page.waitForSelector("text=ATS Score: 78/100");
  check("tailor result renders with ATS score", true);
  const body = await page.textContent("body");
  check("tailored summary shown", body.includes("A tailored summary for the role"));
  check("fit verdict shown", body.includes("Decent fit."));
  check("cost recorded in status", body.includes("Cost: $0.0450"));

  // Skills chips: matched keyword gets a check, missing keyword flagged.
  check("matched skill chip", (await page.locator("span", { hasText: "SQL" }).count()) >= 1);

  // JD highlights
  await page.click("text=job description with keyword highlights");
  check("matched keyword marked", (await page.locator("mark", { hasText: "SQL" }).count()) >= 1);
  check("missing keyword marked", (await page.locator("mark", { hasText: "Tableau" }).count()) >= 1);

  // Variant tabs from the API response
  check("main variant tab", await page.isVisible("text=Main (ATS 78)"));
  await page.click("text=Different emphasis (ATS 71)");
  check(
    "variant swap changes summary",
    (await page.textContent("body")).includes("A-variant summary emphasising dashboards"),
  );
  await page.click("text=Main (ATS 78)");

  // Bullet editor: original next to tailored
  const pageText = await page.textContent("body");
  check("bullet original shown", pageText.includes("Built the demand forecast."));
  check("bullet tailored shown", pageText.includes("A: Rebuilt the demand forecast"));

  // Tracker entry persisted under the real key
  const apps = await page.evaluate(() => JSON.parse(window.localStorage.getItem("workdayz-applications") ?? "[]"));
  check("one tracker entry after tailor", apps.length === 1, `got ${apps.length}`);
  check("tracker entry carries tailored summary", apps[0]?.tailoredSummary?.startsWith("A tailored summary"), apps[0]?.tailoredSummary);

  // Batch queue: 2 URLs -> 2 more draft entries
  await page.click("text=Batch mode — tailor several postings at once");
  await page.fill('textarea[placeholder*="myworkdayjobs"]', "https://a.wd5.myworkdayjobs.com/1\nhttps://b.wd5.myworkdayjobs.com/2");
  await page.click("text=Run batch");
  await page.waitForSelector("text=Batch finished — everything is in the tracker.", { timeout: 15000 });
  const apps2 = await page.evaluate(() => JSON.parse(window.localStorage.getItem("workdayz-applications") ?? "[]"));
  check("batch added 2 draft entries", apps2.length === 3, `got ${apps2.length}`);
  check("batch entries are drafts", apps2.filter((a) => a.status === "draft").length === 3);

  // Tracker page renders with the analytics + filters
  await page.goto(`${BASE}/applications`);
  await page.waitForSelector("text=Application Tracker");
  check("tracker rows render", (await page.textContent("body")).includes("Batch Analyst"));
} finally {
  await browser.close();
  stopServer();
}

if (failures.length) {
  console.error(`\n${failures.length} UI check(s) failed.`);
  process.exit(1);
}
console.log("\nAll UI checks passed.");

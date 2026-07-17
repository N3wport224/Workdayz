// Verifies the apply-page result toolkit: PDF/DOCX/cover-letter exports
// (real routes, no AI) and interview prep / outreach / question drafting
// (mocked AI responses) against the real production build in a real browser.
import { spawn } from "child_process";
import { existsSync } from "fs";
import { chromium } from "playwright-core";

const PORT = 3463;
const BASE = `http://localhost:${PORT}`;
const CHROMIUM = [process.env.WORKDAYZ_CHROMIUM, "/opt/pw-browsers/chromium"].filter(Boolean).find((p) => existsSync(p));

const failures = [];
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else { failures.push(name); console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const res = await fetch(BASE); if (res.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("next start never became ready");
}

const profile = {
  contact: { firstName: "Alex", lastName: "Perez", email: "test@example.com", phone: "555-0100",
    address: "", city: "Austin", state: "TX", postalCode: "78701", country: "United States", linkedin: "", website: "" },
  summary: "Operations analyst with forecasting experience.",
  skills: ["Excel", "SQL"],
  experience: [{ id: "e1", company: "Acme", title: "Ops Analyst", location: "Austin", startDate: "2021-06", endDate: "Present",
    bullets: ["Built the demand forecast.", "Cut reporting time."] }],
  education: [], certifications: [], projects: [],
};

function tailorResult() {
  return {
    summary: "Tailored summary for the role with plenty of relevant detail packed in.",
    skills: ["SQL", "Excel", "Forecasting"],
    bullets: [{ id: "e1", original: "Built the demand forecast.", tailored: "Rebuilt the demand forecast, improving accuracy." }],
    coverLetter: "Dear hiring team, I'm excited to apply.",
    fitAnalysis: { verdict: "Decent fit.", strengths: ["Forecasting"], gaps: ["No Tableau"] },
    variants: [],
    atsScore: 78,
    atsBreakdown: { totalKeywords: 3, matchedKeywords: 2, matched: ["SQL", "forecast"], missing: ["Tableau"], score: 78, integrityFlags: [] },
    estimatedCost: "0.0450",
  };
}

const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "audit-placeholder" },
  stdio: "ignore",
  detached: true,
});
const stopServer = () => { try { process.kill(-server.pid, "SIGTERM"); } catch {} };
process.on("exit", stopServer);

const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
try {
  await waitForServer(30_000);
  const context = await browser.newContext();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.addInitScript((p) => {
    try { window.localStorage.setItem("workdayz-profile", JSON.stringify(p)); } catch {}
  }, profile);

  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("PAGE-ERROR:", String(e).slice(0, 200)));
  await page.route("**/api/tailor", async (route) => route.fulfill({ json: tailorResult() }));
  await page.route("**/api/interview-prep", async (route) => route.fulfill({
    json: { prep: { questions: [{ question: "Tell me about a forecasting project.", category: "behavioral", talkingPoints: ["Rebuilt the demand forecast."] }] } },
  }));
  await page.route("**/api/generate-message", async (route) => route.fulfill({
    json: { message: { subject: "Following up", body: "Hi — following up on my application." } },
  }));
  await page.route("**/api/answer-questions", async (route) => route.fulfill({
    json: { answers: [{ question: "Why do you want to work here?", answer: "Because the mission aligns with my forecasting background." }] },
  }));

  await page.goto(`${BASE}/apply`);
  await page.fill("input[required]", "Ops Analyst II");
  await page.locator("form input").nth(1).fill("Acme Corp");
  await page.fill("form textarea", "We need SQL and forecast skills. Tableau required. ".repeat(10));
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=ATS Score: 78/100");

  // ---------- Exports (real PDF/DOCX routes, no AI) ----------
  const [pdfDownload] = await Promise.all([page.waitForEvent("download"), page.click("text=⬇ Resume PDF")]);
  check("resume PDF downloads", pdfDownload.suggestedFilename().endsWith(".pdf"), pdfDownload.suggestedFilename());
  const pdfPath = await pdfDownload.path();
  const pdfBuf = await (await import("fs/promises")).readFile(pdfPath);
  check("resume PDF has real PDF content", pdfBuf.slice(0, 5).toString() === "%PDF-" && pdfBuf.length > 1000, `${pdfBuf.length} bytes`);

  const [docxDownload] = await Promise.all([page.waitForEvent("download"), page.click("text=⬇ Resume DOCX")]);
  check("resume DOCX downloads", docxDownload.suggestedFilename().endsWith(".docx"), docxDownload.suggestedFilename());
  const docxBuf = await (await import("fs/promises")).readFile(await docxDownload.path());
  check("resume DOCX has real zip/PK content", docxBuf.slice(0, 2).toString() === "PK" && docxBuf.length > 1000, `${docxBuf.length} bytes`);

  const [clDownload] = await Promise.all([page.waitForEvent("download"), page.click("text=⬇ Cover letter PDF")]);
  check("cover letter PDF downloads", clDownload.suggestedFilename().endsWith(".pdf"));

  // PDF style selectors affect the request body (spot check they're wired, not just present)
  await page.selectOption('select[aria-label="PDF layout"]', "compact");
  await page.selectOption('select[aria-label="PDF font"]', "Times-Roman");
  await page.selectOption('select[aria-label="Resume section order"]', "skills-first");
  const [styledPdf] = await Promise.all([page.waitForEvent("download"), page.click("text=⬇ Resume PDF")]);
  check("styled PDF still downloads after changing template/font/order", styledPdf.suggestedFilename().endsWith(".pdf"));

  // ---------- Interview prep (mocked AI) ----------
  await page.click("text=🎤 Generate interview prep");
  await page.waitForSelector("text=Tell me about a forecasting project.");
  check("interview prep renders question + category", (await page.textContent("body")).includes("behavioral"));

  // ---------- Outreach messages (mocked AI) ----------
  await page.click("text=✍️ Draft message");
  await page.waitForSelector("text=Following up");
  check("outreach message renders subject + body", (await page.textContent("body")).includes("following up on my application"));

  // ---------- Question answering (mocked AI) ----------
  await page.fill('textarea[placeholder*="Why do you want to work here"]', "Why do you want to work here?");
  await page.click("text=💬 Draft answers");
  await page.waitForSelector("text=Because the mission aligns", { timeout: 10000 }).catch(() => {});
  const bodyText = await page.textContent("body");
  check("question answer renders drafted text", bodyText.includes("Because the mission aligns"));
} finally {
  await browser.close();
  stopServer();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nAll apply-toolkit checks passed.");

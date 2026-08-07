// Journey verification: home checklist, profile (demo/save/named
// profiles/skills), applications page (search/CSV/ICS/purge/archive), and
// settings (model/persistKey/encrypted backup) driven against the real
// production build in a real browser. Complements ui-verify.mjs, which
// covers the tailor/variant/batch flow on the apply page.
import { spawn } from "child_process";
import { existsSync } from "fs";
import { chromium } from "playwright-core";

const PORT = 3462;
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
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("PAGE-ERROR:", String(e).slice(0, 200)));

  // ---------- Home page ----------
  await page.goto(`${BASE}/`);
  await page.waitForSelector("text=Workdayz");
  check("home renders setup checklist", (await page.textContent("body")).includes("Setup checklist"));
  check("tour dismiss button present", await page.isVisible("text=Got it — let's go!"));
  await page.click("text=Got it — let's go!");
  const tourDone = await page.evaluate(() => localStorage.getItem("workdayz-tour-done"));
  check("dismissing tour persists", tourDone === "true");

  // ---------- Profile page ----------
  await page.goto(`${BASE}/profile`);
  await page.waitForSelector("text=Resume Profile");
  await page.click("text=Load demo");
  await page.waitForTimeout(300);
  let bodyText = await page.textContent("body");
  const firstNameVal = await page.locator('input[aria-label="First name"]').inputValue().catch(() => "");
  check("demo profile fills the first-name field", firstNameVal.length > 0, `got "${firstNameVal}"`);

  await page.click("text=Save profile");
  await page.waitForSelector("text=✓ Saved!");
  const savedProfile = await page.evaluate(() => JSON.parse(localStorage.getItem("workdayz-profile") ?? "null"));
  check("save profile persists to storage", savedProfile && savedProfile.contact && savedProfile.contact.firstName.length > 0, JSON.stringify(savedProfile?.contact));

  // Named profiles: create a second one, switch, delete.
  page.once("dialog", (d) => d.accept("Warehouse resume"));
  await page.click("text=+ New (copy current)");
  await page.waitForTimeout(300);
  let profileNames = await page.locator("#profileSwitcher option").allTextContents();
  check("new named profile created", profileNames.includes("Warehouse resume"), JSON.stringify(profileNames));
  await page.selectOption("#profileSwitcher", "Default");
  await page.waitForTimeout(200);
  check("switching profile changes active selection", await page.locator("#profileSwitcher").inputValue() === "Default");
  await page.selectOption("#profileSwitcher", "Warehouse resume");
  await page.waitForTimeout(200);
  page.once("dialog", (d) => d.accept());
  await page.click("text=Delete");
  await page.waitForTimeout(300);
  profileNames = await page.locator("#profileSwitcher option").allTextContents();
  check("deleting named profile removes it", !profileNames.includes("Warehouse resume"), JSON.stringify(profileNames));

  // Certifications: the section had no UI at all — certs were parsed, synced
  // and autofilled, but invisible and uneditable. Verify the round trip.
  check(
    "certifications section is rendered",
    (await page.textContent("body")).includes("Certifications"),
  );
  const demoCertName = await page
    .locator('input[aria-label="Certification 1 name"]')
    .inputValue()
    .catch(() => "");
  check("demo profile's certifications are visible and populated", demoCertName.length > 0, `got "${demoCertName}"`);

  const certRowsBefore = await page.locator('input[aria-label$="name"][id^="cert-name-"]').count();
  await page.click("text=+ Add certification");
  await page.waitForTimeout(150);
  check(
    "add certification appends a row",
    (await page.locator('input[id^="cert-name-"]').count()) === certRowsBefore + 1,
  );

  await page.fill(`#cert-name-${certRowsBefore}`, "CompTIA Security+");
  await page.fill(`#cert-issuer-${certRowsBefore}`, "CompTIA");
  await page.fill(`#cert-issued-${certRowsBefore}`, "05/2025");
  await page.click("text=Save profile");
  await page.waitForTimeout(300);
  const certsSaved = await page.evaluate(
    () => JSON.parse(localStorage.getItem("workdayz-profile") ?? "null")?.certifications ?? [],
  );
  const added = certsSaved.find((c) => c.name === "CompTIA Security+");
  check("edited certification persists with its issuer and date", added?.issuer === "CompTIA" && added?.issueDate === "05/2025", JSON.stringify(added));

  await page.click(`button[aria-label="Remove certification ${certRowsBefore + 1}"]`);
  await page.waitForTimeout(150);
  check(
    "remove certification drops the row",
    (await page.locator('input[id^="cert-name-"]').count()) === certRowsBefore,
  );

  // A profile saved before certifications became structured holds bare strings.
  // Un-coerced, the name inputs render blank and the next save writes back a
  // mix of strings and objects — silent corruption rather than a loud failure.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("workdayz-profile"));
    raw.certifications = ["Legacy String Cert", "Second Legacy"];
    localStorage.setItem("workdayz-profile", JSON.stringify(raw));
    localStorage.removeItem("workdayz-profiles");
  });
  await page.reload();
  await page.waitForSelector("text=Resume Profile");
  const legacyName = await page
    .locator('input[aria-label="Certification 1 name"]')
    .inputValue()
    .catch(() => "");
  check("legacy string certifications render with their names", legacyName === "Legacy String Cert", `got "${legacyName}"`);

  await page.click("text=Save profile");
  await page.waitForTimeout(300);
  const migrated = await page.evaluate(
    () => JSON.parse(localStorage.getItem("workdayz-profile") ?? "null")?.certifications ?? [],
  );
  check(
    "saving a legacy profile writes back structured entries, not strings",
    migrated.length === 2 && migrated.every((c) => typeof c === "object" && typeof c.name === "string" && c.id),
    JSON.stringify(migrated),
  );

  // References section + skill add
  await page.fill('input[placeholder="Type a skill and press Enter"]', "Forecasting");
  await page.press('input[placeholder="Type a skill and press Enter"]', "Enter");
  bodyText = await page.textContent("body");
  check("added skill appears as chip", bodyText.includes("Forecasting"));

  // ---------- Settings page ----------
  await page.goto(`${BASE}/settings`);
  await page.waitForSelector("text=Settings");
  check("model dropdown has real model ids", (await page.locator('select[aria-label="Claude model"] option').allTextContents()).some((t) => t.includes("Sonnet 5")));
  const persistBox = page.locator('input[type="checkbox"]').first();
  check("persist-key checkbox present", await persistBox.isVisible());
  await page.fill('input[type="password"]', "sk-ant-test-key-1234567890");
  await page.click("text=Save settings");
  await page.waitForTimeout(300);
  const settingsStored = await page.evaluate(() => JSON.parse(localStorage.getItem("workdayz-settings") ?? "null"));
  check("settings save persists api key + keySavedAt", settingsStored?.anthropicKey?.startsWith("sk-ant-") && !!settingsStored?.keySavedAt, JSON.stringify(settingsStored));

  // Encrypted backup round trip
  await page.fill('input[type="password"] >> nth=1', "correct horse battery staple");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("text=⬇ Download encrypted backup"),
  ]);
  check("encrypted backup downloads a file", download.suggestedFilename().endsWith(".encrypted.json"), download.suggestedFilename());

  // ---------- Applications page ----------
  // Seed two applications directly (fast, deterministic) then drive the UI.
  await page.evaluate(() => {
    const now = new Date().toISOString();
    const apps = [
      {
        id: "app-1", createdAt: now, updatedAt: now,
        job: { title: "Ops Analyst", company: "Acme", location: "Austin", description: "x".repeat(60) },
        profile: JSON.parse(localStorage.getItem("workdayz-profile") ?? "{}"),
        tailoredSummary: "Summary A", tailoredSkills: ["SQL"], tailoredBullets: [],
        coverLetter: "Letter A", atsScore: 80,
        atsBreakdown: { totalKeywords: 2, matchedKeywords: 2, matched: ["SQL"], missing: [], score: 80, integrityFlags: [] },
        fitAnalysis: { strengths: [], gaps: [], verdict: "" }, variants: [], status: "applied",
        statusHistory: [{ status: "applied", at: now }, { status: "screening", at: now }],
      },
      {
        id: "app-2", createdAt: now, updatedAt: now,
        job: { title: "Data Coordinator", company: "Globex", location: "Remote", description: "y".repeat(60) },
        profile: JSON.parse(localStorage.getItem("workdayz-profile") ?? "{}"),
        tailoredSummary: "Summary B", tailoredSkills: ["Excel"], tailoredBullets: [],
        coverLetter: "Letter B", atsScore: 65,
        atsBreakdown: { totalKeywords: 2, matchedKeywords: 1, matched: ["Excel"], missing: ["Tableau"], score: 65, integrityFlags: [] },
        fitAnalysis: { strengths: [], gaps: [], verdict: "" }, variants: [], status: "draft",
      },
    ];
    localStorage.setItem("workdayz-applications", JSON.stringify(apps));
  });
  await page.goto(`${BASE}/applications`);
  await page.waitForSelector("text=Application Tracker");
  bodyText = await page.textContent("body");
  check("both seeded applications render", bodyText.includes("Ops Analyst") && bodyText.includes("Data Coordinator"));

  await page.fill('input[placeholder="Search by title or company..."]', "Acme");
  await page.waitForTimeout(200);
  bodyText = await page.textContent("body");
  check("search filters to matching company", bodyText.includes("Ops Analyst") && !bodyText.includes("Data Coordinator"));
  await page.fill('input[placeholder="Search by title or company..."]', "");

  const [csvDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.click("text=⬇ CSV"),
  ]);
  check("CSV export downloads", csvDownload.suggestedFilename() === "workdayz-applications.csv");

  const [icsDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.click("text=📅 Follow-ups .ics"),
  ]);
  check("ICS export downloads", icsDownload.suggestedFilename() === "workdayz-followups.ics");

  // Archive the draft, verify it disappears then reappears with "Show archived"
  const draftCard = page.locator(".card", { hasText: "Data Coordinator" });
  await draftCard.locator("text=Archive").click();
  await page.waitForTimeout(200);
  bodyText = await page.textContent("body");
  check("archiving hides the app by default", !bodyText.includes("Data Coordinator"));
  await page.click("text=Show archived");
  await page.waitForTimeout(200);
  bodyText = await page.textContent("body");
  check("Show archived reveals it again", bodyText.includes("Data Coordinator"));

  // Purge details on the applied one
  page.once("dialog", (d) => d.accept());
  const appliedCard = page.locator(".card", { hasText: "Ops Analyst" });
  await appliedCard.locator("text=Purge details").click();
  await page.waitForTimeout(200);
  const purged = await page.evaluate(() => JSON.parse(localStorage.getItem("workdayz-applications") ?? "[]").find((a) => a.id === "app-1"));
  check("purge strips resume snapshot + cover letter", purged.coverLetter === "" && purged.job.description === "(purged)", JSON.stringify({ cl: purged.coverLetter, desc: purged.job.description }));
  check("purge keeps tracker row + status", purged.status === "applied" && purged.atsScore === 80);

  // Copy summary (clipboard permission may be unavailable headless — best-effort)
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.click("text=📋 Copy summary");
    await page.waitForTimeout(200);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check("copy summary writes markdown to clipboard", clip.includes("# Job search summary"));
  } catch (e) {
    console.log("  --  copy summary clipboard check skipped:", String(e).slice(0, 80));
  }
} finally {
  await browser.close();
  stopServer();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nAll journey checks passed.");

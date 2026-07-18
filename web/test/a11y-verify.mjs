// Item 89: automated accessibility audit. Boots the production build, runs
// axe-core against every page, FAILS on critical violations, and reports
// serious ones without failing (they're tracked, not gating).
// Run `npx next build` first; starts/stops its own `next start` on port 3460.
import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { createRequire } from "module";
import { chromium } from "playwright-core";

const PORT = 3460;
const BASE = `http://localhost:${PORT}`;
const ROUTES = ["/", "/profile", "/apply", "/applications", "/settings"];
const CHROMIUM = [process.env.WORKDAYZ_CHROMIUM, "/opt/pw-browsers/chromium"]
  .filter(Boolean)
  .find((p) => existsSync(p));

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf-8");

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

// detached => own process group, so we can kill the whole tree even if this
// script crashes mid-run (a lone `server.kill()` leaves next-server alive,
// squatting on the port and serving stale content to the next test run).
const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  stdio: "ignore",
  detached: true,
  env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "a11y-placeholder" },
});
const stopServer = () => {
  try { process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ }
};
process.on("exit", stopServer);

let criticalTotal = 0;
try {
  await waitForServer(30_000);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const page = await browser.newPage();

  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    await page.addScriptTag({ content: axeSource });
    const results = await page.evaluate(async () => {
      return await axe.run(document, { resultTypes: ["violations"] });
    });
    const critical = results.violations.filter((v) => v.impact === "critical");
    const serious = results.violations.filter((v) => v.impact === "serious");
    criticalTotal += critical.length;
    console.log(`${route}: ${critical.length} critical, ${serious.length} serious`);
    for (const v of critical) console.error(`  CRITICAL ${v.id}: ${v.help} (${v.nodes.length} node(s))`);
    for (const v of serious) console.warn(`  serious ${v.id}: ${v.help} (${v.nodes.length} node(s))`);
  }
  await browser.close();
} finally {
  stopServer();
}

if (criticalTotal > 0) {
  console.error(`\n${criticalTotal} critical accessibility violation(s).`);
  process.exit(1);
}
console.log("\nAccessibility audit passed (no critical violations).");

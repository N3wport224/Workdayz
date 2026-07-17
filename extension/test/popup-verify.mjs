// Drives the REAL built popup (dist/popup) in a real browser with a
// minimal in-page chrome.* shim (storage.local, runtime, tabs, commands,
// permissions) so its logic executes exactly as it would in Chrome —
// exercising the tabs, feature toggles, fill-source selector, dark theme,
// and diagnostics that the DOM autofill harness can't reach (it never
// loads the extension UI itself).
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POPUP_DIR = path.join(__dirname, "..", "dist", "popup");
const POPUP_HTML = path.join(POPUP_DIR, "popup.html");

if (!existsSync(POPUP_HTML)) {
  console.error("dist/popup/popup.html not found — run `node build.mjs` first.");
  process.exit(1);
}

const CHROMIUM = [process.env.WORKDAYZ_CHROMIUM, "/opt/pw-browsers/chromium"].filter(Boolean).find((p) => existsSync(p));

const failures = [];
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else { failures.push(name); console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

// In-page chrome.* shim installed before any script runs. Storage is a
// plain object closed over by the shim so get/set behave like the real
// chrome.storage.local (async, JSON-serializable).
const CHROME_SHIM = `
window.__storage = {};
window.chrome = {
  runtime: {
    getManifest: () => ({ version: "1.0.0-test" }),
    sendMessage: (msg, cb) => { if (cb) cb({}); return Promise.resolve({}); },
    lastError: null,
  },
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
  tabs: {
    query: () => Promise.resolve([{ id: 1, url: "https://acme.wd1.myworkdayjobs.com/job/123" }]),
    sendMessage: () => Promise.resolve({ ok: true, filled: 3, stillRequired: 0 }),
  },
  commands: {
    getAll: () => Promise.resolve([{ name: "run-autofill", shortcut: "Alt+Shift+F", description: "Run autofill" }]),
  },
  permissions: {
    request: () => Promise.resolve(true),
  },
};
`;

const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page.addInitScript(CHROME_SHIM);
  await page.goto(`file://${POPUP_HTML}`);
  await page.waitForTimeout(500);

  check("popup loads with no console/page errors", consoleErrors.length === 0, consoleErrors.join(" | ").slice(0, 300));

  // Tabs
  check("Autofill tab active by default", await page.locator('.tab[data-tab="autofillPanel"]').evaluate((el) => el.classList.contains("active")));
  await page.click('.tab[data-tab="settingsPanel"]');
  check("Settings tab becomes active on click", await page.locator('.tab[data-tab="settingsPanel"]').evaluate((el) => el.classList.contains("active")));
  check("Autofill panel hides when Settings tab active", !(await page.locator("#autofillPanel").evaluate((el) => el.classList.contains("active"))));
  check("Settings panel shows", await page.locator("#settingsPanel").evaluate((el) => el.classList.contains("active")));

  // Feature toggles persist to chrome.storage.local via updateSettings
  // The checkbox is visually hidden under a styled `.slider` (a toggle
  // switch), so it's toggled via the clickable slider label, matching how a
  // real user interacts with it — not a raw synthetic .check().
  const smartFormatToggle = page.locator("#setSmartFormatting");
  check("smart formatting toggle present", await smartFormatToggle.count() === 1);
  const beforeChecked = await smartFormatToggle.isChecked();
  await page.locator("label.switch", { has: smartFormatToggle }).locator(".slider").click();
  await page.waitForTimeout(200);
  const afterChecked = await smartFormatToggle.isChecked();
  check("toggling smart formatting flips its checkbox", beforeChecked !== afterChecked);
  const storedSettings = await page.evaluate(() => window.__storage["workdayz.settings"]);
  check("toggle change is persisted to chrome.storage.local", storedSettings?.smartFormatting === afterChecked, JSON.stringify(storedSettings));

  // Dark theme toggle
  const darkToggle = page.locator("#setDarkTheme");
  if (await darkToggle.count()) {
    await page.locator("label.switch", { has: darkToggle }).locator(".slider").click();
    await page.waitForTimeout(150);
    check("dark theme toggle sets body[data-theme=dark]", await page.evaluate(() => document.body.dataset.theme) === "dark");
    const themeStored = await page.evaluate(() => window.__storage["workdayz.settings"]?.theme);
    check("dark theme persists to storage", themeStored === "dark");
  } else {
    check("dark theme toggle present", false, "#setDarkTheme not found");
  }

  // Shortcut cheat sheet reads chrome.commands.getAll
  const shortcutText = await page.locator("#shortcutList").textContent().catch(() => "");
  check("keyboard shortcut list renders the registered command", (shortcutText ?? "").includes("Alt+Shift+F"));

  // Fill-source selector + hint text
  await page.click('.tab[data-tab="autofillPanel"]');
  const fillSourceSelect = page.locator("#fillSourceSelect");
  check("fill source selector present", await fillSourceSelect.count() === 1);
  if (await fillSourceSelect.count()) {
    const options = await fillSourceSelect.locator("option").allTextContents();
    check("fill source has tailored + profile options", options.some((o) => /tailored/i.test(o)) && options.some((o) => /profile/i.test(o)), JSON.stringify(options));
  }

  // Reset settings button restores defaults
  await page.click('.tab[data-tab="settingsPanel"]');
  page.once("dialog", (d) => d.accept());
  await page.click("#resetSettingsBtn");
  await page.waitForTimeout(200);
  const afterReset = await smartFormatToggle.isChecked();
  check("reset settings restores smart formatting to its default (on)", afterReset === true, `was ${afterReset}`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} popup check(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nAll popup checks passed.");

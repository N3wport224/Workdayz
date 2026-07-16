import { STORAGE_KEYS, type AutofillPackage, type AutofillRunSummary, type BaseProfile, type CustomFillRule } from "../types";
import { getSettings, updateSettings, getUsageStats, type ExtensionSettings } from "../content/features";
import { runAudit } from "../content/feature-audit";

// Enhanced results (autofill-v2) are a superset of AutofillRunSummary.
interface MaybeEnhanced extends AutofillRunSummary {
  confidence?: { pct: number; label: string };
}

const webAppUrlInput = document.getElementById("webAppUrl") as HTMLInputElement;
const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement;
const connectFeedback = document.getElementById("connectFeedback") as HTMLDivElement;
const openAppBtn = document.getElementById("openAppBtn") as HTMLButtonElement;
const autofillBtn = document.getElementById("autofillBtn") as HTMLButtonElement;
const autofillFeedback = document.getElementById("autofillFeedback") as HTMLDivElement;
const autofillDetails = document.getElementById("autofillDetails") as HTMLDivElement;
const clearBtn = document.getElementById("clearBtn") as HTMLButtonElement;
const packageStatus = document.getElementById("packageStatus") as HTMLDivElement;
const packageSummary = document.getElementById("packageSummary") as HTMLDivElement;
const profileStatus = document.getElementById("profileStatus") as HTMLDivElement;
const hearAboutUsInput = document.getElementById("hearAboutUs") as HTMLInputElement;
const customRulesInput = document.getElementById("customRules") as HTMLTextAreaElement;
const tenantRulesLabel = document.getElementById("tenantRulesLabel") as HTMLLabelElement;
const tenantRulesInput = document.getElementById("tenantRules") as HTMLTextAreaElement;
const saveRulesBtn = document.getElementById("saveRulesBtn") as HTMLButtonElement;
const exportRulesBtn = document.getElementById("exportRulesBtn") as HTMLButtonElement;
const importRulesBtn = document.getElementById("importRulesBtn") as HTMLButtonElement;
const importArea = document.getElementById("importArea") as HTMLTextAreaElement;
const rulesFeedback = document.getElementById("rulesFeedback") as HTMLDivElement;
const connectionLabel = document.getElementById("connectionLabel") as HTMLSpanElement;
const connectionDetail = document.getElementById("connectionDetail") as HTMLDivElement;
const versionBadge = document.getElementById("versionBadge") as HTMLSpanElement;
const settingsFeedback = document.getElementById("settingsFeedback") as HTMLDivElement;
const usageStatsGrid = document.getElementById("usageStats") as HTMLDivElement;
const auditBtn = document.getElementById("auditBtn") as HTMLButtonElement;
const auditResults = document.getElementById("auditResults") as HTMLUListElement;
const timeoutInput = document.getElementById("setTimeout") as HTMLInputElement;

// Feature toggles → ExtensionSettings keys (single source of truth in
// content/features.ts; the popup just binds UI to it).
const TOGGLE_BINDINGS: [string, keyof ExtensionSettings][] = [
  ["setSmartFormatting", "smartFormatting"],
  ["setShowConfidence", "showConfidenceScore"],
  ["setHighlight", "highlightFilledFields"],
  ["setScreenReader", "enableScreenReaderAnnouncements"],
  ["setAutoFill", "autoFillOnPageLoad"],
];

let activeTenantHost: string | null = null;

function showFeedback(el: HTMLDivElement, text: string, kind: "success" | "warning" | "error" | "info") {
  el.textContent = text;
  el.className = `feedback ${kind}`;
}

function parseRuleLines(text: string): CustomFillRule[] {
  return text
    .split("\n")
    .map((line) => {
      const eq = line.indexOf("=");
      if (eq < 1) return null;
      return { label: line.slice(0, eq).trim(), value: line.slice(eq + 1).trim() };
    })
    .filter((r): r is CustomFillRule => Boolean(r && r.label && r.value))
    .slice(0, 20);
}

function rulesToLines(rules: CustomFillRule[]): string {
  return rules.map((r) => `${r.label} = ${r.value}`).join("\n");
}

function buildStatusRow(icon: string, iconClass: string, label: string, detail: string): string {
  return `<div class="status-row">
    <div class="icon ${iconClass}">${icon}</div>
    <div class="status-text">
      <span class="label">${escapeHtml(label)}</span>
      <div class="detail">${escapeHtml(detail)}</div>
    </div>
  </div>`;
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

async function init() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.webAppOrigin,
    STORAGE_KEYS.autofillPackage,
    STORAGE_KEYS.baseProfile,
    STORAGE_KEYS.customRules,
    STORAGE_KEYS.hearAboutUs,
    STORAGE_KEYS.fillHistory,
  ]);
  const origin = (stored[STORAGE_KEYS.webAppOrigin] as string | undefined) ?? "http://localhost:3000";
  webAppUrlInput.value = origin;

  // Connection status
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isWorkday = tab?.url ? /\.myworkdayjobs\.com/i.test(new URL(tab.url).hostname) : false;
  if (isWorkday) {
    connectionLabel.textContent = `📍 On ${new URL(tab!.url!).hostname}`;
    connectionDetail.textContent = "Workday application page detected — ready to autofill.";
  } else {
    connectionLabel.textContent = "🌐 Not on a Workday site";
    connectionDetail.textContent = "Navigate to a job application at *.myworkdayjobs.com to autofill.";
  }

  // Package status
  const pkg = stored[STORAGE_KEYS.autofillPackage] as AutofillPackage | undefined;
  if (pkg) {
    const pkgLabel = `${escapeHtml(pkg.job.title)} at ${escapeHtml(pkg.job.company)}`;
    const pkgDetail = `ATS ${pkg.atsScore}/100 · generated ${new Date(pkg.createdAt).toLocaleString()}`;
    packageStatus.innerHTML = buildStatusRow("✓", "ready", pkgLabel, pkgDetail);

    // Summary grid
    const certCount = pkg.certificationDetails?.filter(c => c.name?.trim()).length ?? 0;
    packageSummary.innerHTML = `
      <div class="summary-item"><div class="num green">${pkg.experience.length}</div><div class="desc">Roles</div></div>
      <div class="summary-item"><div class="num green">${pkg.education.length}</div><div class="desc">Education</div></div>
      <div class="summary-item"><div class="num ${certCount > 0 ? 'green' : 'amber'}">${certCount}</div><div class="desc">Certs</div></div>
      <div class="summary-item"><div class="num ${pkg.atsScore >= 80 ? 'green' : pkg.atsScore >= 60 ? 'amber' : 'red'}">${pkg.atsScore}</div><div class="desc">ATS Score</div></div>
    `;
    packageSummary.classList.remove("hidden");
  } else {
    packageStatus.innerHTML = buildStatusRow("!", "empty", "No package loaded", "Generate a tailored application in the web app first.");
    packageSummary.classList.add("hidden");
  }

  // Profile status
  const profile = stored[STORAGE_KEYS.baseProfile] as BaseProfile | undefined;
  if (profile) {
    const syncedAt = profile.syncedAt ? ` · synced ${new Date(profile.syncedAt).toLocaleString()}` : "";
    profileStatus.innerHTML = buildStatusRow(
      "✓", "ready",
      `${escapeHtml(profile.contact.firstName)} ${escapeHtml(profile.contact.lastName)}`,
      `${profile.experience.length} role(s) · ${profile.education.length} education · ${profile.certificationDetails?.length ?? 0} cert(s)${syncedAt}`
    );
  } else {
    profileStatus.innerHTML = buildStatusRow("!", "empty", "No profile synced", "Save your resume on the web app's Resume page with this extension connected.");
  }

  hearAboutUsInput.value = (stored[STORAGE_KEYS.hearAboutUs] as string | undefined) ?? "";
  const rules = (stored[STORAGE_KEYS.customRules] as CustomFillRule[] | undefined) ?? [];
  customRulesInput.value = rulesToLines(rules);

  // Per-tenant rules for the active tab's Workday host
  try {
    const host = tab?.url ? new URL(tab.url).hostname : "";
    if (/\.myworkdayjobs\.com$/i.test(host)) {
      activeTenantHost = host;
      const tenants = ((await chrome.storage.local.get(STORAGE_KEYS.tenantRules))[
        STORAGE_KEYS.tenantRules
      ] ?? {}) as Record<string, CustomFillRule[]>;
      tenantRulesLabel.textContent = `Rules only for ${host}`;
      tenantRulesLabel.style.display = "";
      tenantRulesInput.style.display = "";
      tenantRulesInput.value = rulesToLines(tenants[host] ?? []);
    }
  } catch {
    /* no active-tab URL access — leave the tenant box hidden */
  }
}

connectBtn.addEventListener("click", async () => {
  const url = webAppUrlInput.value.trim();
  if (!url) return;
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    showFeedback(connectFeedback, "Enter a valid URL, e.g. http://localhost:3000", "error");
    return;
  }

  const pattern = `${origin}/*`;
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) {
    showFeedback(connectFeedback, "Permission denied — the extension can't reach that page.", "error");
    return;
  }

  await chrome.runtime.sendMessage({ type: "REGISTER_WEB_APP_ORIGIN", origin });
  showFeedback(connectFeedback, `Connected to ${origin}. Reload the web app tab.`, "success");
});

openAppBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "OPEN_APPLY_TAB" });
});

autofillBtn.addEventListener("click", async () => {
  autofillBtn.disabled = true;
  autofillBtn.textContent = "⏳ Running autofill...";
  showFeedback(autofillFeedback, "Filling fields...", "info");
  autofillFeedback.classList.remove("hidden");
  autofillDetails.innerHTML = "";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    showFeedback(autofillFeedback, "No active tab.", "error");
    autofillBtn.disabled = false;
    autofillBtn.textContent = "▶ Autofill this page";
    return;
  }
  try {
    const result = (await chrome.tabs.sendMessage(tab.id, { type: "RUN_AUTOFILL" })) as MaybeEnhanced;
    if (!result || (!result.filled.length && !result.filesAttached.length)) {
      showFeedback(autofillFeedback, "Nothing to fill — open a Workday application page with a tailored package ready.", "warning");
    } else {
      const total = result.filled.length;
      const files = result.filesAttached.length;
      const leftForYou = result.leftForYou?.length ?? 0;
      const stillRequired = result.stillRequired?.length ?? 0;
      const skipped = result.skipped.length;
      const confidence = result.confidence ? ` Confidence: ${result.confidence.label}.` : "";

      showFeedback(
        autofillFeedback,
        `✅ Filled ${total} field(s)${files ? ` and attached ${result.filesAttached.join(" & ")}` : ""}.${confidence}${stillRequired ? ` ${stillRequired} required field(s) still need you.` : ""} Review before continuing.`,
        stillRequired > 0 ? "warning" : "success"
      );

      // Structured detail
      let detailsHtml = `<div class="summary-grid">`;
      detailsHtml += `<div class="summary-item"><div class="num green">${total}</div><div class="desc">Filled</div></div>`;
      detailsHtml += `<div class="summary-item"><div class="num ${stillRequired > 0 ? 'red' : 'green'}">${stillRequired}</div><div class="desc">Still Required</div></div>`;
      if (leftForYou > 0) detailsHtml += `<div class="summary-item"><div class="num amber">${leftForYou}</div><div class="desc">Left For You</div></div>`;
      if (skipped > 0) detailsHtml += `<div class="summary-item"><div class="num amber">${skipped}</div><div class="desc">Skipped</div></div>`;
      detailsHtml += `</div>`;

      // Left-for-you details
      if (result.leftForYou?.length) {
        detailsHtml += `<div style="margin-top: 6px; font-size: 11px; color: var(--text-secondary);">`;
        detailsHtml += `<strong>Self-ID questions left for you:</strong>`;
        detailsHtml += `<ul class="detail-list">`;
        for (const item of result.leftForYou) {
          detailsHtml += `<li>${escapeHtml(item)}</li>`;
        }
        detailsHtml += `</ul></div>`;
      }

      // Still-required details
      if (result.stillRequired?.length) {
        detailsHtml += `<div style="margin-top: 6px; font-size: 11px; color: var(--danger);">`;
        detailsHtml += `<strong>Required fields still empty:</strong>`;
        detailsHtml += `<ul class="detail-list">`;
        for (const item of result.stillRequired) {
          detailsHtml += `<li>${escapeHtml(item.slice(0, 50))}</li>`;
        }
        detailsHtml += `</ul></div>`;
      }

      // Skipped details
      if (result.skipped.length) {
        detailsHtml += `<div style="margin-top: 6px; font-size: 11px; color: var(--warning);">`;
        detailsHtml += `<strong>Skipped:</strong>`;
        detailsHtml += `<ul class="detail-list">`;
        for (const item of result.skipped) {
          detailsHtml += `<li>${escapeHtml(item.slice(0, 80))}</li>`;
        }
        detailsHtml += `</ul></div>`;
      }

      // Mismatches
      if (result.mismatches?.length) {
        detailsHtml += `<div style="margin-top: 6px; font-size: 11px; color: var(--warning);">`;
        detailsHtml += `<strong>Mismatches (form differs from profile):</strong>`;
        detailsHtml += `<ul class="detail-list">`;
        for (const item of result.mismatches) {
          detailsHtml += `<li>${escapeHtml(item.slice(0, 80))}</li>`;
        }
        detailsHtml += `</ul></div>`;
      }

      autofillDetails.innerHTML = detailsHtml;
      autofillDetails.classList.add("open");
    }
  } catch {
    showFeedback(autofillFeedback, "Couldn't reach the page. Open a Workday application form tab first.", "error");
  }
  autofillBtn.disabled = false;
  autofillBtn.textContent = "▶ Autofill this page";
});

saveRulesBtn.addEventListener("click", async () => {
  const rules = parseRuleLines(customRulesInput.value);
  const updates: Record<string, unknown> = {
    [STORAGE_KEYS.customRules]: rules,
    [STORAGE_KEYS.hearAboutUs]: hearAboutUsInput.value.trim(),
  };
  let tenantNote = "";
  if (activeTenantHost) {
    const tenants = ((await chrome.storage.local.get(STORAGE_KEYS.tenantRules))[
      STORAGE_KEYS.tenantRules
    ] ?? {}) as Record<string, CustomFillRule[]>;
    const tenantRules = parseRuleLines(tenantRulesInput.value);
    if (tenantRules.length) tenants[activeTenantHost] = tenantRules;
    else delete tenants[activeTenantHost];
    updates[STORAGE_KEYS.tenantRules] = tenants;
    tenantNote = ` + ${tenantRules.length} for ${activeTenantHost}`;
  }
  await chrome.storage.local.set(updates);
  showFeedback(
    rulesFeedback,
    `Saved ${rules.length} custom answer(s)${tenantNote}${
      hearAboutUsInput.value.trim() ? ` + the "How did you hear about us?" default` : ""
    }.`,
    "success"
  );
});

exportRulesBtn.addEventListener("click", async () => {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.customRules,
    STORAGE_KEYS.tenantRules,
    STORAGE_KEYS.hearAboutUs,
  ]);
  const payload = JSON.stringify(
    {
      workdayzRules: 1,
      global: stored[STORAGE_KEYS.customRules] ?? [],
      tenants: stored[STORAGE_KEYS.tenantRules] ?? {},
      hearAboutUs: stored[STORAGE_KEYS.hearAboutUs] ?? "",
    },
    null,
    2,
  );
  try {
    await navigator.clipboard.writeText(payload);
    showFeedback(rulesFeedback, "Rules JSON copied to clipboard — save or share it.", "success");
  } catch {
    showFeedback(rulesFeedback, "Couldn't access the clipboard.", "error");
  }
});

importRulesBtn.addEventListener("click", async () => {
  if (importArea.style.display === "none") {
    importArea.style.display = "";
    showFeedback(rulesFeedback, 'Paste the exported rules JSON below, then click "Import" again.', "info");
    importArea.focus();
    return;
  }
  try {
    const parsed = JSON.parse(importArea.value) as {
      workdayzRules?: number;
      global?: CustomFillRule[];
      tenants?: Record<string, CustomFillRule[]>;
      hearAboutUs?: string;
    };
    if (parsed?.workdayzRules !== 1) throw new Error();
    await chrome.storage.local.set({
      [STORAGE_KEYS.customRules]: Array.isArray(parsed.global) ? parsed.global.slice(0, 20) : [],
      [STORAGE_KEYS.tenantRules]: parsed.tenants && typeof parsed.tenants === "object" ? parsed.tenants : {},
      [STORAGE_KEYS.hearAboutUs]: typeof parsed.hearAboutUs === "string" ? parsed.hearAboutUs : "",
    });
    importArea.style.display = "none";
    importArea.value = "";
    showFeedback(rulesFeedback, "Rules imported successfully.", "success");
    init();
  } catch {
    showFeedback(rulesFeedback, "That isn't a valid Workdayz rules export.", "error");
  }
});

clearBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove([STORAGE_KEYS.autofillPackage, STORAGE_KEYS.scrapedJob]);
  showFeedback(autofillFeedback, "Cleared. Your application data is no longer stored in the extension.", "info");
  autofillFeedback.classList.remove("hidden");
  packageStatus.innerHTML = buildStatusRow("!", "empty", "No package loaded", "Generate a tailored application in the web app first.");
  packageSummary.classList.add("hidden");
});

// Collapsible sections
function setupCollapsible(toggleId: string, contentId: string) {
  const toggle = document.getElementById(toggleId);
  const content = document.getElementById(contentId);
  if (toggle && content) {
    toggle.addEventListener("click", () => {
      const isOpen = content.classList.toggle("open");
      toggle.textContent = isOpen ? `▼ ${toggle.textContent!.slice(1).trim()}` : `▶ ${toggle.textContent!.slice(1).trim()}`;
    });
  }
}

setupCollapsible("rulesToggle", "rulesContent");
setupCollapsible("connectToggle", "connectContent");

// --- Tabs ---
document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.tab ?? "")?.classList.add("active");
  });
});

// --- Settings tab: bind toggles to ExtensionSettings ---
async function initSettings() {
  const settings = await getSettings();
  for (const [elId, key] of TOGGLE_BINDINGS) {
    const el = document.getElementById(elId) as HTMLInputElement | null;
    if (!el) continue;
    el.checked = Boolean(settings[key]);
    el.addEventListener("change", async () => {
      await updateSettings({ [key]: el.checked });
      showFeedback(settingsFeedback, "Saved — takes effect on the next fill.", "success");
    });
  }

  timeoutInput.value = String(Math.round(settings.fillTimeoutMs / 1000));
  timeoutInput.addEventListener("change", async () => {
    const seconds = Math.min(120, Math.max(5, Number(timeoutInput.value) || 30));
    timeoutInput.value = String(seconds);
    await updateSettings({ fillTimeoutMs: seconds * 1000 });
    showFeedback(settingsFeedback, `Fill timeout set to ${seconds}s.`, "success");
  });

  // Local-only usage stats (never leaves the browser)
  const stats = await getUsageStats();
  usageStatsGrid.innerHTML = `
    <div class="summary-item"><div class="num green">${stats.totalAutofills}</div><div class="desc">Autofills</div></div>
    <div class="summary-item"><div class="num green">${stats.totalFieldsFilled}</div><div class="desc">Fields Filled</div></div>
  `;

  try {
    versionBadge.textContent = `v${chrome.runtime.getManifest().version}`;
  } catch {
    /* keep the static default */
  }
}

auditBtn.addEventListener("click", async () => {
  auditBtn.disabled = true;
  auditBtn.textContent = "Running…";
  try {
    const report = await runAudit();
    auditResults.innerHTML = report.checks
      .map(
        (c) =>
          `<li><span class="chk ${c.status}">${c.status === "pass" ? "✓" : c.status === "warn" ? "!" : "✗"}</span><span><strong>${escapeHtml(c.name)}</strong> <span class="detail">${escapeHtml(c.detail)}</span></span></li>`,
      )
      .join("");
  } finally {
    auditBtn.disabled = false;
    auditBtn.textContent = "Run self-check";
  }
});

init();
initSettings();
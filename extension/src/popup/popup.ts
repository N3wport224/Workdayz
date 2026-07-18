import { STORAGE_KEYS, isWorkdayDomain, type AutofillPackage, type AutofillRunSummary, type BaseProfile, type CustomFillRule } from "../types";
import { getSettings, updateSettings, resetSettings, getUsageStats, saveTemplate, loadTemplates, deleteTemplate, getShortcutInfo, type ExtensionSettings } from "../content/features";
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
const fillSourceSelect = document.getElementById("fillSourceSelect") as HTMLSelectElement;
const fillSourceHint = document.getElementById("fillSourceHint") as HTMLDivElement;

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

/** Explains exactly which resume the NEXT autofill will pull data from, so
 * there's never any guessing about the fill source. */
function describeFillSource(
  choice: string,
  pkg: AutofillPackage | undefined,
  profile: BaseProfile | undefined,
): string {
  if (choice === "profile") {
    if (profile) return `Next autofill uses: Base profile — ${profile.contact.firstName} ${profile.contact.lastName}.`;
    if (pkg) return "Base profile isn't synced yet — will fall back to the tailored package.";
    return "Base profile isn't synced yet — save your resume in the web app first.";
  }
  if (pkg) {
    const label = pkg.resumeSource?.label ?? "Tailored resume";
    return `Next autofill uses: ${label} — "${pkg.job.title}" at ${pkg.job.company}.`;
  }
  if (profile) return "No tailored package yet — will fill from your Base profile.";
  return "Nothing to fill from yet — tailor a job or save your profile in the web app.";
}

async function init() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.webAppOrigin,
    STORAGE_KEYS.autofillPackage,
    STORAGE_KEYS.baseProfile,
    STORAGE_KEYS.customRules,
    STORAGE_KEYS.hearAboutUs,
    STORAGE_KEYS.fillHistory,
    STORAGE_KEYS.fillSource,
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
    const sourceLabel = pkg.resumeSource?.label ?? "Tailored resume";
    const pkgDetail = `${sourceLabel} · ATS ${pkg.atsScore}/100 · generated ${new Date(pkg.createdAt).toLocaleString()}`;
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

  // Resume source dropdown: default = tailored package; persisted so the
  // content script honors it on every fill.
  fillSourceSelect.value =
    (stored[STORAGE_KEYS.fillSource] as string | undefined) === "profile" ? "profile" : "tailored";
  fillSourceHint.textContent = describeFillSource(fillSourceSelect.value, pkg, profile);

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
  let hostname: string;
  try {
    const parsed = new URL(url);
    origin = parsed.origin;
    hostname = parsed.hostname;
  } catch {
    showFeedback(connectFeedback, "Enter a valid URL, e.g. http://localhost:3000", "error");
    return;
  }

  // The bridge trusts any postMessage on the page it runs on — never let it
  // run on a Workday tenant itself (myworkdayjobs.com is already a required
  // permission, so the request below would succeed silently otherwise).
  if (isWorkdayDomain(hostname)) {
    showFeedback(connectFeedback, "That's a Workday site — connect the extension to your own web app's URL instead.", "error");
    return;
  }

  const pattern = `${origin}/*`;
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) {
    showFeedback(connectFeedback, "Permission denied — the extension can't reach that page.", "error");
    return;
  }

  const response = await chrome.runtime.sendMessage({ type: "REGISTER_WEB_APP_ORIGIN", origin });
  if (!response?.ok) {
    showFeedback(connectFeedback, "Couldn't connect to that origin.", "error");
    return;
  }
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

fillSourceSelect.addEventListener("change", async () => {
  await chrome.storage.local.set({ [STORAGE_KEYS.fillSource]: fillSourceSelect.value });
  const stored = await chrome.storage.local.get([STORAGE_KEYS.autofillPackage, STORAGE_KEYS.baseProfile]);
  fillSourceHint.textContent = describeFillSource(
    fillSourceSelect.value,
    stored[STORAGE_KEYS.autofillPackage] as AutofillPackage | undefined,
    stored[STORAGE_KEYS.baseProfile] as BaseProfile | undefined,
  );
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

  // Item 71: dark/light theme actually wired to settings.theme
  const darkToggle = document.getElementById("setDarkTheme") as HTMLInputElement | null;
  if (darkToggle) {
    document.body.dataset.theme = settings.theme === "dark" ? "dark" : "light";
    darkToggle.checked = settings.theme === "dark";
    darkToggle.addEventListener("change", async () => {
      const theme = darkToggle.checked ? "dark" : "light";
      document.body.dataset.theme = theme;
      await updateSettings({ theme });
      showFeedback(settingsFeedback, `Theme: ${theme}.`, "success");
    });
  }

  // Item 66: keyboard shortcut cheat sheet
  const shortcutList = document.getElementById("shortcutList") as HTMLUListElement | null;
  if (shortcutList) {
    try {
      const shortcuts = await getShortcutInfo();
      shortcutList.innerHTML = shortcuts.length
        ? shortcuts
            .map((s) => `<li><strong>${escapeHtml(s.currentKey)}</strong> — ${escapeHtml(s.description || s.name)}</li>`)
            .join("")
        : `<li style="opacity:.6">No shortcuts registered.</li>`;
    } catch {
      shortcutList.innerHTML = `<li style="opacity:.6">Unavailable in this context.</li>`;
    }
  }

  // Item 72: first-run onboarding
  const onboardingCard = document.getElementById("onboardingCard");
  const onboardingDone = document.getElementById("onboardingDone");
  try {
    const flag = await chrome.storage.local.get("workdayz.onboarded");
    if (!flag["workdayz.onboarded"]) onboardingCard?.classList.remove("hidden");
  } catch { /* orphaned */ }
  onboardingDone?.addEventListener("click", async () => {
    onboardingCard?.classList.add("hidden");
    try {
      await chrome.storage.local.set({ "workdayz.onboarded": true });
    } catch { /* orphaned */ }
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

// --- Fill templates (item 11): save/apply/delete named rule presets ---
const templateNameInput = document.getElementById("templateName") as HTMLInputElement;
const saveTemplateBtn = document.getElementById("saveTemplateBtn") as HTMLButtonElement;
const templatesList = document.getElementById("templatesList") as HTMLUListElement;
const resetSettingsBtn = document.getElementById("resetSettingsBtn") as HTMLButtonElement;

async function renderTemplates() {
  const templates = await loadTemplates();
  if (templates.length === 0) {
    templatesList.innerHTML = `<li style="opacity:.6">No templates saved yet.</li>`;
    return;
  }
  templatesList.innerHTML = "";
  for (const t of templates) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = `${t.name} (${t.rules.length} rule${t.rules.length === 1 ? "" : "s"})`;
    name.style.flex = "1";
    const applyBtn = document.createElement("button");
    applyBtn.className = "btn btn-secondary btn-sm";
    applyBtn.style.width = "auto";
    applyBtn.textContent = "Apply";
    applyBtn.addEventListener("click", async () => {
      customRulesInput.value = rulesToLines(t.rules);
      await chrome.storage.local.set({ [STORAGE_KEYS.customRules]: t.rules });
      showFeedback(rulesFeedback, `Applied template "${t.name}" — its rules are now the global rules.`, "success");
    });
    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-danger btn-sm";
    delBtn.style.width = "auto";
    delBtn.textContent = "✕";
    delBtn.title = "Delete template";
    delBtn.addEventListener("click", async () => {
      await deleteTemplate(t.name);
      renderTemplates();
    });
    li.append(name, applyBtn, delBtn);
    templatesList.appendChild(li);
  }
}

saveTemplateBtn.addEventListener("click", async () => {
  const name = templateNameInput.value.trim().slice(0, 40);
  if (!name) {
    showFeedback(rulesFeedback, "Give the template a name first.", "warning");
    return;
  }
  const rules = parseRuleLines(customRulesInput.value);
  if (rules.length === 0) {
    showFeedback(rulesFeedback, "No rules to save — add some global rules above first.", "warning");
    return;
  }
  await deleteTemplate(name); // saving under an existing name replaces it
  await saveTemplate(name, rules);
  templateNameInput.value = "";
  showFeedback(rulesFeedback, `Saved template "${name}".`, "success");
  renderTemplates();
});

// --- Item 12: reset all extension settings to defaults ---
resetSettingsBtn.addEventListener("click", async () => {
  await resetSettings();
  showFeedback(settingsFeedback, "Settings reset to defaults.", "success");
  window.location.reload();
});

renderTemplates();

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
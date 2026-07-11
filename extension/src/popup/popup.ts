import { STORAGE_KEYS, type AutofillPackage, type AutofillRunSummary, type BaseProfile, type CustomFillRule } from "../types";

const webAppUrlInput = document.getElementById("webAppUrl") as HTMLInputElement;
const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement;
const connectStatus = document.getElementById("connectStatus") as HTMLDivElement;
const openAppBtn = document.getElementById("openAppBtn") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const autofillBtn = document.getElementById("autofillBtn") as HTMLButtonElement;
const autofillStatus = document.getElementById("autofillStatus") as HTMLDivElement;
const clearBtn = document.getElementById("clearBtn") as HTMLButtonElement;
const clearStatus = document.getElementById("clearStatus") as HTMLDivElement;
const profileStatusEl = document.getElementById("profileStatus") as HTMLDivElement;
const hearAboutUsInput = document.getElementById("hearAboutUs") as HTMLInputElement;
const customRulesInput = document.getElementById("customRules") as HTMLTextAreaElement;
const saveRulesBtn = document.getElementById("saveRulesBtn") as HTMLButtonElement;
const rulesStatus = document.getElementById("rulesStatus") as HTMLDivElement;

async function init() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.webAppOrigin,
    STORAGE_KEYS.autofillPackage,
    STORAGE_KEYS.baseProfile,
    STORAGE_KEYS.customRules,
    STORAGE_KEYS.hearAboutUs,
  ]);
  const origin = (stored[STORAGE_KEYS.webAppOrigin] as string | undefined) ?? "http://localhost:3000";
  webAppUrlInput.value = origin;

  const pkg = stored[STORAGE_KEYS.autofillPackage] as AutofillPackage | undefined;
  statusEl.textContent = pkg
    ? `Ready: "${pkg.job.title}" at ${pkg.job.company} (ATS ${pkg.atsScore}/100), generated ${new Date(pkg.createdAt).toLocaleString()}.`
    : "No tailored application yet — generate one in the web app.";

  const profile = stored[STORAGE_KEYS.baseProfile] as BaseProfile | undefined;
  profileStatusEl.textContent = profile
    ? `Base profile: ${profile.contact.firstName} ${profile.contact.lastName} (${profile.experience.length} role(s))${
        profile.syncedAt ? `, synced ${new Date(profile.syncedAt).toLocaleString()}` : ""
      }.`
    : "No base profile synced — save your resume on the web app's Resume page with this extension connected.";

  hearAboutUsInput.value = (stored[STORAGE_KEYS.hearAboutUs] as string | undefined) ?? "";
  const rules = (stored[STORAGE_KEYS.customRules] as CustomFillRule[] | undefined) ?? [];
  customRulesInput.value = rules.map((r) => `${r.label} = ${r.value}`).join("\n");
}

connectBtn.addEventListener("click", async () => {
  const url = webAppUrlInput.value.trim();
  if (!url) return;
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    connectStatus.textContent = "Enter a valid URL, e.g. http://localhost:3000";
    return;
  }

  const pattern = `${origin}/*`;
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) {
    connectStatus.textContent = "Permission denied — the extension can't reach that page.";
    return;
  }

  await chrome.runtime.sendMessage({ type: "REGISTER_WEB_APP_ORIGIN", origin });
  connectStatus.textContent = `Connected to ${origin}. Reload the web app tab.`;
});

openAppBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "OPEN_APPLY_TAB" });
});

autofillBtn.addEventListener("click", async () => {
  autofillStatus.textContent = "Running...";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    autofillStatus.textContent = "No active tab.";
    return;
  }
  try {
    const result = (await chrome.tabs.sendMessage(tab.id, { type: "RUN_AUTOFILL" })) as AutofillRunSummary;
    if (!result || (!result.filled.length && !result.filesAttached.length)) {
      autofillStatus.textContent = "Nothing filled — make sure you're on a Workday application page with a tailored package ready.";
    } else {
      autofillStatus.textContent = `Filled ${result.filled.length} field(s)${result.filesAttached.length ? `, attached ${result.filesAttached.join(" & ")}` : ""}. Review before continuing.`;
    }
  } catch {
    autofillStatus.textContent = "Couldn't reach this tab — open a Workday application page first.";
  }
});

saveRulesBtn.addEventListener("click", async () => {
  const rules: CustomFillRule[] = customRulesInput.value
    .split("\n")
    .map((line) => {
      const eq = line.indexOf("=");
      if (eq < 1) return null;
      return { label: line.slice(0, eq).trim(), value: line.slice(eq + 1).trim() };
    })
    .filter((r): r is CustomFillRule => Boolean(r && r.label && r.value))
    .slice(0, 20);
  await chrome.storage.local.set({
    [STORAGE_KEYS.customRules]: rules,
    [STORAGE_KEYS.hearAboutUs]: hearAboutUsInput.value.trim(),
  });
  rulesStatus.textContent = `Saved ${rules.length} custom answer(s)${
    hearAboutUsInput.value.trim() ? ` + the "How did you hear about us?" default` : ""
  }.`;
});

clearBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove([STORAGE_KEYS.autofillPackage, STORAGE_KEYS.scrapedJob]);
  clearStatus.textContent = "Cleared. Your resume and job data are no longer stored in the extension.";
  statusEl.textContent = "No tailored application yet — generate one in the web app.";
});

init();

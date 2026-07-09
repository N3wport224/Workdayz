import { STORAGE_KEYS, type AutofillPackage, type JobPosting, type RuntimeMessage } from "../types";

const BRIDGE_SCRIPT_ID = "workdayz-web-app-bridge";

async function registerBridgeForOrigin(origin: string): Promise<void> {
  const pattern = `${origin.replace(/\/$/, "")}/*`;
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [BRIDGE_SCRIPT_ID] });
  const config: chrome.scripting.RegisteredContentScript = {
    id: BRIDGE_SCRIPT_ID,
    matches: [pattern],
    js: ["content/web-app-bridge.js"],
    runAt: "document_start",
    world: "ISOLATED",
  };
  if (existing.length) {
    await chrome.scripting.updateContentScripts([config]);
  } else {
    await chrome.scripting.registerContentScripts([config]);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.webAppOrigin);
  const origin = stored[STORAGE_KEYS.webAppOrigin] as string | undefined;
  if (origin) {
    const granted = await chrome.permissions.contains({ origins: [`${origin.replace(/\/$/, "")}/*`] });
    if (granted) await registerBridgeForOrigin(origin);
  }
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // keep the message channel open for the async response
});

async function handleMessage(message: RuntimeMessage) {
  switch (message.type) {
    case "STORE_SCRAPED_JOB": {
      await chrome.storage.local.set({ [STORAGE_KEYS.scrapedJob]: message.payload });
      return { ok: true };
    }
    case "GET_SCRAPED_JOB": {
      const data = await chrome.storage.local.get(STORAGE_KEYS.scrapedJob);
      return { job: (data[STORAGE_KEYS.scrapedJob] as JobPosting | undefined) ?? null };
    }
    case "STORE_AUTOFILL_PACKAGE": {
      await chrome.storage.local.set({ [STORAGE_KEYS.autofillPackage]: message.payload });
      return { ok: true };
    }
    case "GET_AUTOFILL_PACKAGE": {
      const data = await chrome.storage.local.get(STORAGE_KEYS.autofillPackage);
      return { pkg: (data[STORAGE_KEYS.autofillPackage] as AutofillPackage | undefined) ?? null };
    }
    case "OPEN_APPLY_TAB": {
      const stored = await chrome.storage.local.get(STORAGE_KEYS.webAppOrigin);
      const origin = (stored[STORAGE_KEYS.webAppOrigin] as string | undefined) ?? "http://localhost:3000";
      await chrome.tabs.create({ url: `${origin.replace(/\/$/, "")}/apply?from=extension` });
      return { ok: true };
    }
    case "REGISTER_WEB_APP_ORIGIN": {
      await chrome.storage.local.set({ [STORAGE_KEYS.webAppOrigin]: message.origin });
      await registerBridgeForOrigin(message.origin);
      return { ok: true };
    }
    default:
      return { ok: false, error: `Unknown message type: ${(message as { type: string }).type}` };
  }
}

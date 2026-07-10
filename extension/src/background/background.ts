import { STORAGE_KEYS, type AutofillPackage, type BaseProfile, type JobPosting, type RuntimeMessage } from "../types";

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
    case "STORE_PROFILE": {
      await chrome.storage.local.set({ [STORAGE_KEYS.baseProfile]: message.payload });
      return { ok: true };
    }
    case "GET_PROFILE": {
      const data = await chrome.storage.local.get(STORAGE_KEYS.baseProfile);
      return { profile: (data[STORAGE_KEYS.baseProfile] as BaseProfile | undefined) ?? null };
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
    case "ANSWER_QUESTIONS": {
      // Proxy to the web app's API: the background worker holds host
      // permission for the connected origin, and the stored autofill package
      // supplies the resume/job context. The API key never leaves the web app.
      const stored = await chrome.storage.local.get([STORAGE_KEYS.webAppOrigin, STORAGE_KEYS.autofillPackage]);
      const origin = stored[STORAGE_KEYS.webAppOrigin] as string | undefined;
      const pkg = stored[STORAGE_KEYS.autofillPackage] as AutofillPackage | undefined;
      if (!origin) return { error: "Connect the web app in the extension popup first." };
      if (!pkg) return { error: "No tailored application stored — generate one in the web app first." };
      try {
        const res = await fetch(`${origin.replace(/\/$/, "")}/api/answer-questions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Without a deadline, a hung web app leaves the widget on
          // "Drafting..." forever. LLM drafting takes 10-30s; 90s is generous.
          signal: AbortSignal.timeout(90_000),
          body: JSON.stringify({
            job: pkg.job,
            summary: pkg.summary,
            skills: pkg.skills,
            experience: pkg.experience.map((e) => ({ title: e.title, company: e.company, bullets: e.bullets })),
            questions: message.questions,
          }),
        });
        const data = await res.json();
        if (!res.ok) return { error: data.error ?? "Answer drafting failed." };
        return { answers: data.answers };
      } catch (err) {
        return {
          error:
            err instanceof Error && err.name === "TimeoutError"
              ? "The web app took too long to respond — try again."
              : "Couldn't reach the web app — is it running?",
        };
      }
    }
    default:
      return { ok: false, error: `Unknown message type: ${(message as { type: string }).type}` };
  }
}

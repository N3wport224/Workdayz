import { MESSAGE_TYPES, type AutofillPackage, type BaseProfile } from "../types";

// Runs only on the web app's origin (dynamically registered by
// background.ts once the user connects it from the popup). Relays
// postMessage traffic from the web page to the extension's background
// service worker and back. See web/lib/extension-bridge.ts for the other
// half of this protocol.

function announceReady() {
  window.postMessage({ source: "workdayz-extension", type: MESSAGE_TYPES.extensionReady }, window.location.origin);
}

window.addEventListener("message", async (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; type?: string; payload?: unknown };
  if (data?.source !== "workdayz-web") return;

  // If the extension was reloaded/updated while this tab stayed open, this
  // orphaned script's chrome.runtime calls throw "Extension context
  // invalidated". Swallow it: the page will show "not detected" and the user
  // reloads the tab, instead of an uncaught rejection and a silent failure.
  try {
    await handle(data);
  } catch {
    /* orphaned content script — no-op */
  }
});

async function handle(data: { type?: string; payload?: unknown }) {
  switch (data.type) {
    case MESSAGE_TYPES.ping: {
      announceReady();
      break;
    }
    case MESSAGE_TYPES.autofillPackage: {
      const response = await chrome.runtime.sendMessage({
        type: "STORE_AUTOFILL_PACKAGE",
        payload: data.payload as AutofillPackage,
      });
      if (response?.ok) {
        window.postMessage(
          { source: "workdayz-extension", type: MESSAGE_TYPES.packageStored },
          window.location.origin,
        );
      }
      break;
    }
    case MESSAGE_TYPES.profile: {
      await chrome.runtime.sendMessage({
        type: "STORE_PROFILE",
        payload: data.payload as BaseProfile,
      });
      break;
    }
    case MESSAGE_TYPES.requestScrapedJob: {
      const response = await chrome.runtime.sendMessage({ type: "GET_SCRAPED_JOB" });
      if (response?.job) {
        window.postMessage(
          { source: "workdayz-extension", type: MESSAGE_TYPES.scrapedJob, payload: response.job },
          window.location.origin,
        );
      }
      break;
    }
  }
}

announceReady();

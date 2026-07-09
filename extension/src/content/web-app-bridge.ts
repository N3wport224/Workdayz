import { MESSAGE_TYPES, type AutofillPackage } from "../types";

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

  switch (data.type) {
    case MESSAGE_TYPES.ping: {
      announceReady();
      break;
    }
    case MESSAGE_TYPES.autofillPackage: {
      await chrome.runtime.sendMessage({
        type: "STORE_AUTOFILL_PACKAGE",
        payload: data.payload as AutofillPackage,
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
});

announceReady();

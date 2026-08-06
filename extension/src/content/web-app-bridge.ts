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
      const response = await chrome.runtime.sendMessage({
        type: "STORE_PROFILE",
        payload: data.payload as BaseProfile,
      });
      // Item 76: tell the page what its save replaced (last-write-wins made visible)
      window.postMessage(
        { source: "workdayz-extension", type: MESSAGE_TYPES.profileStored, payload: { previousSyncedAt: response?.previousSyncedAt ?? null } },
        window.location.origin,
      );
      break;
    }
    case MESSAGE_TYPES.profileList: {
      await chrome.runtime.sendMessage({
        type: "STORE_PROFILE_LIST",
        payload: data.payload as { profiles: Record<string, BaseProfile>; activeName: string },
      });
      break;
    }
    case MESSAGE_TYPES.requestPendingConfirmations: {
      // Drains submissions logged while the web app was closed — the common
      // case, since people apply and then close the tab.
      const response = await chrome.runtime.sendMessage({ type: "GET_PENDING_CONFIRMATIONS" });
      window.postMessage(
        {
          source: "workdayz-extension",
          type: MESSAGE_TYPES.pendingConfirmations,
          payload: response?.confirmations ?? [],
        },
        window.location.origin,
      );
      break;
    }
    case MESSAGE_TYPES.confirmationsAcknowledged: {
      // Only the keys the web app actually committed are dropped, so a failed
      // write leaves the confirmation queued for the next drain.
      const keys = (data.payload as { keys?: unknown })?.keys;
      await chrome.runtime.sendMessage({
        type: "ACK_CONFIRMATIONS",
        keys: Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : [],
      });
      break;
    }
    case MESSAGE_TYPES.requestSyncStatus: {
      // Items 74/77: report what the extension holds right now.
      const status = await chrome.runtime.sendMessage({ type: "GET_SYNC_STATUS" });
      window.postMessage(
        { source: "workdayz-extension", type: MESSAGE_TYPES.syncStatus, payload: status ?? null },
        window.location.origin,
      );
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

// Item 78: the background relays "a fill just finished on a Workday tab" —
// forward it to the page so the web app can toast it live.
try {
  chrome.runtime.onMessage.addListener((message: { type?: string; count?: number; stillRequired?: number; payload?: unknown }) => {
    if (message?.type === "FILL_COMPLETED_RELAY") {
      window.postMessage(
        {
          source: "workdayz-extension",
          type: MESSAGE_TYPES.fillCompleted,
          payload: { count: message.count ?? 0, stillRequired: message.stillRequired ?? 0 },
        },
        window.location.origin,
      );
    }
    // A submission just landed on a Workday tab — let an open tracker react
    // immediately instead of waiting for the next drain.
    if (message?.type === "CONFIRMATION_RELAY") {
      window.postMessage(
        { source: "workdayz-extension", type: MESSAGE_TYPES.applicationConfirmed, payload: message.payload },
        window.location.origin,
      );
    }
  });
} catch {
  /* orphaned script */
}

announceReady();

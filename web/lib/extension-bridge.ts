/**
 * Web app side of the window.postMessage protocol with the extension.
 * See extension/src/content/web-app-bridge.ts for the other half.
 */

import type { AutofillPackage, BaseProfile } from "./types";

const MESSAGE_TYPES = {
  extensionReady: "WORKDAYZ_EXTENSION_READY",
  autofillPackage: "WORKDAYZ_AUTOFILL_PACKAGE",
  requestScrapedJob: "WORKDAYZ_REQUEST_SCRAPED_JOB",
  scrapedJob: "WORKDAYZ_SCRAPED_JOB",
  packageStored: "WORKDAYZ_PACKAGE_STORED",
  profile: "WORKDAYZ_PROFILE",
  ping: "WORKDAYZ_PING",
} as const;

export type BridgeStatus = "detected" | "not-detected" | "checking";

let _status: BridgeStatus = "checking";
let _listeners: Array<(status: BridgeStatus) => void> = [];

export function getBridgeStatus(): BridgeStatus {
  return _status;
}

export function onBridgeStatusChange(cb: (status: BridgeStatus) => void): () => void {
  _listeners.push(cb);
  return () => {
    _listeners = _listeners.filter((l) => l !== cb);
  };
}

function setStatus(s: BridgeStatus) {
  _status = s;
  _listeners.forEach((cb) => cb(s));
}

// Listen for extension announcements. Guarded so importing this module during
// server-side prerender (where `window` is undefined) doesn't crash the build.
if (typeof window !== "undefined") {
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as { source?: string; type?: string; payload?: unknown };
    if (data?.source !== "workdayz-extension") return;

    switch (data.type) {
      case MESSAGE_TYPES.extensionReady:
        setStatus("detected");
        break;
      case MESSAGE_TYPES.packageStored:
        // The extension confirmed it stored the package
        break;
      case MESSAGE_TYPES.scrapedJob:
        // The extension sent a scraped job posting
        break;
    }
  });
}

/** Ping the extension to check if it's loaded. */
export function pingExtension(): void {
  setStatus("checking");
  window.postMessage(
    { source: "workdayz-web", type: MESSAGE_TYPES.ping },
    window.location.origin,
  );
  // If no response in 500ms, assume not detected
  setTimeout(() => {
    if (_status === "checking") setStatus("not-detected");
  }, 500);
}

/** Send a tailored package to the extension for autofill. */
export function sendAutofillPackage(pkg: AutofillPackage): void {
  window.postMessage(
    { source: "workdayz-web", type: MESSAGE_TYPES.autofillPackage, payload: pkg },
    window.location.origin,
  );
}

/** Sync the base profile to the extension. */
export function sendProfile(profile: BaseProfile): void {
  window.postMessage(
    { source: "workdayz-web", type: MESSAGE_TYPES.profile, payload: profile },
    window.location.origin,
  );
}

/** Request the scraped job from the extension. */
export function requestScrapedJob(): void {
  window.postMessage(
    { source: "workdayz-web", type: MESSAGE_TYPES.requestScrapedJob },
    window.location.origin,
  );
}

// Auto-ping on load
if (typeof window !== "undefined") {
  setTimeout(pingExtension, 300);
}
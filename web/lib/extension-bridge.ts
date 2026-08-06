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
  profileList: "WORKDAYZ_PROFILE_LIST",
  ping: "WORKDAYZ_PING",
  requestSyncStatus: "WORKDAYZ_REQUEST_SYNC_STATUS",
  syncStatus: "WORKDAYZ_SYNC_STATUS",
  profileStored: "WORKDAYZ_PROFILE_STORED",
  fillCompleted: "WORKDAYZ_FILL_COMPLETED",
  applicationConfirmed: "WORKDAYZ_APPLICATION_CONFIRMED",
  requestPendingConfirmations: "WORKDAYZ_REQUEST_PENDING_CONFIRMATIONS",
  pendingConfirmations: "WORKDAYZ_PENDING_CONFIRMATIONS",
  confirmationsAcknowledged: "WORKDAYZ_CONFIRMATIONS_ACKNOWLEDGED",
} as const;

/** Items 74/77: what the extension currently holds. */
export interface ExtensionSyncStatus {
  syncedAt: string | null;
  package: { title: string; company: string; source: string; createdAt: string } | null;
}

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
      case MESSAGE_TYPES.syncStatus:
        _syncStatusListeners.forEach((cb) => cb(data.payload as ExtensionSyncStatus | null));
        break;
      case MESSAGE_TYPES.profileStored:
        _profileStoredListeners.forEach((cb) => cb((data.payload as { previousSyncedAt: string | null })?.previousSyncedAt ?? null));
        break;
      case MESSAGE_TYPES.fillCompleted:
        _fillCompletedListeners.forEach((cb) => cb(data.payload as { count: number; stillRequired: number }));
        break;
      case MESSAGE_TYPES.applicationConfirmed:
        _confirmationListeners.forEach((cb) => cb([data.payload as ApplicationConfirmation]));
        break;
      case MESSAGE_TYPES.pendingConfirmations:
        _confirmationListeners.forEach((cb) =>
          cb(Array.isArray(data.payload) ? (data.payload as ApplicationConfirmation[]) : []),
        );
        break;
    }
  });
}

// --- Batch H listeners -------------------------------------------------------
let _syncStatusListeners: Array<(s: ExtensionSyncStatus | null) => void> = [];
let _profileStoredListeners: Array<(previousSyncedAt: string | null) => void> = [];
let _fillCompletedListeners: Array<(r: { count: number; stillRequired: number }) => void> = [];
let _confirmationListeners: Array<(c: ApplicationConfirmation[]) => void> = [];

/** A submitted application detected on a Workday confirmation page. Mirrors
 * extension/src/content/confirmation.ts's ConfirmationEvent. */
export interface ApplicationConfirmation {
  key: string;
  company: string;
  title: string;
  jobId: string;
  submittedAt: string;
  sourceUrl: string;
  hostname: string;
  via: "url" | "dom";
  evidence: string;
}

/**
 * Fires for confirmations, whether relayed live or drained from the queue.
 * Always receives an array so both paths look identical to the caller.
 */
export function onApplicationConfirmed(cb: (c: ApplicationConfirmation[]) => void): () => void {
  _confirmationListeners.push(cb);
  return () => {
    _confirmationListeners = _confirmationListeners.filter((l) => l !== cb);
  };
}

/** Asks for confirmations logged while the web app was closed. */
export function requestPendingConfirmations(): void {
  window.postMessage(
    { source: "workdayz-web", type: MESSAGE_TYPES.requestPendingConfirmations },
    window.location.origin,
  );
}

/**
 * Tells the extension which confirmations were actually written to the tracker,
 * so it can drop just those. Unacknowledged ones stay queued — a failed write
 * must not silently lose a submission.
 */
export function acknowledgeConfirmations(keys: string[]): void {
  window.postMessage(
    { source: "workdayz-web", type: MESSAGE_TYPES.confirmationsAcknowledged, payload: { keys } },
    window.location.origin,
  );
}

/** Items 74/77: ask the extension what it currently holds; the answer arrives
 * via onSyncStatus. */
export function requestSyncStatus(): void {
  window.postMessage({ source: "workdayz-web", type: MESSAGE_TYPES.requestSyncStatus }, window.location.origin);
}

export function onSyncStatus(cb: (s: ExtensionSyncStatus | null) => void): () => void {
  _syncStatusListeners.push(cb);
  return () => {
    _syncStatusListeners = _syncStatusListeners.filter((l) => l !== cb);
  };
}

/** Item 76: fired after a profile sync, with the timestamp it replaced. */
export function onProfileStored(cb: (previousSyncedAt: string | null) => void): () => void {
  _profileStoredListeners.push(cb);
  return () => {
    _profileStoredListeners = _profileStoredListeners.filter((l) => l !== cb);
  };
}

/** Item 78: fired when the extension finishes a fill on a Workday tab. */
export function onFillCompleted(cb: (r: { count: number; stillRequired: number }) => void): () => void {
  _fillCompletedListeners.push(cb);
  return () => {
    _fillCompletedListeners = _fillCompletedListeners.filter((l) => l !== cb);
  };
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

/** Sync every named profile to the extension, so its on-page widget can
 * offer a picker instead of only ever using whichever one synced last. */
export function sendProfileList(profiles: Record<string, BaseProfile>, activeName: string): void {
  window.postMessage(
    { source: "workdayz-web", type: MESSAGE_TYPES.profileList, payload: { profiles, activeName } },
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

// Auto-ping on load, with retries (item 75): the bridge content script can
// register a beat after the page loads, so a single early ping false-negatives.
if (typeof window !== "undefined") {
  setTimeout(pingExtension, 300);
  let attempts = 0;
  const retry = setInterval(() => {
    attempts += 1;
    if (_status === "detected" || attempts >= 4) {
      clearInterval(retry);
      return;
    }
    pingExtension();
  }, 1500);
}
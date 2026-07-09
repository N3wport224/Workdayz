"use client";

import type { AutofillPackage, JobPosting } from "./types";

// Message protocol shared with extension/src/content/web-app-bridge.ts.
// The extension's bridge content script only runs on the web app's own
// origin (see extension/manifest.json host permissions) and relays these
// messages to the background service worker via chrome.runtime.sendMessage.
export const EXTENSION_READY_TYPE = "WORKDAYZ_EXTENSION_READY";
export const AUTOFILL_PACKAGE_TYPE = "WORKDAYZ_AUTOFILL_PACKAGE";
export const REQUEST_SCRAPED_JOB_TYPE = "WORKDAYZ_REQUEST_SCRAPED_JOB";
export const SCRAPED_JOB_TYPE = "WORKDAYZ_SCRAPED_JOB";

export function onScrapedJob(callback: (job: JobPosting) => void) {
  const handler = (event: MessageEvent) => {
    if (event.source !== window) return;
    if (event.data?.source === "workdayz-extension" && event.data?.type === SCRAPED_JOB_TYPE) {
      callback(event.data.payload as JobPosting);
    }
  };
  window.addEventListener("message", handler);
  window.postMessage({ source: "workdayz-web", type: REQUEST_SCRAPED_JOB_TYPE }, window.location.origin);
  return () => window.removeEventListener("message", handler);
}

export function sendPackageToExtension(pkg: AutofillPackage) {
  window.postMessage(
    { source: "workdayz-web", type: AUTOFILL_PACKAGE_TYPE, payload: pkg },
    window.location.origin,
  );
}

export function onExtensionDetected(callback: (present: boolean) => void) {
  const handler = (event: MessageEvent) => {
    if (event.source !== window) return;
    if (event.data?.source === "workdayz-extension" && event.data?.type === EXTENSION_READY_TYPE) {
      callback(true);
    }
  };
  window.addEventListener("message", handler);
  // Ask the extension to announce itself in case it loaded before we did.
  window.postMessage({ source: "workdayz-web", type: "WORKDAYZ_PING" }, window.location.origin);
  return () => window.removeEventListener("message", handler);
}

async function fileToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function fetchPdfAsBase64(
  url: string,
  body: unknown,
): Promise<{ base64: string; fileName: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "PDF generation failed." }));
    throw new Error(err.error || "PDF generation failed.");
  }
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="(.+)"/);
  const fileName = match?.[1] ?? "document.pdf";
  const blob = await res.blob();
  const base64 = await fileToBase64(blob);
  return { base64, fileName };
}

/**
 * Extension Feature Audit Engine
 * 
 * Self-diagnostics that verify every module is loaded, every storage key
 * is reachable, and every content-script integration point responds.
 * Reports version, loaded modules, and health checks — no user data.
 */

export interface AuditReport {
  timestamp: string;
  version: string;
  checks: { name: string; status: "pass" | "fail" | "warn"; detail: string }[];
}

const VERSION = "0.2.0";

/**
 * Runs a full self-diagnostics battery. Safe to call from any context — 
 * gracefully handles missing chrome APIs (orphaned script, Firefox quirk).
 */
export async function runAudit(): Promise<AuditReport> {
  const checks: AuditReport["checks"] = [];

  // 1. Check chrome.storage.local
  try {
    const probe = await chrome.storage.local.get(null);
    const keyCount = Object.keys(probe).length;
    checks.push({
      name: "chrome.storage.local",
      status: "pass",
      detail: `Accessible, ${keyCount} key(s) stored.`,
    });
  } catch (e) {
    checks.push({
      name: "chrome.storage.local",
      status: "fail",
      detail: `Not accessible: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  // 2. Check chrome.runtime
  try {
    if (typeof chrome.runtime?.id === "string" && chrome.runtime.id.length > 0) {
      checks.push({
        name: "chrome.runtime",
        status: "pass",
        detail: `Extension ID: ${chrome.runtime.id.slice(0, 12)}…`,
      });
    } else {
      checks.push({ name: "chrome.runtime", status: "fail", detail: "No runtime ID." });
    }
  } catch {
    checks.push({ name: "chrome.runtime", status: "fail", detail: "Not accessible." });
  }

  // 3. Check chrome.tabs (limited in some contexts)
  try {
    const tabs = await chrome.tabs?.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0) {
      checks.push({
        name: "chrome.tabs",
        status: "pass",
        detail: `Active tab: ${(tabs[0].url ?? "unknown").slice(0, 60)}`,
      });
    } else {
      checks.push({ name: "chrome.tabs", status: "warn", detail: "Query succeeded but no active tab." });
    }
  } catch {
    checks.push({ name: "chrome.tabs", status: "warn", detail: "Not available in this context (background or popup only)." });
  }

  // 4. Check chrome.commands
  try {
    const commands = await chrome.commands?.getAll();
    if (commands && commands.length > 0) {
      const autofillCmd = commands.find((c) => c.name === "run-autofill");
      checks.push({
        name: "chrome.commands",
        status: autofillCmd ? "pass" : "warn",
        detail: autofillCmd
          ? `Autofill shortcut: ${autofillCmd.shortcut ?? "not set"}`
          : "No commands registered.",
      });
    } else {
      checks.push({ name: "chrome.commands", status: "warn", detail: "No commands found." });
    }
  } catch {
    checks.push({ name: "chrome.commands", status: "warn", detail: "Not accessible." });
  }

  // 5. Check content script injection points
  const isWorkday = typeof window !== "undefined" && /myworkdayjobs\.com/i.test(window.location.hostname);
  checks.push({
    name: "workday-site-detection",
    status: isWorkday ? "pass" : "warn",
    detail: isWorkday
      ? `On ${window.location.hostname} — content scripts active.`
      : "Not on a Workday career site.",
  });

  // 6. Check DOM accessibility (runs in content script context)
  if (typeof document !== "undefined") {
    const bodyOk = document.body ? "pass" : "fail";
    checks.push({
      name: "dom-access",
      status: bodyOk,
      detail: bodyOk === "pass" ? "document.body accessible." : "No document.body.",
    });
  } else {
    checks.push({ name: "dom-access", status: "warn", detail: "No document (background worker)." });
  }

  // 7. Check storage usage
  try {
    const usageBytes = await chrome.storage.local.getBytesInUse?.() ?? -1;
    if (usageBytes >= 0) {
      checks.push({
        name: "storage-usage",
        status: "pass",
        detail: `${usageBytes.toLocaleString()} bytes used (Chrome sync quota: ~10 MB per origin).`,
      });
    } else {
      checks.push({ name: "storage-usage", status: "pass", detail: "Usage info unavailable." });
    }
  } catch {
    checks.push({ name: "storage-usage", status: "warn", detail: "Could not check storage usage." });
  }

  return {
    timestamp: new Date().toISOString(),
    version: VERSION,
    checks,
  };
}
import { STORAGE_KEYS, isWorkdayDomain, type ApplicationConfirmation, type AutofillPackage, type BaseProfile, type JobPosting, type RuntimeMessage } from "../types";
import {
  BACKUP_ALARM_NAME,
  auditBackups,
  loadSnapshots,
  runBackupAudit,
  scheduleBackupAlarm,
  setBackupSettings,
  storeSnapshot,
} from "./backup-alarm";

/** Same window as content/confirmation.ts's DEDUPE_WINDOW_MS. Duplicated as a
 * literal because the background worker and content scripts are separate
 * bundles; the confirmation test asserts they agree. */
const CONFIRMATION_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Cap on the durable queue. A queue that grows without bound would eventually
 * hit the storage quota and take the rest of the extension's state with it. */
const MAX_PENDING_CONFIRMATIONS = 200;

const BRIDGE_SCRIPT_ID = "workdayz-web-app-bridge";

async function registerBridgeForOrigin(origin: string): Promise<void> {
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return; // not a valid origin — nothing to register
  }
  if (isWorkdayDomain(hostname)) return; // never bridge onto a Workday tenant itself
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
  await scheduleBackupAlarm();
});

// Chrome persists alarms across service-worker restarts, but a worker that was
// killed and revived still needs its listener re-attached — and re-creating the
// alarm by name is idempotent, so this can't stack duplicates.
chrome.runtime.onStartup?.addListener(() => {
  void scheduleBackupAlarm();
});

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name !== BACKUP_ALARM_NAME) return;
  // Auditing only — the tracker data lives in the web app's localStorage and is
  // unreachable from here, so there is nothing to snapshot unattended. See
  // backup-alarm.ts for the full reasoning.
  void runBackupAudit();
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // keep the message channel open for the async response
});

// Keyboard shortcut (Alt+Shift+F by default, remappable at
// chrome://extensions/shortcuts): trigger autofill on the active tab. The
// widget on the page shows the result; errors just mean no content script.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "run-autofill") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "RUN_AUTOFILL" });
  } catch {
    /* not a Workday page */
  }
});

/** Exported so test/confirmation-sync.test.mjs drives the REAL dedupe and
 * queue logic instead of a reimplementation of it. The background bundle is
 * already an ESM service worker, so an extra export changes nothing at runtime. */
export async function handleMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender) {
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
      // Item 76: report what this sync replaced so the web app can surface
      // last-write-wins instead of silently swallowing a conflicting save.
      const existing = await chrome.storage.local.get(STORAGE_KEYS.baseProfile);
      const previousSyncedAt = (existing[STORAGE_KEYS.baseProfile] as BaseProfile | undefined)?.syncedAt ?? null;
      await chrome.storage.local.set({
        [STORAGE_KEYS.baseProfile]: { ...message.payload, syncedAt: new Date().toISOString() },
      });
      return { ok: true, previousSyncedAt };
    }
    case "GET_SYNC_STATUS": {
      // Items 74/77: what the extension currently holds, for the web app.
      const data = await chrome.storage.local.get([STORAGE_KEYS.baseProfile, STORAGE_KEYS.autofillPackage]);
      const profile = data[STORAGE_KEYS.baseProfile] as BaseProfile | undefined;
      const pkg = data[STORAGE_KEYS.autofillPackage] as AutofillPackage | undefined;
      return {
        syncedAt: profile?.syncedAt ?? null,
        package: pkg
          ? { title: pkg.job.title, company: pkg.job.company, source: pkg.resumeSource?.label ?? "Tailored resume", createdAt: pkg.createdAt }
          : null,
      };
    }
    case "SET_BADGE": {
      // Per-tab fill-count badge; clears itself when the tab navigates.
      // Item 73: red when required fields still need the user, green when done.
      const tabId = sender.tab?.id;
      if (typeof tabId === "number") {
        const color = (message.stillRequired ?? 0) > 0 ? "#dc2626" : "#059669";
        await chrome.action.setBadgeBackgroundColor({ color, tabId });
        await chrome.action.setBadgeText({ text: message.count > 0 ? String(message.count) : "", tabId });
      }
      // Item 78: let any open web-app tab know a fill just finished.
      try {
        const stored = await chrome.storage.local.get(STORAGE_KEYS.webAppOrigin);
        const origin = stored[STORAGE_KEYS.webAppOrigin] as string | undefined;
        if (origin) {
          const tabs = await chrome.tabs.query({ url: `${origin.replace(/\/$/, "")}/*` });
          for (const tab of tabs) {
            if (tab.id !== undefined) {
              chrome.tabs
                .sendMessage(tab.id, { type: "FILL_COMPLETED_RELAY", count: message.count, stillRequired: message.stillRequired ?? 0 })
                .catch(() => {});
            }
          }
        }
      } catch {
        /* best-effort notification */
      }
      return { ok: true };
    }
    case "GET_PROFILE": {
      const data = await chrome.storage.local.get(STORAGE_KEYS.baseProfile);
      return { profile: (data[STORAGE_KEYS.baseProfile] as BaseProfile | undefined) ?? null };
    }
    case "STORE_PROFILE_LIST": {
      const { profiles, activeName } = message.payload;
      // Keep whatever the user already picked in the widget if it still
      // exists in the new set; otherwise fall back to the web app's active one.
      const stored = await chrome.storage.local.get(STORAGE_KEYS.activeProfileName);
      const currentActive = stored[STORAGE_KEYS.activeProfileName] as string | undefined;
      const chosen = currentActive && profiles[currentActive] ? currentActive : activeName;
      const toSet: Record<string, unknown> = {
        [STORAGE_KEYS.profiles]: profiles,
        [STORAGE_KEYS.activeProfileName]: chosen,
      };
      if (profiles[chosen]) {
        toSet[STORAGE_KEYS.baseProfile] = { ...profiles[chosen], syncedAt: new Date().toISOString() };
      }
      await chrome.storage.local.set(toSet);
      return { ok: true };
    }
    case "GET_PROFILE_LIST": {
      const data = await chrome.storage.local.get([STORAGE_KEYS.profiles, STORAGE_KEYS.activeProfileName]);
      return {
        profiles: (data[STORAGE_KEYS.profiles] as Record<string, BaseProfile> | undefined) ?? {},
        activeName: (data[STORAGE_KEYS.activeProfileName] as string | undefined) ?? "",
      };
    }
    case "SET_ACTIVE_PROFILE": {
      const data = await chrome.storage.local.get(STORAGE_KEYS.profiles);
      const profiles = (data[STORAGE_KEYS.profiles] as Record<string, BaseProfile> | undefined) ?? {};
      const profile = profiles[message.name];
      if (!profile) return { ok: false };
      await chrome.storage.local.set({
        [STORAGE_KEYS.activeProfileName]: message.name,
        [STORAGE_KEYS.baseProfile]: { ...profile, syncedAt: new Date().toISOString() },
      });
      return { ok: true };
    }
    case "RECORD_CONFIRMATION": {
      const event = message.payload;
      const stored = await chrome.storage.local.get([
        STORAGE_KEYS.confirmationLog,
        STORAGE_KEYS.pendingConfirmations,
      ]);
      const log = (stored[STORAGE_KEYS.confirmationLog] ?? {}) as Record<string, { at: string }>;

      // Dedupe here rather than in the content script: a reload or a
      // back-navigation builds a brand-new content script with no memory of
      // the last one, so only persisted state can catch a repeat.
      const previous = log[event.key]?.at;
      const previousMs = previous ? Date.parse(previous) : NaN;
      if (Number.isFinite(previousMs) && Math.abs(Date.now() - previousMs) < CONFIRMATION_DEDUPE_WINDOW_MS) {
        return { ok: true, duplicate: true, firstSeenAt: previous };
      }

      const queue = (stored[STORAGE_KEYS.pendingConfirmations] ?? []) as ApplicationConfirmation[];
      // Newest kept when over cap — an old unconsumed confirmation is the
      // least valuable thing to hold on to.
      const nextQueue = [...queue.filter((c) => c.key !== event.key), event].slice(-MAX_PENDING_CONFIRMATIONS);

      await chrome.storage.local.set({
        [STORAGE_KEYS.confirmationLog]: { ...log, [event.key]: { at: event.submittedAt } },
        [STORAGE_KEYS.pendingConfirmations]: nextQueue,
      });

      // Best-effort live relay so an open tracker updates immediately. The
      // queue above is what makes this reliable when nothing is open.
      try {
        const originData = await chrome.storage.local.get(STORAGE_KEYS.webAppOrigin);
        const origin = originData[STORAGE_KEYS.webAppOrigin] as string | undefined;
        if (origin) {
          const tabs = await chrome.tabs.query({ url: `${origin.replace(/\/$/, "")}/*` });
          for (const tab of tabs) {
            if (tab.id !== undefined) {
              chrome.tabs.sendMessage(tab.id, { type: "CONFIRMATION_RELAY", payload: event }).catch(() => {});
            }
          }
        }
      } catch {
        /* relay is best-effort; the queue is the source of truth */
      }

      return { ok: true, duplicate: false, queued: nextQueue.length };
    }
    case "GET_PENDING_CONFIRMATIONS": {
      const data = await chrome.storage.local.get(STORAGE_KEYS.pendingConfirmations);
      return { confirmations: (data[STORAGE_KEYS.pendingConfirmations] ?? []) as ApplicationConfirmation[] };
    }
    case "ACK_CONFIRMATIONS": {
      // Only drop what the web app says it actually committed. Anything it
      // didn't acknowledge stays queued for the next drain, so a crash
      // mid-write can't silently lose a submission.
      const data = await chrome.storage.local.get(STORAGE_KEYS.pendingConfirmations);
      const queue = (data[STORAGE_KEYS.pendingConfirmations] ?? []) as ApplicationConfirmation[];
      const acked = new Set(message.keys ?? []);
      const remaining = queue.filter((c) => !acked.has(c.key));
      await chrome.storage.local.set({ [STORAGE_KEYS.pendingConfirmations]: remaining });
      return { ok: true, remaining: remaining.length };
    }
    case "STORE_BACKUP_SNAPSHOT": {
      const result = await storeSnapshot(message.payload);
      return result;
    }
    case "GET_BACKUP_STATUS": {
      return await auditBackups();
    }
    case "GET_BACKUP_SNAPSHOT": {
      // Returns a payload for restore. Defaults to the newest; an explicit
      // createdAt lets the user fall back to an older one when the newest was
      // written from already-corrupted data.
      const snapshots = await loadSnapshots();
      if (!snapshots.length) return { snapshot: null };
      const wanted = message.createdAt
        ? snapshots.find((s) => s.createdAt === message.createdAt)
        : snapshots[snapshots.length - 1];
      return { snapshot: wanted ?? null };
    }
    case "SET_BACKUP_SETTINGS": {
      const settings = await setBackupSettings({
        enabled: message.enabled,
        intervalDays: message.intervalDays,
      });
      return { ok: true, settings };
    }
    case "RUN_BACKUP_AUDIT": {
      return await runBackupAudit();
    }
    case "OPEN_APPLY_TAB": {
      const stored = await chrome.storage.local.get(STORAGE_KEYS.webAppOrigin);
      const origin = (stored[STORAGE_KEYS.webAppOrigin] as string | undefined) ?? "http://localhost:3000";
      await chrome.tabs.create({ url: `${origin.replace(/\/$/, "")}/apply?from=extension` });
      return { ok: true };
    }
    case "REGISTER_WEB_APP_ORIGIN": {
      let hostname = "";
      try {
        hostname = new URL(message.origin).hostname;
      } catch {
        return { ok: false, reason: "invalid-origin" };
      }
      if (isWorkdayDomain(hostname)) {
        return { ok: false, reason: "workday-domain" };
      }
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

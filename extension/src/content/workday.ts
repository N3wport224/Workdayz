import type { AutofillPackage, JobPosting, RuntimeMessage } from "../types";
import { isJobPostingPage, scrapeJobPosting } from "./job-scraper";
import { looksLikeApplicationForm, runAutofill } from "./autofill";
import { addButton, mountWidget } from "./widget";

// Workday's career sites are heavily client-rendered SPAs: content can
// change from "job posting" to "application form" (or load asynchronously
// after this script first runs) without a full page navigation. We
// re-evaluate on both history API activity and DOM mutations, debounced, so
// the widget appears/updates without needing a reload.

type Mode = "none" | "job-posting" | "application-form";
let currentMode: Mode = "none";

async function sendMessage<T = unknown>(message: RuntimeMessage): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

function unmountWidget() {
  document.getElementById("workdayz-widget-host")?.remove();
}

function initJobPostingWidget() {
  const widget = mountWidget("Workdayz");
  widget.setStatus("Ready to tailor your resume for this posting.");
  addButton(widget.root, "Tailor with Workdayz →", async () => {
    const job: JobPosting = scrapeJobPosting();
    if (!job.description || job.description.length < 50) {
      widget.setStatus("Couldn't find a job description on this page — copy/paste it manually into the web app instead.");
      return;
    }
    widget.setStatus(`Scraped "${job.title}". Opening the tailoring app...`);
    try {
      await sendMessage({ type: "STORE_SCRAPED_JOB", payload: job });
      await sendMessage({ type: "OPEN_APPLY_TAB" });
    } catch {
      // Extension was reloaded since this script was injected.
      widget.setStatus("The extension was updated — reload this page and try again.");
    }
  });
}

async function runAutofillNow(widget: { setStatus(text: string): void }) {
  const { pkg } = await sendMessage<{ pkg: AutofillPackage | null }>({ type: "GET_AUTOFILL_PACKAGE" });
  if (!pkg) {
    widget.setStatus("No tailored application yet. Generate one in the Workdayz web app first.");
    return null;
  }
  widget.setStatus(`Filling from "${pkg.job.title}" at ${pkg.job.company} (ATS ${pkg.atsScore}/100)...`);
  const result = runAutofill(pkg);
  const parts = [`Filled ${result.filled.length} field group(s)`];
  if (result.filesAttached.length) parts.push(`attached ${result.filesAttached.join(" & ")}`);
  if (result.skipped.length) parts.push(`couldn't find: ${result.skipped.join(", ")}`);
  widget.setStatus(`${parts.join(". ")}. Review before continuing — nothing is submitted automatically.`);
  return result;
}

function initApplicationFormWidget() {
  const widget = mountWidget("Workdayz");
  widget.setStatus("Checking for a tailored application...");

  sendMessage<{ pkg: AutofillPackage | null }>({ type: "GET_AUTOFILL_PACKAGE" }).then(({ pkg }) => {
    widget.setStatus(
      pkg
        ? `Ready: "${pkg.job.title}" at ${pkg.job.company} (ATS ${pkg.atsScore}/100).`
        : "No tailored application yet. Generate one in the Workdayz web app first.",
    );
  });

  const runBtn = addButton(widget.root, "Autofill this step", async () => {
    runBtn.disabled = true;
    try {
      await runAutofillNow(widget);
    } catch {
      widget.setStatus("The extension was updated — reload this page and try again.");
    }
    runBtn.disabled = false;
  });
}

function detectMode(): Mode {
  // Check application-form first: a page can transiently contain posting-like
  // remnants while the SPA is mid-transition into the apply flow.
  if (looksLikeApplicationForm()) return "application-form";
  if (isJobPostingPage()) return "job-posting";
  return "none";
}

function evaluate() {
  const mode = detectMode();
  if (mode === currentMode) return;
  currentMode = mode;
  unmountWidget();
  if (mode === "job-posting") initJobPostingWidget();
  else if (mode === "application-form") initApplicationFormWidget();
}

let debounceTimer: number | undefined;
function scheduleEvaluate() {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(evaluate, 400);
}

// NOTE: patching history.pushState here would be useless — content scripts
// run in an isolated world, so the page's own History calls never touch our
// patched copy. SPA transitions are caught by the MutationObserver instead
// (any meaningful route change mutates the DOM), with popstate/hashchange
// for browser-driven navigation.
window.addEventListener("popstate", scheduleEvaluate);
window.addEventListener("hashchange", scheduleEvaluate);
new MutationObserver(scheduleEvaluate).observe(document.body, { childList: true, subtree: true });

// A popup-triggered autofill can arrive at any time regardless of whether
// our own SPA-transition detection has caught up yet. This script runs in
// every frame (all_frames), and Chrome resolves tabs.sendMessage with the
// FIRST response from any frame — so only the frame that actually contains
// the application form may respond, or an empty frame's "0 filled" answer
// can shadow the real one.
chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === "RUN_AUTOFILL") {
    if (!looksLikeApplicationForm()) return false;
    sendMessage<{ pkg: AutofillPackage | null }>({ type: "GET_AUTOFILL_PACKAGE" }).then(({ pkg }) => {
      if (!pkg) {
        sendResponse({ filled: [], skipped: [], filesAttached: [] });
        return;
      }
      sendResponse(runAutofill(pkg));
    });
    return true;
  }
});

evaluate();

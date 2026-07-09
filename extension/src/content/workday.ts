import type { AutofillPackage, JobPosting, RuntimeMessage } from "../types";
import { isJobPostingPage, scrapeJobPosting } from "./job-scraper";
import { looksLikeApplicationForm, runAutofill } from "./autofill";
import { addButton, mountWidget } from "./widget";

async function sendMessage<T = unknown>(message: RuntimeMessage): Promise<T> {
  return chrome.runtime.sendMessage(message);
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
    await sendMessage({ type: "STORE_SCRAPED_JOB", payload: job });
    await sendMessage({ type: "OPEN_APPLY_TAB" });
  });
}

function initApplicationFormWidget() {
  const widget = mountWidget("Workdayz");
  widget.setStatus("Checking for a tailored application...");

  async function refreshStatus() {
    const { pkg } = await sendMessage<{ pkg: AutofillPackage | null }>({ type: "GET_AUTOFILL_PACKAGE" });
    if (pkg) {
      widget.setStatus(`Ready: "${pkg.job.title}" at ${pkg.job.company} (ATS ${pkg.atsScore}/100).`);
    } else {
      widget.setStatus("No tailored application yet. Generate one in the Workdayz web app first.");
    }
    return pkg;
  }

  const runBtn = addButton(widget.root, "Autofill this step", async () => {
    runBtn.disabled = true;
    const pkg = await refreshStatus();
    if (!pkg) {
      runBtn.disabled = false;
      return;
    }
    const result = runAutofill(pkg);
    const parts = [`Filled ${result.filled.length} field(s)`];
    if (result.filesAttached.length) parts.push(`attached ${result.filesAttached.join(" & ")}`);
    if (result.skipped.length) parts.push(`couldn't find: ${result.skipped.join(", ")}`);
    widget.setStatus(`${parts.join(". ")}. Review before continuing — nothing is submitted automatically.`);
    runBtn.disabled = false;
  });

  refreshStatus();

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.type === "RUN_AUTOFILL") {
      refreshStatus().then((pkg) => {
        if (!pkg) {
          sendResponse({ filled: [], skipped: [], filesAttached: [] });
          return;
        }
        sendResponse(runAutofill(pkg));
      });
      return true;
    }
  });
}

if (isJobPostingPage()) {
  initJobPostingWidget();
} else if (looksLikeApplicationForm()) {
  initApplicationFormWidget();
}

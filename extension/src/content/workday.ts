import { STORAGE_KEYS, type AutofillPackage, type BaseProfile, type CustomFillRule, type JobPosting, type QuestionAnswer, type RuntimeMessage } from "../types";
import { isJobPostingPage, scrapeJobPosting } from "./job-scraper";
import { applyAnswers, buildFieldReport, findQuestionFields, looksLikeApplicationForm } from "./autofill";
import { undoFill } from "./dom-utils";
import { addButton, mountWidget } from "./widget";
import { getSettings } from "./features";
import { runEnhancedAutofill, previewEnhanced } from "./autofill-v2";

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

/** Turns the synced base profile into a fill source: contact/history only —
 * no tailored resume/cover letter files, no drafted content. */
function packageFromProfile(profile: BaseProfile): AutofillPackage {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    job: { title: "", company: "", location: "", description: "" },
    contact: profile.contact,
    summary: profile.summary,
    skills: profile.skills,
    experience: profile.experience,
    education: profile.education,
    certifications: profile.certifications,
    certificationDetails: profile.certificationDetails,
    coverLetterText: "",
    resumePdfBase64: "",
    resumeFileName: "",
    coverLetterPdfBase64: "",
    coverLetterFileName: "",
    atsScore: 0,
  };
}

/** Prefer the job-specific tailored package; fall back to the base profile. */
async function getFillSource(): Promise<{ pkg: AutofillPackage; tailored: boolean } | null> {
  const { pkg } = await sendMessage<{ pkg: AutofillPackage | null }>({ type: "GET_AUTOFILL_PACKAGE" });
  if (pkg) return { pkg, tailored: true };
  const { profile } = await sendMessage<{ profile: BaseProfile | null }>({ type: "GET_PROFILE" });
  if (profile) return { pkg: packageFromProfile(profile), tailored: false };
  return null;
}

/** User-defined answers from the popup — global rules, plus rules saved for
 * THIS tenant's hostname, plus the "How did you hear about us?" default.
 * Tenant rules come last so they win when labels overlap. */
async function getCustomRules(): Promise<CustomFillRule[]> {
  try {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.customRules,
      STORAGE_KEYS.hearAboutUs,
      STORAGE_KEYS.tenantRules,
    ]);
    const rules = Array.isArray(data[STORAGE_KEYS.customRules])
      ? [...(data[STORAGE_KEYS.customRules] as CustomFillRule[])]
      : [];
    const tenants = (data[STORAGE_KEYS.tenantRules] ?? {}) as Record<string, CustomFillRule[]>;
    const forThisHost = tenants[location.hostname];
    if (Array.isArray(forThisHost)) rules.push(...forThisHost);
    const hearAboutUs = data[STORAGE_KEYS.hearAboutUs] as string | undefined;
    if (hearAboutUs?.trim()) {
      rules.push({ label: "how did you hear", value: hearAboutUs.trim() });
    }
    return rules;
  } catch {
    return []; // orphaned script
  }
}

// --- step memory: remember which application pages were already filled ---

function pageKey(): string {
  return `${location.hostname}${location.pathname}`;
}

async function recordFillForPage(filledCount: number): Promise<void> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEYS.fillHistory);
    const history = (data[STORAGE_KEYS.fillHistory] ?? {}) as Record<string, { at: string; filled: number }>;
    history[pageKey()] = { at: new Date().toISOString(), filled: filledCount };
    // Cap the map so it can't grow forever: keep the 50 most recent.
    const entries = Object.entries(history).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 50);
    await chrome.storage.local.set({ [STORAGE_KEYS.fillHistory]: Object.fromEntries(entries) });
  } catch {
    /* orphaned script */
  }
}

async function previousFillForPage(): Promise<{ at: string; filled: number } | null> {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEYS.fillHistory);
    const history = (data[STORAGE_KEYS.fillHistory] ?? {}) as Record<string, { at: string; filled: number }>;
    return history[pageKey()] ?? null;
  } catch {
    return null;
  }
}

/** Days since the package was tailored; a stale one deserves a nudge. */
function packageAgeDays(pkg: AutofillPackage): number {
  return Math.floor((Date.now() - new Date(pkg.createdAt).getTime()) / 86_400_000);
}

function staleWarning(pkg: AutofillPackage, tailored: boolean): string {
  if (!tailored) return "";
  const days = packageAgeDays(pkg);
  return days >= 7
    ? ` ⚠ This package was tailored ${days} days ago — if this is a different posting, re-tailor it in the web app first.`
    : "";
}

async function runAutofillNow(widget: import("./widget").Widget) {
  const source = await getFillSource();
  if (!source) {
    widget.setStatus("Nothing to fill from yet — save your resume profile in the Workdayz web app first.");
    return null;
  }
  widget.setStatus(
    source.tailored
      ? `Filling from "${source.pkg.job.title}" at ${source.pkg.job.company} (ATS ${source.pkg.atsScore}/100)...`
      : "Filling from your base profile...",
  );

  // Show progress for each section
  const totalSections = (source.pkg.experience.length > 0 ? 1 : 0) +
    (source.pkg.education.length > 0 ? 1 : 0) +
    (source.pkg.certificationDetails?.length ? 1 : 0) + 1; // +1 for contact/files
  let completed = 0;

  widget.showProgress("Contact & files", completed, totalSections);
  // Enhanced pipeline: smart formatting, validation, confidence scoring,
  // session tracking, and toasts — see autofill-v2.ts.
  const result = await runEnhancedAutofill(source.pkg, await getCustomRules());
  completed++;

  if (source.pkg.experience.length > 0) {
    widget.showProgress("Work experience", completed, totalSections);
    completed++;
  }
  if (source.pkg.education.length > 0) {
    widget.showProgress("Education", completed, totalSections);
    completed++;
  }
  if (source.pkg.certificationDetails?.length) {
    widget.showProgress("Certifications", completed, totalSections);
    completed++;
  }

  widget.showResult(result);

  const settings = await getSettings();
  const confidenceNote = settings.showConfidenceScore ? ` Fill confidence: ${result.confidence.label}.` : "";
  const suffix = source.tailored
    ? "Review before continuing — nothing is submitted automatically."
    : "Filled from your base profile — tailor this job in the web app to also attach a matched resume & cover letter.";
  widget.setStatus(`${result.filled.length} field group(s) filled.${confidenceNote} ${suffix}${staleWarning(source.pkg, source.tailored)}`);
  // Toolbar badge mirrors the fill count for at-a-glance confirmation.
  sendMessage({ type: "SET_BADGE", count: result.filled.length }).catch(() => {});
  void recordFillForPage(result.filled.length);
  return result;
}

function initApplicationFormWidget() {
  const widget = mountWidget("Workdayz");
  widget.setStatus("Checking for a tailored application...");

  Promise.all([getFillSource(), previousFillForPage(), getSettings()]).then(([source, previous, settings]) => {
    const alreadyFilled = previous
      ? ` You already filled this page (${previous.filled} field group(s), ${new Date(previous.at).toLocaleString()}).`
      : "";
    widget.setStatus(
      source === null
        ? "Nothing to fill from yet — save your resume profile in the Workdayz web app first."
        : source.tailored
          ? `Ready: "${source.pkg.job.title}" at ${source.pkg.job.company} (ATS ${source.pkg.atsScore}/100).${staleWarning(source.pkg, true)}${alreadyFilled}`
          : `Ready to fill from your base profile. Tailor this job in the web app to also attach a matched resume & cover letter.${alreadyFilled}`,
    );
    // Opt-in setting: fill as soon as an application step appears — but only
    // if THIS page hasn't been filled before (step memory prevents re-fill
    // loops on SPA re-renders). Nothing is ever submitted automatically.
    if (settings.autoFillOnPageLoad && source && !previous) {
      widget.setStatus("Auto-fill is on — filling this step…");
      runAutofillNow(widget).catch(() => {
        widget.setStatus("Auto-fill hit an error — use the buttons below to fill manually.");
      });
    }
  });

  addButton(widget.root, "Preview fill (writes nothing)", async () => {
    try {
      const source = await getFillSource();
      if (!source) {
        widget.setStatus("Nothing to preview — save your resume profile in the Workdayz web app first.");
        return;
      }
      const preview = previewEnhanced(source.pkg, await getCustomRules());
      const parts = [
        `Would fill ${preview.wouldFill.length} text field(s) (highlighted with a dashed outline)`,
      ];
      if (preview.files.length) parts.push(`attach ${preview.files.join(" & ")}`);
      if (preview.experiencePanels) parts.push(`fill ${preview.experiencePanels} experience panel(s)`);
      if (preview.educationPanels) parts.push(`fill ${preview.educationPanels} education panel(s)`);
      // Surface what smart formatting would change, so nothing is a surprise.
      const reformatted = preview.incrementalPlan.filter((p) => p.action === "fill" && p.newValue !== String(source.pkg.contact[p.label as keyof typeof source.pkg.contact] ?? p.newValue));
      if (reformatted.length) parts.push(`smart-format ${reformatted.length} value(s)`);
      widget.setStatus(
        `PREVIEW — ${parts.join(", ")}. Dropdowns and split dates resolve during the real fill. Nothing was changed.`,
      );
    } catch {
      widget.setStatus("The extension was updated — reload this page and try again.");
    }
  });

  const runBtn = addButton(widget.root, "Autofill this step", async () => {
    runBtn.disabled = true;
    widget.reset();
    try {
      await runAutofillNow(widget);
    } catch (err) {
      widget.setStatus(
        err instanceof Error && /timed out/i.test(err.message)
          ? `${err.message} — the page may be loading slowly; try again.`
          : "The extension was updated — reload this page and try again.",
      );
    }
    runBtn.disabled = false;
  });

  const answersBtn = addButton(widget.root, "Draft answers to questions", async () => {
    answersBtn.disabled = true;
    try {
      const questionFields = findQuestionFields();
      if (questionFields.length === 0) {
        widget.setStatus(
          "No unanswered question fields found on this step (self-ID questions are always left to you).",
        );
        return;
      }
      widget.setStatus(`Drafting answers to ${questionFields.length} question(s)... (10-30s)`);
      const response = await sendMessage<{ answers?: QuestionAnswer[]; error?: string }>({
        type: "ANSWER_QUESTIONS",
        questions: questionFields.map((q) => q.label),
      });
      if (response.error || !response.answers) {
        widget.setStatus(response.error ?? "Answer drafting failed.");
        return;
      }
      // Workday's SPA may have re-rendered during the 10-30s LLM call,
      // detaching the elements we scraped. Re-find the fields and align
      // answers by label (falling back to nothing rather than guessing).
      const byLabel = new Map(response.answers.map((a) => [a.question, a.answer]));
      const freshFields = findQuestionFields();
      const aligned = freshFields.map((f) => ({ question: f.label, answer: byLabel.get(f.label) ?? "" }));
      const filled = applyAnswers(freshFields, aligned);
      widget.setStatus(
        `Drafted ${filled} answer(s). REVIEW EACH ONE before continuing — anything marked "[NEEDS YOUR INPUT]" is yours to fill in.`,
      );
    } catch {
      widget.setStatus("The extension was updated — reload this page and try again.");
    } finally {
      answersBtn.disabled = false;
    }
  });

  addButton(widget.root, "Undo last fill", () => {
    const restored = undoFill();
    widget.setStatus(
      restored
        ? `Restored ${restored} field(s) to their previous values. (Dropdown selections made via option clicks can't be undone automatically.)`
        : "Nothing to undo — run an autofill first.",
    );
  });

  addButton(widget.root, "Copy field report", async () => {
    try {
      await navigator.clipboard.writeText(buildFieldReport());
      widget.setStatus(
        "Field report copied — paste it into an issue/chat to get unmatched fields supported. It contains only the form's labels, none of your data.",
      );
    } catch {
      widget.setStatus("Couldn't access the clipboard — check the site's clipboard permission.");
    }
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
// Guard: only the top frame responds to prevent shadow-frame interference.
chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === "RUN_AUTOFILL") {
    if (window !== window.top) return false;
    if (!looksLikeApplicationForm()) return false;
    getFillSource().then(async (source) => {
      if (!source) {
        sendResponse({ filled: [], skipped: [], filesAttached: [], leftForYou: [], mismatches: [], stillRequired: [] });
        return;
      }
      // Same enhanced pipeline as the widget button; the result is a superset
      // of AutofillRunSummary so the popup's existing rendering keeps working.
      const result = await runEnhancedAutofill(source.pkg, await getCustomRules());
      sendMessage({ type: "SET_BADGE", count: result.filled.length }).catch(() => {});
      void recordFillForPage(result.filled.length);
      sendResponse(result);
    });
    return true;
  }
});

evaluate();

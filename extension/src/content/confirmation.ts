/**
 * Detects that an application was actually submitted, so the tracker can move
 * it to "Applied" without the user retyping anything.
 *
 * Detection is deliberately conservative. A false positive marks a job as
 * applied when it wasn't — the user then stops chasing an application that was
 * never submitted, which is far more damaging than a missed detection they can
 * fix with one click. So:
 *   - A confirmation URL is trusted on its own.
 *   - DOM-only evidence must appear in a HEADING, not anywhere on the page.
 *     "Application Submitted" inside a list of past applications is not a
 *     confirmation, and the my-applications page is full of that text.
 *   - Anything that still looks like a fillable application form is never a
 *     confirmation, however it is worded.
 *
 * Storage-level dedupe lives in recordConfirmation: the page can re-render
 * many times, and a reload or back-navigation creates a whole new content
 * script whose in-memory state is gone.
 */

import { guessCompanyName } from "./job-scraper";
import { looksLikeApplicationForm } from "./autofill";

export interface ConfirmationDetection {
  /** "url" is self-sufficient; "dom" required a heading-level match. */
  via: "url" | "dom";
  /** The heading or URL fragment that triggered it, for the widget to show. */
  evidence: string;
}

/** URL shapes Workday uses once a submission lands. */
const URL_PATTERNS = [
  /\/job-apply\/confirmation/i,
  /\/applications?\/confirmation/i,
  /\/apply\/(?:confirmation|submitted|thank-?you)/i,
  /\/application-submitted/i,
];

/** Phrases that mean "we received it", not "you may apply". */
const SUCCESS_PHRASES = [
  /\byour application (?:has been |was )?(?:successfully )?submitted\b/i,
  /\bapplication (?:has been |was )?(?:successfully )?submitted\b/i,
  /\bthank you for (?:your interest and )?apply(?:ing)?\b/i,
  /\bthank you for your application\b/i,
  /\bwe(?:'ve| have) received your application\b/i,
  /\byour application is complete\b/i,
  /\bsubmission (?:was )?successful\b/i,
];

/** Only these carry enough weight for a DOM-only detection. */
const HEADING_SELECTORS = [
  'h1', 'h2', 'h3',
  '[role="heading"]',
  '[data-automation-id="confirmationPage"]',
  '[data-automation-id="confirmationMessage"]',
  '[data-automation-id="successMessage"]',
];

function matchesUrl(href: string): string | null {
  for (const pattern of URL_PATTERNS) {
    const hit = href.match(pattern);
    if (hit) return hit[0];
  }
  return null;
}

function matchesHeading(): string | null {
  for (const selector of HEADING_SELECTORS) {
    for (const el of Array.from(document.querySelectorAll(selector))) {
      // A whole page dumped into one <h1> isn't a heading; cap the length so
      // this can't match body copy that merely mentions submitting.
      const raw = (el.textContent ?? "").trim();
      if (!raw || raw.length > 200) continue;
      for (const phrase of SUCCESS_PHRASES) {
        if (phrase.test(raw)) return raw.slice(0, 120);
      }
    }
  }
  return null;
}

/**
 * Pure detection against the current DOM/URL. Returns null when this is not a
 * confirmation page.
 */
export function detectConfirmation(href: string = location.href): ConfirmationDetection | null {
  // A page still offering form fields to fill has not been submitted, no
  // matter what its copy says. Checked first so it can veto both paths.
  if (looksLikeApplicationForm()) return null;

  const urlHit = matchesUrl(href);
  if (urlHit) return { via: "url", evidence: urlHit };

  const headingHit = matchesHeading();
  if (headingHit) return { via: "dom", evidence: headingHit };

  return null;
}

// ---------------------------------------------------------------------------
// Metadata + dedupe
// ---------------------------------------------------------------------------

export interface ConfirmationEvent {
  /** Stable dedupe key — see confirmationKey. */
  key: string;
  company: string;
  title: string;
  /** Requisition/job id when the page or stored context exposes one. */
  jobId: string;
  /** ISO timestamp of detection — the submission moment, near enough. */
  submittedAt: string;
  sourceUrl: string;
  hostname: string;
  via: ConfirmationDetection["via"];
  evidence: string;
}

/** Pulls a requisition id out of the confirmation page or its URL. */
function scrapeJobId(href: string): string {
  const fromDom =
    document.querySelector('[data-automation-id="requisitionId"]')?.textContent?.trim() ||
    document.querySelector('[data-automation-id="requisition-id"]')?.textContent?.trim() ||
    document.querySelector('[data-automation-id="job-id"]')?.textContent?.trim() ||
    "";
  if (fromDom) return fromDom.slice(0, 60);
  // Workday req ids in URLs look like .../Platform-Engineer_JR-98765 or
  // ?jobId=JR_12345. \b can't be used before the prefix: underscore is a word
  // character, so "_JR" has no boundary and the common Workday slug form would
  // never match. An explicit separator class handles "_" while still refusing
  // to find "R-12345" inside a word like "SENIOR-12345".
  const fromUrl = href.match(/(?:^|[^A-Za-z0-9])((?:JR|R)[-_]?\d{3,})(?![A-Za-z0-9])/i);
  return fromUrl?.[1] ?? "";
}

/**
 * Identity of one submission. jobId is the strongest signal; falling back to
 * the title keeps dedupe working on tenants that never expose a req id.
 *
 * Host is included so the same generic title at two employers stays distinct.
 */
export function confirmationKey(parts: { hostname: string; jobId: string; title: string; company: string }): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const identity = parts.jobId ? norm(parts.jobId) : norm(parts.title);
  return `${norm(parts.hostname)}|${norm(parts.company)}|${identity}`;
}

/**
 * Builds the event from the page plus whatever the extension already knows
 * about what the user was applying to. The confirmation page itself usually
 * drops the job title, so the stored package/scraped job is the better source
 * — the page is only a fallback.
 */
export function buildConfirmationEvent(
  detection: ConfirmationDetection,
  context: { title?: string; company?: string } = {},
  href: string = location.href,
  now: string = new Date().toISOString(),
): ConfirmationEvent {
  const hostname = (() => {
    try {
      return new URL(href).hostname;
    } catch {
      return location.hostname;
    }
  })();

  const company = (context.company || guessCompanyName() || hostname).slice(0, 120);
  const title = (context.title || document.title.split(/[-|]/)[0].trim() || "Unknown role").slice(0, 200);
  const jobId = scrapeJobId(href);

  return {
    key: confirmationKey({ hostname, jobId, title, company }),
    company,
    title,
    jobId,
    submittedAt: now,
    sourceUrl: href.slice(0, 500),
    hostname,
    via: detection.via,
    evidence: detection.evidence,
  };
}

/**
 * How long the same key is treated as already-logged. Long enough to absorb
 * reloads, back-navigation, and SPA re-renders; short enough that genuinely
 * re-applying to a req months later still records.
 */
export const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** True when `previousAt` is recent enough that this is a repeat view. */
export function isDuplicate(previousAt: string | undefined, now: number, windowMs = DEDUPE_WINDOW_MS): boolean {
  if (!previousAt) return false;
  const then = Date.parse(previousAt);
  if (!Number.isFinite(then)) return false;
  // A clock that moved backwards shouldn't unlock a duplicate log.
  return Math.abs(now - then) < windowMs;
}

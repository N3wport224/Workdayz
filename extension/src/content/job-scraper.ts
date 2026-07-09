import type { JobPosting } from "../types";

function text(selector: string): string {
  return document.querySelector(selector)?.textContent?.trim() ?? "";
}

function guessCompanyName(): string {
  const meta = document.querySelector('meta[property="og:site_name"]')?.getAttribute("content");
  if (meta) return meta.trim();

  // Workday career sites are typically hosted at <company>.wd#.myworkdayjobs.com
  const host = window.location.hostname;
  const match = host.match(/^([a-z0-9-]+)\.(?:wd\d+\.)?myworkdayjobs\.com$/i);
  if (match) {
    return match[1]
      .split("-")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ");
  }

  const titleParts = document.title.split(/[-|]/);
  return titleParts.length > 1 ? titleParts[titleParts.length - 1].trim() : "";
}

function largestTextBlock(): string {
  let best = "";
  document.querySelectorAll("div, section, article").forEach((el) => {
    const t = el.textContent?.trim() ?? "";
    // Prefer leaf-ish containers: skip if a child already has most of this text.
    if (t.length > best.length && t.length < 20000) best = t;
  });
  return best;
}

export function isJobPostingPage(): boolean {
  return Boolean(
    document.querySelector('[data-automation-id="jobPostingHeader"]') ||
      document.querySelector('[data-automation-id="jobPostingDescription"]'),
  );
}

export function scrapeJobPosting(): JobPosting {
  const title =
    text('[data-automation-id="jobPostingHeader"]') || text("h1") || document.title.split(/[-|]/)[0].trim();

  const description =
    text('[data-automation-id="jobPostingDescription"]') || largestTextBlock();

  const location =
    text('[data-automation-id="locations"]') ||
    text('[data-automation-id="subtitle"]') ||
    text('[data-automation-id="jobPostingLocation"]');

  return {
    title,
    company: guessCompanyName(),
    location,
    description,
    sourceUrl: window.location.href,
  };
}

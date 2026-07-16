import type { JobPosting } from "../types";

function text(selector: string): string {
  return document.querySelector(selector)?.textContent?.trim() ?? "";
}

function textAll(selector: string): string[] {
  return Array.from(document.querySelectorAll(selector)).map((el) => el.textContent?.trim() ?? "").filter(Boolean);
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

/** Extracts structured metadata from Workday's job posting page. */
function extractStructuredData(): Record<string, string> {
  const data: Record<string, string> = {};

  // Workday often embeds JSON-LD structured data
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script.textContent ?? "{}");
      if (parsed?.title) data.title = parsed.title;
      if (parsed?.hiringOrganization?.name) data.company = parsed.hiringOrganization.name;
      if (parsed?.jobLocation?.address?.addressLocality) data.location = parsed.jobLocation.address.addressLocality;
      if (parsed?.datePosted) data.datePosted = parsed.datePosted;
      if (parsed?.employmentType) data.employmentType = parsed.employmentType;
      if (parsed?.description) data.description = parsed.description;
    } catch {
      /* skip malformed JSON-LD */
    }
  }

  return data;
}

export function isJobPostingPage(): boolean {
  return Boolean(
    document.querySelector('[data-automation-id="jobPostingHeader"]') ||
      document.querySelector('[data-automation-id="jobPostingDescription"]') ||
      document.querySelector('[data-automation-id="jobPostingTitle"]') ||
      // Some tenants use different automation-id patterns
      document.querySelector('[id*="job-posting"]') ||
      document.querySelector('[class*="job-posting"]'),
  );
}

export function scrapeJobPosting(): JobPosting {
  const structured = extractStructuredData();

  const title =
    structured.title ||
    text('[data-automation-id="jobPostingHeader"]') ||
    text('[data-automation-id="jobPostingTitle"]') ||
    text("h1") ||
    document.title.split(/[-|]/)[0].trim();

  const description =
    structured.description ||
    text('[data-automation-id="jobPostingDescription"]') ||
    text('[data-automation-id="job-description"]') ||
    text('[class*="job-description"]') ||
    largestTextBlock();

  const location =
    structured.location ||
    text('[data-automation-id="locations"]') ||
    text('[data-automation-id="subtitle"]') ||
    text('[data-automation-id="jobPostingLocation"]') ||
    text('[data-automation-id="location"]');

  const company = structured.company || guessCompanyName();

  // Extract additional metadata for richer context
  const jobId =
    text('[data-automation-id="job-id"]') ||
    text('[data-automation-id="requisition-id"]') ||
    text('[class*="job-id"]') ||
    "";

  const postingDate =
    structured.datePosted ||
    text('[data-automation-id="posted-date"]') ||
    text('[data-automation-id="date-posted"]') ||
    "";

  const employmentType =
    structured.employmentType ||
    text('[data-automation-id="time-type"]') ||
    text('[data-automation-id="job-category"]') ||
    text('[data-automation-id="workplace-type"]') ||
    "";

  // Build a richer description that includes metadata
  let enrichedDescription = description;
  const metaParts: string[] = [];
  if (jobId) metaParts.push(`Job ID: ${jobId}`);
  if (postingDate) metaParts.push(`Posted: ${postingDate}`);
  if (employmentType) metaParts.push(`Type: ${employmentType}`);
  if (metaParts.length > 0) {
    enrichedDescription = `${metaParts.join(" | ")}\n\n${description}`;
  }

  return {
    title,
    company,
    location,
    description: enrichedDescription,
    sourceUrl: window.location.href,
  };
}
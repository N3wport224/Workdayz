import type { AtsScoreBreakdown, ResumeProfile, TailoredResume } from "./types";
import { isPresent, parseFlexibleDate } from "./format-date";

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9+.#\s]/g, " ");
}

// Common abbreviation ↔ expansion pairs an ATS (or recruiter search) treats
// as equivalent. Matched with word boundaries — plain substring matching
// would let "ml" match "html".
const ALIAS_PAIRS: [string, string][] = [
  ["javascript", "js"],
  ["typescript", "ts"],
  ["kubernetes", "k8s"],
  ["amazon web services", "aws"],
  ["google cloud platform", "gcp"],
  ["machine learning", "ml"],
  ["artificial intelligence", "ai"],
  ["continuous integration", "ci cd"],
  ["customer relationship management", "crm"],
  ["search engine optimization", "seo"],
  ["quality assurance", "qa"],
  ["user experience", "ux"],
  ["user interface", "ui"],
  ["business intelligence", "bi"],
  ["structured query language", "sql"],
  ["product manager", "product management"],
  ["project manager", "project management"],
  ["profit and loss", "p&l"],
];

const ALIASES = new Map<string, string[]>();
for (const [a, b] of ALIAS_PAIRS) {
  ALIASES.set(a, [...(ALIASES.get(a) ?? []), b]);
  ALIASES.set(b, [...(ALIASES.get(b) ?? []), a]);
}

function wordBoundaryHit(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(haystack);
}

/** Direct substring match, or a known-equivalent alias on a word boundary. */
function matchesText(haystack: string, needle: string): boolean {
  if (haystack.includes(needle)) return true;
  return (ALIASES.get(needle) ?? []).some((alias) => wordBoundaryHit(haystack, alias));
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function resumeText(resume: TailoredResume): string {
  return [
    resume.summary,
    resume.skills.join(" "),
    resume.experience.flatMap((e) => e.bullets).join(" "),
  ].join(" ");
}

function profileText(profile: ResumeProfile): string {
  return [
    profile.summary,
    profile.skills.join(" "),
    // Titles/companies count as evidence too — "Engineering Manager" should
    // verify a "management" skill.
    profile.experience.flatMap((e) => [e.title, e.company, ...e.bullets]).join(" "),
    profile.certifications.join(" "),
  ].join(" ");
}

/**
 * Deterministic ATS scoring: keyword coverage (extracted by the model from
 * the job description) plus a handful of formatting/structure heuristics
 * recruiters' ATS parsers commonly penalize. We don't trust the model's own
 * arithmetic — the score is computed here in code.
 */
export function computeAtsScore(
  keywords: string[],
  tailored: TailoredResume,
  profile: ResumeProfile,
  /** When provided, keywords found in the job TITLE weigh double and ones
   * repeated ≥3× in the description weigh 1.5× — missing what the posting
   * leads with hurts more than missing a passing mention. */
  job?: { title: string; description: string },
): AtsScoreBreakdown {
  const haystack = normalize(resumeText(tailored));
  const titleText = job ? normalize(job.title) : "";
  const descriptionText = job ? normalize(job.description) : "";
  const matched: string[] = [];
  const missing: string[] = [];
  let matchedWeight = 0;
  let totalWeight = 0;

  // Dedupe by normalized form and drop blanks BEFORE scoring — duplicate
  // keywords from the model would otherwise double-count in the score (and
  // collide as React keys in the chip list), while blank ones would inflate
  // the denominator.
  const seen = new Set<string>();
  for (const kw of keywords) {
    const needle = normalize(kw).trim();
    if (!needle || seen.has(needle)) continue;
    seen.add(needle);
    const weight = !job
      ? 1
      : matchesText(titleText, needle)
        ? 2
        : countOccurrences(descriptionText, needle) >= 3
          ? 1.5
          : 1;
    totalWeight += weight;
    if (matchesText(haystack, needle)) {
      matched.push(kw);
      matchedWeight += weight;
    } else {
      missing.push(kw);
    }
  }

  const totalKeywords = matched.length + missing.length;
  const keywordCoverage = totalWeight ? matchedWeight / totalWeight : 1;

  const formattingIssues: string[] = [];
  if (!tailored.summary || tailored.summary.split(/\s+/).length < 15) {
    formattingIssues.push(
      "Summary is short or missing — aim for 2-4 sentences covering your top qualifications.",
    );
  }
  const totalBullets = tailored.experience.reduce(
    (sum, e) => sum + e.bullets.length,
    0,
  );
  if (totalBullets === 0) {
    formattingIssues.push("No experience bullets were generated.");
  }
  const bulletsWithNumbers = tailored.experience
    .flatMap((e) => e.bullets)
    .filter((b) => /\d/.test(b)).length;
  if (totalBullets > 0 && bulletsWithNumbers / totalBullets < 0.3) {
    formattingIssues.push(
      "Few bullets contain quantified results (numbers, %, $). ATS-friendly resumes and human reviewers both respond better to measurable impact.",
    );
  }
  if (tailored.skills.length < 5) {
    formattingIssues.push(
      "Fewer than 5 skills listed — add more relevant keywords from the job description if truthful.",
    );
  }

  // Structural parseability: an ATS that can't find your contact info or read
  // your dates may drop the data entirely, regardless of keyword match.
  if (!profile.contact.email.trim() && !profile.contact.phone.trim()) {
    formattingIssues.push(
      "No email or phone in your contact info — an ATS can't route your application. Add at least one on the Resume page.",
    );
  }
  const undatedRoles = profile.experience.filter((e) => {
    const start = (e.startDate ?? "").trim();
    return !start || (parseFlexibleDate(start) === null && !isPresent(start));
  }).length;
  if (profile.experience.length > 0 && undatedRoles > 0) {
    formattingIssues.push(
      `${undatedRoles} of ${profile.experience.length} experience entr${
        profile.experience.length === 1 ? "y has" : "ies have"
      } a missing or unreadable date — ATS parsers may not read these roles. Use MM/YYYY (e.g. 06/2021).`,
    );
  }

  // Integrity guard: flag any skill the model added that doesn't appear
  // anywhere in the source profile, so the user can verify before it goes
  // out under their name.
  const sourceText = normalize(profileText(profile));
  const unverifiedSkills = tailored.skills.filter(
    (skill) => !sourceText.includes(normalize(skill).trim()),
  );

  const formattingPenalty = formattingIssues.length * 0.04;
  const rawScore = keywordCoverage - formattingPenalty;
  const score = Math.round(Math.max(0, Math.min(1, rawScore)) * 100);

  const notes: string[] = [];
  notes.push(
    `${matched.length}/${totalKeywords} job keywords found in your tailored resume.`,
  );
  if (unverifiedSkills.length) {
    notes.push(
      `Verify before submitting — these skills were added but weren't found in your original resume: ${unverifiedSkills.join(", ")}.`,
    );
  }

  return {
    score,
    matchedKeywords: matched,
    missingKeywords: missing,
    formattingIssues,
    notes: notes.join(" "),
  };
}

/**
 * Deterministic ATS keyword scoring engine.
 * 
 * Scores a tailored resume against a job description by counting keyword
 * matches, with weighted scoring for title keywords and repeated terms.
 * Includes an integrity check that flags skills not traceable to the
 * original profile.
 */

import type { AtsBreakdown, ResumeProfile } from "./types";

// Known technical aliases — expands matching beyond literal strings
const ALIASES: Record<string, string[]> = {
  k8s: ["kubernetes", "k8"],
  ml: ["machine learning"],
  ai: ["artificial intelligence"],
  ux: ["user experience"],
  ui: ["user interface"],
  db: ["database", "databases"],
  sre: ["site reliability engineering", "site reliability"],
  cicd: ["ci/cd", "continuous integration", "continuous deployment"],
  iac: ["infrastructure as code", "infrastructure-as-code"],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+#._/-]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return normalize(text).split(/\s+/).filter(Boolean);
}

function expandTerms(terms: string[]): Set<string> {
  const set = new Set<string>();
  for (const term of terms) {
    set.add(normalize(term));
    const alias = ALIASES[normalize(term)];
    if (alias) alias.forEach((a) => set.add(normalize(a)));
  }
  return set;
}

function extractKeywords(text: string): { term: string; weight: number }[] {
  const freq = new Map<string, { count: number; weight: number }>();

  // Multi-word phrases (1-4 words)
  const words = normalize(text).split(/\s+/);
  for (let len = 1; len <= 4; len++) {
    for (let i = 0; i <= words.length - len; i++) {
      const phrase = words.slice(i, i + len).join(" ");
      if (phrase.length < 2) continue;
      const count = freq.get(phrase)?.count ?? 0;
      const baseWeight = len === 1 ? 1 : 1.2; // phrases weigh more
      // Repeated 3+ times → 1.5× weight
      const weight = baseWeight * (count >= 3 ? 1.5 : 1);
      freq.set(phrase, { count: count + 1, weight });
    }
  }

  return Array.from(freq.entries())
    .filter(([, meta]) => meta.count > 0) // keep everything for now
    .map(([term, meta]) => ({ term, weight: meta.weight }));
}

export function scoreResume(
  jobDescription: string,
  jobTitle: string,
  tailoredSummary: string,
  tailoredSkills: string[],
  tailoredBullets: string[],
  originalProfile: ResumeProfile,
): AtsBreakdown {
  // Extract weighted keywords from job description
  const jdKeywords = extractKeywords(jobDescription);

  // Title keywords get 2× weight
  const titleWords = expandTerms(tokenize(jobTitle));

  // Build the candidate text from the tailored output
  const candidateText = [
    tailoredSummary,
    ...tailoredSkills,
    ...tailoredBullets,
  ].join(" ");
  const candidateTokens = expandTerms(tokenize(candidateText));

  // Original profile tokens for integrity check
  const originalTokens = expandTerms(tokenize([
    originalProfile.summary,
    ...originalProfile.skills,
    ...originalProfile.experience.flatMap((e) => [e.title, e.company, ...e.bullets]),
    ...originalProfile.education.flatMap((e) => [e.school, e.degree, e.fieldOfStudy]),
    ...originalProfile.certifications.map((c) => c.name),
  ].join(" ")));

  const matched: string[] = [];
  const missing: string[] = [];
  const integrityFlags: string[] = [];

  let matchedScore = 0;
  let totalScore = 0;

  for (const { term, weight } of jdKeywords) {
    if (term.length < 3) continue; // skip very short terms
    const expanded = expandTerms([term]);
    const isTitleWord = titleWords.has(normalize(term));
    const finalWeight = weight * (isTitleWord ? 2 : 1);
    totalScore += finalWeight;

    const isMatched = Array.from(expanded).some((t) => candidateTokens.has(t));
    if (isMatched) {
      matched.push(term);
      matchedScore += finalWeight;
    } else {
      missing.push(term);
    }
  }

  // Integrity check: flag skills in tailored output not in original profile
  for (const skill of tailoredSkills) {
    const normalized = normalize(skill);
    if (!originalTokens.has(normalized) && normalized.length > 3) {
      integrityFlags.push(`"${skill}" doesn't appear in your original profile`);
    }
  }

  const score = totalScore > 0 ? Math.round((matchedScore / totalScore) * 100) : 0;

  return {
    totalKeywords: totalScore,
    matchedKeywords: matchedScore,
    matched,
    missing,
    score,
    integrityFlags,
  };
}

// ---------------------------------------------------------------------------
// Item 34: per-section parseability readiness
// ---------------------------------------------------------------------------
export interface SectionReadiness {
  section: string;
  status: "ok" | "warn" | "missing";
  detail: string;
}

export function sectionReadiness(profile: ResumeProfile): SectionReadiness[] {
  const out: SectionReadiness[] = [];

  const hasEmail = Boolean(profile.contact.email.trim());
  const hasPhone = Boolean(profile.contact.phone.trim());
  out.push({
    section: "Contact",
    status: hasEmail || hasPhone ? (hasEmail && hasPhone ? "ok" : "warn") : "missing",
    detail: hasEmail && hasPhone ? "Email + phone present" : hasEmail || hasPhone ? "Only one of email/phone" : "No email or phone — an ATS can't route you",
  });

  const datedRoles = profile.experience.filter((e) => /\d{4}/.test(e.startDate ?? ""));
  out.push({
    section: "Experience",
    status: profile.experience.length === 0 ? "missing" : datedRoles.length === profile.experience.length ? "ok" : "warn",
    detail:
      profile.experience.length === 0
        ? "No roles"
        : `${datedRoles.length}/${profile.experience.length} roles have readable dates`,
  });

  out.push({
    section: "Education",
    status: profile.education.length ? "ok" : "warn",
    detail: profile.education.length ? `${profile.education.length} entr(ies)` : "None listed",
  });

  out.push({
    section: "Skills",
    status: profile.skills.length >= 5 ? "ok" : profile.skills.length ? "warn" : "missing",
    detail: `${profile.skills.length} skill(s)${profile.skills.length < 5 ? " — aim for 5+" : ""}`,
  });

  out.push({
    section: "Certifications",
    status: profile.certifications.length ? "ok" : "warn",
    detail: profile.certifications.length ? `${profile.certifications.length} cert(s)` : "None — fine if you have none",
  });

  return out;
}

// ---------------------------------------------------------------------------
// Item 35: ranked, actionable "what would raise my score" suggestions
// ---------------------------------------------------------------------------
export function suggestImprovements(
  jobDescription: string,
  jobTitle: string,
  breakdown: AtsBreakdown,
): { suggestion: string; impact: "high" | "medium" | "low" }[] {
  const jd = normalize(jobDescription);
  const title = normalize(jobTitle);
  const ranked = breakdown.missing
    .map((kw) => {
      const needle = normalize(kw);
      const inTitle = title.includes(needle);
      let count = 0;
      let idx = jd.indexOf(needle);
      while (idx !== -1) {
        count += 1;
        idx = jd.indexOf(needle, idx + needle.length);
      }
      return { kw, inTitle, count };
    })
    .sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || b.count - a.count)
    .slice(0, 8)
    .map(({ kw, inTitle, count }) => ({
      suggestion: inTitle
        ? `Work "${kw}" into your summary or a bullet — it's in the job TITLE, the biggest single lift.`
        : count >= 3
          ? `Add "${kw}" if truthful — the posting repeats it ${count}×.`
          : `Consider "${kw}" — mentioned in the description.`,
      impact: (inTitle ? "high" : count >= 3 ? "medium" : "low") as "high" | "medium" | "low",
    }));

  for (const flag of breakdown.integrityFlags.slice(0, 2)) {
    ranked.push({ suggestion: `Integrity: ${flag} — remove it or back it with a real bullet.`, impact: "high" });
  }
  return ranked;
}

// ---------------------------------------------------------------------------
// Item 38: sections the JD emphasizes that the resume barely covers
// ---------------------------------------------------------------------------
export function thinSections(jobDescription: string, profile: ResumeProfile): string[] {
  const jd = jobDescription.toLowerCase();
  const flags: string[] = [];
  if (/certif|license/.test(jd) && profile.certifications.length === 0) {
    flags.push("The posting mentions certifications/licenses but your profile lists none.");
  }
  if (/\b(degree|bachelor|associate|diploma)\b/.test(jd) && profile.education.length === 0) {
    flags.push("The posting mentions a degree but your profile has no education entries.");
  }
  const years = jd.match(/(\d+)\+?\s*years?/);
  if (years && profile.experience.length === 0) {
    flags.push(`The posting asks for ${years[1]}+ years of experience but your profile has no roles.`);
  }
  if (/\b(portfolio|github|work samples)\b/.test(jd) && !profile.contact.website && (profile.projects?.length ?? 0) === 0) {
    flags.push("The posting mentions a portfolio/samples but your profile has no website or projects.");
  }
  return flags;
}

export function formatScoreColor(score: number): string {
  if (score >= 80) return "#059669"; // green
  if (score >= 60) return "#d97706"; // amber
  return "#dc2626"; // red
}

export function scoreLabel(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Strong";
  if (score >= 70) return "Good";
  if (score >= 60) return "Fair";
  if (score >= 40) return "Below Average";
  return "Needs Work";
}
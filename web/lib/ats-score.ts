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
  const tokens = tokenize(text);
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
    .filter(([_, meta]) => meta.count > 0) // keep everything for now
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
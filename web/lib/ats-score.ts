import type { AtsScoreBreakdown, ResumeProfile, TailoredResume } from "./types";

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9+.#\s]/g, " ");
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
): AtsScoreBreakdown {
  const haystack = normalize(resumeText(tailored));
  const matched: string[] = [];
  const missing: string[] = [];

  // Dedupe by normalized form and drop blanks BEFORE scoring — duplicate
  // keywords from the model would otherwise double-count in the score (and
  // collide as React keys in the chip list), while blank ones would inflate
  // the denominator.
  const seen = new Set<string>();
  for (const kw of keywords) {
    const needle = normalize(kw).trim();
    if (!needle || seen.has(needle)) continue;
    seen.add(needle);
    if (haystack.includes(needle)) {
      matched.push(kw);
    } else {
      missing.push(kw);
    }
  }

  const totalKeywords = matched.length + missing.length;
  const keywordCoverage = totalKeywords ? matched.length / totalKeywords : 1;

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

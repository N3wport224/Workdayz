/**
 * Deterministic bullet ranking: picks which of a role's bullets to actually
 * show for a given posting, by keyword overlap against that posting.
 *
 * Free, instant, and testable — no LLM call. It scores against the SAME
 * keyword engine as ats-score.ts (same normalizer, same alias table, same
 * title-doubling), so a bullet this module calls "most relevant" is a bullet
 * that genuinely moves the ATS score. An LLM pass can reorder these afterwards
 * (see refine-bullet-ranking.ts), but the deterministic pass is always the
 * baseline and always runs.
 *
 * Two properties worth stating because they're easy to get wrong:
 *   - Scores are LENGTH-NORMALIZED. Raw overlap makes the longest bullet win
 *     every time, which is the opposite of useful on a resume.
 *   - Selection is STABLE. Equal scores keep the candidate's original bullet
 *     order rather than reshuffling, so re-running is not a diff.
 */

import { expandTerms, extractKeywords, normalize, tokenize } from "./ats-score";
import { analyzeBullet } from "./bullet-strength";
import type { ExperienceEntry } from "./types";

export interface RankedBullet {
  /** Index of this bullet within its source role, so callers can map back. */
  index: number;
  text: string;
  /** Length-normalized relevance, 0-100. Comparable within one ranking call. */
  score: number;
  /** Job-description keywords this bullet actually hits — the "why". */
  matchedKeywords: string[];
  /** From bullet-strength.ts: quantified/action-verb/length quality. */
  strength: "strong" | "ok" | "weak";
}

export interface RankedRole {
  /** ExperienceEntry.id, so a caller can line results back up with the profile. */
  roleId: string;
  title: string;
  company: string;
  /** Every bullet, best first. */
  ranked: RankedBullet[];
  /** The subset to actually show, honoring minKeep/maxKeep. */
  selected: RankedBullet[];
}

export interface RankBulletsOptions {
  /**
   * Most bullets to keep per role. The 3-5 range is the resume convention;
   * defaults to 5 so nothing is dropped silently on a typical role.
   */
  maxKeep?: number;
  /**
   * Fewest to keep even when relevance is poor — a role showing zero bullets
   * reads as a gap in your history, which is worse than a weak bullet.
   */
  minKeep?: number;
  /**
   * Bullets scoring below this are eligible to be dropped (above minKeep).
   * 0 keeps everything up to maxKeep.
   */
  minScore?: number;
}

const DEFAULTS: Required<RankBulletsOptions> = { maxKeep: 5, minKeep: 2, minScore: 0 };

/** Terms this short are noise ("of", "to", "a") — matches scoreResume's floor. */
const MIN_TERM_CHARS = 3;

/** Quality nudge, deliberately small: relevance to THIS posting is the point,
 * and a strong-but-irrelevant bullet should still lose to a relevant one. */
const STRENGTH_BONUS = { strong: 1.08, ok: 1.0, weak: 0.94 } as const;

/**
 * Precomputed job-posting keyword weights. Built once per posting and reused
 * across every role, since extractKeywords over a long JD is the expensive
 * part of this module.
 */
export interface JobKeywordIndex {
  terms: { term: string; weight: number; expanded: Set<string> }[];
  totalWeight: number;
}

export function buildJobKeywordIndex(jobDescription: string, jobTitle: string): JobKeywordIndex {
  const titleWords = expandTerms(tokenize(jobTitle));
  const terms: JobKeywordIndex["terms"] = [];
  let totalWeight = 0;

  // Dedupe: extractKeywords emits one entry per n-gram occurrence, so a term
  // repeated in the JD would otherwise be counted several times here.
  const seen = new Map<string, number>();
  for (const { term, weight } of extractKeywords(jobDescription)) {
    if (term.length < MIN_TERM_CHARS) continue;
    // Title keywords weigh double — same rule scoreResume applies.
    const finalWeight = weight * (titleWords.has(normalize(term)) ? 2 : 1);
    const prior = seen.get(term);
    if (prior === undefined || finalWeight > prior) seen.set(term, finalWeight);
  }

  for (const [term, weight] of seen) {
    terms.push({ term, weight, expanded: expandTerms([term]) });
    totalWeight += weight;
  }
  return { terms, totalWeight };
}

/** True when `inner` is `outer` or a whole-word span inside it. Word-boundary
 * aware so "code" is subsumed by "as code" but "cod" is not. */
function isSubsumedBy(inner: string, outer: string): boolean {
  if (inner === outer) return true;
  if (inner.length >= outer.length) return false;
  return ` ${outer} `.includes(` ${inner} `);
}

/**
 * Reduces overlapping matched n-grams to maximal ones, so a single matched
 * concept is credited once.
 *
 * A subsumed term keeps its weight alive: "kubernetes" (title keyword, 2x)
 * sits inside "kubernetes clusters" (1.2x), and collapsing to the longer term
 * alone would silently discard the title bonus. Each surviving term therefore
 * takes the MAX weight of the group it absorbed.
 */
function collapseSubsumedTerms(
  hits: { term: string; weight: number }[],
): { keywords: string[]; weight: number } {
  // Longest first so a maximal term is always seen before what it subsumes.
  const sorted = [...hits].sort((a, b) => b.term.length - a.term.length || a.term.localeCompare(b.term));
  const kept: { term: string; weight: number }[] = [];

  for (const hit of sorted) {
    const parent = kept.find((k) => isSubsumedBy(hit.term, k.term));
    if (parent) {
      // Absorbed — but its weight can still raise the group's.
      parent.weight = Math.max(parent.weight, hit.weight);
      continue;
    }
    kept.push({ ...hit });
  }

  return {
    keywords: kept.map((k) => k.term),
    weight: kept.reduce((sum, k) => sum + k.weight, 0),
  };
}

/**
 * Scores one bullet against a posting. Length normalization uses sqrt of word
 * count rather than raw count: dividing by length outright over-punishes the
 * detailed bullets that tend to carry the quantified results worth keeping.
 */
export function scoreBullet(bullet: string, index: number, index_: JobKeywordIndex): RankedBullet {
  const text = bullet.trim();
  const strength = analyzeBullet(text).rating;
  if (!text || index_.totalWeight === 0) {
    return { index, text, score: 0, matchedKeywords: [], strength };
  }

  const normalizedText = normalize(text);
  const bulletTokens = expandTerms(tokenize(text));

  const hits: { term: string; weight: number }[] = [];
  for (const { term, weight, expanded } of index_.terms) {
    let hit = false;
    for (const variant of expanded) {
      // Multi-word terms need a substring check; single tokens match the set.
      if (variant.includes(" ") ? normalizedText.includes(variant) : bulletTokens.has(variant)) {
        hit = true;
        break;
      }
    }
    if (hit) hits.push({ term, weight });
  }

  // Credit each matched CONCEPT once, not once per overlapping n-gram.
  // extractKeywords emits every 1-4 word window, so a bullet echoing one long
  // JD phrase ("infrastructure as code adoption") otherwise banks 8 separate
  // hits — measured at 2.7x a title-keyword match, which ranked phrase-echoing
  // bullets above genuinely central ones. Keep only maximal terms.
  //
  // Deliberately local to ranking: scoreResume has the same n-gram property,
  // but changing it would move every ATS score in the app.
  const { keywords: matchedKeywords, weight: matchedWeight } = collapseSubsumedTerms(hits);

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const lengthFactor = Math.sqrt(Math.max(wordCount, 1));
  // Scale so a typical strong bullet lands in a readable 0-100 band. The
  // constant only affects presentation — ordering is unchanged by it.
  const raw = (matchedWeight / lengthFactor) * STRENGTH_BONUS[strength] * 12;

  return {
    index,
    text,
    score: Math.min(100, Math.round(raw * 10) / 10),
    // Longest first: "machine learning pipeline" is more informative than "ml".
    matchedKeywords: matchedKeywords.sort((a, b) => b.length - a.length).slice(0, 8),
    strength,
  };
}

/** Ranks one role's bullets and picks the subset to show. */
export function rankRoleBullets(
  role: Pick<ExperienceEntry, "id" | "title" | "company" | "bullets">,
  index: JobKeywordIndex,
  options: RankBulletsOptions = {},
): RankedRole {
  const { maxKeep, minKeep, minScore } = { ...DEFAULTS, ...options };

  const scored = (role.bullets ?? []).map((b, i) => scoreBullet(b, i, index));

  // Stable sort: equal scores keep original order, so re-running the ranker on
  // unchanged input produces an identical result rather than a phantom diff.
  const ranked = [...scored].sort((a, b) => (b.score - a.score) || (a.index - b.index));

  const cap = Math.max(0, maxKeep);
  const floor = Math.min(Math.max(0, minKeep), cap);
  const selected: RankedBullet[] = [];
  for (const bullet of ranked) {
    if (selected.length >= cap) break;
    // Below the relevance floor, only keep going until minKeep is satisfied.
    if (bullet.score < minScore && selected.length >= floor) break;
    selected.push(bullet);
  }

  return { roleId: role.id, title: role.title, company: role.company, ranked, selected };
}

/** Ranks every role in a profile's experience against one posting. */
export function rankProfileBullets(
  experience: Pick<ExperienceEntry, "id" | "title" | "company" | "bullets">[],
  jobDescription: string,
  jobTitle: string,
  options: RankBulletsOptions = {},
): RankedRole[] {
  const index = buildJobKeywordIndex(jobDescription, jobTitle);
  return (experience ?? []).map((role) => rankRoleBullets(role, index, options));
}

/**
 * The strongest bullets across ALL roles, for places that want a flat list
 * (a summary line, a short-form application box) rather than per-role output.
 */
export function topBulletsAcrossRoles(
  experience: Pick<ExperienceEntry, "id" | "title" | "company" | "bullets">[],
  jobDescription: string,
  jobTitle: string,
  limit = 5,
): Array<RankedBullet & { roleId: string; title: string; company: string }> {
  const ranked = rankProfileBullets(experience, jobDescription, jobTitle, { maxKeep: Infinity, minKeep: 0 });
  return ranked
    .flatMap((role) =>
      role.ranked.map((b) => ({ ...b, roleId: role.roleId, title: role.title, company: role.company })),
    )
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, Math.max(0, limit));
}

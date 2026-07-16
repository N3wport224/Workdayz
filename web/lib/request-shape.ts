// Server-side request shaping: API routes receive JSON from the web UI and
// from the browser extension's background worker. Coerce nested structures
// to the shapes the LLM libs index into, so a malformed payload yields an
// empty field instead of a 500 with an internal TypeError message.

import type { ResumeProfile } from "./types";

export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

export interface ShapedExperienceItem {
  title: string;
  company: string;
  bullets: string[];
}

export function shapeExperienceItems(v: unknown): ShapedExperienceItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object")
    .map((e) => ({ title: str(e.title), company: str(e.company), bullets: strArr(e.bullets) }));
}

/** Coerces a client-supplied profile so every array the tailoring engine
 * iterates is actually an array. Contents are still user data — this guards
 * shape, not truth. */
export function shapeProfile(profile: ResumeProfile): ResumeProfile {
  return {
    ...profile,
    summary: str(profile.summary),
    skills: strArr(profile.skills),
    certifications: Array.isArray(profile.certifications) ? profile.certifications : [],
    experience: Array.isArray(profile.experience)
      ? profile.experience.map((e) => ({ ...e, bullets: strArr(e?.bullets) }))
      : [],
    education: Array.isArray(profile.education) ? profile.education : [],
  };
}

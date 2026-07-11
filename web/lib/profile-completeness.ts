import type { ResumeProfile } from "./types";

export interface CompletenessResult {
  score: number; // 0-100
  suggestions: string[];
}

interface Check {
  weight: number;
  ok: boolean;
  suggestion: string;
}

export function computeCompleteness(profile: ResumeProfile): CompletenessResult {
  const totalBullets = profile.experience.reduce((n, e) => n + e.bullets.filter((b) => b.trim()).length, 0);

  const checks: Check[] = [
    { weight: 10, ok: Boolean(profile.contact.firstName && profile.contact.lastName), suggestion: "Add your full name." },
    { weight: 10, ok: Boolean(profile.contact.email), suggestion: "Add your email address." },
    { weight: 8, ok: Boolean(profile.contact.phone), suggestion: "Add a phone number — Workday forms almost always require one." },
    { weight: 6, ok: Boolean(profile.contact.city && profile.contact.state), suggestion: "Add your city and state for location fields." },
    { weight: 4, ok: Boolean(profile.contact.country), suggestion: "Add your country — it's a required dropdown on most applications." },
    { weight: 4, ok: Boolean(profile.contact.linkedin), suggestion: "Add your LinkedIn URL — recruiters check it anyway." },
    { weight: 12, ok: profile.summary.trim().split(/\s+/).filter(Boolean).length >= 20, suggestion: "Write a summary of at least ~20 words — it anchors every tailored resume." },
    { weight: 12, ok: profile.skills.length >= 5, suggestion: "List at least 5 skills — they drive ATS keyword matching." },
    { weight: 14, ok: profile.experience.length >= 1, suggestion: "Add at least one work experience entry." },
    { weight: 14, ok: totalBullets >= 3, suggestion: "Add at least 3 accomplishment bullets across your roles — tailoring can only rephrase what's here." },
    {
      weight: 8,
      ok: profile.experience.length > 0 && profile.experience.every((e) => e.startDate.trim().length > 0),
      suggestion: "Add start dates to every role — Workday date fields need them.",
    },
    { weight: 8, ok: profile.education.length >= 1, suggestion: "Add your education." },
  ];

  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const earned = checks.filter((c) => c.ok).reduce((s, c) => s + c.weight, 0);

  return {
    score: Math.round((earned / totalWeight) * 100),
    suggestions: checks.filter((c) => !c.ok).map((c) => c.suggestion),
  };
}

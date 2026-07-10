"use client";

import type { ResumeProfile } from "./types";

const PROFILE_KEY = "workdayz.profile.v1";

export const emptyProfile: ResumeProfile = {
  contact: {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
    linkedin: "",
    website: "",
  },
  summary: "",
  skills: [],
  experience: [],
  education: [],
  certifications: [],
};

/** Merges a possibly-partial stored/imported profile onto the empty profile,
 * deep-merging `contact` so every field the UI binds to is a real string and
 * forcing array fields back to arrays (a hand-edited backup with e.g.
 * `"skills": "TypeScript"` must not crash the form). */
export function mergeProfile(partial: Partial<ResumeProfile> | null | undefined): ResumeProfile {
  if (!partial || typeof partial !== "object") return emptyProfile;
  const arr = <T>(v: T[] | undefined, fallback: T[]): T[] => (Array.isArray(v) ? v : fallback);
  return {
    ...emptyProfile,
    ...partial,
    contact: { ...emptyProfile.contact, ...(partial.contact ?? {}) },
    skills: arr(partial.skills, emptyProfile.skills),
    experience: arr(partial.experience, emptyProfile.experience),
    education: arr(partial.education, emptyProfile.education),
    certifications: arr(partial.certifications, emptyProfile.certifications),
  };
}

export function loadProfile(): ResumeProfile {
  if (typeof window === "undefined") return emptyProfile;
  const raw = window.localStorage.getItem(PROFILE_KEY);
  if (!raw) return emptyProfile;
  try {
    return mergeProfile(JSON.parse(raw));
  } catch {
    return emptyProfile;
  }
}

export function saveProfile(profile: ResumeProfile): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function hasProfile(profile: ResumeProfile): boolean {
  return Boolean(profile.contact.firstName && profile.contact.email);
}

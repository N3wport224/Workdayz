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
 * deep-merging `contact` so every field the UI binds to is a real string. */
export function mergeProfile(partial: Partial<ResumeProfile> | null | undefined): ResumeProfile {
  if (!partial || typeof partial !== "object") return emptyProfile;
  return {
    ...emptyProfile,
    ...partial,
    contact: { ...emptyProfile.contact, ...(partial.contact ?? {}) },
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

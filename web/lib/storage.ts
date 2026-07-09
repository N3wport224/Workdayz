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

export function loadProfile(): ResumeProfile {
  if (typeof window === "undefined") return emptyProfile;
  const raw = window.localStorage.getItem(PROFILE_KEY);
  if (!raw) return emptyProfile;
  try {
    return { ...emptyProfile, ...JSON.parse(raw) } as ResumeProfile;
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

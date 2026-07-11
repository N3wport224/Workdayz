"use client";

import type { ResumeProfile } from "./types";

const LEGACY_PROFILE_KEY = "workdayz.profile.v1";
const PROFILES_KEY = "workdayz.profiles.v1";

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
  projects: [],
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
    skills: arr(partial.skills, []),
    experience: arr(partial.experience, []),
    education: arr(partial.education, []),
    certifications: arr(partial.certifications, []),
    projects: arr(partial.projects, []),
  };
}

// --- multiple named profiles ("Engineering resume", "PM resume", ...) ---

export interface ProfileEntry {
  id: string;
  name: string;
  profile: ResumeProfile;
}

interface ProfileStore {
  activeId: string;
  entries: ProfileEntry[];
}

function loadStore(): ProfileStore {
  if (typeof window === "undefined") {
    return { activeId: "", entries: [] };
  }
  const raw = window.localStorage.getItem(PROFILES_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ProfileStore;
      if (Array.isArray(parsed.entries) && parsed.entries.length) return parsed;
    } catch {
      /* fall through to migration/default */
    }
  }
  // Migrate the original single-profile key, or start fresh.
  let migrated = emptyProfile;
  try {
    const legacy = window.localStorage.getItem(LEGACY_PROFILE_KEY);
    if (legacy) migrated = mergeProfile(JSON.parse(legacy));
  } catch {
    /* corrupt legacy data — start fresh */
  }
  const store: ProfileStore = {
    activeId: "default",
    entries: [{ id: "default", name: "Default", profile: migrated }],
  };
  window.localStorage.setItem(PROFILES_KEY, JSON.stringify(store));
  return store;
}

function persistStore(store: ProfileStore): void {
  window.localStorage.setItem(PROFILES_KEY, JSON.stringify(store));
}

export function listProfiles(): { id: string; name: string; active: boolean }[] {
  const store = loadStore();
  return store.entries.map((e) => ({ id: e.id, name: e.name, active: e.id === store.activeId }));
}

export function switchProfile(id: string): void {
  const store = loadStore();
  if (store.entries.some((e) => e.id === id)) {
    store.activeId = id;
    persistStore(store);
  }
}

/** Creates a new profile (optionally copying the current one) and makes it active. */
export function createProfile(name: string, copyCurrent: boolean): string {
  const store = loadStore();
  const current = store.entries.find((e) => e.id === store.activeId);
  const id = crypto.randomUUID();
  store.entries.push({
    id,
    name: name.trim() || "Untitled",
    profile: copyCurrent && current ? JSON.parse(JSON.stringify(current.profile)) : emptyProfile,
  });
  store.activeId = id;
  persistStore(store);
  return id;
}

export function renameProfile(id: string, name: string): void {
  const store = loadStore();
  const entry = store.entries.find((e) => e.id === id);
  if (entry && name.trim()) {
    entry.name = name.trim();
    persistStore(store);
  }
}

/** Deletes a profile; refuses to delete the last one. */
export function deleteProfile(id: string): boolean {
  const store = loadStore();
  if (store.entries.length <= 1) return false;
  store.entries = store.entries.filter((e) => e.id !== id);
  if (store.activeId === id) store.activeId = store.entries[0].id;
  persistStore(store);
  return true;
}

/** The active profile — every consumer (tailoring, autofill sync) uses this. */
export function loadProfile(): ResumeProfile {
  if (typeof window === "undefined") return emptyProfile;
  const store = loadStore();
  const entry = store.entries.find((e) => e.id === store.activeId) ?? store.entries[0];
  return entry ? mergeProfile(entry.profile) : emptyProfile;
}

export function saveProfile(profile: ResumeProfile): void {
  if (typeof window === "undefined") return;
  const store = loadStore();
  const entry = store.entries.find((e) => e.id === store.activeId) ?? store.entries[0];
  if (entry) {
    entry.profile = profile;
    persistStore(store);
  }
}

export function hasProfile(profile: ResumeProfile): boolean {
  return Boolean(profile.contact.firstName && profile.contact.email);
}

/** Removes every piece of Workdayz data this browser holds. */
export function wipeAllData(): void {
  if (typeof window === "undefined") return;
  const mine = Object.keys(window.localStorage).filter((k) => k.startsWith("workdayz."));
  for (const key of mine) window.localStorage.removeItem(key);
}

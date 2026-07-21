/**
 * Client-side storage for the web app. Uses localStorage for the profile,
 * applications, and settings. In production this would be a database.
 */

import type { ResumeProfile, TailoredApplication } from "./types";

const PROFILE_KEY = "workdayz-profile";
const APPLICATIONS_KEY = "workdayz-applications";
const SETTINGS_KEY = "workdayz-settings";

export interface ExtensionSettings {
  anthropicKey: string;
  model: string;
  autoSyncExtension: boolean;
  /** Item 85: false = keep the API key in sessionStorage only (gone when the
   * browser closes) instead of persisting it in localStorage. */
  persistKey?: boolean;
  /** Item 79: when the key was last changed, for rotation reminders. */
  keySavedAt?: string;
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  anthropicKey: "",
  // Empty = use the server's ANTHROPIC_MODEL/default; only send an override
  // when the user actually picks one in Settings.
  model: "",
  autoSyncExtension: true,
  persistKey: true,
};

const SESSION_KEY_NAME = "workdayz-session-key";

// Profile
export function saveProfile(profile: ResumeProfile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (e) {
    console.error("Failed to save profile:", e);
  }
}

export function loadProfile(): ResumeProfile | null {
  try {
    const data = localStorage.getItem(PROFILE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

// --- Multiple named profiles (item 14) -------------------------------------
// The map holds every profile; PROFILE_KEY always mirrors the ACTIVE one so
// existing consumers (apply page, extension sync) keep reading loadProfile().
const PROFILES_KEY = "workdayz-profiles";
const ACTIVE_PROFILE_KEY = "workdayz-active-profile";

function loadProfileMap(): Record<string, ResumeProfile> {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, ResumeProfile>) : {};
    // First run: migrate the single legacy profile into the map.
    if (Object.keys(map).length === 0) {
      const single = loadProfile();
      if (single) {
        map["Default"] = single;
        localStorage.setItem(PROFILES_KEY, JSON.stringify(map));
        localStorage.setItem(ACTIVE_PROFILE_KEY, "Default");
      }
    }
    return map;
  } catch {
    return {};
  }
}

/** Every named profile, keyed by name — used to sync the full set to the
 * extension so its widget can offer a picker. */
export function loadAllProfiles(): Record<string, ResumeProfile> {
  return loadProfileMap();
}

export function listProfileNames(): string[] {
  const names = Object.keys(loadProfileMap());
  return names.length ? names.sort() : ["Default"];
}

export function getActiveProfileName(): string {
  try {
    return localStorage.getItem(ACTIVE_PROFILE_KEY) ?? "Default";
  } catch {
    return "Default";
  }
}

/** Saves under the active name AND mirrors to the legacy single-profile key. */
export function saveNamedProfile(profile: ResumeProfile): void {
  saveProfile(profile);
  try {
    const map = loadProfileMap();
    map[getActiveProfileName()] = profile;
    localStorage.setItem(PROFILES_KEY, JSON.stringify(map));
  } catch (e) {
    console.error("Failed to save named profile:", e);
  }
}

/** Switches the active profile; returns it (null if the name is unknown). */
export function switchProfile(name: string): ResumeProfile | null {
  try {
    const map = loadProfileMap();
    const profile = map[name];
    if (!profile) return null;
    localStorage.setItem(ACTIVE_PROFILE_KEY, name);
    saveProfile(profile); // mirror as the active single profile
    return profile;
  } catch {
    return null;
  }
}

/** Creates a new named profile (optionally copying another) and activates it. */
export function createNamedProfile(name: string, copyFrom?: ResumeProfile): ResumeProfile | null {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) return null;
  try {
    const map = loadProfileMap();
    if (map[trimmed]) return null; // no silent overwrite
    const fresh: ResumeProfile = copyFrom
      ? JSON.parse(JSON.stringify(copyFrom))
      : {
          contact: { firstName: "", lastName: "", email: "", phone: "", address: "", city: "", state: "", postalCode: "", country: "US", linkedin: "", website: "" },
          summary: "", skills: [], experience: [], education: [], projects: [], certifications: [],
        };
    map[trimmed] = fresh;
    localStorage.setItem(PROFILES_KEY, JSON.stringify(map));
    localStorage.setItem(ACTIVE_PROFILE_KEY, trimmed);
    saveProfile(fresh);
    return fresh;
  } catch {
    return null;
  }
}

/** Deletes a named profile. Refuses to delete the last one. */
export function deleteNamedProfile(name: string): boolean {
  try {
    const map = loadProfileMap();
    if (!map[name] || Object.keys(map).length <= 1) return false;
    delete map[name];
    localStorage.setItem(PROFILES_KEY, JSON.stringify(map));
    if (getActiveProfileName() === name) {
      const next = Object.keys(map).sort()[0];
      localStorage.setItem(ACTIVE_PROFILE_KEY, next);
      saveProfile(map[next]);
    }
    return true;
  } catch {
    return false;
  }
}

// Applications
export function saveApplications(apps: TailoredApplication[]): void {
  try {
    localStorage.setItem(APPLICATIONS_KEY, JSON.stringify(apps));
  } catch (e) {
    console.error("Failed to save applications:", e);
  }
}

export function loadApplications(): TailoredApplication[] {
  try {
    const data = localStorage.getItem(APPLICATIONS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveApplication(app: TailoredApplication): TailoredApplication[] {
  const apps = loadApplications();
  const idx = apps.findIndex((a) => a.id === app.id);
  if (idx >= 0) apps[idx] = app;
  else apps.push(app);
  saveApplications(apps);
  return apps;
}

export function deleteApplication(id: string): TailoredApplication[] {
  const apps = loadApplications().filter((a) => a.id !== id);
  saveApplications(apps);
  return apps;
}

// Settings
export function saveSettings(settings: Partial<ExtensionSettings>): ExtensionSettings {
  const current = loadSettings();
  const updated = { ...current, ...settings };
  // Item 79: stamp when the key changes, for rotation reminders.
  if (settings.anthropicKey !== undefined && settings.anthropicKey !== current.anthropicKey) {
    updated.keySavedAt = new Date().toISOString();
  }
  try {
    if (updated.persistKey === false) {
      // Item 85: session-only key — never written to localStorage; it lives in
      // sessionStorage and disappears when the browser closes.
      sessionStorage.setItem(SESSION_KEY_NAME, updated.anthropicKey);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...updated, anthropicKey: "" }));
    } else {
      sessionStorage.removeItem(SESSION_KEY_NAME);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    }
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
  return updated;
}

export function loadSettings(): ExtensionSettings {
  try {
    const data = localStorage.getItem(SETTINGS_KEY);
    const settings: ExtensionSettings = data ? { ...DEFAULT_SETTINGS, ...JSON.parse(data) } : { ...DEFAULT_SETTINGS };
    // Item 85: merge the session-only key back in for this browser session.
    if (settings.persistKey === false && !settings.anthropicKey) {
      settings.anthropicKey = sessionStorage.getItem(SESSION_KEY_NAME) ?? "";
    }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// Demo profile for first-run experience
export function createDemoProfile(): ResumeProfile {
  return {
    contact: {
      firstName: "Alex",
      lastName: "Johnson",
      email: "alex.johnson@example.com",
      phone: "(555) 123-4567",
      address: "123 Main St",
      city: "San Francisco",
      state: "CA",
      postalCode: "94105",
      country: "US",
      linkedin: "https://linkedin.com/in/alexjohnson",
      website: "https://alexjohnson.dev",
    },
    summary: "Senior software engineer with 8+ years of experience building scalable web applications.",
    skills: ["TypeScript", "React", "Node.js", "Python", "AWS", "Docker", "PostgreSQL", "GraphQL", "CI/CD", "Kubernetes"],
    experience: [
      {
        id: "exp-1",
        company: "TechCorp Inc.",
        title: "Senior Software Engineer",
        location: "San Francisco, CA",
        startDate: "2021-03",
        endDate: "Present",
        bullets: [
          "Led development of a microservices platform serving 2M+ daily users, reducing API latency by 40%",
          "Architected a real-time data pipeline processing 500K events/second using Kafka and Flink",
          "Mentored 4 junior engineers through structured code reviews and pair programming sessions",
          "Implemented CI/CD pipelines that reduced deployment time from 2 hours to 15 minutes",
        ],
      },
      {
        id: "exp-2",
        company: "StartupXYZ",
        title: "Software Engineer",
        location: "Oakland, CA",
        startDate: "2018-06",
        endDate: "2021-02",
        bullets: [
          "Built the core REST API serving 100K+ requests/minute with 99.9% uptime",
          "Designed and implemented a GraphQL layer that reduced frontend data fetching by 60%",
          "Migrated legacy monolith to microservices on AWS ECS, cutting infrastructure costs by 30%",
        ],
      },
    ],
    education: [
      {
        id: "edu-1",
        school: "University of California, Berkeley",
        degree: "BS",
        fieldOfStudy: "Computer Science",
        startDate: "2014-09",
        endDate: "2018-05",
        gpa: "3.7",
      },
    ],
    projects: [
      {
        id: "proj-1",
        name: "Open Source CLI Tool",
        description: "A CLI tool for scaffolding TypeScript projects. 1,200+ GitHub stars.",
        url: "https://github.com/alexjohnson/ts-starter",
        technologies: ["TypeScript", "Node.js"],
      },
    ],
    certifications: [
      { id: "cert-1", name: "AWS Solutions Architect Associate", issuer: "Amazon Web Services", issueDate: "2022-04", expirationDate: "2025-04" },
    ],
  };
}

// Wipe all data
export function wipeAllData(): void {
  try {
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(APPLICATIONS_KEY);
    localStorage.removeItem(SETTINGS_KEY);
  } catch {
    // localStorage unavailable
  }
}

// Backup / restore
export function exportAllData(): string {
  return JSON.stringify({
    profile: loadProfile(),
    applications: loadApplications(),
    settings: loadSettings(),
    exportedAt: new Date().toISOString(),
  });
}

export function importAllData(json: string): { success: boolean; error?: string } {
  try {
    const data = JSON.parse(json);
    if (data.profile) saveProfile(data.profile);
    if (data.applications) saveApplications(data.applications);
    if (data.settings) saveSettings(data.settings);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Invalid data" };
  }
}
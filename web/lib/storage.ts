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
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  anthropicKey: "",
  model: "claude-sonnet-4-20250514",
  autoSyncExtension: true,
};

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
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
  return updated;
}

export function loadSettings(): ExtensionSettings {
  try {
    const data = localStorage.getItem(SETTINGS_KEY);
    return data ? { ...DEFAULT_SETTINGS, ...JSON.parse(data) } : { ...DEFAULT_SETTINGS };
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
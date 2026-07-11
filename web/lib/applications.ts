"use client";

import type { ApplicationStatus, SavedApplication } from "./types";

const APPLICATIONS_KEY = "workdayz.applications.v1";

export function loadApplications(): SavedApplication[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(APPLICATIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Drop corrupt entries rather than letting one break the whole tracker.
    return parsed.filter(
      (a): a is SavedApplication =>
        Boolean(a) && typeof a.id === "string" && Boolean(a.job) && Boolean(a.atsScore),
    );
  } catch {
    return [];
  }
}

function persist(applications: SavedApplication[]): void {
  window.localStorage.setItem(APPLICATIONS_KEY, JSON.stringify(applications));
}

export function upsertApplication(app: SavedApplication): void {
  const applications = loadApplications();
  const index = applications.findIndex((a) => a.id === app.id);
  if (index >= 0) {
    applications[index] = app;
  } else {
    applications.unshift(app);
  }
  persist(applications);
}

export function updateApplication(id: string, patch: Partial<SavedApplication>): void {
  const applications = loadApplications();
  const index = applications.findIndex((a) => a.id === id);
  if (index < 0) return;
  applications[index] = {
    ...applications[index],
    ...patch,
    id, // never let a patch change identity
    updatedAt: new Date().toISOString(),
  };
  persist(applications);
}

export function updateApplicationStatus(id: string, status: ApplicationStatus): void {
  const app = loadApplications().find((a) => a.id === id);
  if (!app || app.status === status) return;
  updateApplication(id, {
    status,
    statusHistory: [...(app.statusHistory ?? []), { status, at: new Date().toISOString() }],
  });
}

/** When the current status took effect: last history entry, else creation. */
export function statusSince(app: SavedApplication): string {
  const history = app.statusHistory;
  return history?.length ? history[history.length - 1].at : app.createdAt;
}

export function countTailoredSince(applications: SavedApplication[], days: number): number {
  const cutoff = Date.now() - days * 86_400_000;
  return applications.filter((a) => new Date(a.createdAt).getTime() >= cutoff).length;
}

export function isFollowUpOverdue(app: SavedApplication): boolean {
  if (!app.followUpAt) return false;
  if (app.status === "rejected" || app.status === "offer") return false;
  return new Date(`${app.followUpAt}T23:59:59`) < new Date();
}

/** Merges imported applications into storage, skipping ids that already
 * exist. Returns how many were added. */
export function importApplications(incoming: unknown): number {
  if (!Array.isArray(incoming)) throw new Error("Backup file must contain an array of applications.");
  const existing = loadApplications();
  const known = new Set(existing.map((a) => a.id));
  const additions = incoming.filter(
    (a): a is SavedApplication =>
      Boolean(a) && typeof a.id === "string" && !known.has(a.id) && Boolean(a.job) && Boolean(a.atsScore),
  );
  persist([...additions, ...existing]);
  return additions.length;
}

export function deleteApplication(id: string): void {
  persist(loadApplications().filter((a) => a.id !== id));
}

export function getApplication(id: string): SavedApplication | undefined {
  return loadApplications().find((a) => a.id === id);
}

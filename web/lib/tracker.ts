/**
 * Tracker utilities (items 40-54): CSV/ICS/markdown exports, status history,
 * follow-ups, duplicate detection, and response analytics — all pure
 * functions over the saved TailoredApplication list.
 */

import type { ApplicationStatus, TailoredApplication } from "./types";

// --- Item 40: CSV export ----------------------------------------------------
function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildCsv(apps: TailoredApplication[]): string {
  const header = ["Title", "Company", "Location", "Status", "Archived", "ATS", "Created", "Updated", "Follow-up", "Salary", "Sent resume", "URL", "Notes"];
  const rows = apps.map((a) =>
    [
      a.job.title,
      a.job.company,
      a.job.location,
      a.status,
      a.archived ? "yes" : "",
      String(a.atsScore),
      a.createdAt.slice(0, 10),
      a.updatedAt?.slice(0, 10) ?? "",
      a.followUpDate ?? "",
      a.comp ?? "",
      a.sentResume ?? "",
      a.job.sourceUrl ?? "",
      a.notes ?? "",
    ]
      .map(csvField)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

// --- Item 41: ICS follow-up calendar ----------------------------------------
function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function followUpsToIcs(apps: TailoredApplication[]): string {
  const events = apps
    .filter((a) => a.followUpDate && !a.archived && a.status !== "rejected" && a.status !== "accepted")
    .map((a) => {
      const stamp = a.followUpDate!.replace(/-/g, "");
      return [
        "BEGIN:VEVENT",
        `UID:${a.id}@workdayz.local`,
        `DTSTART;VALUE=DATE:${stamp}`,
        `SUMMARY:${icsEscape(`Follow up: ${a.job.title} at ${a.job.company}`)}`,
        `DESCRIPTION:${icsEscape(`Workdayz follow-up. Status: ${a.status}. ${a.job.sourceUrl ?? ""}`.trim())}`,
        "END:VEVENT",
      ].join("\r\n");
    });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Workdayz//Tracker//EN", ...events, "END:VCALENDAR"].join("\r\n");
}

// --- Items 43/44: follow-ups + status history -------------------------------
export function isFollowUpOverdue(app: TailoredApplication): boolean {
  if (!app.followUpDate || app.archived) return false;
  if (app.status === "rejected" || app.status === "accepted" || app.status === "offer") return false;
  return new Date(`${app.followUpDate}T23:59:59`) < new Date();
}

/** Status change that also appends to the history trail (item 44). */
export function withStatusChange(app: TailoredApplication, status: ApplicationStatus): TailoredApplication {
  if (app.status === status) return app;
  return {
    ...app,
    status,
    updatedAt: new Date().toISOString(),
    statusHistory: [...(app.statusHistory ?? []), { status, at: new Date().toISOString() }],
  };
}

/** "3d in screening" — how long the app has sat in its current status. */
export function timeInStage(app: TailoredApplication): string {
  const last = app.statusHistory?.length ? app.statusHistory[app.statusHistory.length - 1].at : app.createdAt;
  const days = Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000);
  return days === 0 ? "today" : `${days}d in ${app.status}`;
}

// --- Item 49: duplicate detection -------------------------------------------
export function duplicateIds(apps: TailoredApplication[]): Set<string> {
  const dupes = new Set<string>();
  const seen = new Map<string, { id: string; at: number }>();
  for (const a of [...apps].sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
    const key = `${a.job.company.toLowerCase().trim()}|${a.job.title.toLowerCase().trim()}`;
    const prev = seen.get(key);
    const at = new Date(a.createdAt).getTime();
    if (prev && at - prev.at < 30 * 86_400_000) {
      dupes.add(a.id);
      dupes.add(prev.id);
    }
    seen.set(key, { id: a.id, at });
  }
  return dupes;
}

// --- Items 50/99: response analytics (incl. per sent-resume variant) --------
const RESPONSE_STATUSES: ApplicationStatus[] = ["screening", "interview", "offer", "accepted", "rejected"];

export interface ResponseStats {
  submitted: number;
  responses: number;
  responseRate: number | null;
  interviews: number;
  byResume: { label: string; submitted: number; responses: number }[];
}

export function responseStats(apps: TailoredApplication[]): ResponseStats {
  const submitted = apps.filter((a) => a.status !== "draft");
  const responded = submitted.filter((a) => RESPONSE_STATUSES.includes(a.status));
  const interviews = submitted.filter((a) => ["interview", "offer", "accepted"].includes(a.status));

  const byLabel = new Map<string, { submitted: number; responses: number }>();
  for (const a of submitted) {
    const label = a.sentResume ?? "(unrecorded)";
    const entry = byLabel.get(label) ?? { submitted: 0, responses: 0 };
    entry.submitted += 1;
    if (RESPONSE_STATUSES.includes(a.status)) entry.responses += 1;
    byLabel.set(label, entry);
  }

  return {
    submitted: submitted.length,
    responses: responded.length,
    responseRate: submitted.length ? responded.length / submitted.length : null,
    interviews: interviews.length,
    byResume: [...byLabel.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.submitted - a.submitted),
  };
}

// --- Item 51: weekly application volume -------------------------------------
export function weeklyVolume(apps: TailoredApplication[], weeks = 8, now = new Date()): number[] {
  const counts = new Array<number>(weeks).fill(0);
  const nowMs = now.getTime();
  for (const a of apps) {
    const age = nowMs - new Date(a.createdAt).getTime();
    if (age < 0) continue;
    const week = Math.floor(age / (7 * 86_400_000));
    if (week < weeks) counts[weeks - 1 - week] += 1; // oldest first
  }
  return counts;
}

// --- Item 54: shareable markdown summary ------------------------------------
export function trackerSummaryMarkdown(apps: TailoredApplication[]): string {
  const active = apps.filter((a) => !a.archived);
  const lines = [
    `# Job search summary — ${new Date().toLocaleDateString()}`,
    "",
    `${active.length} tracked application(s).`,
    "",
    "| Company | Title | Status | ATS | Applied |",
    "|---|---|---|---|---|",
    ...active
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((a) => `| ${a.job.company} | ${a.job.title} | ${a.status} | ${a.atsScore} | ${a.createdAt.slice(0, 10)} |`),
  ];
  return lines.join("\n");
}

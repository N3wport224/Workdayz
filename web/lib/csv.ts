import type { SavedApplication } from "./types";

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

export function applicationsToCsv(applications: SavedApplication[]): string {
  const header = [
    "Job title",
    "Company",
    "Location",
    "Status",
    "Archived",
    "ATS score",
    "Tailored",
    "Last updated",
    "Follow up by",
    "Source URL",
    "Notes",
  ];
  const rows = applications.map((a) => [
    a.job.title,
    a.job.company,
    a.job.location,
    a.status,
    a.archived ? "yes" : "",
    String(a.atsScore.score),
    a.createdAt,
    a.updatedAt,
    a.followUpAt ?? "",
    a.job.sourceUrl ?? "",
    a.notes ?? "",
  ]);
  return buildCsv([header, ...rows]);
}

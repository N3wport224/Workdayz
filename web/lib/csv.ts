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
    "ATS score",
    "Tailored",
    "Last updated",
    "Source URL",
    "Notes",
  ];
  const rows = applications.map((a) => [
    a.job.title,
    a.job.company,
    a.job.location,
    a.status,
    String(a.atsScore.score),
    a.createdAt,
    a.updatedAt,
    a.job.sourceUrl ?? "",
    a.notes ?? "",
  ]);
  return buildCsv([header, ...rows]);
}

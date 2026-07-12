// Minimal iCalendar export for follow-up reminders — all-day VEVENTs the
// user imports into their real calendar. RFC 5545 subset: text escaping,
// CRLF line endings, folding not needed at our line lengths.

import type { SavedApplication } from "./types";

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function dateStamp(iso: string): string {
  // "2026-07-20" → "20260720" (all-day DTSTART;VALUE=DATE)
  return iso.replace(/-/g, "");
}

export function followUpsToIcs(applications: SavedApplication[], now = new Date()): string {
  const events = applications
    .filter((a) => a.followUpAt && a.status !== "rejected" && a.status !== "offer")
    .map((a) => {
      const uid = `${a.id}@workdayz.local`;
      return [
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
        `DTSTART;VALUE=DATE:${dateStamp(a.followUpAt!)}`,
        `SUMMARY:${escapeText(`Follow up: ${a.job.title} at ${a.job.company}`)}`,
        `DESCRIPTION:${escapeText(
          `Workdayz follow-up reminder. Status: ${a.status}. ${a.job.sourceUrl ?? ""}`.trim(),
        )}`,
        "END:VEVENT",
      ].join("\r\n");
    });

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Workdayz//Follow-ups//EN",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

// Outcome analytics over the saved applications — turns the tracker into a
// feedback loop ("do my higher-ATS applications actually get more replies?").
// All pure functions; archived entries are included since outcomes are
// outcomes.

import type { SavedApplication } from "./types";

/** A response = the employer moved you forward or told you no: any status
 * past "applied". Drafts and still-pending applieds are not responses. */
function hasResponse(app: SavedApplication): boolean {
  return app.status === "interviewing" || app.status === "offer" || app.status === "rejected";
}

/** Applications that were actually submitted (anything past draft). */
function wasSubmitted(app: SavedApplication): boolean {
  return app.status !== "draft";
}

export interface AtsBandStats {
  band: string;
  submitted: number;
  responses: number;
  interviews: number; // interviewing or offer
}

const BANDS: { band: string; min: number; max: number }[] = [
  { band: "85-100", min: 85, max: 101 },
  { band: "70-84", min: 70, max: 85 },
  { band: "<70", min: -1, max: 70 },
];

export function statsByAtsBand(applications: SavedApplication[]): AtsBandStats[] {
  return BANDS.map(({ band, min, max }) => {
    const inBand = applications.filter(
      (a) => wasSubmitted(a) && a.atsScore.score >= min && a.atsScore.score < max,
    );
    return {
      band,
      submitted: inBand.length,
      responses: inBand.filter(hasResponse).length,
      interviews: inBand.filter((a) => a.status === "interviewing" || a.status === "offer").length,
    };
  }).filter((b) => b.submitted > 0);
}

export interface ResponseSummary {
  submitted: number;
  responses: number;
  responseRate: number | null; // null when nothing submitted
  medianDaysToResponse: number | null;
}

/** Days from creation to the first status-history entry that counts as a
 * response, for applications that have one. */
export function responseSummary(applications: SavedApplication[]): ResponseSummary {
  const submitted = applications.filter(wasSubmitted);
  const responded = submitted.filter(hasResponse);

  const days: number[] = [];
  for (const app of responded) {
    const first = (app.statusHistory ?? []).find(
      (h) => h.status === "interviewing" || h.status === "offer" || h.status === "rejected",
    );
    if (!first) continue;
    const delta = (new Date(first.at).getTime() - new Date(app.createdAt).getTime()) / 86_400_000;
    if (Number.isFinite(delta) && delta >= 0) days.push(delta);
  }
  days.sort((a, b) => a - b);
  const median = days.length
    ? days.length % 2
      ? days[(days.length - 1) / 2]
      : (days[days.length / 2 - 1] + days[days.length / 2]) / 2
    : null;

  return {
    submitted: submitted.length,
    responses: responded.length,
    responseRate: submitted.length ? responded.length / submitted.length : null,
    medianDaysToResponse: median === null ? null : Math.round(median * 10) / 10,
  };
}

/** Tailoring volume for the last `weeks` ISO-ish weeks (most recent first). */
export function weeklyCounts(applications: SavedApplication[], weeks: number, now = new Date()): number[] {
  const counts = new Array<number>(weeks).fill(0);
  const nowMs = now.getTime();
  for (const app of applications) {
    const age = nowMs - new Date(app.createdAt).getTime();
    if (age < 0) continue;
    const week = Math.floor(age / (7 * 86_400_000));
    if (week < weeks) counts[week] += 1;
  }
  return counts;
}

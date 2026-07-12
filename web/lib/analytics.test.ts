import { describe, expect, it } from "vitest";
import { responseSummary, statsByAtsBand, weeklyCounts } from "./analytics";
import type { ApplicationStatus, SavedApplication } from "./types";

function app(
  status: ApplicationStatus,
  ats: number,
  createdAt: string,
  history: { status: ApplicationStatus; at: string }[] = [],
): SavedApplication {
  return {
    id: crypto.randomUUID(),
    status,
    createdAt,
    updatedAt: createdAt,
    job: { title: "T", company: "C", location: "", description: "d" },
    contact: {
      firstName: "A", lastName: "B", email: "", phone: "", address: "",
      city: "", state: "", postalCode: "", country: "", linkedin: "", website: "",
    },
    summary: "",
    skills: [],
    experience: [],
    education: [],
    certifications: [],
    coverLetterText: "",
    atsScore: { score: ats, matchedKeywords: [], missingKeywords: [], formattingIssues: [], notes: "" },
    statusHistory: history,
  };
}

describe("statsByAtsBand", () => {
  it("buckets submitted applications and counts responses", () => {
    const stats = statsByAtsBand([
      app("applied", 90, "2026-06-01T00:00:00Z"),
      app("interviewing", 88, "2026-06-01T00:00:00Z"),
      app("rejected", 60, "2026-06-01T00:00:00Z"),
      app("draft", 95, "2026-06-01T00:00:00Z"), // never submitted — excluded
    ]);
    const high = stats.find((s) => s.band === "85-100")!;
    expect(high.submitted).toBe(2);
    expect(high.responses).toBe(1);
    expect(high.interviews).toBe(1);
    const low = stats.find((s) => s.band === "<70")!;
    expect(low.submitted).toBe(1);
    expect(low.responses).toBe(1);
    expect(low.interviews).toBe(0);
    expect(stats.find((s) => s.band === "70-84")).toBeUndefined(); // empty band dropped
  });
});

describe("responseSummary", () => {
  it("computes response rate and median days to first response", () => {
    const summary = responseSummary([
      app("interviewing", 80, "2026-06-01T00:00:00Z", [
        { status: "applied", at: "2026-06-01T00:00:00Z" },
        { status: "interviewing", at: "2026-06-05T00:00:00Z" }, // 4 days
      ]),
      app("rejected", 70, "2026-06-01T00:00:00Z", [
        { status: "rejected", at: "2026-06-11T00:00:00Z" }, // 10 days
      ]),
      app("applied", 75, "2026-06-01T00:00:00Z"),
    ]);
    expect(summary.submitted).toBe(3);
    expect(summary.responses).toBe(2);
    expect(summary.responseRate).toBeCloseTo(2 / 3);
    expect(summary.medianDaysToResponse).toBe(7); // median of 4 and 10
  });

  it("returns nulls when nothing was submitted", () => {
    const summary = responseSummary([app("draft", 80, "2026-06-01T00:00:00Z")]);
    expect(summary.responseRate).toBeNull();
    expect(summary.medianDaysToResponse).toBeNull();
  });
});

describe("weeklyCounts", () => {
  it("buckets creations into trailing weeks, most recent first", () => {
    const now = new Date("2026-07-15T00:00:00Z");
    const counts = weeklyCounts(
      [
        app("applied", 80, "2026-07-14T00:00:00Z"), // this week
        app("applied", 80, "2026-07-13T00:00:00Z"), // this week
        app("applied", 80, "2026-07-05T00:00:00Z"), // last week
        app("applied", 80, "2026-05-01T00:00:00Z"), // out of range
      ],
      2,
      now,
    );
    expect(counts).toEqual([2, 1]);
  });
});

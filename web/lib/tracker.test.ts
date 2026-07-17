import { describe, expect, it } from "vitest";
import { buildCsv, duplicateIds, followUpsToIcs, isFollowUpOverdue, responseStats, timeInStage, trackerSummaryMarkdown, weeklyVolume, withStatusChange } from "./tracker";
import type { TailoredApplication } from "./types";

function app(overrides: Partial<TailoredApplication> = {}): TailoredApplication {
  return {
    id: `id-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    job: { title: "Engineer", company: "Acme", location: "Remote", description: "d" },
    profile: {
      contact: { firstName: "A", lastName: "B", email: "a@b.c", phone: "", address: "", city: "", state: "", postalCode: "", country: "", linkedin: "", website: "" },
      summary: "", skills: [], experience: [], education: [], projects: [], certifications: [],
    },
    tailoredSummary: "s",
    tailoredSkills: [],
    tailoredBullets: [],
    coverLetter: "",
    atsScore: 80,
    atsBreakdown: { totalKeywords: 0, matchedKeywords: 0, matched: [], missing: [], score: 80, integrityFlags: [] },
    status: "draft",
    ...overrides,
  };
}

describe("buildCsv", () => {
  it("escapes commas and quotes", () => {
    const csv = buildCsv([app({ notes: 'has, comma and "quote"', job: { title: "T", company: "C", location: "L", description: "d" } })]);
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).toContain('"has, comma and ""quote"""');
  });
});

describe("followUpsToIcs", () => {
  it("emits an event per active follow-up and skips rejected/archived", () => {
    const ics = followUpsToIcs([
      app({ followUpDate: "2026-08-01" }),
      app({ followUpDate: "2026-08-02", status: "rejected" }),
      app({ followUpDate: "2026-08-03", archived: true }),
      app({}),
    ]);
    expect(ics.match(/BEGIN:VEVENT/g)?.length ?? 0).toBe(1);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260801");
  });
});

describe("withStatusChange / timeInStage", () => {
  it("appends to history and stamps updatedAt", () => {
    const a = withStatusChange(app(), "applied");
    expect(a.status).toBe("applied");
    expect(a.statusHistory).toHaveLength(1);
    expect(a.updatedAt).toBeTruthy();
    expect(timeInStage(a)).toBe("today"); // changed just now
    const aged = { ...a, statusHistory: [{ status: "applied" as const, at: new Date(Date.now() - 3 * 86_400_000).toISOString() }] };
    expect(timeInStage(aged)).toBe("3d in applied");
  });

  it("is a no-op for the same status", () => {
    const base = app({ status: "applied" });
    expect(withStatusChange(base, "applied")).toBe(base);
  });
});

describe("isFollowUpOverdue", () => {
  it("flags past dates on active applications only", () => {
    expect(isFollowUpOverdue(app({ followUpDate: "2001-01-01", status: "applied" }))).toBe(true);
    expect(isFollowUpOverdue(app({ followUpDate: "2001-01-01", status: "rejected" }))).toBe(false);
    expect(isFollowUpOverdue(app({ followUpDate: "2999-01-01", status: "applied" }))).toBe(false);
  });
});

describe("duplicateIds", () => {
  it("marks same company+title within 30 days", () => {
    const first = app({ createdAt: "2026-07-01T00:00:00Z" });
    const second = app({ createdAt: "2026-07-10T00:00:00Z" });
    const other = app({ createdAt: "2026-07-10T00:00:00Z", job: { title: "Other", company: "Elsewhere", location: "", description: "d" } });
    const dupes = duplicateIds([first, second, other]);
    expect(dupes.has(first.id)).toBe(true);
    expect(dupes.has(second.id)).toBe(true);
    expect(dupes.has(other.id)).toBe(false);
  });
});

describe("responseStats", () => {
  it("computes rate and per-resume splits", () => {
    const stats = responseStats([
      app({ status: "applied", sentResume: "Tailored" }),
      app({ status: "interview", sentResume: "Tailored" }),
      app({ status: "rejected", sentResume: "Variant: X" }),
      app({ status: "draft" }),
    ]);
    expect(stats.submitted).toBe(3);
    expect(stats.responses).toBe(2);
    expect(stats.interviews).toBe(1);
    expect(stats.byResume.find((r) => r.label === "Tailored")?.responses).toBe(1);
  });
});

describe("weeklyVolume", () => {
  it("buckets by week, oldest first", () => {
    const now = new Date("2026-07-17T00:00:00Z");
    const counts = weeklyVolume(
      [app({ createdAt: "2026-07-16T00:00:00Z" }), app({ createdAt: "2026-07-01T00:00:00Z" })],
      4,
      now,
    );
    expect(counts).toHaveLength(4);
    expect(counts[3]).toBe(1); // this week
    expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
  });
});

describe("trackerSummaryMarkdown", () => {
  it("renders a table of active applications", () => {
    const md = trackerSummaryMarkdown([app({}), app({ archived: true })]);
    expect(md).toContain("| Acme | Engineer |");
    expect(md.match(/\| Acme /g)?.length).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { followUpsToIcs } from "./ics";
import type { SavedApplication } from "./types";

const base: SavedApplication = {
  id: "abc",
  status: "applied",
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  job: { title: "Ops Analyst", company: "Acme, Inc", location: "", description: "d" },
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
  atsScore: { score: 80, matchedKeywords: [], missingKeywords: [], formattingIssues: [], notes: "" },
  followUpAt: "2026-07-20",
};

describe("followUpsToIcs", () => {
  it("emits an all-day VEVENT per follow-up with escaped text", () => {
    const ics = followUpsToIcs([base], new Date("2026-07-12T10:00:00Z"));
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260720");
    expect(ics).toContain("SUMMARY:Follow up: Ops Analyst at Acme\\, Inc");
    expect(ics).toContain("UID:abc@workdayz.local");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("skips terminal statuses and entries without a date", () => {
    const ics = followUpsToIcs([
      { ...base, status: "rejected" },
      { ...base, id: "x", followUpAt: undefined },
    ]);
    expect(ics).not.toContain("VEVENT");
  });
});

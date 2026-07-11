import { describe, expect, it } from "vitest";
import { prepToMarkdown } from "./prep-markdown";
import type { SavedApplication } from "./types";

const baseApp: SavedApplication = {
  id: "a1",
  status: "interviewing",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  job: { title: "Ops Analyst", company: "Acme", location: "", description: "d" },
  contact: {
    firstName: "A",
    lastName: "B",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
    linkedin: "",
    website: "",
  },
  summary: "",
  skills: [],
  experience: [],
  education: [],
  certifications: [],
  coverLetterText: "",
  atsScore: { score: 82, matchedKeywords: [], missingKeywords: [], formattingIssues: [], notes: "" },
  fitAnalysis: { verdict: "Strong fit overall.", strengths: ["s"], gaps: ["No SQL experience"] },
  interviewPrep: {
    generatedAt: "2026-07-02T00:00:00.000Z",
    questions: [
      { question: "Tell me about a forecast you built.", category: "behavioral", talkingPoints: ["Point A", "Point B"] },
      { question: "How do you handle ambiguity?", category: "behavioral", talkingPoints: ["Point C"] },
      { question: "Walk through a SQL join.", category: "technical", talkingPoints: ["Point D"] },
    ],
  },
};

describe("prepToMarkdown", () => {
  it("renders title, fit gaps, and grouped categories", () => {
    const md = prepToMarkdown(baseApp);
    expect(md).toContain("# Interview prep — Ops Analyst at Acme");
    expect(md).toContain("- No SQL experience");
    expect(md).toContain("## Behavioral questions");
    expect(md).toContain("## Technical questions");
    expect(md).toContain("### Walk through a SQL join.");
    expect(md).toContain("- Point D");
    // Both behavioral questions land under one heading.
    expect(md.match(/## Behavioral questions/g)).toHaveLength(1);
  });

  it("returns empty string when there is no prep", () => {
    expect(prepToMarkdown({ ...baseApp, interviewPrep: undefined })).toBe("");
  });
});

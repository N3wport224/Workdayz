import { describe, expect, it } from "vitest";
import { computeAtsScore } from "./ats-score";
import { emptyProfile } from "./storage";
import type { ResumeProfile, TailoredResume } from "./types";

function profile(overrides: Partial<ResumeProfile> = {}): ResumeProfile {
  return { ...emptyProfile, ...overrides };
}

function tailoredResume(overrides: Partial<TailoredResume> = {}): TailoredResume {
  return {
    summary:
      "Experienced backend engineer who ships reliable distributed systems at scale, with a track record of leading cross-functional teams.",
    skills: ["TypeScript", "Node.js", "PostgreSQL", "Kubernetes", "AWS"],
    experience: [
      {
        id: "1",
        bullets: [
          "Reduced API p99 latency by 42% through query optimization and caching.",
          "Led a team of 4 engineers to migrate the billing service to Kubernetes.",
        ],
      },
    ],
    ...overrides,
  };
}

describe("computeAtsScore", () => {
  it("scores full keyword coverage highly with no formatting issues", () => {
    const result = computeAtsScore(
      ["TypeScript", "Node.js", "Kubernetes"],
      tailoredResume(),
      profile({ skills: ["TypeScript", "Node.js", "PostgreSQL", "Kubernetes", "AWS"] }),
    );
    expect(result.matchedKeywords).toEqual(["TypeScript", "Node.js", "Kubernetes"]);
    expect(result.missingKeywords).toEqual([]);
    expect(result.score).toBe(100);
    expect(result.formattingIssues).toEqual([]);
  });

  it("reports missing keywords that don't appear anywhere in the tailored resume", () => {
    const result = computeAtsScore(
      ["TypeScript", "GraphQL", "Rust"],
      tailoredResume(),
      profile({ skills: tailoredResume().skills }),
    );
    expect(result.matchedKeywords).toEqual(["TypeScript"]);
    expect(result.missingKeywords).toEqual(["GraphQL", "Rust"]);
    expect(result.score).toBeLessThan(100);
  });

  it("is case-insensitive and ignores punctuation when matching keywords", () => {
    const result = computeAtsScore(
      ["node.js", "TYPESCRIPT"],
      tailoredResume({ summary: "Builds services in TypeScript and Node.js for production workloads.", skills: [] }),
      profile(),
    );
    expect(result.matchedKeywords).toEqual(["node.js", "TYPESCRIPT"]);
  });

  it("flags a short summary as a formatting issue", () => {
    const result = computeAtsScore([], tailoredResume({ summary: "Engineer." }), profile());
    expect(result.formattingIssues).toContain(
      "Summary is short or missing — aim for 2-4 sentences covering your top qualifications.",
    );
  });

  it("flags having fewer than 5 skills", () => {
    const result = computeAtsScore([], tailoredResume({ skills: ["TypeScript"] }), profile());
    expect(result.formattingIssues).toContain(
      "Fewer than 5 skills listed — add more relevant keywords from the job description if truthful.",
    );
  });

  it("flags bullets with no quantified results", () => {
    const result = computeAtsScore(
      [],
      tailoredResume({
        experience: [
          { id: "1", bullets: ["Helped improve the checkout flow.", "Worked closely with design on UX."] },
        ],
      }),
      profile(),
    );
    expect(result.formattingIssues.some((i) => i.includes("quantified results"))).toBe(true);
  });

  it("flags experience with no bullets at all", () => {
    const result = computeAtsScore([], tailoredResume({ experience: [] }), profile());
    expect(result.formattingIssues).toContain("No experience bullets were generated.");
  });

  it("flags skills added by the model that aren't found anywhere in the source profile", () => {
    const sourceProfile = profile({
      summary: "Backend engineer.",
      skills: ["TypeScript"],
      experience: [{ id: "1", company: "Acme", title: "Engineer", location: "", startDate: "", endDate: "", bullets: ["Wrote APIs in TypeScript."] }],
    });
    const result = computeAtsScore(
      [],
      tailoredResume({ skills: ["TypeScript", "Kubernetes", "Rust"] }),
      sourceProfile,
    );
    expect(result.notes).toContain("Kubernetes, Rust");
  });

  it("does not flag skills that appear in the source profile's bullets even if not in its skills list", () => {
    const sourceProfile = profile({
      skills: [],
      experience: [
        { id: "1", company: "Acme", title: "Engineer", location: "", startDate: "", endDate: "", bullets: ["Deployed services with Kubernetes and Terraform."] },
      ],
    });
    const result = computeAtsScore([], tailoredResume({ skills: ["Kubernetes"] }), sourceProfile);
    expect(result.notes).not.toContain("Kubernetes");
  });

  it("clamps the score between 0 and 100", () => {
    const result = computeAtsScore(
      Array.from({ length: 20 }, (_, i) => `keyword-${i}`),
      tailoredResume({ summary: "", skills: [], experience: [] }),
      profile(),
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("treats an empty keyword list as full coverage", () => {
    const result = computeAtsScore([], tailoredResume(), profile());
    expect(result.matchedKeywords).toEqual([]);
    expect(result.missingKeywords).toEqual([]);
  });
});

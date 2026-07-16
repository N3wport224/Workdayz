import { describe, expect, it } from "vitest";
import { scoreResume, scoreLabel } from "./ats-score";
import type { ResumeProfile } from "./types";

function profile(overrides: Partial<ResumeProfile> = {}): ResumeProfile {
  return {
    contact: {
      firstName: "", lastName: "", email: "a@b.c", phone: "", address: "",
      city: "", state: "", postalCode: "", country: "", linkedin: "", website: "",
    },
    summary: "",
    skills: [],
    experience: [],
    education: [],
    certifications: [],
    projects: [],
    ...overrides,
  };
}

describe("scoreResume", () => {
  it("scores higher when the tailored resume covers the job's keywords", () => {
    const jd = "We need a TypeScript engineer with Kubernetes and PostgreSQL experience.";
    const covered = scoreResume(
      jd,
      "TypeScript Engineer",
      "Backend engineer",
      ["TypeScript", "Kubernetes", "PostgreSQL"],
      ["Built services in TypeScript on Kubernetes backed by PostgreSQL."],
      profile({ skills: ["TypeScript", "Kubernetes", "PostgreSQL"] }),
    );
    const bare = scoreResume(
      jd,
      "TypeScript Engineer",
      "Office worker",
      ["Excel"],
      ["Did general office work."],
      profile({ skills: ["Excel"] }),
    );
    expect(covered.score).toBeGreaterThan(bare.score);
    expect(covered.matched.length).toBeGreaterThan(0);
  });

  it("flags tailored skills that aren't traceable to the original profile", () => {
    const result = scoreResume(
      "Rust systems programming role.",
      "Rust Engineer",
      "JavaScript developer",
      ["Rust"],
      ["Wrote systems code."],
      profile({ skills: ["JavaScript"], summary: "JavaScript developer" }),
    );
    expect(result.integrityFlags.some((f) => f.toLowerCase().includes("rust"))).toBe(true);
  });

  it("returns a well-formed AtsBreakdown", () => {
    const result = scoreResume("Sales role", "Sales", "Sales pro", ["Sales"], ["Sold things."], profile({ skills: ["Sales"] }));
    expect(typeof result.score).toBe("number");
    expect(Array.isArray(result.matched)).toBe(true);
    expect(Array.isArray(result.missing)).toBe(true);
    expect(Array.isArray(result.integrityFlags)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("counts a structured certification's name as evidence for a matching skill", () => {
    // Regression: certifications are now objects; their names must feed the
    // integrity corpus (not stringify to "[object Object]"), so a skill backed
    // by a cert of the same name is NOT flagged as unverifiable.
    const result = scoreResume(
      "PMP-certified project manager needed.",
      "Project Manager",
      "Certified PM",
      ["PMP"],
      ["Managed projects."],
      profile({ certifications: [{ id: "c1", name: "PMP" }] }),
    );
    expect(result.integrityFlags.some((f) => f.includes("PMP"))).toBe(false);
  });
});

describe("scoreLabel", () => {
  it("labels score bands", () => {
    expect(scoreLabel(95)).toBe("Excellent");
    expect(scoreLabel(30)).toBe("Needs Work");
  });
});

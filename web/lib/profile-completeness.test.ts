import { describe, expect, it } from "vitest";
import { computeCompleteness } from "./profile-completeness";
import { emptyProfile } from "./storage";
import type { ResumeProfile } from "./types";

const fullProfile: ResumeProfile = {
  contact: {
    firstName: "Alex", lastName: "Perez", email: "a@b.com", phone: "555",
    address: "", city: "Austin", state: "TX", postalCode: "78701",
    country: "USA", linkedin: "linkedin.com/in/x", website: "",
  },
  summary: Array(25).fill("word").join(" "),
  skills: ["a", "b", "c", "d", "e"],
  experience: [
    { id: "1", company: "Acme", title: "Eng", location: "", startDate: "2020-01", endDate: "Present", bullets: ["one", "two", "three"] },
  ],
  education: [{ id: "1", school: "UT", degree: "BS", fieldOfStudy: "CS", startDate: "", endDate: "" }],
  certifications: [],
};

describe("computeCompleteness", () => {
  it("scores an empty profile at 0 with many suggestions", () => {
    const r = computeCompleteness(emptyProfile);
    expect(r.score).toBe(0);
    expect(r.suggestions.length).toBeGreaterThan(5);
  });

  it("scores a complete profile at 100 with no suggestions", () => {
    const r = computeCompleteness(fullProfile);
    expect(r.score).toBe(100);
    expect(r.suggestions).toEqual([]);
  });

  it("drops below 100 with a targeted suggestion when skills are thin", () => {
    const r = computeCompleteness({ ...fullProfile, skills: ["one"] });
    expect(r.score).toBeLessThan(100);
    expect(r.suggestions.some((s) => s.includes("5 skills"))).toBe(true);
  });
});

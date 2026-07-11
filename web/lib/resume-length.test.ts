import { describe, expect, it } from "vitest";
import { estimateResumePages } from "./resume-length";

const base = {
  summary: "A short professional summary of the candidate's background and strengths.",
  skills: ["TypeScript", "React", "Node.js"],
  experience: [
    { title: "Engineer", company: "Acme", bullets: ["Did a thing with 42% impact", "Shipped another thing"] },
  ],
  education: [{ school: "UT", degree: "BS" }],
  certifications: [],
};

describe("estimateResumePages", () => {
  it("estimates a small resume at about one page", () => {
    const pages = estimateResumePages(base);
    expect(pages).toBeGreaterThan(0.2);
    expect(pages).toBeLessThanOrEqual(1);
  });

  it("grows monotonically with more content", () => {
    const bigger = {
      ...base,
      experience: Array(6).fill({
        title: "Engineer",
        company: "Acme",
        bullets: Array(6).fill("Delivered a meaningful outcome measured at 30% improvement across the platform"),
      }),
    };
    expect(estimateResumePages(bigger)).toBeGreaterThan(estimateResumePages(base));
  });
});

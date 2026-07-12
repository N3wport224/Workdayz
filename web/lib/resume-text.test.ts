import { describe, expect, it } from "vitest";
import { resumeToText } from "./resume-text";

describe("resumeToText", () => {
  it("renders sections in PDF order with contact line", () => {
    const text = resumeToText({
      contact: {
        firstName: "Alex", lastName: "Perez", email: "a@b.c", phone: "555",
        address: "", city: "Austin", state: "TX", postalCode: "", country: "",
        linkedin: "linkedin.com/in/alex", website: "",
      },
      summary: "Ops analyst.",
      skills: ["Excel", "SQL"],
      experience: [
        {
          id: "1", company: "Acme", title: "Analyst", location: "Austin",
          startDate: "2021-01", endDate: "Present", bullets: ["Built dashboards."],
        },
      ],
      education: [
        { id: "e", school: "UT", degree: "BS", fieldOfStudy: "Math", startDate: "2016", endDate: "2020", gpa: "3.8" },
      ],
      certifications: ["PMP"],
      projects: [{ id: "p", name: "Forecast tool", description: "Python model." }],
    });
    expect(text).toContain("ALEX PEREZ");
    expect(text).toContain("a@b.c | 555 | Austin, TX | linkedin.com/in/alex");
    expect(text.indexOf("SUMMARY")).toBeLessThan(text.indexOf("SKILLS"));
    expect(text.indexOf("EXPERIENCE")).toBeLessThan(text.indexOf("PROJECTS"));
    expect(text).toContain("- Built dashboards.");
    expect(text).toContain("BS in Math, UT (2016 - 2020) — GPA 3.8");
    expect(text).toContain("Forecast tool: Python model.");
    expect(text).toContain("CERTIFICATIONS\nPMP");
  });
});

import { describe, expect, it } from "vitest";
import { analyzeBullet } from "./bullet-strength";

describe("analyzeBullet", () => {
  it("rates a quantified action-verb bullet strong", () => {
    const r = analyzeBullet("Reduced API p99 latency by 42% through query optimization and caching");
    expect(r.rating).toBe("strong");
    expect(r.tips).toEqual([]);
  });

  it("flags weak openers", () => {
    const r = analyzeBullet("Responsible for maintaining the customer database and running 3 reports");
    expect(r.tips.some((t) => t.includes("action verb"))).toBe(true);
  });

  it("flags missing quantification", () => {
    const r = analyzeBullet("Led migration of the monolith to microservices for the platform team");
    expect(r.tips.some((t) => t.includes("quantified"))).toBe(true);
    expect(r.rating).toBe("ok");
  });

  it("flags very short bullets", () => {
    const r = analyzeBullet("Wrote code");
    expect(r.rating).toBe("weak");
  });

  it("flags empty bullets", () => {
    expect(analyzeBullet("   ").rating).toBe("weak");
  });

  it("flags run-on bullets", () => {
    const long = Array(40).fill("word").join(" ") + " 42%";
    expect(analyzeBullet("Led " + long).tips.some((t) => t.includes("tighten"))).toBe(true);
  });
});

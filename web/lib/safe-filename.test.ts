import { describe, expect, it } from "vitest";
import { safeFilenamePart } from "./safe-filename";

describe("safeFilenamePart", () => {
  it("passes through plain names", () => {
    expect(safeFilenamePart("Alex_Perez", "Candidate")).toBe("Alex_Perez");
  });

  it("strips quotes, commas, and other header-breaking characters", () => {
    expect(safeFilenamePart(`Alex "AJ" O'Brien, Jr.`, "Candidate")).toBe("Alex_AJ_O_Brien_Jr");
  });

  it("strips newlines (header injection)", () => {
    const out = safeFilenamePart("Alex\r\nContent-Type: evil", "Candidate");
    expect(out).not.toMatch(/[\r\n":]/);
    expect(out).toBe("AlexContent-Type_evil");
  });

  it("decomposes accented characters instead of dropping the whole name", () => {
    expect(safeFilenamePart("José Muñoz", "Candidate")).toBe("Jose_Munoz");
  });

  it("falls back when nothing survives", () => {
    expect(safeFilenamePart("日本語のみ", "Candidate")).toBe("Candidate");
    expect(safeFilenamePart("", "Candidate")).toBe("Candidate");
  });

  it("caps length", () => {
    expect(safeFilenamePart("a".repeat(200), "Candidate")).toHaveLength(60);
  });
});

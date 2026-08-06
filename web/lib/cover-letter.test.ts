import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_CHARS,
  MAX_MAX_CHARS,
  MIN_MAX_CHARS,
  resolveMaxChars,
  trimToCharBudget,
} from "./cover-letter";

describe("resolveMaxChars", () => {
  it("defaults to Workday's common 4,000-character cap", () => {
    expect(resolveMaxChars(undefined)).toBe(4000);
    expect(DEFAULT_MAX_CHARS).toBe(4000);
  });

  it("accepts a valid explicit cap", () => {
    expect(resolveMaxChars(2000)).toBe(2000);
  });

  it("clamps absurdly small caps up to the floor", () => {
    expect(resolveMaxChars(10)).toBe(MIN_MAX_CHARS);
    expect(resolveMaxChars(0)).toBe(MIN_MAX_CHARS);
    expect(resolveMaxChars(-500)).toBe(MIN_MAX_CHARS);
  });

  it("clamps absurdly large caps down to the ceiling", () => {
    expect(resolveMaxChars(10_000_000)).toBe(MAX_MAX_CHARS);
  });

  it("ignores non-numeric and non-finite input", () => {
    expect(resolveMaxChars("4000")).toBe(DEFAULT_MAX_CHARS);
    expect(resolveMaxChars(null)).toBe(DEFAULT_MAX_CHARS);
    expect(resolveMaxChars(NaN)).toBe(DEFAULT_MAX_CHARS);
    expect(resolveMaxChars(Infinity)).toBe(DEFAULT_MAX_CHARS);
    expect(resolveMaxChars({})).toBe(DEFAULT_MAX_CHARS);
  });

  it("floors fractional caps", () => {
    expect(resolveMaxChars(2000.9)).toBe(2000);
  });
});

describe("trimToCharBudget", () => {
  it("leaves text that already fits untouched", () => {
    const text = "Short and sweet.";
    const { body, trimmed } = trimToCharBudget(text, 4000);
    expect(body).toBe(text);
    expect(trimmed).toBe(false);
  });

  it("trims trailing whitespace without flagging a trim", () => {
    const { body, trimmed } = trimToCharBudget("  padded  ", 4000);
    expect(body).toBe("padded");
    expect(trimmed).toBe(false);
  });

  it("drops whole paragraphs first", () => {
    const p1 = "A".repeat(90);
    const p2 = "B".repeat(90);
    const p3 = "C".repeat(90);
    const { body, trimmed } = trimToCharBudget([p1, p2, p3].join("\n\n"), 200);
    expect(trimmed).toBe(true);
    // Two paragraphs (90 + 2 + 90 = 182) fit; the third would overshoot.
    expect(body).toBe(`${p1}\n\n${p2}`);
    expect(body).not.toContain("C");
  });

  it("falls back to whole sentences when there is one long paragraph", () => {
    const text = "First sentence here. Second sentence here. Third sentence here.";
    const { body, trimmed } = trimToCharBudget(text, 45);
    expect(trimmed).toBe(true);
    expect(body).toBe("First sentence here. Second sentence here.");
    expect(body.endsWith(".")).toBe(true);
  });

  it("never cuts mid-word when it has to fall back to a word boundary", () => {
    // One paragraph, no sentence punctuation at all.
    const text = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
    const { body, trimmed } = trimToCharBudget(text, 25);
    expect(trimmed).toBe(true);
    expect(body.length).toBeLessThanOrEqual(25);
    // Every retained token must be a complete word from the source.
    const words = text.split(" ");
    for (const word of body.split(" ")) expect(words).toContain(word);
  });

  it("always respects the budget across a range of caps", () => {
    const text = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} sentence one. Sentence two here.`).join("\n\n");
    for (const cap of [MIN_MAX_CHARS, 500, 750, 1000, 2000]) {
      const { body } = trimToCharBudget(text, cap);
      expect(body.length).toBeLessThanOrEqual(cap);
    }
  });

  it("handles a single word longer than the whole budget", () => {
    const { body, trimmed } = trimToCharBudget("Supercalifragilistic", 10);
    expect(trimmed).toBe(true);
    expect(body.length).toBeLessThanOrEqual(10);
  });

  it("handles empty input", () => {
    expect(trimToCharBudget("", 4000)).toEqual({ body: "", trimmed: false });
    expect(trimToCharBudget("   ", 4000)).toEqual({ body: "", trimmed: false });
  });

  it("preserves paragraph breaks in what it keeps", () => {
    const text = "One.\n\nTwo.\n\nThree.";
    const { body } = trimToCharBudget(text, 11);
    expect(body).toContain("\n\n");
  });

  it("reports trimmed=true exactly when it shortened the content", () => {
    const long = "X".repeat(5000);
    expect(trimToCharBudget(long, 4000).trimmed).toBe(true);
    expect(trimToCharBudget("X".repeat(4000), 4000).trimmed).toBe(false);
    expect(trimToCharBudget("X".repeat(3999), 4000).trimmed).toBe(false);
  });

  it("is idempotent — trimming an already-trimmed body changes nothing", () => {
    const text = Array.from({ length: 8 }, (_, i) => `Para ${i}. More text here.`).join("\n\n");
    const once = trimToCharBudget(text, 100);
    const twice = trimToCharBudget(once.body, 100);
    expect(twice.body).toBe(once.body);
    expect(twice.trimmed).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { segmentByKeywords } from "./highlight-keywords";

describe("segmentByKeywords", () => {
  it("marks matched and missing keywords, case-insensitively", () => {
    const segments = segmentByKeywords(
      "We use TypeScript and graphql daily.",
      ["typescript"],
      ["GraphQL"],
    );
    expect(segments).toEqual([
      { text: "We use ", kind: "plain" },
      { text: "TypeScript", kind: "matched" },
      { text: " and ", kind: "plain" },
      { text: "graphql", kind: "missing" },
      { text: " daily.", kind: "plain" },
    ]);
  });

  it("returns one plain segment when there are no keywords", () => {
    expect(segmentByKeywords("Hello world", [], [])).toEqual([
      { text: "Hello world", kind: "plain" },
    ]);
  });

  it("respects word boundaries — ml must not match inside html", () => {
    const segments = segmentByKeywords("We write html pages.", ["ml"], []);
    expect(segments).toEqual([{ text: "We write html pages.", kind: "plain" }]);
  });

  it("prefers the longest keyword when they overlap", () => {
    const segments = segmentByKeywords(
      "Experience with project management required.",
      ["project management"],
      ["project"],
    );
    expect(segments.find((s) => s.kind === "matched")?.text).toBe("project management");
    expect(segments.some((s) => s.kind === "missing")).toBe(false);
  });

  it("handles regex-special keywords like C++ safely", () => {
    const segments = segmentByKeywords("Knows C++ well.", ["C++"], []);
    expect(segments).toEqual([
      { text: "Knows ", kind: "plain" },
      { text: "C++", kind: "matched" },
      { text: " well.", kind: "plain" },
    ]);
  });

  it("round-trips: concatenated segments equal the input text", () => {
    const text = "TypeScript, Rust, and Go — plus Kubernetes on AWS.";
    const segments = segmentByKeywords(text, ["Rust", "Kubernetes"], ["Go", "AWS"]);
    expect(segments.map((s) => s.text).join("")).toBe(text);
  });
});

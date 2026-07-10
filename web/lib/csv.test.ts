import { describe, expect, it } from "vitest";
import { buildCsv } from "./csv";

describe("buildCsv", () => {
  it("joins plain values with commas and CRLF", () => {
    expect(buildCsv([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d");
  });

  it("quotes values containing commas", () => {
    expect(buildCsv([["Engineer, Senior", "Acme"]])).toBe('"Engineer, Senior",Acme');
  });

  it("doubles embedded quotes", () => {
    expect(buildCsv([['the "best" role']])).toBe('"the ""best"" role"');
  });

  it("quotes values containing newlines", () => {
    expect(buildCsv([["line1\nline2"]])).toBe('"line1\nline2"');
  });

  it("leaves clean values unquoted", () => {
    expect(buildCsv([["hello world"]])).toBe("hello world");
  });
});

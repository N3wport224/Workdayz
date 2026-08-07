/**
 * Legacy certification coercion.
 *
 * `ResumeProfile.certifications` used to be `string[]` and became structured
 * `CertificationEntry` objects, but nothing normalized stored data on read.
 * That was invisible while no UI touched certifications. Now that the profile
 * page renders and edits them, an un-coerced legacy profile would show blank
 * name fields and then write mixed strings-and-objects back on the next save —
 * silently corrupting the record rather than failing loudly.
 *
 * These cover the coercion itself; the rendering path is covered by the
 * browser journey suite.
 */
import { describe, expect, it } from "vitest";
import { normalizeCertifications } from "./storage";

describe("normalizeCertifications — legacy string[] profiles", () => {
  it("converts bare strings into structured entries", () => {
    const result = normalizeCertifications(["AWS Solutions Architect", "CompTIA Security+"]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("AWS Solutions Architect");
    expect(result[1].name).toBe("CompTIA Security+");
  });

  it("gives every coerced entry a stable id for React keys and edit handlers", () => {
    const result = normalizeCertifications(["One", "Two", "Three"]);
    const ids = result.map((c) => c.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(3);
  });

  it("leaves issuer and dates undefined rather than inventing them", () => {
    // A legacy string carries no issuer or date. Filling in a guess would put
    // unverifiable data on a resume.
    const [cert] = normalizeCertifications(["AWS Solutions Architect"]);
    expect(cert.issuer).toBeUndefined();
    expect(cert.issueDate).toBeUndefined();
    expect(cert.expirationDate).toBeUndefined();
  });

  it("drops empty and whitespace-only strings", () => {
    expect(normalizeCertifications(["", "   ", "Real Cert"])).toHaveLength(1);
  });
});

describe("normalizeCertifications — already-structured profiles", () => {
  it("passes structured entries through unchanged", () => {
    const input = [
      { id: "c1", name: "AWS", issuer: "Amazon", issueDate: "03/2024", expirationDate: "03/2027" },
    ];
    expect(normalizeCertifications(input)).toEqual(input);
  });

  it("preserves every optional field", () => {
    const [cert] = normalizeCertifications([
      { id: "c1", name: "CKA", issuer: "CNCF", issueDate: "01/2025" },
    ]);
    expect(cert.issuer).toBe("CNCF");
    expect(cert.issueDate).toBe("01/2025");
  });

  it("backfills a missing id on hand-edited or older structured data", () => {
    const [cert] = normalizeCertifications([{ name: "No id here" }]);
    expect(cert.id).toBeTruthy();
    expect(cert.name).toBe("No id here");
  });

  it("keeps an entry whose name is empty so the user can finish typing it", () => {
    // Distinct from a legacy empty STRING, which is pure noise. An empty
    // object is a row the user just added and is mid-edit on.
    expect(normalizeCertifications([{ id: "c1", name: "" }])).toHaveLength(1);
  });

  it("coerces a non-string name rather than letting it reach the UI", () => {
    const [cert] = normalizeCertifications([{ id: "c1", name: 42 }]);
    expect(cert.name).toBe("");
  });
});

describe("normalizeCertifications — mixed and malformed input", () => {
  it("handles a half-migrated profile with both shapes", () => {
    const result = normalizeCertifications([
      "Legacy String Cert",
      { id: "c2", name: "Structured Cert", issuer: "Issuer" },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Legacy String Cert");
    expect(result[1].issuer).toBe("Issuer");
    expect(new Set(result.map((c) => c.id)).size).toBe(2);
  });

  it("drops nulls and primitives instead of crashing the page", () => {
    const result = normalizeCertifications([null, undefined, 42, true, "Real"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Real");
  });

  it("returns an empty array for non-array input", () => {
    expect(normalizeCertifications(undefined)).toEqual([]);
    expect(normalizeCertifications(null)).toEqual([]);
    expect(normalizeCertifications("AWS")).toEqual([]);
    expect(normalizeCertifications({ name: "AWS" })).toEqual([]);
  });

  it("is idempotent — normalizing twice changes nothing", () => {
    // loadProfile runs on every read, so a saved-then-reloaded profile must not
    // drift (e.g. ids regenerating and breaking React reconciliation).
    const once = normalizeCertifications(["Legacy", { id: "c2", name: "Structured" }]);
    expect(normalizeCertifications(once)).toEqual(once);
  });

  it("produces entries safe for the outbound string[] shapes", () => {
    // BaseProfile and AutofillPackage derive `certifications: string[]` via
    // `.map(c => c.name)`. Every entry must yield a string, never undefined.
    const result = normalizeCertifications(["Legacy", { id: "c2" }, { id: "c3", name: "Named" }]);
    for (const name of result.map((c) => c.name)) {
      expect(typeof name).toBe("string");
    }
  });
});

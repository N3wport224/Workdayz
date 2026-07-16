import { describe, expect, it } from "vitest";
import { createDemoProfile, loadProfile, saveProfile } from "./storage";

describe("storage", () => {
  it("loadProfile returns null when localStorage is unavailable (SSR/node)", () => {
    expect(loadProfile()).toBeNull();
  });

  it("saveProfile is a no-op without throwing when localStorage is unavailable", () => {
    expect(() => saveProfile(createDemoProfile())).not.toThrow();
  });

  describe("createDemoProfile", () => {
    it("returns a fully-shaped ResumeProfile", () => {
      const p = createDemoProfile();
      expect(typeof p.contact.firstName).toBe("string");
      expect(p.contact.firstName.length).toBeGreaterThan(0);
      expect(Array.isArray(p.skills)).toBe(true);
      expect(Array.isArray(p.experience)).toBe(true);
      expect(Array.isArray(p.education)).toBe(true);
      expect(Array.isArray(p.projects)).toBe(true);
    });

    it("returns certifications as structured entries (name required)", () => {
      const p = createDemoProfile();
      expect(Array.isArray(p.certifications)).toBe(true);
      for (const cert of p.certifications) {
        expect(typeof cert.id).toBe("string");
        expect(typeof cert.name).toBe("string");
      }
    });
  });
});

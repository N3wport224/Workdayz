import { describe, expect, it } from "vitest";
import { emptyProfile, hasProfile, loadProfile, mergeProfile, saveProfile } from "./storage";

describe("storage", () => {
  it("loadProfile returns the empty profile when there is no window (SSR)", () => {
    expect(loadProfile()).toEqual(emptyProfile);
  });

  it("saveProfile is a no-op without throwing when there is no window (SSR)", () => {
    expect(() => saveProfile(emptyProfile)).not.toThrow();
  });

  describe("mergeProfile", () => {
    it("fills missing top-level fields from the empty profile", () => {
      const merged = mergeProfile({ summary: "hi" });
      expect(merged.summary).toBe("hi");
      expect(merged.skills).toEqual([]);
      expect(merged.contact.firstName).toBe("");
    });

    it("deep-merges contact so partial contacts keep every key as a string", () => {
      const merged = mergeProfile({
        contact: { firstName: "Alex" } as Partial<typeof emptyProfile.contact> as typeof emptyProfile.contact,
      });
      expect(merged.contact.firstName).toBe("Alex");
      expect(merged.contact.linkedin).toBe("");
    });

    it("returns the empty profile for garbage input", () => {
      expect(mergeProfile(null)).toEqual(emptyProfile);
      expect(mergeProfile(undefined)).toEqual(emptyProfile);
    });
  });

  describe("hasProfile", () => {
    it("is false for an empty profile", () => {
      expect(hasProfile(emptyProfile)).toBe(false);
    });

    it("is false when only one of firstName/email is set", () => {
      expect(hasProfile({ ...emptyProfile, contact: { ...emptyProfile.contact, firstName: "Alex" } })).toBe(false);
    });

    it("is true once firstName and email are both set", () => {
      expect(
        hasProfile({
          ...emptyProfile,
          contact: { ...emptyProfile.contact, firstName: "Alex", email: "alex@example.com" },
        }),
      ).toBe(true);
    });
  });
});

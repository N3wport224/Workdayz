import { describe, expect, it } from "vitest";
import { emptyProfile, hasProfile, loadProfile, saveProfile } from "./storage";

describe("storage", () => {
  it("loadProfile returns the empty profile when there is no window (SSR)", () => {
    expect(loadProfile()).toEqual(emptyProfile);
  });

  it("saveProfile is a no-op without throwing when there is no window (SSR)", () => {
    expect(() => saveProfile(emptyProfile)).not.toThrow();
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

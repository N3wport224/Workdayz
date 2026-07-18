import { describe, expect, it } from "vitest";
import { decryptBackup, encryptBackup, isEncryptedBackup, type EncryptedBackup } from "./crypto-backup";

describe("crypto-backup", () => {
  it("round-trips plaintext with the right passphrase", async () => {
    const encrypted = await encryptBackup('{"hello":"world"}', "correct horse");
    expect(isEncryptedBackup(encrypted)).toBe(true);
    expect(encrypted.ciphertext).not.toContain("hello");
    const decrypted = await decryptBackup(encrypted, "correct horse");
    expect(decrypted).toBe('{"hello":"world"}');
  });

  it("rejects the wrong passphrase", async () => {
    const encrypted = await encryptBackup("secret", "right");
    await expect(decryptBackup(encrypted, "wrong")).rejects.toThrow();
  });

  it("does not recognize plain objects as encrypted backups", () => {
    expect(isEncryptedBackup({ workdayzBackup: true })).toBe(false);
    expect(isEncryptedBackup(null)).toBe(false);
  });

  it("stamps new backups with the current (bumped) iteration count", async () => {
    const encrypted = await encryptBackup("data", "passphrase");
    expect(encrypted.iterations).toBe(600_000);
  });

  it("still decrypts a legacy backup with no iterations field (pre-bump default)", async () => {
    // Reproduces exactly what the old encryptBackup() produced: PBKDF2 at
    // 310_000 iterations and no `iterations` key on the object at all.
    const passphrase = "legacy passphrase";
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt as BufferSource, iterations: 310_000, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode("old data"));
    const legacyBackup: EncryptedBackup = {
      workdayzEncrypted: true,
      version: 1,
      salt: btoa(String.fromCharCode(...salt)),
      iv: btoa(String.fromCharCode(...iv)),
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
      // no `iterations` field — this is the point of the test
    };
    const decrypted = await decryptBackup(legacyBackup, passphrase);
    expect(decrypted).toBe("old data");
  });
});

import { describe, expect, it } from "vitest";
import { decryptBackup, encryptBackup, isEncryptedBackup } from "./crypto-backup";

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
});

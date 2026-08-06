/**
 * End-to-end backup round trip: encrypt web-side → cross the bridge → store as
 * the extension stores it → come back → decrypt → restore.
 *
 * The point is the SEAM. Encryption and storage are each already tested; what
 * isn't obvious is whether base64 ciphertext survives being JSON-serialized
 * into chrome.storage.local and back without a byte changing. A single mangled
 * byte fails GCM authentication and the backup is gone — silently, and only
 * discovered on the day someone needs it.
 *
 * The fake storage below mirrors chrome.storage.local's actual behavior: values
 * are structured-cloned, which for our purposes means a JSON round trip.
 */
import { describe, expect, it } from "vitest";
import { decryptBackup, encryptBackup, isEncryptedBackup } from "./crypto-backup";
import { isFullBackup, type FullBackup } from "./full-backup";

/** A snapshot as it travels over postMessage and lands in chrome.storage.local. */
interface Snapshot {
  version: 1;
  createdAt: string;
  encrypted: boolean;
  payload: string;
  applications: number;
  profiles: number;
}

/**
 * Stand-in for chrome.storage.local. Serializes on write and parses on read,
 * which is what makes this a real test of the seam rather than passing the same
 * object reference around.
 */
class FakeExtensionStorage {
  private raw = new Map<string, string>();

  set(key: string, value: unknown): void {
    this.raw.set(key, JSON.stringify(value));
  }

  get<T>(key: string): T | null {
    const stored = this.raw.get(key);
    return stored === undefined ? null : (JSON.parse(stored) as T);
  }
}

function sampleBackup(): FullBackup {
  return {
    workdayzBackup: true,
    version: 1,
    exportedAt: "2026-03-20T12:00:00.000Z",
    entries: {
      "workdayz-applications": JSON.stringify([
        { id: "a1", job: { title: "Platform Engineer", company: "Acme" }, status: "applied" },
      ]),
      "workdayz-profiles": JSON.stringify({ Default: { summary: "Engineer with 8 years." } }),
      "workdayz-settings": JSON.stringify({ model: "" }),
    },
  };
}

const PASSPHRASE = "correct horse battery staple";

/** The full path a snapshot takes, with the storage seam in the middle. */
async function roundTrip(backup: FullBackup, passphrase: string, storage = new FakeExtensionStorage()) {
  // 1. Web app encrypts — the user is present to supply the passphrase.
  const envelope = await encryptBackup(JSON.stringify(backup), passphrase);

  // 2. Crosses postMessage as a plain JSON string payload.
  const snapshot: Snapshot = {
    version: 1,
    createdAt: "2026-03-20T12:00:00.000Z",
    encrypted: true,
    payload: JSON.stringify(envelope),
    applications: 1,
    profiles: 1,
  };

  // 3. Extension stores it. Never decrypts; never holds the passphrase.
  storage.set("workdayz.backupSnapshots", [snapshot]);

  // 4. Later: the web app pulls it back.
  const restoredList = storage.get<Snapshot[]>("workdayz.backupSnapshots");
  const pulled = restoredList?.[restoredList.length - 1];
  return { pulled, envelope };
}

describe("backup round trip across the bridge", () => {
  it("survives encrypt → store → retrieve → decrypt intact", async () => {
    const original = sampleBackup();
    const { pulled } = await roundTrip(original, PASSPHRASE);

    expect(pulled).toBeTruthy();
    const parsed = JSON.parse(pulled!.payload);
    expect(isEncryptedBackup(parsed)).toBe(true);

    const plaintext = await decryptBackup(parsed, PASSPHRASE);
    const decoded = JSON.parse(plaintext);
    expect(isFullBackup(decoded)).toBe(true);
    expect(decoded).toEqual(original);
  });

  it("preserves the ciphertext byte-for-byte through storage", async () => {
    const { pulled, envelope } = await roundTrip(sampleBackup(), PASSPHRASE);
    const parsed = JSON.parse(pulled!.payload);

    // A single altered byte fails GCM auth, so this is the assertion that
    // catches a transport or serialization bug before a user does.
    expect(parsed.ciphertext).toBe(envelope.ciphertext);
    expect(parsed.salt).toBe(envelope.salt);
    expect(parsed.iv).toBe(envelope.iv);
    expect(parsed.iterations).toBe(envelope.iterations);
  });

  it("carries the PBKDF2 iteration count so future changes stay decryptable", async () => {
    const { pulled } = await roundTrip(sampleBackup(), PASSPHRASE);
    const parsed = JSON.parse(pulled!.payload);
    // Stamped per-backup rather than read from a shared constant — otherwise
    // bumping the constant would break every snapshot already stored.
    expect(parsed.iterations).toBe(600_000);
  });

  it("rejects the wrong passphrase rather than returning garbage", async () => {
    const { pulled } = await roundTrip(sampleBackup(), PASSPHRASE);
    const parsed = JSON.parse(pulled!.payload);
    await expect(decryptBackup(parsed, "wrong passphrase entirely")).rejects.toThrow();
  });

  it("stores only ciphertext — no plaintext leaks into extension storage", async () => {
    const storage = new FakeExtensionStorage();
    await roundTrip(sampleBackup(), PASSPHRASE, storage);

    // Everything the extension holds, as one string. None of the real content
    // should be findable in it.
    const held = JSON.stringify(storage.get("workdayz.backupSnapshots"));
    expect(held).not.toContain("Platform Engineer");
    expect(held).not.toContain("Acme");
    expect(held).not.toContain("Engineer with 8 years");
    expect(held).not.toContain("workdayz-applications");
    // And the passphrase must never appear anywhere near it.
    expect(held).not.toContain(PASSPHRASE);
  });

  it("keeps display metadata readable without decrypting", async () => {
    // The UI has to describe a snapshot it cannot read, so counts and
    // timestamps travel outside the ciphertext.
    const { pulled } = await roundTrip(sampleBackup(), PASSPHRASE);
    expect(pulled!.applications).toBe(1);
    expect(pulled!.profiles).toBe(1);
    expect(pulled!.encrypted).toBe(true);
    expect(pulled!.createdAt).toBe("2026-03-20T12:00:00.000Z");
  });

  it("round-trips a large backup with unicode and quotes intact", async () => {
    const gnarly: FullBackup = {
      workdayzBackup: true,
      version: 1,
      exportedAt: "2026-03-20T12:00:00.000Z",
      entries: {
        "workdayz-applications": JSON.stringify(
          Array.from({ length: 50 }, (_, i) => ({
            id: `a${i}`,
            notes: `Réf "quoted" \\ backslash — em-dash 日本語 emoji 🎯 line\nbreak`,
          })),
        ),
      },
    };
    const { pulled } = await roundTrip(gnarly, PASSPHRASE);
    const decoded = JSON.parse(await decryptBackup(JSON.parse(pulled!.payload), PASSPHRASE));
    expect(decoded).toEqual(gnarly);
  });

  it("produces a different envelope each time for identical input", async () => {
    // Random salt and IV per encryption. Identical ciphertext across runs would
    // mean a reused IV, which is a real AES-GCM break.
    const backup = sampleBackup();
    const a = await encryptBackup(JSON.stringify(backup), PASSPHRASE);
    const b = await encryptBackup(JSON.stringify(backup), PASSPHRASE);

    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);

    // Both still decrypt to the same thing.
    expect(JSON.parse(await decryptBackup(a, PASSPHRASE))).toEqual(backup);
    expect(JSON.parse(await decryptBackup(b, PASSPHRASE))).toEqual(backup);
  });

  it("detects tampering with the stored ciphertext", async () => {
    const storage = new FakeExtensionStorage();
    await roundTrip(sampleBackup(), PASSPHRASE, storage);

    const list = storage.get<Snapshot[]>("workdayz.backupSnapshots")!;
    const envelope = JSON.parse(list[0].payload);
    // Flip one base64 character.
    const chars = envelope.ciphertext.split("");
    chars[10] = chars[10] === "A" ? "B" : "A";
    envelope.ciphertext = chars.join("");

    // GCM authenticates, so corruption surfaces as a failure rather than
    // silently-wrong plaintext.
    await expect(decryptBackup(envelope, PASSPHRASE)).rejects.toThrow();
  });
});

// Optional passphrase encryption for backups (WebCrypto AES-256-GCM,
// PBKDF2-SHA-256 key derivation). The exported JSON contains the user's full
// work history and contact details — encrypting it makes parking the file in
// a cloud drive safe.

const PBKDF2_ITERATIONS = 310_000;

export interface EncryptedBackup {
  workdayzEncrypted: true;
  version: 1;
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptBackup(plaintext: string, passphrase: string): Promise<EncryptedBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    workdayzEncrypted: true,
    version: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export function isEncryptedBackup(parsed: unknown): parsed is EncryptedBackup {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as EncryptedBackup).workdayzEncrypted === true &&
    typeof (parsed as EncryptedBackup).ciphertext === "string"
  );
}

/** Throws on a wrong passphrase (GCM auth failure). */
export async function decryptBackup(backup: EncryptedBackup, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase, fromBase64(backup.salt));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(backup.iv) as BufferSource },
    key,
    fromBase64(backup.ciphertext) as BufferSource,
  );
  return new TextDecoder().decode(plaintext);
}

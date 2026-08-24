import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Token Vault — AES-256-GCM encryption for Google OAuth refresh tokens.
 *
 * A refresh token is a permanent bearer credential to a creator's private
 * analytics, so it is never stored or logged in plaintext anywhere:
 *   DB column refresh_enc = nonce(12) || ciphertext || tag(16)
 * The 32-byte key is derived (SHA-256) from YOUTUBE_TOKEN_MASTER_KEY, which
 * lives only in deployment secrets. Rotating the master key requires a
 * decrypt-all/re-encrypt-all pass (documented in docs/GOOGLE_OAUTH_SETUP.md).
 */

const NONCE_BYTES = 12;
const KEY_BYTES = 32;

export function deriveKey(masterSecret: string): Buffer {
  return createHash('sha256').update(masterSecret, 'utf8').digest();
}

export function encryptSecret(plaintext: string, masterSecret: string): Buffer {
  const key = deriveKey(masterSecret);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]);
}

export function decryptSecret(encrypted: Buffer, masterSecret: string): string {
  if (encrypted.length <= NONCE_BYTES + 16) {
    throw new Error('vault_corrupt_payload');
  }
  const key = deriveKey(masterSecret);
  const nonce = encrypted.subarray(0, NONCE_BYTES);
  const tag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(NONCE_BYTES, encrypted.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Wrong key or tampered ciphertext — GCM auth failure.
    throw new Error('vault_decryption_failed');
  }
}

/** Sanity check for tests: constant-time-ish length validation helper. */
export function vaultPayloadLength(plaintextBytes: number): number {
  return NONCE_BYTES + plaintextBytes + 16;
}

export const VAULT_NONCE_BYTES = NONCE_BYTES;
export const VAULT_KEY_BYTES = KEY_BYTES;

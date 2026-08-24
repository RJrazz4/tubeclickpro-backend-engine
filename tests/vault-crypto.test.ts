import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, vaultPayloadLength } from '../src/youtube/crypto.js';

const MASTER = 'unit-test-master-key-16+';

describe('token vault (AES-256-GCM)', () => {
  it('round-trips a refresh token', () => {
    const token = '1//0gyXfC_a-refresh-token-example-0000000';
    const enc = encryptSecret(token, MASTER);
    expect(enc.subarray).toBeDefined(); // Buffer
    expect(decryptSecret(enc, MASTER)).toBe(token);
  });

  it('ciphertext length = nonce + plaintext + tag (no plaintext leakage of size beyond that)', () => {
    const enc = encryptSecret('a'.repeat(120), MASTER);
    expect(enc.length).toBe(vaultPayloadLength(120));
  });

  it('fails closed on tampered ciphertext (GCM auth)', () => {
    const enc = encryptSecret('secret', MASTER);
    enc[enc.length - 3] ^= 0xff;
    expect(() => decryptSecret(enc, MASTER)).toThrow(/vault_decryption_failed/);
  });

  it('fails closed with the wrong master key', () => {
    const enc = encryptSecret('secret', MASTER);
    expect(() => decryptSecret(enc, 'another-master-key-16')).toThrow(/vault_decryption_failed/);
  });

  it('rejects corrupt/truncated payloads', () => {
    expect(() => decryptSecret(Buffer.from('short'), MASTER)).toThrow(/vault_corrupt_payload/);
  });
});

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt } from '../crypto';

const KEY_A = randomBytes(32).toString('hex');
const KEY_B = randomBytes(32).toString('hex');

describe('crypto (AES-256-GCM)', () => {
  it('round-trips encrypt → decrypt to the original plaintext', () => {
    const plaintext = 'EAAGm0PX4ZB...synthetic-meta-token...kZBZ';
    const bundled = encrypt(plaintext, KEY_A);
    expect(bundled).not.toEqual(plaintext);
    expect(decrypt(bundled, KEY_A)).toBe(plaintext);
  });

  it('round-trips an empty string', () => {
    const bundled = encrypt('', KEY_A);
    expect(decrypt(bundled, KEY_A)).toBe('');
  });

  it('round-trips multibyte unicode', () => {
    const plaintext = 'halo kak — 你好 — 🌶️🇮🇩';
    const bundled = encrypt(plaintext, KEY_A);
    expect(decrypt(bundled, KEY_A)).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const plaintext = 'same-payload';
    const a = encrypt(plaintext, KEY_A);
    const b = encrypt(plaintext, KEY_A);
    expect(a).not.toEqual(b);
    expect(decrypt(a, KEY_A)).toBe(plaintext);
    expect(decrypt(b, KEY_A)).toBe(plaintext);
  });

  it('fails decryption with the wrong key', () => {
    const bundled = encrypt('secret-token', KEY_A);
    expect(() => decrypt(bundled, KEY_B)).toThrow();
  });

  it('rejects malformed bundled input', () => {
    expect(() => decrypt('not-base64-???', KEY_A)).toThrow();
    expect(() => decrypt('', KEY_A)).toThrow();
    // Valid base64 but too short
    expect(() => decrypt(Buffer.from('short').toString('base64'), KEY_A)).toThrow();
  });

  it('rejects keys that are not 32-byte hex', () => {
    expect(() => encrypt('x', 'not-hex')).toThrow();
    expect(() => encrypt('x', '00')).toThrow();
    expect(() => decrypt('AAAA', 'not-hex')).toThrow();
  });

  it('detects tampering via the auth tag', () => {
    const bundled = encrypt('payload', KEY_A);
    const buf = Buffer.from(bundled, 'base64');
    // Flip a single bit in the ciphertext region (after iv+tag = 28 bytes)
    buf[buf.length - 1] = buf[buf.length - 1] ^ 0x01;
    const tampered = buf.toString('base64');
    expect(() => decrypt(tampered, KEY_A)).toThrow();
  });
});

/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/utils/crypto.ts
 * Role    : AES-256-GCM symmetric encryption for WABA access tokens.
 *           Random 12-byte IV per encryption. Auth-tag verified on decrypt.
 *           Bundle format (base64): iv(12) | authTag(16) | ciphertext(...)
 * Imports : node:crypto only
 * Exports : encrypt, decrypt
 * DO NOT  : log plaintext or the key. Pin the algorithm — never accept
 *           the algorithm or auth-tag length from an outside source.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12;  // GCM-recommended
const TAG_BYTES = 16; // GCM auth tag

function decodeKey(keyHex: string): Buffer {
  if (typeof keyHex !== 'string' || !/^[0-9a-fA-F]+$/.test(keyHex)) {
    throw new Error('crypto: key must be a hex string');
  }
  const buf = Buffer.from(keyHex, 'hex');
  if (buf.length !== KEY_BYTES) {
    throw new Error(`crypto: key must decode to ${KEY_BYTES} bytes (got ${buf.length})`);
  }
  return buf;
}

/**
 * Encrypt plaintext under AES-256-GCM.
 * Returns a single base64 string bundling iv(12) + authTag(16) + ciphertext.
 */
export function encrypt(plaintext: string, keyHex: string): string {
  if (typeof plaintext !== 'string') {
    throw new Error('crypto: plaintext must be a string');
  }
  const key = decodeKey(keyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/**
 * Decrypt a bundle produced by `encrypt`.
 * Throws on malformed input or auth-tag mismatch (wrong key / tampered ciphertext).
 */
export function decrypt(bundled: string, keyHex: string): string {
  if (typeof bundled !== 'string' || bundled.length === 0) {
    throw new Error('crypto: bundled ciphertext must be a non-empty string');
  }
  const key = decodeKey(keyHex);
  let buf: Buffer;
  try {
    buf = Buffer.from(bundled, 'base64');
  } catch {
    throw new Error('crypto: bundled ciphertext is not valid base64');
  }
  if (buf.length < IV_BYTES + TAG_BYTES) {
    throw new Error('crypto: bundled ciphertext is too short');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const authTag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

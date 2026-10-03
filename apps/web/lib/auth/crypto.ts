/**
 * Cryptographic primitives for authentication (doc 06 §8, FR-60, FR-70).
 *
 * Three different one-way functions, used for three different reasons:
 *   - **Argon2id** for passwords. Memory-hard, so an attacker with the hash cannot test billions of
 *     guesses per second on a GPU. Deliberately slow (~50–100 ms).
 *   - **SHA-256** for session ids, OTP codes and reset tokens. These are already 128+ bits of
 *     randomness, so there is nothing to brute-force; hashing them means a database leak hands over
 *     no usable credential, and it must stay fast because it runs on every request.
 *   - **HMAC-SHA256** for signing values we hand to the browser (the CAPTCHA challenge), so the
 *     browser can hold them without being able to forge them.
 */
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Argon2id parameters. 19 MiB / 2 passes / 1 lane is the OWASP-recommended baseline and fits inside
 * a serverless function's memory and time limits. Raising these later only invalidates nothing —
 * `verify` reads the parameters from the stored hash, so old hashes keep working.
 */
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON2_OPTIONS);
}

/**
 * Verifies a password. Returns false rather than throwing on a malformed stored hash, so a corrupt
 * row cannot turn a failed login into a 500 that tells an attacker the account exists.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(storedHash, password);
  } catch {
    return false;
  }
}

/** URL-safe random token. 32 bytes = 256 bits, the session-id and reset-token size. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** A 6-digit numeric OTP, uniformly distributed (no modulo bias). */
export function randomOtp(): string {
  let digits = '';
  while (digits.length < 6) {
    for (const byte of randomBytes(8)) {
      // 250 = 25 * 10: taking bytes below it keeps every digit equally likely.
      if (byte < 250 && digits.length < 6) digits += String(byte % 10);
    }
  }
  return digits;
}

/** One-way hash for high-entropy secrets (session ids, OTP codes, reset tokens). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    // Failing loudly beats signing with a predictable key: with a guessable secret, CAPTCHA tokens
    // can be forged and the whole bot defence is decoration.
    throw new Error('AUTH_SECRET is missing or too short — set it to 32+ random bytes (see .env.example)');
  }
  return s;
}

/** `value.signature`, so the browser can carry `value` without being able to change it. */
export function sign(value: string): string {
  const mac = createHmac('sha256', secret()).update(value).digest('base64url');
  return `${value}.${mac}`;
}

/** Returns the value if the signature is intact, else null. */
export function unsign(signed: string): string | null {
  const idx = signed.lastIndexOf('.');
  if (idx <= 0) return null;
  const value = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  const expected = createHmac('sha256', secret()).update(value).digest('base64url');
  return constantTimeEqual(mac, expected) ? value : null;
}

/**
 * Compares two strings without leaking where they first differ. Used for every secret comparison:
 * a normal `===` returns faster on an early mismatch, which is measurable over many attempts.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

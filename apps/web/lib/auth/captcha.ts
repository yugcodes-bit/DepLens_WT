/**
 * CAPTCHA (FR-65) — self-hosted, no third-party service.
 *
 * Why our own instead of reCAPTCHA or Turnstile: a verification run costs real machine time on the
 * measurement worker, so bots must not be able to queue them — but we also have to *demonstrate and
 * document* the mechanism, and a hosted widget would hide it behind an API key and a third party
 * that sees our users.
 *
 * How it works: the server picks 5 characters, draws each one as **vector strokes** (never as an SVG
 * `<text>` element — that would put the answer in the markup for any bot to regex out), and hands the
 * browser the image plus an **HMAC-signed, expiring token** carrying only a hash of the answer. The
 * browser can display the token but cannot read or forge the answer. On submit the server re-hashes
 * what was typed and compares in constant time.
 *
 * Honest limit, worth stating in the documentation: this stops scripted form posts, not a human
 * solver or a determined shape-recognition attack. The real protection against expensive work is the
 * per-account quota on verification runs (NFR-S5); the CAPTCHA is the cheap first filter.
 */
import { randomInt } from 'node:crypto';
import { CAPTCHA_ALPHABET, STROKE_FONT } from './captchaFont.ts';
import { constantTimeEqual, hashToken, sign, unsign } from './crypto.ts';

export const CAPTCHA_COOKIE = 'deplens_captcha';
const TTL_MS = 10 * 60 * 1000;
const LENGTH = 5;

export interface Captcha {
  /** Inline SVG to render. */
  svg: string;
  /** Signed token for the cookie, submitted back with the form. */
  token: string;
  /**
   * The plaintext answer. **Only** surfaced by the API in end-to-end test mode
   * (`NODE_ENV !== 'production'` *and* `DEPLENS_E2E=1`) so the automated page tests can submit forms.
   * There is no bypass inside `verifyCaptcha` itself — the checking path is the same in every mode.
   */
  answer: string;
}

function answerFingerprint(answer: string): string {
  return hashToken(`captcha:${answer.toUpperCase()}`);
}

/** True only in the dedicated test mode. Never true on a deployed instance. */
export function e2eMode(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.DEPLENS_E2E === '1';
}

/** Creates a fresh challenge. The answer is never stored, in any form, on the server. */
export function createCaptcha(): Captcha {
  let answer = '';
  for (let i = 0; i < LENGTH; i++) answer += CAPTCHA_ALPHABET[randomInt(CAPTCHA_ALPHABET.length)]!;
  const expires = Date.now() + TTL_MS;
  return {
    svg: renderSvg(answer),
    token: sign(`${answerFingerprint(answer)}:${expires}`),
    answer,
  };
}

export type CaptchaResult = 'ok' | 'missing' | 'expired' | 'wrong';

/** Verifies a typed answer against the signed token. Identical logic in every environment. */
export function verifyCaptcha(token: string | undefined, typed: string | undefined): CaptchaResult {
  if (!token || !typed) return 'missing';
  const value = unsign(token);
  if (!value) return 'missing';
  const sep = value.lastIndexOf(':');
  const fingerprint = value.slice(0, sep);
  const expires = Number(value.slice(sep + 1));
  if (!Number.isFinite(expires) || Date.now() > expires) return 'expired';
  return constantTimeEqual(answerFingerprint(typed.trim()), fingerprint) ? 'ok' : 'wrong';
}

const jitter = (amount: number) => (randomInt(amount * 200) - amount * 100) / 100;

/**
 * Draws the challenge as SVG paths. SVG rather than a raster image so there is no native image
 * dependency to install or bundle — but as geometry, not as text.
 */
function renderSvg(answer: string): string {
  const w = 200;
  const h = 70;
  const parts: string[] = [];

  // Background speckle, so the strokes do not sit on a flat field that is trivial to threshold.
  for (let i = 0; i < 45; i++) {
    parts.push(`<circle cx="${randomInt(w)}" cy="${randomInt(h)}" r="${1 + randomInt(2)}" fill="#8c98ab" opacity="0.4"/>`);
  }
  // Decoy curves that cross the glyphs, so a naive stroke tracer picks up extra shapes.
  for (let i = 0; i < 3; i++) {
    parts.push(
      `<path d="M0 ${randomInt(h)} Q ${w / 2} ${randomInt(h)} ${w} ${randomInt(h)}" stroke="#64748b"` +
        ` stroke-width="1.4" fill="none" opacity="0.55"/>`,
    );
  }

  const cell = (w - 24) / answer.length;
  for (const [i, ch] of [...answer].entries()) {
    const glyph = STROKE_FONT[ch];
    if (!glyph) continue;
    const scale = (2.9 + randomInt(70) / 100) * (h / 70);
    const originX = 14 + i * cell + jitter(3);
    const originY = 12 + jitter(5);
    const rotate = randomInt(39) - 19;
    const hue = randomInt(360);

    const d = glyph
      .map((line) =>
        line
          .map(([x, y], n) => {
            // Per-point jitter bends the strokes so the same character is never drawn twice alike.
            const px = (originX + x * scale + jitter(0.9)).toFixed(1);
            const py = (originY + y * scale + jitter(0.9)).toFixed(1);
            return `${n === 0 ? 'M' : 'L'}${px} ${py}`;
          })
          .join(' '),
      )
      .join(' ');

    const cx = (originX + 5 * scale).toFixed(1);
    const cy = (originY + 5 * scale).toFixed(1);
    parts.push(
      `<path d="${d}" fill="none" stroke="hsl(${hue} 55% 28%)" stroke-width="${(2.2 + randomInt(90) / 100).toFixed(1)}"` +
        ` stroke-linecap="round" stroke-linejoin="round" transform="rotate(${rotate} ${cx} ${cy})"/>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"` +
    ` aria-label="Captcha image: type the ${LENGTH} characters it shows">` +
    `<rect width="${w}" height="${h}" rx="8" fill="#e4e9f0"/>${parts.join('')}</svg>`
  );
}

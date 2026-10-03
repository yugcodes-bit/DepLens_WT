/** Issues a CAPTCHA challenge (FR-65): the SVG for display, the signed answer hash in a cookie. */
import { NextResponse } from 'next/server';
import { CAPTCHA_COOKIE, createCaptcha, e2eMode } from '@/lib/auth/captcha.ts';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const { svg, token, answer } = createCaptcha();
  const res = NextResponse.json({
    ok: true,
    svg,
    // Automated page tests cannot read vector strokes, so the answer is exposed *only* when both
    // NODE_ENV is not production and DEPLENS_E2E=1. A deployed instance can never satisfy that.
    ...(e2eMode() ? { answer } : {}),
  });
  res.cookies.set(CAPTCHA_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}

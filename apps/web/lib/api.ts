/**
 * Shared helpers for route handlers.
 *
 * Every endpoint answers in the same shape, so the forms need exactly one code path for errors:
 *   success -> { ok: true,  ...payload }
 *   failure -> { ok: false, errors: { fieldName | _form: message } }
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError } from './auth/session.ts';
import { fieldErrors } from './validation.ts';

export type ApiOk<T> = { ok: true } & T;
export type ApiFail = { ok: false; errors: Record<string, string> };

export function ok<T extends object>(payload: T = {} as T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, ...payload }, { status });
}

export function fail(errors: Record<string, string>, status = 400): NextResponse {
  return NextResponse.json({ ok: false, errors }, { status });
}

/** A failure that belongs to the form as a whole rather than to one field. */
export function failForm(message: string, status = 400): NextResponse {
  return fail({ _form: message }, status);
}

/**
 * Validates a JSON body against a schema (FR-74 … FR-80 server side). The client validates too, but
 * only this check counts — a request can be sent by anything, not just our page (constraint C-1).
 */
export async function parseBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<{ data: z.output<S>; error?: undefined } | { data?: undefined; error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { error: failForm('Expected a JSON body') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { error: fail(fieldErrors(parsed.error)) };
  return { data: parsed.data };
}

/**
 * Origin check for endpoints that run **before** a session exists (register, login, reset), where
 * there is no session CSRF token to compare against yet. Once a session exists, `assertCsrf` in
 * session.ts adds the token check on top of this.
 */
export async function assertSameOrigin(): Promise<NextResponse | null> {
  const h = await headers();
  const origin = h.get('origin');
  if (!origin) return null; // same-origin fetches may omit it; the cookie is SameSite=Lax regardless
  const host = h.get('host');
  const allowed = new Set(
    [process.env.NEXT_PUBLIC_APP_URL, host ? `https://${host}` : null, host ? `http://${host}` : null].filter(Boolean),
  );
  return allowed.has(origin) ? null : failForm('Request origin is not allowed', 403);
}

/**
 * Wraps a handler so an `AuthError` becomes its own status instead of a 500, and so an unexpected
 * error is logged server-side but never leaked to the client.
 */
export function route(handler: (request: Request) => Promise<NextResponse>) {
  return async (request: Request): Promise<NextResponse> => {
    try {
      return await handler(request);
    } catch (e) {
      if (e instanceof AuthError) return failForm(e.message, e.status);
      console.error('[api] unhandled error', e);
      return failForm('Something went wrong on our side. Please try again.', 500);
    }
  };
}

/**
 * Deliberately vague message for "wrong email or wrong password".
 *
 * Telling the user which half was wrong would let anyone test whether an address has an account
 * here, so both paths return this one string and both are logged as `login.failed`.
 */
export const GENERIC_LOGIN_FAILURE = 'Email or password is incorrect';

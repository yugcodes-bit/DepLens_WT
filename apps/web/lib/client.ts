'use client';

/** Browser-side helpers shared by every form. */

export interface ApiResponse {
  ok: boolean;
  errors?: Record<string, string>;
  message?: string;
  next?: string;
  /** Development only: the OTP code or reset token, when no mail provider is configured. */
  devCode?: string;
  devToken?: string;
}

/**
 * POSTs JSON and always resolves to a usable object.
 *
 * A network failure is turned into the same `{ ok: false, errors }` shape as a validation failure,
 * so no form has to tell the two apart or risk showing nothing at all.
 */
export async function postJson(url: string, body: unknown, csrfToken?: string): Promise<ApiResponse> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // FR-71: echoed back so the server knows the request came from our own page.
        ...(csrfToken ? { 'x-deplens-csrf': csrfToken } : {}),
      },
      body: JSON.stringify(body),
    });
    const parsed = (await res.json()) as ApiResponse;
    return parsed;
  } catch {
    return { ok: false, errors: { _form: 'Could not reach the server. Check your connection and try again.' } };
  }
}

/** Runs a Zod schema in the browser for instant feedback (FR-74 … FR-80, client half). */
export function clientValidate<T>(
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } } },
  value: unknown,
): { data: T; errors?: undefined } | { data?: undefined; errors: Record<string, string> } {
  const result = schema.safeParse(value);
  if (result.success) return { data: result.data };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_form';
    errors[key] ??= issue.message;
  }
  return { errors };
}

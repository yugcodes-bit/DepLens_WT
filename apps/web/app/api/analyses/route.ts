/**
 * POST /api/analyses — queue a static analysis (FR-04, doc 06 §7.3).
 *
 * The request is **not** executed here. Analysis installs npm packages and runs two bundlers, which
 * does not fit in a Vercel function's 60 s limit and 512 MB `/tmp` (doc 06 §7). So this handler
 * validates, writes a `job` row, and returns its id; a tier-2 worker claims it and writes the
 * result back. That split is also why the deployed app stays on a free tier.
 */
import { analysisRequestSchema } from '@deplens/shared';
import { enqueueJob } from '@deplens/db';
import { failForm, ok, parseBody, route } from '@/lib/api.ts';
import { assertCsrf, getSession } from '@/lib/auth/session.ts';
import { audit } from '@/lib/auth/guard.ts';

/** Research hosts a signed-in user may analyse against without uploading a project. */
const ALLOWED_HOSTS = new Set([
  'empty',
  'vanilla',
  'react',
  'vue',
  'svelte',
  'preact',
  'solid',
  'react-heavy',
]);

export const POST = route(async (request: Request) => {
  const session = await getSession();
  if (!session) return failForm('Sign in to run an analysis', 401);
  if (!session.user.emailVerifiedAt) return failForm('Verify your email address first', 403);
  // Throws an AuthError that `route` turns into a 403 — the CSRF token plus an origin check.
  await assertCsrf(session);

  const { data, error } = await parseBody(request, analysisRequestSchema);
  if (error) return error;

  // The host name reaches a file path in the worker, so it is checked against a fixed list rather
  // than sanitised — an allowlist cannot be talked round, a sanitiser sometimes can.
  if (!ALLOWED_HOSTS.has(data.host)) {
    return failForm(`Unknown host '${data.host}'. Choose one of: ${[...ALLOWED_HOSTS].sort().join(', ')}`);
  }

  const job = await enqueueJob({
    kind: 'analyze',
    tier: 'ci',
    payload: { ...data, userId: session.user.id },
  });

  await audit('analysis.created', 'success', {
    userId: session.user.id,
    detail: { host: data.host, candidates: data.candidates.length, profile: data.profile, jobId: job.id },
  });

  return ok({ jobId: job.id, status: job.status }, 202);
});

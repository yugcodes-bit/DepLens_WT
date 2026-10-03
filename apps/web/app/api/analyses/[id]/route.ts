/**
 * GET /api/analyses/:id — status and, once a worker has finished, the result.
 *
 * Polled by the results page. The job's payload carries the id of the user who queued it, and this
 * handler refuses to return someone else's analysis (FR-68) — ownership is checked here, on the
 * server, not by hiding a link in the UI.
 */
import { getJob } from '@deplens/db';
import { fail, failForm, ok, route } from '@/lib/api.ts';
import { getSession } from '@/lib/auth/session.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = route(async (request: Request) => {
  const session = await getSession();
  if (!session) return failForm('Sign in to view an analysis', 401);

  const id = new URL(request.url).pathname.split('/').pop() ?? '';
  if (!UUID.test(id)) return fail({ _form: 'Not a valid analysis id' }, 400);

  const job = await getJob(id);
  // "Not found" and "not yours" answer identically, so the endpoint cannot be used to discover
  // which analysis ids exist.
  const owner = job?.payload?.['userId'];
  if (!job || owner !== session.user.id) return failForm('Analysis not found', 404);

  return ok({
    id: job.id,
    status: job.status,
    progress: job.progress,
    progressMessage: job.progressMessage,
    error: job.error,
    result: job.result,
    createdAt: job.createdAt,
  });
});

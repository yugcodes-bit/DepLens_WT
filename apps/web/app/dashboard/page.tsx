import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { getDb, projects } from '@deplens/db';
import { Badge } from '@/components/Badge.tsx';
import { getSession } from '@/lib/auth/session.ts';

/**
 * The signed-in home (FR-68: a user sees only their own projects).
 *
 * This is a server component, so the authorization check happens before any markup is produced —
 * there is no moment at which a browser holds data it should not have.
 */
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.user.emailVerifiedAt) redirect(`/verify?email=${encodeURIComponent(session.user.email)}`);

  const mine = await getDb()
    .select({ id: projects.id, name: projects.name, mode: projects.mode, createdAt: projects.createdAt })
    .from(projects)
    .where(eq(projects.userId, session.user.id))
    .orderBy(desc(projects.createdAt))
    .limit(20);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {session.user.name ? `Welcome, ${session.user.name}` : 'Your dashboard'}
        </h1>
        <p className="text-sm text-[var(--color-ink-soft)]">
          Signed in as {session.user.email} · role{' '}
          <span className="rounded bg-[var(--color-brand-soft)] px-1.5 py-0.5 text-xs font-semibold text-[var(--color-brand)]">
            {session.user.role}
          </span>
        </p>
      </section>

      <section className="dl-card flex flex-col items-start gap-3 p-6">
        <h2 className="text-lg font-bold tracking-tight">Compare candidate packages</h2>
        <p className="max-w-prose text-sm text-[var(--color-ink-soft)]">
          Pick one of the research host apps, list the packages you are choosing between, and see what each
          one would add — exact bytes, a predicted main-thread cost with an uncertainty interval, and the
          reasons behind both.
        </p>
        <Link href="/analyze" className="dl-btn dl-btn-primary text-sm">
          New analysis
        </Link>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold tracking-tight">Your projects</h2>
          <Link href="/projects/new" className="dl-btn dl-btn-primary text-sm">
            New project
          </Link>
        </div>

        {mine.length === 0 ? (
          <div className="dl-card flex flex-col items-start gap-3 p-6">
            <p className="font-semibold">No projects yet</p>
            <p className="max-w-prose text-sm text-[var(--color-ink-soft)]">
              A project is your app&apos;s dependency context — paste your <code>package.json</code> and
              lockfile once, then compare as many candidate packages against it as you like. Nothing is
              uploaded except those two files, and they are deleted after 24 hours unless you opt in to
              contribute measurements.
            </p>
            <Link href="/projects/new" className="dl-btn dl-btn-primary text-sm">
              Create your first project
            </Link>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {mine.map((p) => (
              <li key={p.id} className="dl-card p-4">
                <Link href={`/projects/${p.id}`} className="font-semibold underline-offset-2 hover:underline">
                  {p.name ?? 'Untitled project'}
                </Link>
                <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
                  {p.mode} mode · created {p.createdAt.toISOString().slice(0, 10)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dl-card flex flex-col gap-3 p-5">
        <h2 className="text-lg font-bold tracking-tight">What the three answers mean</h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="flex items-center gap-2 font-semibold">
              <Badge kind="exact" /> instantly
            </dt>
            <dd className="mt-1 text-sm text-[var(--color-ink-soft)]">
              Byte deltas and which packages you already ship. Computed from real builds, so these are
              never estimates.
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-2 font-semibold">
              <Badge kind="predicted" /> in ~1 minute
            </dt>
            <dd className="mt-1 text-sm text-[var(--color-ink-soft)]">
              Extra script time with an uncertainty range. If the range straddles your budget, the tool
              says so instead of guessing.
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-2 font-semibold">
              <Badge kind="measured" /> on request
            </dt>
            <dd className="mt-1 text-sm text-[var(--color-ink-soft)]">
              A real browser measurement on a calibrated quiet machine. Slower and limited per account,
              because it costs real machine time.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

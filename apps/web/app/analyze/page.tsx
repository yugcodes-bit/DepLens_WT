import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session.ts';
import { AnalyzeForm } from './AnalyzeForm.tsx';

/**
 * New analysis (doc 05 UI-1).
 *
 * A server component so authorization happens before any markup exists, and so the CSRF token is
 * handed to the client form directly rather than fetched afterwards.
 */
export const metadata = {
  title: 'New analysis · DepLens',
  description: 'Compare what candidate npm packages will cost your app at runtime.',
};

export default async function AnalyzePage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/analyze');
  if (!session.user.emailVerifiedAt) redirect(`/verify?email=${encodeURIComponent(session.user.email)}`);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">New analysis</h1>
        <p className="max-w-prose text-sm text-[var(--color-ink-soft)]">
          Pick an app, list the packages you are choosing between, and write the exact import you would
          add. DepLens builds the app with and without each import, counts the bytes exactly, and
          estimates the main-thread cost for the device profile you choose.
        </p>
      </section>

      <AnalyzeForm csrfToken={session.csrfToken} />
    </div>
  );
}

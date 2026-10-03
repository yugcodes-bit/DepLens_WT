import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { getSession } from '@/lib/auth/session.ts';
import { LogoutButton } from '@/components/LogoutButton.tsx';
import './globals.css';

export const metadata: Metadata = {
  title: 'DepLens — what will this npm package cost your app?',
  description:
    'DepLens predicts the extra main-thread time a specific npm import adds to your web app on a given device, with an uncertainty range, and measures it in a real browser on demand.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Server component: the session is read per request, so the nav can never show a stale identity.
  const session = await getSession();

  return (
    <html lang="en">
      <body className="min-h-dvh flex flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-lg focus:bg-[var(--color-brand)] focus:px-3 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>

        <header className="border-b border-[var(--color-line)]">
          <nav
            aria-label="Main"
            className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-6"
          >
            <Link href="/" className="mr-auto flex items-center gap-2 font-bold tracking-tight">
              <span aria-hidden className="inline-block h-5 w-5 rounded-md bg-[var(--color-brand)]" />
              DepLens
            </Link>
            <Link href="/how-it-works" className="text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
              How it works
            </Link>
            {session ? (
              <>
                <Link href="/dashboard" className="text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
                  Dashboard
                </Link>
                <span className="hidden text-sm text-[var(--color-ink-faint)] sm:inline">{session.user.email}</span>
                <LogoutButton csrfToken={session.csrfToken} />
              </>
            ) : (
              <>
                <Link href="/login" className="text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
                  Sign in
                </Link>
                <Link href="/register" className="dl-btn dl-btn-primary text-sm">
                  Create account
                </Link>
              </>
            )}
          </nav>
        </header>

        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
          {children}
        </main>

        <footer className="border-t border-[var(--color-line)] px-4 py-6 text-sm text-[var(--color-ink-faint)] sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p>DepLens — a web-engineering research project. Measurements are reproducible and open.</p>
            <p>
              Every number is labelled <strong>exact</strong>, <strong>modeled</strong>, <strong>predicted</strong> or{' '}
              <strong>measured</strong>.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}

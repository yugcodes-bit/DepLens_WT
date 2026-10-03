import Link from 'next/link';
import { Badge, Metric } from '@/components/Badge.tsx';
import { getSession } from '@/lib/auth/session.ts';

/**
 * Landing page.
 *
 * The numbers below are real output from our own harness (see `docs/research-log.md`, 1 Oct 2026),
 * not illustrations. The point of the page is the contrast in the second table: two imports of a
 * similar kind, two orders of magnitude apart in cost, which is what no existing tool can tell you.
 */
export default async function HomePage() {
  const session = await getSession();

  return (
    <div className="flex flex-col gap-14">
      <section className="flex flex-col gap-5">
        <p className="text-sm font-semibold uppercase tracking-widest text-[var(--color-brand)]">
          Web performance · research project
        </p>
        <h1 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
          Bundlephobia tells you how <span className="text-[var(--color-ink-faint)]">big</span> a package is.
          <br />
          DepLens tells you how much <span className="text-[var(--color-brand)]">slower your app</span> will start.
        </h1>
        <p className="max-w-2xl text-base text-[var(--color-ink-soft)] sm:text-lg">
          Give it your app, the package, and the exact import line. It builds your app twice — with and
          without that one import — and reports what the difference actually costs on a mid-range phone,
          with an honest uncertainty range and a button that proves it in a real browser.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href={session ? '/dashboard' : '/register'} className="dl-btn dl-btn-primary">
            {session ? 'Go to your dashboard' : 'Create a free account'}
          </Link>
          <Link href="/how-it-works" className="dl-btn dl-btn-ghost">
            How it works
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Why size is the wrong question</h2>
        <p className="max-w-2xl text-sm text-[var(--color-ink-soft)]">
          Two bundles of <strong>identical size</strong>, measured by our harness. A browser only fully
          compiles the code it actually runs, so size cannot see the difference between them.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="dl-card p-5">
            <p className="text-sm font-medium">246 KB of functions that are never called</p>
            <div className="mt-3">
              <Metric label="Extra main-thread time" value="≈ 0" unit="ms" kind="measured" />
            </div>
          </div>
          <div className="dl-card p-5">
            <p className="text-sm font-medium">The same 246 KB, each function called once</p>
            <div className="mt-3">
              <Metric label="Extra main-thread time" value="32.4" unit="ms" kind="measured" />
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
          And the cost depends on <em>your</em> app, not just the package
        </h2>
        <p className="max-w-2xl text-sm text-[var(--color-ink-soft)]">
          Both rows below are real sessions from our harness. The second import is almost free — not
          because the package is cheap, but because that app already ships it.
        </p>

        {/* NFR-U6: the table collapses to stacked cards below the sm breakpoint. */}
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">
              Measured incremental cost of two imports, each added to a different host application
            </caption>
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Import added
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Into
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Extra bytes <Badge kind="exact" />
                </th>
                <th scope="col" className="py-2 font-semibold">
                  Extra script time <Badge kind="measured" />
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              <tr className="border-b border-[var(--color-line)]">
                <td className="py-3 pr-4 font-mono text-xs">import _ from &apos;lodash&apos;</td>
                <td className="py-3 pr-4">a plain React app</td>
                <td className="py-3 pr-4">+73,468 B</td>
                <td className="py-3 font-semibold text-[var(--color-bad)]">
                  +37.4 ms <span className="font-normal text-[var(--color-ink-faint)]">[27.0, 50.3]</span>
                </td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-mono text-xs">import {'{'} format {'}'} from &apos;date-fns&apos;</td>
                <td className="py-3 pr-4">an app that already ships date-fns</td>
                <td className="py-3 pr-4">+204 B</td>
                <td className="py-3 font-semibold text-[var(--color-good)]">
                  +1.6 ms <span className="font-normal text-[var(--color-ink-faint)]">[−0.5, 4.4]</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 sm:hidden">
          <div className="dl-card p-4">
            <p className="font-mono text-xs">import _ from &apos;lodash&apos;</p>
            <p className="mt-1 text-xs text-[var(--color-ink-faint)]">into a plain React app</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Metric label="Extra bytes" value="+73,468" unit="B" kind="exact" />
              <Metric label="Script time" value="+37.4" unit="ms" interval="[27.0, 50.3]" kind="measured" />
            </div>
          </div>
          <div className="dl-card p-4">
            <p className="font-mono text-xs">import {'{'} format {'}'} from &apos;date-fns&apos;</p>
            <p className="mt-1 text-xs text-[var(--color-ink-faint)]">into an app that already ships date-fns</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Metric label="Extra bytes" value="+204" unit="B" kind="exact" />
              <Metric label="Script time" value="+1.6" unit="ms" interval="[−0.5, 4.4]" kind="measured" />
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Every number says where it came from</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ['exact', 'Byte deltas', 'Diffed from two real production builds of your app.'],
              ['modeled', 'Download time', 'Computed from brotli bytes and the profile’s bandwidth.'],
              ['predicted', 'Script time', 'Model estimate — always shown with a range, never alone.'],
              ['measured', 'Verified cost', 'A real browser, 10 interleaved A/B loads, on a quiet machine.'],
            ] as const
          ).map(([kind, title, text]) => (
            <div key={kind} className="dl-card flex flex-col gap-2 p-4">
              <Badge kind={kind} />
              <p className="font-semibold">{title}</p>
              <p className="text-sm text-[var(--color-ink-soft)]">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="dl-card flex flex-col gap-3 p-5 sm:p-6">
        <h2 className="text-lg font-bold tracking-tight">Use it from your terminal instead</h2>
        <p className="text-sm text-[var(--color-ink-soft)]">
          The analysis runs locally and only a vector of numbers is sent for prediction, so your source
          code never leaves your machine.
        </p>
        <pre className="overflow-x-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-xs sm:text-sm">
          <code>{'npx @deplens/cli check date-fns --import "import { format } from \'date-fns\'" --budget 50'}</code>
        </pre>
        <p className="text-xs text-[var(--color-ink-faint)]">
          The CLI ships in a later phase; the measurement harness behind it already works today.
        </p>
      </section>
    </div>
  );
}

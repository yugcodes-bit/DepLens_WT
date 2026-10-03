import Link from 'next/link';
import { Badge } from '@/components/Badge.tsx';

export const metadata = { title: 'How DepLens works' };

const MODULES = [
  {
    n: 1,
    title: 'Project intake',
    input: 'Your package.json + lockfile',
    process: 'Resolve the exact packages and versions your app installs; detect the framework',
    output: 'framework: react · already ships 248 packages including date-fns@4.1.0',
  },
  {
    n: 2,
    title: 'Build twice',
    input: 'Your app + the exact import line',
    process:
      'Two copies: one untouched, one with only that import added (plus a sink so the bundler cannot drop it). Install without running install scripts, then build both with Vite',
    output: 'Two production bundles that differ by exactly one import',
  },
  {
    n: 3,
    title: 'Byte diff',
    input: 'The two bundles',
    process: 'Compress at fixed settings (gzip-9, brotli-11), sum the files loaded on first paint, subtract',
    output: '+204 bytes · new packages: none · shared: date-fns',
  },
  {
    n: 4,
    title: 'Read the added code',
    input: 'Only the code that is new in the second bundle',
    process: 'Parse it and count what makes JavaScript expensive at load: top-level calls, eager functions, large literals, DOM use',
    output: 'A row of ~40 numbers describing the added code and your app context',
  },
  {
    n: 5,
    title: 'Predict',
    input: 'That row of numbers',
    process: 'Gradient-boosted trees estimate the cost; conformal prediction turns it into an honest range',
    output: '11.8 ms (range 7.9 – 17.5 ms)',
  },
  {
    n: 6,
    title: 'Explain and advise',
    input: 'The prediction and the model’s per-feature contributions',
    process: 'Turn each contributing factor into a sentence; check known cheaper alternatives',
    output: '“Only 2% of the package survives tree-shaking (−4.0 ms)” · “Intl.DateTimeFormat costs 0 bytes”',
  },
  {
    n: 7,
    title: 'Verify',
    input: 'The two bundles',
    process:
      'Load each in headless Chrome with the CPU slowed to phone speed, recording a performance trace. 10 pairs, order randomised, fresh browser profile each time, then a robust paired estimate',
    output: '37.4 ms, 95% confident 27.0 – 50.3 · compile 28.5 · evaluate 6.7 · gc 2.5',
  },
] as const;

export default function HowItWorksPage() {
  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">How it works</h1>
        <p className="max-w-2xl text-base text-[var(--color-ink-soft)]">
          The whole idea is one comparison: build your app <strong>with</strong> and{' '}
          <strong>without</strong> the exact import you are considering, and report the difference.
          Everything else exists to make that difference trustworthy.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-bold tracking-tight">Seven steps, each as input → output</h2>
        <ol className="flex flex-col gap-3">
          {MODULES.map((m) => (
            <li key={m.n} className="dl-card p-4 sm:p-5">
              <div className="flex items-baseline gap-3">
                <span className="text-sm font-bold text-[var(--color-brand)]">{m.n}</span>
                <h3 className="font-bold">{m.title}</h3>
              </div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[6rem_1fr]">
                <dt className="font-semibold text-[var(--color-ink-faint)]">Input</dt>
                <dd>{m.input}</dd>
                <dt className="font-semibold text-[var(--color-ink-faint)]">Process</dt>
                <dd>{m.process}</dd>
                <dt className="font-semibold text-[var(--color-ink-faint)]">Output</dt>
                <dd className="font-mono text-xs sm:text-sm">{m.output}</dd>
              </dl>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-bold tracking-tight">Why ten page loads and not one</h2>
        <p className="max-w-2xl text-sm text-[var(--color-ink-soft)]">
          Computers are noisy. Loading the <em>same</em> build twice can differ by several milliseconds.
          So the measurement interleaves the two versions, compares them pair by pair — which cancels
          slow drift like a warming laptop — and reports a confidence interval rather than a single
          number. We also regularly measure a build against <strong>itself</strong> and check the tool
          reports zero.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="dl-card p-4">
            <p className="text-sm font-semibold">Same build vs itself, quiet machine</p>
            <p className="mt-2 text-lg font-bold tabular-nums text-[var(--color-good)]">
              0.1 ms <span className="text-sm font-normal text-[var(--color-ink-faint)]">[−0.1, 0.3]</span>
            </p>
            <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
              Correctly reports “no difference”, and can resolve under a millisecond.
            </p>
          </div>
          <div className="dl-card p-4">
            <p className="text-sm font-semibold">Same build vs itself, busy machine</p>
            <p className="mt-2 text-lg font-bold tabular-nums text-[var(--color-warn)]">
              −1.4 ms <span className="text-sm font-normal text-[var(--color-ink-faint)]">[−4.0, 1.3]</span>
            </p>
            <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
              Why the tool refuses to measure when the machine is not idle.
            </p>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-bold tracking-tight">What runs where</h2>
        <p className="max-w-2xl text-sm text-[var(--color-ink-soft)]">
          A real measurement needs a real browser and above all a quiet machine, so the system is split
          by the kind of number each part produces.
        </p>
        <ul className="flex flex-col gap-3">
          <li className="dl-card flex flex-col gap-1 p-4">
            <p className="flex items-center gap-2 font-semibold">
              This website <Badge kind="exact" /> <Badge kind="predicted" />
            </p>
            <p className="text-sm text-[var(--color-ink-soft)]">
              Always available. Accounts, projects, comparisons, and everything already analysed.
            </p>
          </li>
          <li className="dl-card flex flex-col gap-1 p-4">
            <p className="flex items-center gap-2 font-semibold">
              Byte-analysis worker <Badge kind="exact" />
            </p>
            <p className="text-sm text-[var(--color-ink-soft)]">
              Always available. Installs and builds a package nobody has analysed yet. It does no timing,
              so it is safe to run on shared infrastructure — a byte count is the same on a busy machine.
            </p>
          </li>
          <li className="dl-card flex flex-col gap-1 p-4">
            <p className="flex items-center gap-2 font-semibold">
              Measurement worker <Badge kind="measured" />
            </p>
            <p className="text-sm text-[var(--color-ink-soft)]">
              A registered quiet machine, one session at a time. Everything timed comes from here.
            </p>
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-bold tracking-tight">What we deliberately do not claim</h2>
        <ul className="flex max-w-2xl list-disc flex-col gap-2 pl-5 text-sm text-[var(--color-ink-soft)]">
          <li>
            How slow a library is when <em>you call it with your data</em> — that depends on your inputs
            and cannot be read from an import.
          </li>
          <li>Responsiveness after load (INP): that needs real people tapping real buttons.</li>
          <li>An exact figure for one specific phone. We emulate and calibrate, and we say so.</li>
          <li>Anything about security or maintenance — other tools already do that well.</li>
          <li>Firefox or Safari. We measure Chromium.</li>
        </ul>
        <p className="max-w-2xl text-sm text-[var(--color-ink-soft)]">
          And the honest headline: for any single package a real measurement beats our prediction. The
          prediction earns its place by being instant, working before you install anything, ranking five
          alternatives at once, and telling you when it is not confident enough to decide.
        </p>
      </section>

      <p className="text-sm">
        <Link href="/register" className="dl-btn dl-btn-primary">
          Try it on your own app
        </Link>
      </p>
    </div>
  );
}

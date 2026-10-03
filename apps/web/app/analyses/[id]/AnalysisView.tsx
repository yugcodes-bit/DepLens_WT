'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AnalysisResult, CandidateReport, RiskLevel } from '@deplens/shared';
import { Badge, Metric } from '@/components/Badge.tsx';
import { ForestPlot, type ForestRow } from '@/components/ForestPlot.tsx';

/**
 * Results view (doc 05 UI-2).
 *
 * Polls the job until the worker finishes. Doc 05 specifies SSE for progress; polling is used here
 * because the job runs on a *separate* machine from the web server (doc 06 §7), so the server has
 * no event to stream — it would be polling the database on the client's behalf either way. The
 * poll interval is deliberate rather than tight: an analysis takes tens of seconds per candidate.
 */

const POLL_MS = 2000;

interface JobState {
  ok: boolean;
  id?: string;
  status?: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress?: number;
  progressMessage?: string | null;
  error?: string | null;
  result?: AnalysisResult | null;
  errors?: Record<string, string>;
}

const RISK_STYLE: Record<RiskLevel, string> = {
  low: 'text-[var(--color-good)] border-[var(--color-good)]',
  moderate: 'text-[var(--color-warn)] border-[var(--color-warn)]',
  uncertain: 'text-[var(--color-warn)] border-[var(--color-warn)]',
  high: 'text-[var(--color-bad)] border-[var(--color-bad)]',
};

const kb = (bytes: number) => `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;

export function AnalysisView({ id }: { id: string }) {
  const [state, setState] = useState<JobState>({ ok: true, status: 'queued', progress: 0 });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/analyses/${id}`, { cache: 'no-store' });
        const body = (await res.json()) as JobState;
        if (cancelled) return;
        setState(body);
        // Stop polling once there is nothing left to wait for.
        if (body.ok && (body.status === 'done' || body.status === 'failed' || body.status === 'cancelled')) return;
        if (!body.ok) return;
      } catch {
        if (cancelled) return;
        setState((s) => ({ ...s, errors: { _form: 'Lost contact with the server. Retrying…' } }));
      }
      timer = setTimeout(poll, POLL_MS);
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  if (!state.ok) {
    return (
      <p role="alert" className="rounded-lg border border-[var(--color-bad)] px-3 py-2 text-sm text-[var(--color-bad)]">
        {state.errors?._form ?? 'Analysis not found'}
      </p>
    );
  }

  if (state.status === 'failed') {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="rounded-lg border border-[var(--color-bad)] px-3 py-2 text-sm text-[var(--color-bad)]">
          This analysis failed: {state.error ?? 'unknown error'}
        </p>
        <Link href="/analyze" className="dl-btn dl-btn-primary self-start text-sm">
          Try another analysis
        </Link>
      </div>
    );
  }

  if (state.status !== 'done' || !state.result) {
    return <Progress status={state.status ?? 'queued'} progress={state.progress ?? 0} message={state.progressMessage} />;
  }

  const result = state.result;
  const rankByName = new Map(result.ranking.map((r) => [r.name, r]));
  const rows: ForestRow[] = result.ranking.flatMap((rank) => {
    const r = result.reports.find((x) => x.candidate.name === rank.name);
    if (!r) return [];
    const [low, high] = r.script.interval ?? [r.script.value, r.script.value];
    return [{ name: rank.name, point: r.script.value, low, high, tiedWithPrevious: rank.tiedWithPrevious }];
  });

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {result.reports.length === 1 ? result.reports[0]!.candidate.name : `${result.reports.length} candidates`} on{' '}
          {result.host.name}
        </h1>
        <p className="text-sm text-[var(--color-ink-soft)]">
          {result.host.framework} app, {kb(result.host.baselineMinBytes)} of initial JavaScript · profile{' '}
          <strong>{result.profile}</strong> at {result.profileSlowdown.toFixed(2)}× · feature schema v
          {result.schemaVersion}
        </p>
        <p className="max-w-prose rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-ink-soft)]">
          Byte figures are <Badge kind="exact" /> — counted by differencing two real builds. Millisecond
          figures are <Badge kind="predicted" /> by{' '}
          <code>{result.reports[0]?.model.kind ?? 'the placeholder model'}</code>, which is the Δbytes
          baseline from the methodology, not a trained model. Its intervals are wide on purpose.
        </p>
      </section>

      {rows.length > 1 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold tracking-tight">Predicted main-thread cost</h2>
          <ForestPlot rows={rows} budgetMs={result.budget?.scriptMs} />
        </section>
      )}

      <section className="flex flex-col gap-6">
        <h2 className="text-lg font-bold tracking-tight">Candidates</h2>
        {result.reports.map((r) => (
          <CandidateCard key={r.candidate.name} report={r} rank={rankByName.get(r.candidate.name)} />
        ))}
      </section>

      <Link href="/analyze" className="dl-btn self-start text-sm">
        Run another analysis
      </Link>
    </div>
  );
}

function Progress({ status, progress, message }: { status: string; progress: number; message?: string | null }) {
  return (
    <div className="dl-card flex flex-col gap-4 p-6">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold">{status === 'queued' ? 'Waiting for a worker…' : 'Analysing…'}</p>
        <p className="text-sm tabular-nums text-[var(--color-ink-faint)]">{progress}%</p>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Analysis progress"
      >
        <div className="h-full rounded-full bg-[var(--color-brand)] transition-[width] duration-500" style={{ width: `${progress}%` }} />
      </div>
      <p className="text-sm text-[var(--color-ink-soft)]">{message ?? 'Installing packages and building the app twice per candidate.'}</p>
      {status === 'queued' && (
        <p className="text-xs text-[var(--color-ink-faint)]">
          Analysis runs on a separate worker, not on the web server — installing npm packages and running a
          bundler does not fit in a serverless function. If nothing happens, no worker is running.
        </p>
      )}
    </div>
  );
}

function CandidateCard({ report: r, rank }: { report: CandidateReport; rank?: { rank: number; tiedWithPrevious: boolean } }) {
  const [low, high] = r.script.interval ?? [r.script.value, r.script.value];
  const [showFeatures, setShowFeatures] = useState(false);

  return (
    <article className="dl-card flex flex-col gap-5 p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-bold">
            {r.candidate.name}
            {r.candidate.version && <span className="text-[var(--color-ink-faint)]">@{r.candidate.version}</span>}
          </h3>
          <code className="text-xs text-[var(--color-ink-soft)]">{r.candidate.import}</code>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase ${RISK_STYLE[r.verdict.risk]}`}>
            {r.verdict.risk}
          </span>
          {rank && (
            <span className="text-xs text-[var(--color-ink-faint)]">
              rank {rank.rank}
              {rank.tiedWithPrevious && ' — tie'}
            </span>
          )}
        </div>
      </header>

      <p className="text-sm text-[var(--color-ink-soft)]">{r.verdict.reason}</p>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Δ bytes (min)" value={kb(r.bytes.min.value)} kind={r.bytes.min.provenance} />
        <Metric label="Δ bytes (brotli)" value={kb(r.bytes.brotli.value)} kind={r.bytes.brotli.provenance} />
        <Metric
          label="Δ main-thread"
          value={r.script.value.toFixed(1)}
          unit="ms"
          interval={`${low.toFixed(1)} – ${high.toFixed(1)}`}
          kind={r.script.provenance}
        />
        <Metric label="Δ network" value={r.network.value.toFixed(0)} unit="ms" kind={r.network.provenance} />
      </div>

      {r.bytes.sharedWithApp.length > 0 && (
        <p className="rounded-lg border border-[var(--color-exact)] bg-[var(--color-surface-2)] px-3 py-2 text-sm">
          <strong>Your app already ships {r.bytes.sharedWithApp.join(', ')}</strong> — that is why this costs so
          much less here than its size suggests.
        </p>
      )}

      {r.outOfDistribution.outOfDistribution && (
        <div className="rounded-lg border border-[var(--color-warn)] px-3 py-2 text-sm text-[var(--color-warn)]">
          <p className="font-semibold">Outside the model&apos;s experience</p>
          <ul className="mt-1 list-disc pl-5">
            {r.outOfDistribution.reasons.map((why) => (
              <li key={why}>{why}</li>
            ))}
          </ul>
        </div>
      )}

      {r.why.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Why</h4>
          <ul className="flex flex-col gap-1 text-sm">
            {r.why.map((w) => (
              <li key={w.feature + w.text} className="flex gap-2">
                <span aria-hidden="true" className="text-[var(--color-ink-faint)]">
                  •
                </span>
                <span>
                  {w.text}
                  {w.ms !== null && <span className="ml-1 tabular-nums text-[var(--color-ink-faint)]">({w.ms.toFixed(1)} ms)</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {r.advice.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">What you could do</h4>
          <ul className="flex flex-col gap-1 text-sm">
            {r.advice.map((a) => (
              <li key={a.text} className="flex gap-2">
                <span aria-hidden="true" className="text-[var(--color-ink-faint)]">
                  →
                </span>
                <span>{a.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-[var(--color-line)] pt-3">
        <button
          type="button"
          onClick={() => setShowFeatures((v) => !v)}
          aria-expanded={showFeatures}
          className="self-start text-xs font-medium text-[var(--color-brand)] underline"
        >
          {showFeatures ? 'Hide' : 'Show'} the {Object.keys(r.features).length} features behind this (
          {r.featureGroups.join(' + ')})
        </button>
        {showFeatures && (
          <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(r.features)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 border-b border-[var(--color-line)] py-0.5">
                  <dt className="font-mono text-[var(--color-ink-soft)]">{k}</dt>
                  <dd className="tabular-nums">{String(v)}</dd>
                </div>
              ))}
          </dl>
        )}
        {r.notes.map((note) => (
          <p key={note} className="text-xs text-[var(--color-ink-faint)]">
            Note: {note}
          </p>
        ))}
        <p className="text-xs text-[var(--color-ink-faint)]">
          Took {(r.timings.totalMs / 1000).toFixed(1)} s — install {(r.timings.installMs / 1000).toFixed(1)} s, build{' '}
          {(r.timings.buildMs / 1000).toFixed(1)} s, feature extraction {Math.round(r.timings.extractMs)} ms.
        </p>
      </div>
    </article>
  );
}

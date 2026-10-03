'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { analysisRequestSchema } from '@deplens/shared';
import { Field, FormMessage } from '@/components/Field.tsx';
import { postJson, type ApiResponse } from '@/lib/client.ts';

/**
 * New-analysis form (doc 05 UI-1).
 *
 * Validated here for feedback and again in the route handler, from the same Zod schema
 * (`analysisRequestSchema`) — the browser copy is a convenience, the server copy is the one that
 * counts (CLAUDE.md).
 */

const HOSTS = [
  { value: 'react', label: 'react — 222 KB baseline, React 18' },
  { value: 'react-heavy', label: 'react-heavy — 411 KB, already ships date-fns & lodash' },
  { value: 'vanilla', label: 'vanilla — no framework' },
  { value: 'vue', label: 'vue' },
  { value: 'svelte', label: 'svelte' },
  { value: 'preact', label: 'preact' },
  { value: 'solid', label: 'solid' },
  { value: 'empty', label: 'empty — 84 B, for isolated cost' },
];

const PROFILES = [
  { value: 'mid-tier-mobile', label: 'Mid-tier mobile (4× slower, slow 4G)' },
  { value: 'desktop', label: 'Desktop (no throttling, cable)' },
  { value: 'low-end-mobile', label: 'Low-end mobile (10× slower, 2G-ish)' },
];

/** The four date libraries from doc 05 UC-02 — the comparison the project was designed around. */
const PRESET = [
  { pkg: 'dayjs@1.11.13', code: "import dayjs from 'dayjs'" },
  { pkg: 'date-fns@4.1.0', code: "import { format } from 'date-fns'" },
  { pkg: 'moment@2.30.1', code: "import moment from 'moment'" },
  { pkg: 'luxon@3.5.0', code: "import { DateTime } from 'luxon'" },
];

interface Row {
  pkg: string;
  code: string;
}

export function AnalyzeForm({ csrfToken }: { csrfToken: string }) {
  const router = useRouter();
  const [host, setHost] = useState('react');
  const [profile, setProfile] = useState('mid-tier-mobile');
  const [budgetMs, setBudgetMs] = useState('50');
  const [rows, setRows] = useState<Row[]>([{ pkg: '', code: '' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const payload = {
      host,
      profile,
      candidates: rows
        .filter((r) => r.pkg.trim() || r.code.trim())
        .map((r) => ({ pkg: r.pkg.trim(), spec: { code: r.code.trim(), placement: 'initial' as const } })),
      ...(budgetMs.trim() ? { budget: { scriptMs: Number(budgetMs) } } : {}),
    };

    const parsed = analysisRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        // Path looks like candidates.0.spec.code — surface it against the row it belongs to.
        const [head, idx, , leaf] = issue.path;
        next[head === 'candidates' ? `row-${idx}-${leaf ?? 'pkg'}` : String(head ?? '_form')] = issue.message;
      }
      setErrors(next);
      return;
    }

    setBusy(true);
    const res = (await postJson('/api/analyses', parsed.data, csrfToken)) as ApiResponse & { jobId?: string };
    setBusy(false);
    if (!res.ok) {
      setErrors(res.errors ?? { _form: 'Could not queue the analysis' });
      return;
    }
    router.push(`/analyses/${String(res.jobId ?? '')}`);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <FormMessage error={errors._form} />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Your app</span>
          <select value={host} onChange={(e) => setHost(e.target.value)} className="dl-input">
            {HOSTS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-[var(--color-ink-faint)]">
            These are the research host apps. Analysing your own repository needs a project (Full mode).
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Device profile</span>
          <select value={profile} onChange={(e) => setProfile(e.target.value)} className="dl-input">
            {PROFILES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-[var(--color-ink-faint)]">
            A profile is a calibrated CPU slowdown, not a raw throttling rate — the same profile means the
            same thing on different machines.
          </span>
        </label>
      </div>

      <Field
        label="Main-thread budget (ms)"
        name="budgetMs"
        value={budgetMs}
        onChange={setBudgetMs}
        inputMode="numeric"
        required={false}
        hint="Optional. The verdict compares the whole uncertainty interval against this, not just the estimate."
        error={errors.budget}
      />

      <fieldset className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <legend className="text-sm font-medium">Candidates</legend>
          <button
            type="button"
            className="dl-btn text-xs"
            onClick={() => setRows(PRESET.map((p) => ({ pkg: p.pkg, code: p.code })))}
          >
            Load the four date libraries
          </button>
        </div>

        {rows.map((row, i) => (
          <div key={i} className="dl-card flex flex-col gap-3 p-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <Field
                label="Package"
                name={`pkg-${i}`}
                value={row.pkg}
                onChange={(v) => setRow(i, { pkg: v })}
                placeholder="date-fns@4.1.0"
                error={errors[`row-${i}-pkg`]}
              />
              <Field
                label="The exact import you would add"
                name={`code-${i}`}
                value={row.code}
                onChange={(v) => setRow(i, { code: v })}
                placeholder="import { format } from 'date-fns'"
                error={errors[`row-${i}-code`]}
              />
            </div>
            {rows.length > 1 && (
              <button
                type="button"
                className="self-start text-xs text-[var(--color-ink-faint)] underline"
                onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
              >
                Remove this candidate
              </button>
            )}
          </div>
        ))}

        {rows.length < 8 && (
          <button type="button" className="dl-btn self-start text-sm" onClick={() => setRows((p) => [...p, { pkg: '', code: '' }])}>
            Add another candidate
          </button>
        )}
      </fieldset>

      <button type="submit" className="dl-btn dl-btn-primary self-start" disabled={busy}>
        {busy ? 'Queueing…' : 'Analyse'}
      </button>

      <p className="max-w-prose text-xs text-[var(--color-ink-faint)]">
        Analysis installs each package and runs two production builds of the host app, so it takes tens of
        seconds per candidate. It never executes install scripts, and it produces no timing measurement —
        the millisecond figures are predictions, clearly labelled as such.
      </p>
    </form>
  );
}

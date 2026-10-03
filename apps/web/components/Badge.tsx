/**
 * Provenance badge (NFR-U2). Every number in this product shows how it was obtained, because the
 * difference between "we measured this" and "a model guessed this" is the difference between a
 * decision and a hunch.
 */
export type Provenance = 'exact' | 'modeled' | 'predicted' | 'measured';

const EXPLANATION: Record<Provenance, string> = {
  exact: 'Computed from a real production build. Not an estimate.',
  modeled: 'Calculated with a documented formula from exact numbers.',
  predicted: 'Estimated by the model, always with an uncertainty range.',
  measured: 'Produced by a real browser on a calibrated quiet machine.',
};

const COLOR: Record<Provenance, string> = {
  exact: 'text-[var(--color-exact)]',
  modeled: 'text-[var(--color-modeled)]',
  predicted: 'text-[var(--color-predicted)]',
  measured: 'text-[var(--color-measured)]',
};

export function Badge({ kind }: { kind: Provenance }) {
  return (
    <abbr title={EXPLANATION[kind]} className={`dl-badge no-underline ${COLOR[kind]}`}>
      {kind}
    </abbr>
  );
}

/** A number with its unit and provenance, the atom every result view is built from. */
export function Metric({
  label,
  value,
  unit,
  interval,
  kind,
}: {
  label: string;
  value: string;
  unit?: string;
  interval?: string;
  kind: Provenance;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">{label}</span>
        <Badge kind={kind} />
      </div>
      <p className="text-xl font-bold tabular-nums sm:text-2xl">
        {value}
        {unit && <span className="ml-1 text-sm font-medium text-[var(--color-ink-soft)]">{unit}</span>}
      </p>
      {interval && <p className="text-xs text-[var(--color-ink-faint)]">95% CI {interval}</p>}
    </div>
  );
}

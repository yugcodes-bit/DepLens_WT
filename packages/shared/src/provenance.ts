/**
 * Provenance — the project's central honesty rule (CLAUDE.md).
 *
 * Every number DepLens shows a user carries one of these four labels, because the whole value of
 * the tool rests on the reader knowing which kind of number they are looking at. A byte delta from
 * two real builds and a millisecond figure from a gradient-boosted model are not the same kind of
 * claim, and a UI that renders them identically is lying by omission.
 */

export const PROVENANCES = ['exact', 'modeled', 'predicted', 'measured'] as const;
export type Provenance = (typeof PROVENANCES)[number];

export interface ProvenanceMeta {
  label: string;
  /** One sentence a non-specialist can read in a tooltip. */
  explanation: string;
  /** How much to trust it, for sorting and for choosing a badge colour. */
  rank: number;
}

export const PROVENANCE_META: Record<Provenance, ProvenanceMeta> = {
  exact: {
    label: 'Exact',
    explanation: 'Counted, not estimated: this came from differencing two real builds of your app.',
    rank: 0,
  },
  measured: {
    label: 'Measured',
    explanation: 'Observed in a real browser on a quiet machine, as a paired A/B difference with a confidence interval.',
    rank: 1,
  },
  predicted: {
    label: 'Predicted',
    explanation: 'A model estimate for your app and device profile, with an uncertainty interval. Not a measurement.',
    rank: 2,
  },
  modeled: {
    label: 'Modelled',
    explanation: 'Derived from a formula rather than observed — a rough scale indicator, not a measurement.',
    rank: 3,
  },
};

/** A number with its provenance attached. Nothing in the UI renders a bare number. */
export interface Attributed<T = number> {
  value: T;
  provenance: Provenance;
  unit?: string;
  /** Lower and upper bound, when the number has one (a CI for measured, an interval for predicted). */
  interval?: [number, number];
  /** Why this number is what it is, in one sentence. */
  note?: string;
}

export const attributed = <T>(value: T, provenance: Provenance, extra: Omit<Attributed<T>, 'value' | 'provenance'> = {}): Attributed<T> => ({
  value,
  provenance,
  ...extra,
});

/**
 * The weakest provenance in a set — what a derived number must be labelled.
 * A figure computed from an exact byte count and a predicted millisecond figure is *predicted*:
 * a combination can never be more trustworthy than its weakest input.
 */
export function weakestProvenance(parts: readonly Provenance[]): Provenance {
  if (parts.length === 0) return 'modeled';
  return parts.reduce((worst, p) => (PROVENANCE_META[p].rank > PROVENANCE_META[worst].rank ? p : worst), parts[0]!);
}

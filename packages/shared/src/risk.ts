/**
 * Verdict and risk rules (FR-24), and the out-of-distribution flag (FR-25).
 *
 * The rule doc 01 §4.2 sets down is the important part: **risk comes from the interval, not from
 * the point estimate.** A point estimate of 30 ms against a 50 ms budget looks safe, but if the
 * interval runs to 80 ms the honest answer is "we cannot tell — verify it". A tool that ranked on
 * the point estimate alone would give confident-looking advice it has no right to give.
 */
import type { Provenance } from './provenance.ts';
import { networkMs, type Profile } from './profiles.ts';

export const RISK_LEVELS = ['low', 'moderate', 'uncertain', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const BUDGET_VERDICTS = ['within', 'over', 'straddles', 'no-budget'] as const;
export type BudgetVerdict = (typeof BUDGET_VERDICTS)[number];

export interface Interval {
  point: number;
  /** Lower bound (p10 for a predicted interval, CI low for a measured one). */
  low: number;
  /** Upper bound (p90 / CI high). */
  high: number;
}

export interface Budget {
  /** Main-thread script budget in milliseconds. */
  scriptMs?: number;
  /** Initial-load budget in brotli kilobytes. */
  brotliKb?: number;
}

export interface Verdict {
  risk: RiskLevel;
  budget: BudgetVerdict;
  /** True when the honest answer is "measure it" rather than a number. */
  verifyRecommended: boolean;
  /** One sentence explaining the verdict, suitable for the UI. */
  reason: string;
}

/**
 * Applies doc 01 §4.2 exactly:
 *   low        — p90 < 50% of budget
 *   high       — p10 > budget
 *   uncertain  — the interval straddles the budget (verify recommended)
 *   moderate   — otherwise
 */
export function verdictFor(interval: Interval, budget: Budget | undefined, opts: { outOfDistribution?: boolean } = {}): Verdict {
  const budgetMs = budget?.scriptMs;

  if (opts.outOfDistribution) {
    // FR-25: a request outside the training distribution is forced to `uncertain`, whatever the
    // interval says — the interval itself is not trustworthy there.
    return {
      risk: 'uncertain',
      budget: budgetMs === undefined ? 'no-budget' : intervalVsBudget(interval, budgetMs),
      verifyRecommended: true,
      reason: 'This request is outside the range the model was trained on, so its interval cannot be trusted. Measure it.',
    };
  }

  if (budgetMs === undefined) {
    // With no budget there is nothing to be "within", so risk falls back to how wide the interval
    // is relative to its own point estimate — a wide interval is itself a reason to verify.
    const straddlesZero = interval.low <= 0 && interval.high >= 0;
    if (straddlesZero) {
      return {
        risk: 'low',
        budget: 'no-budget',
        verifyRecommended: false,
        reason: 'The interval includes zero: this import has no cost we can distinguish from noise.',
      };
    }
    const width = interval.high - interval.low;
    const wide = width > Math.abs(interval.point);
    return {
      risk: wide ? 'uncertain' : 'moderate',
      budget: 'no-budget',
      verifyRecommended: wide,
      reason: wide
        ? 'The interval is wider than the estimate itself, so the number is not actionable yet. Measure it.'
        : 'No budget was set, so this is reported as a cost without a verdict.',
    };
  }

  const vsBudget = intervalVsBudget(interval, budgetMs);

  if (interval.low > budgetMs) {
    return {
      risk: 'high',
      budget: vsBudget,
      verifyRecommended: false,
      reason: `Even the optimistic end of the interval (${fmt(interval.low)} ms) is over the ${fmt(budgetMs)} ms budget.`,
    };
  }
  if (interval.high < budgetMs * 0.5) {
    return {
      risk: 'low',
      budget: vsBudget,
      verifyRecommended: false,
      reason: `The whole interval stays under half the ${fmt(budgetMs)} ms budget.`,
    };
  }
  if (interval.low <= budgetMs && interval.high >= budgetMs) {
    return {
      risk: 'uncertain',
      budget: 'straddles',
      verifyRecommended: true,
      reason: `The interval (${fmt(interval.low)}–${fmt(interval.high)} ms) crosses the ${fmt(budgetMs)} ms budget, so we cannot tell. Measure it.`,
    };
  }
  return {
    risk: 'moderate',
    budget: vsBudget,
    verifyRecommended: false,
    reason: `The interval stays under the ${fmt(budgetMs)} ms budget, but uses more than half of it.`,
  };
}

function intervalVsBudget(interval: Interval, budgetMs: number): BudgetVerdict {
  if (interval.low > budgetMs) return 'over';
  if (interval.high < budgetMs) return 'within';
  return 'straddles';
}

const fmt = (n: number) => (Math.abs(n) >= 10 ? n.toFixed(0) : n.toFixed(1));

/**
 * Out-of-distribution check (FR-25). Deliberately conservative: it is better to tell a developer
 * "we have not seen anything like this" than to hand them a confident number from an extrapolation.
 */
export interface DistributionBounds {
  frameworks: string[];
  maxCtxDeltaMinBytes: number;
  maxIsoMinBytes: number;
  profileSlowdowns: number[];
}

export interface OodResult {
  outOfDistribution: boolean;
  reasons: string[];
}

export function checkDistribution(
  features: { host_framework?: unknown; ctx_delta_min_bytes?: unknown; iso_min_bytes?: unknown; profile_slowdown?: unknown },
  bounds: DistributionBounds,
): OodResult {
  const reasons: string[] = [];
  const framework = features.host_framework;
  if (typeof framework === 'string' && !bounds.frameworks.includes(framework)) {
    reasons.push(`No app using ${framework} was in the training set.`);
  }
  const ctx = features.ctx_delta_min_bytes;
  if (typeof ctx === 'number' && ctx > bounds.maxCtxDeltaMinBytes) {
    reasons.push(
      `This import adds ${Math.round(ctx / 1024)} KB, more than the largest in the training set (${Math.round(bounds.maxCtxDeltaMinBytes / 1024)} KB).`,
    );
  }
  const iso = features.iso_min_bytes;
  if (typeof iso === 'number' && iso > bounds.maxIsoMinBytes) {
    reasons.push(`The package is larger in isolation than anything in the training set.`);
  }
  const slowdown = features.profile_slowdown;
  if (typeof slowdown === 'number' && bounds.profileSlowdowns.length > 0) {
    const max = Math.max(...bounds.profileSlowdowns);
    if (slowdown > max * 1.25) reasons.push('This device profile is slower than any profile in the training set.');
  }
  return { outOfDistribution: reasons.length > 0, reasons };
}

/**
 * The network cost of the added bytes, as a reportable number (doc 01 §4.2 `network`).
 *
 * The formula itself lives in `profiles.ts` (`networkMs`, doc 07 §4.6) and is not duplicated here;
 * this wrapper adds the provenance label and the human-readable model string the UI shows.
 *
 * Always **modelled**, never measured: the harness deliberately does not emulate the network while
 * measuring CPU (doc 07 §3.4), because network jitter would contaminate the CPU label.
 */
export function networkCost(args: { brotliBytes: number; profile: Profile; newChunks?: number }): {
  ms: number;
  provenance: Provenance;
  model: string;
} {
  const extraRoundTrips = Math.max(0, args.newChunks ?? 0);
  const ms = networkMs(args.brotliBytes, args.profile, extraRoundTrips);
  const { downKbps, rttMs } = args.profile.network;
  return {
    ms,
    provenance: 'modeled',
    model:
      `${(downKbps / 1000).toFixed(1)} Mbps, ${rttMs} ms RTT` +
      (extraRoundTrips > 0 ? `, +${extraRoundTrips} round trip${extraRoundTrips > 1 ? 's' : ''} for new chunks` : ', same chunk'),
  };
}

/**
 * The predictor interface, and the **B3 placeholder** that stands in until the dataset exists.
 *
 * Doc 09's P5 plan says the product ships "wired to the exact-Δbytes baseline (B3) as the
 * placeholder predictor". This file is that placeholder, and it is written to be obviously
 * provisional rather than quietly plausible:
 *
 *   - it reports `kind: 'b3-bytes-linear'` and `trainedOnCells: null`, so the UI and the API can
 *     say where the number came from;
 *   - its interval is deliberately **wide**, because the Phase 0 spike measured four imports of
 *     similar size (62–75 KB) costing between ≈0 ms and +117 ms (docs/research-log.md). A narrow
 *     interval from a bytes-only model would be a false claim, and the whole premise of DepLens is
 *     that bytes alone cannot tell you the cost;
 *   - it carries provenance `predicted`, never `measured`.
 *
 * When the ML service exists it implements the same `Predictor` interface and replaces this one.
 */
import type { FeatureVector, Interval } from '@deplens/shared';

export interface Prediction {
  script: Interval;
  tbt: Interval;
  model: {
    kind: string;
    version: string;
    trainedOnCells: number | null;
    note?: string;
  };
}

export interface Predictor {
  predict(features: FeatureVector, context: { profileSlowdown: number }): Prediction;
}

/**
 * Milliseconds of main-thread script time per KB of added minified JS, at profile slowdown 1.
 *
 * Derived from the one in-context measurement we have on the Vite hosts (docs/research-log.md,
 * 2026-10-01): `import _ from 'lodash'` on the `react` host added 73,468 B and 37.4 ms of ΔScript
 * thread time at a calibrated slowdown of 4.28×.
 *
 *     37.4 ms / (71.75 KB × 4.28) = 0.122 ms per KB per unit slowdown
 *
 * One data point is not a model. It is a scale, and it is why the interval below is wide.
 */
export const B3_MS_PER_KB = 0.122;

/**
 * Interval multipliers around the point estimate.
 *
 * The spread comes from the Phase 0 observation that imports of near-identical size differed by
 * more than two orders of magnitude in cost. The lower bound is near zero because a package whose
 * functions are never called at load really does cost ≈0 ms, however many bytes it is.
 */
export const B3_INTERVAL_LOW = 0.05;
export const B3_INTERVAL_HIGH = 2.5;

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * B3: predict from in-context Δbytes alone (doc 08 §4's third baseline).
 *
 * Doc 08 requires every headline result to be compared against this baseline, so having it as a
 * real, callable predictor is useful beyond the placeholder role: it is the thing the trained
 * model has to beat.
 */
export class BytesBaselinePredictor implements Predictor {
  readonly version = 'b3-placeholder-1';

  predict(features: FeatureVector, context: { profileSlowdown: number }): Prediction {
    // Prefer the in-context delta (exact, and what B3 is defined on). Fall back to the isolated
    // size when a host diff was not available, which the note records.
    const ctxBytes = n(features.ctx_delta_min_bytes);
    const usedIsolated = ctxBytes === 0 && n(features.iso_min_bytes) > 0;
    const bytes = usedIsolated ? n(features.iso_min_bytes) : ctxBytes;

    const kb = Math.max(0, bytes) / 1024;
    const point = kb * B3_MS_PER_KB * context.profileSlowdown;

    // TBT only accrues once a single task crosses 50 ms, so a small addition contributes nothing.
    // Modelling it as the part of the point estimate above that threshold is crude but monotone,
    // and it is labelled predicted like everything else here.
    const tbtPoint = Math.max(0, point - 50);

    return {
      script: {
        point,
        low: point * B3_INTERVAL_LOW,
        high: point * B3_INTERVAL_HIGH,
      },
      tbt: {
        point: tbtPoint,
        low: 0,
        high: Math.max(0, point * B3_INTERVAL_HIGH - 50),
      },
      model: {
        kind: 'b3-bytes-linear',
        version: this.version,
        trainedOnCells: null,
        note:
          'Placeholder predictor: a linear function of added bytes, scaled by the device profile. ' +
          'It is the B3 baseline from doc 08 §4, not a trained model — the interval is wide because ' +
          'bytes alone cannot distinguish code that runs at import from code that is never called.' +
          (usedIsolated ? ' No host build diff was available, so the isolated size was used instead of Δbytes in context.' : ''),
      },
    };
  }
}

/** The predictor the pipeline uses today. Swapping this is the whole of P6's serving change. */
export const defaultPredictor: Predictor = new BytesBaselinePredictor();

/**
 * Bounds of the training distribution, used for the FR-25 out-of-distribution flag.
 *
 * With no dataset yet, these describe the **host apps and fixtures we actually have**, which is
 * the honest answer to "what has this thing seen?". They are replaced by the real dataset's bounds
 * when a model is trained.
 */
export const PLACEHOLDER_DISTRIBUTION = {
  frameworks: ['vanilla', 'react', 'vue', 'svelte', 'preact', 'solid'],
  maxCtxDeltaMinBytes: 420_000,
  maxIsoMinBytes: 420_000,
  profileSlowdowns: [1, 4, 10],
};

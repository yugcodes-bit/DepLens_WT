/**
 * The "why" list and the advice list (doc 01 §4.2, doc 04 F3/F22).
 *
 * These are **templates over features**, not generated prose. Doc 04 scored an LLM explainer as
 * WON'T precisely because it would add hallucination risk to the one part of the product that has
 * to be trustworthy: when the tool says "only 2% of the package survives tree-shaking", that
 * number is read straight off a feature, and a reader can check it.
 *
 * In the finished pipeline the ordering comes from TreeSHAP attributions (doc 08 §6). Until a
 * trained model exists, the rules below fire on feature thresholds and carry no millisecond
 * attribution — a `ms` of `null` means "this is a reason, but we cannot yet say how much of the
 * cost it accounts for", which is the honest statement.
 */
import type { FeatureVector } from './schemas.ts';

export interface Reason {
  text: string;
  /** Millisecond attribution from TreeSHAP, or null when no trained model produced it. */
  ms: number | null;
  /** The feature this reason is read from, so the UI can link to the raw number. */
  feature: string;
}

export interface Advice {
  type: 'native' | 'alternative' | 'placement' | 'import-style' | 'duplicate';
  text: string;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

const kb = (bytes: number) => (bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0);

/**
 * Reasons a candidate costs what it costs, strongest signal first.
 *
 * The order is deliberately *not* "most negative first": a developer reading this wants to know
 * what is driving the cost, then what is holding it down.
 */
export function explainFeatures(f: FeatureVector): Reason[] {
  const reasons: Reason[] = [];

  const ctxBytes = num(f.ctx_delta_min_bytes);
  const isoBytes = num(f.iso_min_bytes);
  const shared = num(f.ctx_shared_packages) ?? 0;
  const savedBytes = num(f.ctx_shared_bytes_saved) ?? 0;

  if (ctxBytes !== undefined && ctxBytes > 0) {
    reasons.push({
      text: `Adds ${kb(ctxBytes)} KB of minified code to your initial bundle`,
      ms: null,
      feature: 'ctx_delta_min_bytes',
    });
  }

  // The context effect — the finding the whole project exists to report.
  if (shared > 0 && savedBytes > 1024) {
    reasons.push({
      text: `Your app already ships ${shared} of the packages this import needs, saving ${kb(savedBytes)} KB`,
      ms: null,
      feature: 'ctx_shared_packages',
    });
  }

  const ratio = num(f.iso_treeshake_ratio);
  if (ratio !== undefined && ratio > 0 && ratio < 0.25 && isoBytes !== undefined) {
    reasons.push({
      text: `Only ${(ratio * 100).toFixed(0)}% of the package survives tree-shaking for this import`,
      ms: null,
      feature: 'iso_treeshake_ratio',
    });
  } else if (ratio !== undefined && ratio > 0.9) {
    reasons.push({
      text: 'This import pulls in essentially the whole package — tree-shaking cannot remove much',
      ms: null,
      feature: 'iso_treeshake_ratio',
    });
  }

  const topCalls = num(f.toplevel_calls) ?? 0;
  const sideEffects = num(f.toplevel_side_effect_score) ?? 0;
  const topShare = num(f.fn_bytes_share_toplevel);
  if (topCalls > 0 || sideEffects > 0) {
    reasons.push({
      text: `Runs work the moment it is imported: ${topCalls} call${topCalls === 1 ? '' : 's'} and ${sideEffects} side-effecting statement${sideEffects === 1 ? '' : 's'} at module top level`,
      ms: null,
      feature: 'toplevel_calls',
    });
  } else if (topShare !== undefined && topShare < 0.2) {
    reasons.push({
      text: 'Almost all the added code sits inside functions that are not called at load, so the browser only pre-parses it',
      ms: null,
      feature: 'fn_bytes_share_toplevel',
    });
  }

  if ((num(f.pife_count) ?? 0) > 0) {
    reasons.push({
      text: `${f.pife_count} parenthesized function expression(s) — V8 compiles these eagerly rather than lazily`,
      ms: null,
      feature: 'pife_count',
    });
  }

  if ((num(f.polyfill_signals) ?? 0) > 0 || bool(f.regenerator_runtime)) {
    reasons.push({
      text: 'Ships polyfills or a transpiler runtime, which execute at import on every load',
      ms: null,
      feature: 'polyfill_signals',
    });
  }

  if ((num(f.ctx_dup_versions) ?? 0) > 0) {
    reasons.push({
      text: `Introduces ${f.ctx_dup_versions} duplicate package version(s) — those bytes are shipped twice`,
      ms: null,
      feature: 'ctx_dup_versions',
    });
  }

  if ((num(f.largest_literal_bytes) ?? 0) > 20_480) {
    reasons.push({
      text: `Contains a ${kb(num(f.largest_literal_bytes)!)} KB data literal, which the engine must build at import`,
      ms: null,
      feature: 'largest_literal_bytes',
    });
  }

  if ((num(f.regex_literals) ?? 0) + (num(f.regex_ctor_calls) ?? 0) > 50) {
    reasons.push({
      text: `Compiles ${(num(f.regex_literals) ?? 0) + (num(f.regex_ctor_calls) ?? 0)} regular expressions`,
      ms: null,
      feature: 'regex_literals',
    });
  }

  if (bool(f.ctx_in_initial_chunk) === false) {
    reasons.push({
      text: 'The import is lazy, so it is not part of the initial load at all',
      ms: null,
      feature: 'ctx_in_initial_chunk',
    });
  }

  return reasons;
}

/** Top-N reasons, which is what the Results card shows (doc 05 UI-2: top-5 "why"). */
export const topReasons = (f: FeatureVector, n = 5): Reason[] => explainFeatures(f).slice(0, n);

/** Actionable advice derived from the same features. Each item is something the developer can do. */
export function adviceFor(f: FeatureVector, ctx: { packageName?: string } = {}): Advice[] {
  const advice: Advice[] = [];
  const ratio = num(f.iso_treeshake_ratio);

  if (ratio !== undefined && ratio > 0.9 && (num(f.iso_full_min_bytes) ?? 0) > 20_480) {
    advice.push({
      type: 'import-style',
      text: 'This import pulls in the whole package. Check whether a deep import or a named subset gets you the same API for fewer bytes.',
    });
  }

  if ((num(f.intl_refs) ?? 0) === 0 && /moment|date-fns|dayjs|luxon/.test(ctx.packageName ?? '')) {
    advice.push({
      type: 'native',
      text: 'For formatting and parsing dates, the built-in Intl.DateTimeFormat covers many cases with zero added bytes.',
    });
  }

  if (bool(f.ctx_in_initial_chunk) === true && (num(f.toplevel_calls) ?? 0) === 0 && (num(f.ctx_delta_min_bytes) ?? 0) > 30_720) {
    advice.push({
      type: 'placement',
      text: 'Nothing here runs at import, and it is large. A dynamic import() would move it out of the initial load entirely.',
    });
  }

  if ((num(f.ctx_dup_versions) ?? 0) > 0) {
    advice.push({
      type: 'duplicate',
      text: 'This adds a second copy of a package your app already has. Aligning the versions would remove the duplicate bytes.',
    });
  }

  if (bool(f.pkg_has_wasm)) {
    advice.push({
      type: 'alternative',
      text: 'This package ships WebAssembly. Compiling it can be costly at load; check whether a JS-only alternative is fast enough for your case.',
    });
  }

  return advice;
}

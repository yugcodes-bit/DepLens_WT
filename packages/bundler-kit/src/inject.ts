/**
 * Injection into a host app's entry module (doc 07 §2.1).
 *
 * Host entry files contain a marker block:
 *
 *   /* @deplens-inject *\/
 *   globalThis.__DL_SINK__ = [];
 *   /* @deplens-end *\/
 *
 * The baseline keeps the empty sink; the treatment replaces the block with the import spec + sink.
 */
import { baselineBlock, treatmentBlock, type ImportSpec } from './importSpec.ts';

export const MARKER_START = '/* @deplens-inject */';
export const MARKER_END = '/* @deplens-end */';

export function injectInto(entrySource: string, spec: ImportSpec | null): string {
  const start = entrySource.indexOf(MARKER_START);
  const end = entrySource.indexOf(MARKER_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Host entry is missing the ${MARKER_START} ... ${MARKER_END} block`);
  }
  const block = spec ? treatmentBlock(spec) : baselineBlock();
  // Static imports must stay at module top level; the marker block is required to be at top level.
  return (
    entrySource.slice(0, start) +
    `${MARKER_START}\n${block}\n` +
    entrySource.slice(end)
  );
}

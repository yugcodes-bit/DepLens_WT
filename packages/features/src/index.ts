/**
 * `@deplens/features` — feature extraction for groups G1–G5 and G7 of doc 08 §3.
 *
 * Every name this package emits comes from `feature-schema.json` and is checked against it before
 * it leaves (CLAUDE.md). Nothing here needs a browser, so it runs on the tier-2 CI worker as well
 * as on the measurement machine.
 */
export * from './schema.ts';
export * from './ast.ts';
export * from './pkgMeta.ts';
export * from './context.ts';
export * from './vector.ts';

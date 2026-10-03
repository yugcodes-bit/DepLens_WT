/**
 * `@deplens/bundler-kit` — the build half of the analyzer, with no browser dependency.
 *
 * Deliberately free of Playwright and of the measurement harness, so it can run in three places:
 * the quiet measurement machine (via `@deplens/harness`), a GitHub Actions runner (the tier-2
 * byte-analysis worker, doc 06 §7.2 — byte counts are deterministic, so a shared runner is fine),
 * and a developer's laptop.
 */
export * from './importSpec.ts';
export * from './bundleStats.ts';
export * from './compress.ts';
export * from './install.ts';
export * from './metafile.ts';
export * from './inject.ts';
export * from './viteBuild.ts';
export * from './build.ts';
export * from './isolated.ts';

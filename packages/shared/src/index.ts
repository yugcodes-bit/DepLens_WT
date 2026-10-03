/**
 * `@deplens/shared` — contracts every tier agrees on (doc 06 §5).
 *
 * Browser-safe and dependency-light on purpose: the Next.js app, the API, the CI worker and the
 * measurement harness all import from here, so nothing in this package may pull in esbuild,
 * Playwright or a database driver.
 */
export * from './provenance.ts';
export * from './profiles.ts';
export * from './risk.ts';
export * from './explain.ts';
export * from './schemas.ts';

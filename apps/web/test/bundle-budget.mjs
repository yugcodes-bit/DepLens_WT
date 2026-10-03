#!/usr/bin/env node
/**
 * Checks the app against its own performance budget (NFR-P5: initial JS ≤ 150 KB brotli).
 *
 * A tool that warns people about JavaScript bloat has to be measured by the same ruler, so this runs
 * on the real production build and uses the same compression settings the harness uses for Δbytes
 * (brotli quality 11), not the bundler's own report.
 *
 * Usage:  cd apps/web && pnpm build && node test/bundle-budget.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

const BUDGET_BYTES = 150 * 1024;
const MANIFEST = '.next/app-build-manifest.json';

if (!existsSync(MANIFEST)) {
  console.error(`${MANIFEST} not found — run \`pnpm build\` first.`);
  process.exit(1);
}

const brotli = (path) =>
  brotliCompressSync(readFileSync(path), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const rows = [];

for (const [route, files] of Object.entries(manifest.pages)) {
  // API routes ship no client JS of their own; only the pages a browser actually loads are budgeted.
  if (route.startsWith('/api/')) continue;
  let raw = 0;
  let br = 0;
  for (const file of files) {
    const path = join('.next', file);
    if (!file.endsWith('.js') || !existsSync(path)) continue;
    raw += readFileSync(path).length;
    br += brotli(path);
  }
  rows.push({ route, raw, br });
}

rows.sort((a, b) => b.br - a.br);

console.log('\nInitial JavaScript per route (brotli-11, the same setting the harness uses)\n');
console.log('route'.padEnd(26) + 'raw'.padStart(10) + 'brotli'.padStart(10) + '   verdict');
let failed = 0;
for (const { route, raw, br } of rows) {
  const ok = br <= BUDGET_BYTES;
  if (!ok) failed++;
  console.log(
    route.padEnd(26) +
      String(raw).padStart(10) +
      String(br).padStart(10) +
      `   ${ok ? 'within' : 'OVER'} budget (${(br / 1024).toFixed(1)} KB of ${BUDGET_BYTES / 1024} KB)`,
  );
}

const worst = rows[0];
console.log(
  `\nNFR-P5: heaviest route is ${worst.route} at ${(worst.br / 1024).toFixed(1)} KB brotli — ${
    failed === 0 ? 'PASS' : `FAIL on ${failed} route(s)`
  }\n`,
);
process.exit(failed > 0 ? 1 : 0);

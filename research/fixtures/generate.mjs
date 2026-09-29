// Generates synthetic calibration packages for harness validation (doc 07 §8).
//
//  @deplens/work-<K>  : performs K units of fixed CPU work at module evaluation (1 unit = 100k loop iterations).
//                       Fixed work (not a wall-clock busy-wait) so CPU throttling slows it down like real code.
//  @deplens/bytes-<K> : ~K KB of functions that are exported but never called (only pre-parsed by V8).
//  @deplens/eager-<K> : ~K KB of functions that are all called once at module evaluation (compiled + executed).
//
// Usage: node research/fixtures/generate.mjs
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), 'packages');
rmSync(root, { recursive: true, force: true });

function pkg(name, code) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: `@deplens/${name}`, version: '1.0.0', type: 'module', main: 'index.js', sideEffects: true }, null, 2),
  );
  writeFileSync(join(dir, 'index.js'), code);
}

for (const k of [0, 1, 2, 5, 10, 20, 50, 100]) {
  pkg(
    `work-${k}`,
    `// ${k} units of deterministic CPU work at import time
let x = 0;
const n = ${k} * 100000;
for (let i = 0; i < n; i++) { x = (Math.imul(x, 31) + i) | 0; }
export const result = x;
`,
  );
}

function fn(i) {
  // ~200 bytes per function, varied bodies so minifiers cannot deduplicate them
  return `export function f${i}(a, b) { const t = [a, b, ${i}]; let s = 0; for (const v of t) { s += (v * ${(i % 97) + 3}) ^ ${i}; } if (s > ${i * 13}) { return { k: "f${i}", s, m: Math.max(a, b) }; } return s - ${i}; }\n`;
}

for (const kb of [0, 10, 50, 100, 200, 400]) {
  const count = Math.round((kb * 1024) / 200);
  let body = '';
  for (let i = 0; i < count; i++) body += fn(i);
  pkg(`bytes-${kb}`, body + `export const all = [${Array.from({ length: count }, (_, i) => `f${i}`).join(', ')}];\n`);
  pkg(`eager-${kb}`, body + `export const all = [${Array.from({ length: count }, (_, i) => `f${i}`).join(', ')}];\nexport const ran = all.map((f, i) => f(i, i + 1));\n`);
}

console.log(`fixtures written to ${root}`);

#!/usr/bin/env node
/**
 * Harness CLI.
 *
 *   pnpm harness run  --host research/hosts/vanilla --import "import dayjs from 'dayjs'" --dep dayjs@1.11.13 --cpu 4 --pairs 10
 *   pnpm harness aa   --host research/hosts/vanilla --cpu 4 --pairs 10
 *   pnpm harness calibrate --cpu 1,2,4
 *
 * Output: a summary table on stdout and the full SessionResult JSON in .work/results/.
 */
import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { measureCell, type CellResult } from './cell.ts';
import { calibrate, launchBrowser, startMeasurementServer } from './session.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
const workRoot = resolve(repoRoot, '.work');

function parseDeps(list: string[] | undefined): Record<string, string> {
  const deps: Record<string, string> = {};
  for (const d of list ?? []) {
    // name@version | @scope/name@version | name=file:/abs/path
    if (d.includes('=')) {
      const [n, v] = d.split('=');
      deps[n!] = v!;
      continue;
    }
    const at = d.lastIndexOf('@');
    if (at > 0) deps[d.slice(0, at)] = d.slice(at + 1);
    else deps[d] = 'latest';
  }
  return deps;
}

export function formatCell(r: CellResult): string {
  const L = r.session.labels;
  const f = (k: keyof typeof L, digits = 1) =>
    `${L[k].estimate.toFixed(digits)} [${L[k].ciLow.toFixed(digits)}, ${L[k].ciHigh.toFixed(digits)}]`;
  return [
    `cell: ${r.request.label}  (cpu ${r.request.cpuRate}×, ${r.session.pairs.length} pairs, invalid runs ${r.session.invalidRuns})`,
    `  Δbytes      min ${r.delta.minBytes}  gzip ${r.delta.gzipBytes}  brotli ${r.delta.brotliBytes}  new pkgs: ${r.delta.newPackages.join(', ') || '—'}`,
    `  ΔScript     thread ${f('scriptThread')} ms   wall ${f('scriptWall')} ms`,
    `    compile ${f('compileThread')}  eval ${f('evalThread')}  gc ${f('gcThread')}`,
    `  ΔMainThread ${f('mainThreadWall')} ms   ΔTBT ${f('tbtLoad')} ms   ΔHeap ${f('jsHeapMB', 2)} MB`,
    `  baseline    script ${r.session.baselineMedian.scriptThread.toFixed(1)} ms (thread), main thread ${r.session.baselineMedian.mainThreadWall.toFixed(1)} ms`,
    `  calibration ${r.session.calibration.beforeMs.toFixed(0)} → ${r.session.calibration.afterMs.toFixed(0)} ms,  session ${(r.session.durationMs / 1000).toFixed(0)} s`,
  ].join('\n');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      host: { type: 'string', default: 'research/hosts/vanilla' },
      import: { type: 'string' },
      sink: { type: 'string' },
      dep: { type: 'string', multiple: true },
      cpu: { type: 'string', default: '1' },
      pairs: { type: 'string', default: '10' },
      seed: { type: 'string', default: '1' },
      label: { type: 'string' },
      lazy: { type: 'boolean', default: false },
    },
  });

  const browser = await launchBrowser();
  const server = await startMeasurementServer(workRoot);
  try {
    if (cmd === 'calibrate') {
      for (const rate of values.cpu!.split(',').map(Number)) {
        const ms = await calibrate(browser, server.origin, rate);
        console.log(`cpu ${rate}×  calibration ${ms.toFixed(1)} ms`);
      }
      return;
    }
    if (cmd !== 'run' && cmd !== 'aa') throw new Error(`unknown command ${cmd}; use run | aa | calibrate`);
    const spec =
      cmd === 'aa'
        ? null
        : {
            code: values.import ?? (() => { throw new Error('--import is required'); })(),
            ...(values.sink ? { sink: values.sink } : {}),
            ...(values.lazy ? { placement: 'lazy' as const } : {}),
          };
    const res = await measureCell(browser, server, {
      label: values.label ?? (spec ? spec.code : 'A/A'),
      hostDir: resolve(repoRoot, values.host!),
      spec,
      deps: parseDeps(values.dep),
      emptyHostDir: resolve(repoRoot, 'research/hosts/empty'),
      cpuRate: Number(values.cpu),
      pairs: Number(values.pairs),
      seed: Number(values.seed),
      workRoot,
    });
    console.log(formatCell(res));
    const outDir = join(workRoot, 'results');
    await mkdir(outDir, { recursive: true });
    const file = join(outDir, `${Date.now()}-${cmd}.json`);
    await writeFile(file, JSON.stringify(res, null, 2));
    console.log(`  saved ${file}`);
  } finally {
    await server.close();
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Phase 0 validation experiments (docs/07 §8, docs/09 P0).
 *
 *  E1  Throttling behaviour — does trace thread-time (tdur) scale with CPU throttling? (doc 07 §4.7)
 *  E2  A/A noise floor at 1× and 4×
 *  E3  Injected-cost test — recover known amounts of CPU work (work-K fixtures), at 1× and 4×
 *  E4  Bytes vs executed code — K KB never called (bytes-K) vs K KB called once (eager-K)
 *  E5  First real packages — dates & lodash variants: bytes vs measured ΔScript
 *
 * Usage: pnpm --filter @deplens/harness exec tsx ../../research/experiments/phase0.ts [--quick]
 * Output: .work/experiments/phase0-<ts>/results.jsonl and report.md
 */
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  calibrate,
  launchBrowser,
  linearFit,
  measureCell,
  startMeasurementServer,
  type CellResult,
  type ImportSpec,
} from '../../packages/harness/src/index.ts';

const repo = resolve(import.meta.dirname, '../..');
const workRoot = join(repo, '.work');
const fx = join(repo, 'research/fixtures/packages');
const vanilla = join(repo, 'research/hosts/vanilla');
const empty = join(repo, 'research/hosts/empty');
const quick = process.argv.includes('--quick');
const PAIRS = quick ? 5 : 10;

const outDir = join(workRoot, 'experiments', `phase0-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const results: { exp: string; key: string; cpu: number; res: CellResult }[] = [];

function fixture(name: string, exportName: string): { spec: ImportSpec; deps: Record<string, string> } {
  return { spec: { code: `import { ${exportName} } from '@deplens/${name}'` }, deps: { [`@deplens/${name}`]: `file:${join(fx, name)}` } };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await launchBrowser();
  const server = await startMeasurementServer(workRoot);
  const log = (s: string) => {
    console.log(s);
    return appendFile(join(outDir, 'log.txt'), s + '\n');
  };

  const cell = async (exp: string, key: string, cpu: number, spec: ImportSpec | null, deps: Record<string, string> = {}, seed = 1) => {
    const res = await measureCell(browser, server, {
      label: `${exp}:${key}@${cpu}x`,
      hostDir: vanilla,
      spec,
      deps,
      emptyHostDir: empty,
      cpuRate: cpu,
      pairs: PAIRS,
      seed,
      workRoot,
    });
    results.push({ exp, key, cpu, res });
    await appendFile(join(outDir, 'results.jsonl'), JSON.stringify({ exp, key, cpu, res }) + '\n');
    const L = res.session.labels;
    await log(
      `${exp.padEnd(3)} ${key.padEnd(28)} ${cpu}x  Δmin ${String(res.delta.minBytes).padStart(7)}  ` +
        `ΔScript(thread) ${L.scriptThread.estimate.toFixed(1).padStart(6)} [${L.scriptThread.ciLow.toFixed(1)}, ${L.scriptThread.ciHigh.toFixed(1)}]  ` +
        `(wall ${L.scriptWall.estimate.toFixed(1)})  ΔTBT ${L.tbtLoad.estimate.toFixed(1)}  calib ${res.session.calibration.beforeMs.toFixed(0)}→${res.session.calibration.afterMs.toFixed(0)}  ${(res.session.durationMs / 1000).toFixed(0)}s`,
    );
    return res;
  };

  try {
    // E1a: calibration benchmark under throttling (wall clock inside the page)
    const calib: Record<number, number> = {};
    for (const rate of [1, 2, 4, 6]) calib[rate] = await calibrate(browser, server.origin, rate);
    await log(`E1 calibration ms: ${JSON.stringify(calib)}`);

    // E2: A/A
    for (const cpu of [1, 4]) for (const seed of [11, 12]) await cell('E2', `A/A seed${seed}`, cpu, null, {}, seed);

    // E3: injected cost (also gives E1b: ratio of ΔScript at 4× vs 1×)
    const ks1 = quick ? [0, 5, 20, 50] : [0, 1, 2, 5, 10, 20, 50, 100];
    const ks4 = quick ? [0, 20, 50] : [0, 5, 20, 50, 100];
    for (const k of ks1) {
      const f = fixture(`work-${k}`, 'result');
      await cell('E3', `work-${k}`, 1, f.spec, f.deps);
    }
    for (const k of ks4) {
      const f = fixture(`work-${k}`, 'result');
      await cell('E3', `work-${k}`, 4, f.spec, f.deps);
    }

    // E4: bytes never executed vs executed once
    const kbs = quick ? [0, 100, 400] : [0, 50, 100, 200, 400];
    for (const kb of kbs) {
      const b = fixture(`bytes-${kb}`, 'all');
      await cell('E4', `bytes-${kb}`, 1, b.spec, b.deps);
      const e = fixture(`eager-${kb}`, 'ran');
      await cell('E4', `eager-${kb}`, 1, e.spec, e.deps);
    }

    // E5: real packages (mid-tier profile ≈ 4×)
    const real: [string, ImportSpec, Record<string, string>][] = [
      ['dayjs', { code: `import dayjs from 'dayjs'` }, { dayjs: '1.11.13' }],
      ['moment', { code: `import moment from 'moment'` }, { moment: '2.30.1' }],
      ['date-fns {format}', { code: `import { format } from 'date-fns'` }, { 'date-fns': '4.1.0' }],
      ['date-fns (namespace)', { code: `import * as dfns from 'date-fns'` }, { 'date-fns': '4.1.0' }],
      ['luxon {DateTime}', { code: `import { DateTime } from 'luxon'` }, { luxon: '3.5.0' }],
      ['lodash (default)', { code: `import _ from 'lodash'` }, { lodash: '4.17.21' }],
      ['lodash/debounce', { code: `import debounce from 'lodash/debounce'` }, { lodash: '4.17.21' }],
      ['lodash-es {debounce}', { code: `import { debounce } from 'lodash-es'` }, { 'lodash-es': '4.17.21' }],
    ];
    const realSet = quick ? real.slice(0, 3) : real;
    for (const [key, spec, deps] of realSet) await cell('E5', key, 4, spec, deps);
  } finally {
    await server.close();
    await browser.close();
  }

  await writeFile(join(outDir, 'report.md'), report());
  console.log(`\nreport: ${join(outDir, 'report.md')}`);
}

function report(): string {
  const r = (exp: string, cpu?: number) => results.filter((x) => x.exp === exp && (cpu === undefined || x.cpu === cpu));
  const fmt = (e: { estimate: number; ciLow: number; ciHigh: number }) =>
    `${e.estimate.toFixed(1)} [${e.ciLow.toFixed(1)}, ${e.ciHigh.toFixed(1)}]`;
  const lines: string[] = [];
  const env = results[0]?.res.session.env ?? {};
  lines.push(`# Phase 0 validation report`, '', `- Generated: ${new Date().toISOString()}`, `- Pairs per session: ${PAIRS} (+1 warm-up)`);
  lines.push(`- Environment: ${JSON.stringify({ chromium: env.chromium, cpu: env.cpuModel, cpus: env.cpus, platform: env.platform })}`, '');

  lines.push('## E2 — A/A noise', '', '| session | cpu | ΔScript thread ms | ΔScript wall ms | ΔTBT ms | ΔMainThread ms |', '|---|---|---|---|---|---|');
  for (const x of r('E2')) {
    const L = x.res.session.labels;
    lines.push(`| ${x.key} | ${x.cpu}× | ${fmt(L.scriptThread)} | ${fmt(L.scriptWall)} | ${fmt(L.tbtLoad)} | ${fmt(L.mainThreadWall)} |`);
  }

  for (const cpu of [1, 4]) {
    const rows = r('E3', cpu);
    if (!rows.length) continue;
    const units = rows.map((x) => Number(x.key.split('-')[1]));
    const thread = rows.map((x) => x.res.session.labels.scriptThread.estimate);
    const wall = rows.map((x) => x.res.session.labels.scriptWall.estimate);
    const ft = linearFit(units, thread);
    const fw = linearFit(units, wall);
    lines.push('', `## E3 — injected cost at ${cpu}× (1 unit = 100k loop iterations)`, '', '| fixture | Δmin bytes | ΔScript thread ms | ΔScript wall ms | ΔTBT ms |', '|---|---|---|---|---|');
    for (const x of rows) {
      const L = x.res.session.labels;
      lines.push(`| ${x.key} | ${x.res.delta.minBytes} | ${fmt(L.scriptThread)} | ${fmt(L.scriptWall)} | ${fmt(L.tbtLoad)} |`);
    }
    lines.push('', `Linear fit (thread): ΔScript = ${ft.intercept.toFixed(2)} + ${ft.slope.toFixed(3)}·units, R² = ${ft.r2.toFixed(4)}`);
    lines.push(`Linear fit (wall):   ΔScript = ${fw.intercept.toFixed(2)} + ${fw.slope.toFixed(3)}·units, R² = ${fw.r2.toFixed(4)}`);
  }
  const s1 = r('E3', 1);
  const s4 = r('E3', 4);
  if (s1.length && s4.length) {
    const slope = (rows: typeof s1, pick: 'scriptThread' | 'scriptWall') =>
      linearFit(rows.map((x) => Number(x.key.split('-')[1])), rows.map((x) => x.res.session.labels[pick].estimate)).slope;
    lines.push('', '## E1 — throttling behaviour', '');
    lines.push(`Slope ratio 4×/1× — thread time: **${(slope(s4, 'scriptThread') / slope(s1, 'scriptThread')).toFixed(2)}**, wall time: **${(slope(s4, 'scriptWall') / slope(s1, 'scriptWall')).toFixed(2)}** (expected ≈ 4 if the metric reflects throttling).`);
  }

  lines.push('', '## E4 — bytes never executed vs executed once (1×)', '', '| fixture | Δmin bytes | ΔScript thread ms | compile ms | eval ms |', '|---|---|---|---|---|');
  for (const x of r('E4')) {
    const L = x.res.session.labels;
    lines.push(`| ${x.key} | ${x.res.delta.minBytes} | ${fmt(L.scriptThread)} | ${fmt(L.compileThread)} | ${fmt(L.evalThread)} |`);
  }

  lines.push('', '## E5 — real packages at 4× (vanilla host)', '', '| import | Δmin bytes | Δbrotli bytes | ΔScript thread ms | ΔTBT ms | ΔHeap MB |', '|---|---|---|---|---|---|');
  for (const x of r('E5').sort((a, b) => a.res.delta.minBytes - b.res.delta.minBytes)) {
    const L = x.res.session.labels;
    lines.push(`| ${x.key} | ${x.res.delta.minBytes} | ${x.res.delta.brotliBytes} | ${fmt(L.scriptThread)} | ${fmt(L.tbtLoad)} | ${L.jsHeapMB.estimate.toFixed(2)} |`);
  }
  lines.push('', '> Measured on the build container (2 shared vCPUs, cloud VM). This violates doc 07 §3.1 on purpose: it is a functional spike, not a dataset. Re-run on the dedicated measurement machine.');
  return lines.join('\n') + '\n';
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

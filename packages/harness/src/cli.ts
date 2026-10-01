#!/usr/bin/env node
/**
 * Harness CLI.
 *
 *   pnpm harness hosts                          # list host apps + contract checks
 *   pnpm harness hosts --determinism            # build every host 3× and compare hashes (doc 07 §8.4)
 *   pnpm harness calibrate --cpu 1,2,4,6 --save # measure this machine's calibration curve → .work/machine.json
 *   pnpm harness machine                        # show the stored machine reference
 *   pnpm harness run  --host research/hosts/react --import "import dayjs from 'dayjs'" --dep dayjs@1.11.13 --profile mid-tier-mobile
 *   pnpm harness aa   --host research/hosts/react --profile mid-tier-mobile --pairs 10
 *   pnpm harness iso  --import "import _ from 'lodash'" --dep lodash@4.17.21 --profile mid-tier-mobile
 *   pnpm harness noise                          # A/A noise floor (MDE) from stored sessions
 *
 * Results go to `.work/sessions/` (one JSON per session + an append-only index).
 */
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { InvalidCellError, measureCell, type CellResult } from './cell.ts';
import { build, pruneBuildNodeModules } from './build.ts';
import { checkHostContract, checkHostDeterminism, listHosts } from './hosts.ts';
import { calibrateMachine, machineWarnings, readMachine } from './machine.ts';
import { PROFILES, resolveCpuRate, type ProfileName } from './profiles.ts';
import { launchBrowser, startMeasurementServer } from './session.ts';
import { aaCoverage, mdeFromAA, median } from './stats.ts';
import { readIndex, saveCellResult, saveInvalidCell } from './store.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
const workRoot = resolve(repoRoot, '.work');
const hostsRoot = resolve(repoRoot, 'research/hosts');

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
  const c = r.session.calibration;
  return [
    `cell: ${r.request.label}`,
    `  session     ${r.session.id}  kind ${r.session.kind}  status ${r.session.status}${r.session.statusReason ? ` (${r.session.statusReason})` : ''}`,
    `  profile     ${r.request.profile ?? '—'}  cpu ${r.cpuRate}×  ${r.session.pairs.length} pairs  invalid runs ${r.session.invalidRuns}`,
    `  build       ${r.treatment.bundler} ${r.treatment.bundlerVersion}  host fp ${r.treatment.hostFingerprint}  deps ${JSON.stringify(r.treatment.resolvedDeps)}`,
    `  Δbytes      min ${r.delta.minBytes}  gzip ${r.delta.gzipBytes}  brotli ${r.delta.brotliBytes}  new pkgs: ${r.delta.newPackages.join(', ') || '—'}  shared: ${r.delta.sharedPackages.join(', ') || '—'}`,
    `  ΔScript     thread ${f('scriptThread')} ms   wall ${f('scriptWall')} ms`,
    `    compile ${f('compileThread')}  eval ${f('evalThread')}  gc ${f('gcThread')}`,
    `  ΔMainThread ${f('mainThreadWall')} ms   ΔTBT ${f('tbtLoad')} ms   ΔHeap ${f('jsHeapMB', 2)} MB`,
    `  baseline    script ${r.session.baselineMedian.scriptThread.toFixed(1)} ms (thread), main thread ${r.session.baselineMedian.mainThreadWall.toFixed(1)} ms`,
    `  order check A-first ${r.session.orderEffect.abMean.toFixed(1)} vs B-first ${r.session.orderEffect.baMean.toFixed(1)} ms (diff ${r.session.orderEffect.difference.toFixed(1)})`,
    `  calibration ${c.beforeMs.toFixed(0)} → ${c.afterMs.toFixed(0)} ms` +
      (c.referenceMs !== null ? `, ref ${c.referenceMs.toFixed(0)} ms (drift ${c.driftPct!.toFixed(1)}%)` : ', no machine reference') +
      (c.flagged ? '  ⚠ in-session drift > 5%' : ''),
    `  session took ${(r.session.durationMs / 1000).toFixed(0)} s`,
  ].join('\n');
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    host: { type: 'string' },
    import: { type: 'string' },
    'import-spec': { type: 'string' },
    work: { type: 'string' },
    json: { type: 'boolean', default: false },
    'keep-node-modules': { type: 'boolean', default: false },
    sink: { type: 'string' },
    dep: { type: 'string', multiple: true },
    cpu: { type: 'string' },
    profile: { type: 'string' },
    pairs: { type: 'string', default: '10' },
    seed: { type: 'string', default: '1' },
    label: { type: 'string' },
    lazy: { type: 'boolean', default: false },
    traces: { type: 'boolean', default: false },
    'no-save': { type: 'boolean', default: false },
    'skip-drift': { type: 'boolean', default: false },
    'drift-tolerance': { type: 'string' },
    determinism: { type: 'boolean', default: false },
    repeats: { type: 'string', default: '3' },
  },
});

const cmd = positionals[0];

function requireImport(): string {
  if (!values.import) throw new Error('--import is required, e.g. --import "import { format } from \'date-fns\'"');
  return values.import;
}

function specFromArgs() {
  return {
    code: requireImport(),
    ...(values.sink ? { sink: values.sink } : {}),
    ...(values.lazy ? { placement: 'lazy' as const } : {}),
  };
}

async function cmdHosts(): Promise<void> {
  const all = await listHosts(hostsRoot);
  // --host accepts a host name or a path, so `--host react` and `--host research/hosts/react` both work.
  const only = values.host ? values.host.split(/[,\/]/).filter(Boolean).pop() : undefined;
  const hosts = only ? all.filter((h) => h.config.name === only) : all;
  if (hosts.length === 0) throw new Error(`No host matches '${values.host}'. Known: ${all.map((h) => h.config.name).join(', ')}`);
  console.log(`${hosts.length} host apps in ${hostsRoot}\n`);
  for (const h of hosts) {
    const contract = await checkHostContract(h);
    console.log(
      `${h.config.name.padEnd(12)} ${h.config.framework.padEnd(8)} ${h.bundler.padEnd(8)} fp ${h.fingerprint}  ${contract.ok ? 'contract ok' : 'CONTRACT FAILED'}`,
    );
    for (const p of contract.problems) console.log(`    ✗ ${p}`);
  }
  if (!values.determinism) {
    console.log('\nAdd --determinism to build each host 3× and compare output hashes (doc 07 §8.4).');
    return;
  }
  console.log(`\nDeterminism check (${values.repeats} builds per host):`);
  let allOk = true;
  for (const h of hosts) {
    const d = await checkHostDeterminism(h.dir, workRoot, Number(values.repeats));
    allOk = allOk && d.deterministic;
    const b = d.build.initial;
    console.log(
      `  ${h.config.name.padEnd(12)} ${d.deterministic ? 'deterministic' : 'NOT DETERMINISTIC'}  ` +
        `initial JS ${String(b.minBytes).padStart(7)} min / ${String(b.brotliBytes).padStart(6)} br  ` +
        `modules ${String(d.build.modules).padStart(4)}  ` +
        `build ${Math.round(Math.min(...d.buildMsEach))}–${Math.round(Math.max(...d.buildMsEach))} ms  ` +
        `install ${Math.round(Math.min(...d.installMsEach))}–${Math.round(Math.max(...d.installMsEach))} ms  ` +
        `hashes ${[...new Set(d.hashes)].join(' / ')}`,
    );
  }
  if (!allOk) process.exitCode = 1;
}

/** One build, no browser. Prints the BuildResult as a single JSON line with --json. */
async function cmdBuild(): Promise<void> {
  if (!values.host) throw new Error('--host is required for `build`');
  const specCode = values.import ?? values['import-spec'];
  const res = await build({
    hostDir: resolve(repoRoot, values.host),
    spec: specCode ? specFromArgs() : null,
    deps: parseDeps(values.dep),
    workRoot: values.work ? resolve(values.work) : workRoot,
    keepNodeModules: values['keep-node-modules'],
  });
  if (values.json) {
    console.log(JSON.stringify(res));
    return;
  }
  console.log(
    `${res.host.name}  ${res.bundler} ${res.bundlerVersion}  initial JS ${res.initial.minBytes} min / ${res.initial.gzipBytes} gzip / ${res.initial.brotliBytes} br  ` +
      `modules ${res.modules}  install ${Math.round(res.installMs)} ms  build ${Math.round(res.buildMs)} ms  ${res.cached ? '(cached)' : ''}`,
  );
  console.log(`  dist ${res.distDir}`);
  for (const p of res.packages.slice(0, 8)) console.log(`  ${String(p.bytesInOutput).padStart(8)}  ${p.name}`);
}

async function main(): Promise<void> {
  if (cmd === 'hosts') return cmdHosts();
  if (cmd === 'build') return cmdBuild();

  if (cmd === 'clean') {
    const { pruned, failed } = await pruneBuildNodeModules(workRoot);
    console.log(`pruned node_modules from ${pruned.length} cached builds${failed.length ? `, ${failed.length} still locked: ${failed.join(', ')}` : ''}`);
    return;
  }

  if (cmd === 'machine') {
    const m = await readMachine(workRoot);
    if (!m) {
      console.log("No machine reference yet. Run: pnpm harness calibrate --cpu 1,2,4,6,10 --save");
      return;
    }
    console.log(JSON.stringify(m, null, 2));
    for (const p of Object.keys(PROFILES) as ProfileName[]) {
      console.log(`profile ${p.padEnd(16)} target ${PROFILES[p].targetSlowdown}× → cpu rate ${resolveCpuRate(m.calibration, PROFILES[p].targetSlowdown)}`);
    }
    return;
  }

  if (cmd === 'noise') {
    const entries = (await readIndex(workRoot)).filter((e) => e.kind === 'aa' && e.status === 'ok' && e.scriptThread);
    if (entries.length === 0) {
      console.log('No stored A/A sessions yet. Run: pnpm harness aa --host research/hosts/react --profile mid-tier-mobile');
      return;
    }
    const byGroup = new Map<string, typeof entries>();
    for (const e of entries) {
      const k = `${e.host}@${e.profile ?? `${e.cpuRate}x`}`;
      byGroup.set(k, [...(byGroup.get(k) ?? []), e]);
    }
    console.log('A/A noise floor — ΔScript thread time (doc 07 §7)\n');
    console.log('host@profile              n   MDE95 ms   CI covers 0');
    for (const [k, list] of [...byGroup].sort()) {
      const est = list.map((e) => e.scriptThread!.estimate);
      const cov = aaCoverage(list.map((e) => e.scriptThread!));
      console.log(`${k.padEnd(24)} ${String(list.length).padStart(3)}   ${mdeFromAA(est).toFixed(2).padStart(8)}   ${(cov * 100).toFixed(0)}%`);
    }
    return;
  }

  const browser = await launchBrowser();
  const server = await startMeasurementServer(workRoot);
  try {
    if (cmd === 'calibrate') {
      const rates = (values.cpu ?? '1,2,4,6,10').split(',').map(Number);
      const repeats = Number(values.repeats ?? '3');
      // Repeat the whole curve: a machine whose rate-1 calibration moves by more than a few percent
      // between sweeps is not stable enough for dataset labels (doc 07 §3.1).
      const sweeps: Record<string, number>[] = [];
      for (let i = 0; i < repeats; i++) {
        const r = await calibrateMachine(browser, server.origin, workRoot, rates);
        sweeps.push({ ...r.calibration });
      }
      const medianCurve: Record<string, number> = {};
      for (const rate of Object.keys(sweeps[0]!)) medianCurve[rate] = median(sweeps.map((s) => s[rate]!));
      const record = await calibrateMachine(browser, server.origin, workRoot, rates, medianCurve);
      console.log(`machine ${record.id} — ${record.cpuModel} (${record.cpus} cores), chromium ${record.chromium}`);
      for (const [rate, ms] of Object.entries(record.calibration)) {
        const obs = sweeps.map((s) => s[rate]!);
        const spread = ((Math.max(...obs) - Math.min(...obs)) / ms) * 100;
        console.log(
          `  cpu ${rate.padStart(3)}×  calibration ${ms.toFixed(1)} ms (median of ${repeats}, spread ${spread.toFixed(0)}%)  slowdown ${(ms / record.calibration['1']!).toFixed(2)}×`,
        );
      }
      console.log(`  machine index ${record.machineIndex}`);
      for (const p of Object.keys(PROFILES) as ProfileName[]) {
        console.log(`  profile ${p.padEnd(16)} target ${PROFILES[p].targetSlowdown}× → cpu rate ${resolveCpuRate(record.calibration, PROFILES[p].targetSlowdown)}`);
      }
      for (const w of record.warnings) console.log(`  ⚠ ${w}`);
      console.log(values['no-save'] ? '  (not saved)' : `  saved to ${workRoot}/machine.json`);
      return;
    }

    if (cmd !== 'run' && cmd !== 'aa' && cmd !== 'iso') {
      throw new Error(`unknown command '${cmd ?? ''}'. Use: hosts | build | calibrate | machine | run | aa | iso | noise | clean`);
    }

    const machine = values['skip-drift'] ? null : await readMachine(workRoot);
    if (!machine && !values['skip-drift']) {
      console.log('⚠ no machine reference (.work/machine.json) — drift check disabled. Run `harness calibrate --save` first.\n');
    }
    for (const w of machineWarnings()) console.log(`⚠ ${w}`);

    const hostDir = resolve(repoRoot, values.host ?? (cmd === 'iso' ? 'research/hosts/empty' : 'research/hosts/vanilla'));
    const spec = cmd === 'aa' ? null : specFromArgs();
    const req = {
      label: values.label ?? (spec ? spec.code : `A/A ${values.host ?? 'vanilla'}`),
      hostDir,
      spec,
      deps: parseDeps(values.dep),
      emptyHostDir: resolve(repoRoot, 'research/hosts/empty'),
      ...(values.cpu ? { cpuRate: Number(values.cpu) } : {}),
      ...(values.profile ? { profile: values.profile as ProfileName } : {}),
      ...(!values.cpu && !values.profile ? { cpuRate: 1 } : {}),
      pairs: Number(values.pairs),
      seed: Number(values.seed),
      workRoot,
      kind: cmd === 'aa' ? ('aa' as const) : cmd === 'iso' ? ('iso' as const) : ('ab' as const),
      machine,
      ...(values['drift-tolerance'] ? { driftTolerancePct: Number(values['drift-tolerance']) } : {}),
      keepTraces: values.traces,
    };

    try {
      const res = await measureCell(browser, server, req);
      console.log(formatCell(res));
      if (!values['no-save']) console.log(`  saved ${await saveCellResult(workRoot, res)}`);
      if (res.session.status === 'failed') process.exitCode = 1;
    } catch (e) {
      if (e instanceof InvalidCellError) {
        console.log(`cell '${e.cell.request.label}' is INVALID: ${e.cell.validity.reason} — ${e.cell.validity.detail}`);
        console.log(`  Δbytes min ${e.cell.delta.minBytes}  brotli ${e.cell.delta.brotliBytes}`);
        if (!values['no-save']) await saveInvalidCell(workRoot, e.cell);
        process.exitCode = 2;
        return;
      }
      throw e;
    }
  } finally {
    await server.close();
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

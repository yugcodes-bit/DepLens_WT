/**
 * Host app registry and health checks (doc 07 §5, §8.4; FR-03).
 *
 * A host app qualifies for the dataset only if it (a) declares itself in `host.json`, (b) has the
 * `/* @deplens-inject *\/` marker at the top level of its entry module, (c) marks `app-ready` after
 * its first render, and (d) **builds deterministically** — three builds of the same sources must
 * produce byte-identical output, otherwise every Δbytes we report is partly build noise.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { detectBundler, hostFingerprint, pruneBuildNodeModules, readHostConfig, type BuildResult, type Bundler, type HostConfig } from './build.ts';
import { MARKER_END, MARKER_START } from './inject.ts';

const execFileP = promisify(execFile);

export interface HostInfo {
  dir: string;
  config: HostConfig;
  bundler: Bundler;
  fingerprint: string;
}

/** Every directory under `hostsRoot` that contains a `host.json`. */
export async function listHosts(hostsRoot: string): Promise<HostInfo[]> {
  const out: HostInfo[] = [];
  for (const e of await readdir(hostsRoot, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = join(hostsRoot, e.name);
    if (!existsSync(join(dir, 'host.json'))) continue;
    const config = await readHostConfig(dir);
    out.push({ dir, config, bundler: detectBundler(dir, config), fingerprint: await hostFingerprint(dir) });
  }
  return out.sort((a, b) => a.config.name.localeCompare(b.config.name));
}

export interface HostContractCheck {
  ok: boolean;
  problems: string[];
}

/** Static contract checks that need no build (doc 07 §5). */
export async function checkHostContract(info: HostInfo): Promise<HostContractCheck> {
  const problems: string[] = [];
  const entryPath = join(info.dir, info.config.entry);
  if (!existsSync(entryPath)) {
    problems.push(`entry ${info.config.entry} does not exist`);
    return { ok: false, problems };
  }
  const src = await readFile(entryPath, 'utf8');
  if (!src.includes(MARKER_START) || !src.includes(MARKER_END)) {
    problems.push(`entry is missing the ${MARKER_START} … ${MARKER_END} block`);
  } else {
    // The marker must be at top level: a static import injected inside a function body is a syntax error.
    const before = src.slice(0, src.indexOf(MARKER_START));
    const depth = [...before].reduce((d, ch) => d + (ch === '{' ? 1 : ch === '}' ? -1 : 0), 0);
    if (depth !== 0) problems.push('injection marker is not at the top level of the entry module');
  }
  if (!src.includes("performance.mark('app-ready')") && !src.includes('performance.mark("app-ready")')) {
    problems.push("entry never calls performance.mark('app-ready') — sessions would time out");
  }
  if (!existsSync(join(info.dir, info.config.html))) problems.push(`html ${info.config.html} does not exist`);
  for (const forbidden of ['Math.random(', 'Date.now(']) {
    // Deterministic render (doc 07 §5). `new Date(fixed)` is fine; reading the clock is not.
    if (src.includes(forbidden)) problems.push(`entry uses ${forbidden} — renders must be deterministic`);
  }
  return { ok: problems.length === 0, problems };
}

/** Content hash over every file in a dist directory (relative paths + bytes). */
export async function distHash(distDir: string): Promise<string> {
  const h = createHash('sha256');
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else files.push(p);
    }
  }
  await walk(distDir);
  for (const f of files.sort()) {
    h.update(relative(distDir, f).split(sep).join('/'));
    h.update(await readFile(f));
  }
  return h.digest('hex').slice(0, 16);
}

export interface DeterminismCheck {
  host: string;
  deterministic: boolean;
  hashes: string[];
  build: BuildResult;
  buildMsEach: number[];
  installMsEach: number[];
}

/**
 * Runs one build in a **child process** (`harness build --json`).
 *
 * Isolation is not cosmetic on Windows: once a work dir's rollup/esbuild native binaries are loaded,
 * no process can delete that directory until the loader exits. Building in a child means each build's
 * `node_modules` becomes deletable as soon as the child is gone, which is what keeps a long campaign
 * from filling the disk. It also guarantees a clean `process.env` per build.
 */
export async function buildInChildProcess(args: {
  hostDir: string;
  workRoot: string;
  importSpec?: string;
  deps?: string[];
  keepNodeModules?: boolean;
}): Promise<BuildResult> {
  const cliPath = resolve(import.meta.dirname, 'cli.ts');
  const repoRoot = resolve(import.meta.dirname, '../../..');
  const argv = ['--import', 'tsx', cliPath, 'build', '--host', args.hostDir, '--work', args.workRoot, '--json'];
  if (args.importSpec) argv.push('--import-spec', args.importSpec);
  for (const d of args.deps ?? []) argv.push('--dep', d);
  if (args.keepNodeModules) argv.push('--keep-node-modules');
  // NODE_ENV is deliberately removed rather than set: Vite lets an inherited NODE_ENV override
  // `mode: 'production'`, and a development build of a framework host is both much larger and
  // non-deterministic (the dev JSX transform embeds absolute file paths). npm's own devDependency
  // problem is handled inside build(), where the install child gets its own NODE_ENV.
  const env = { ...process.env };
  delete env.NODE_ENV;
  const { stdout } = await execFileP(process.execPath, argv, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024, env });
  const lines = stdout.trim().split(/\r?\n/);
  const line = lines[lines.length - 1] ?? '';
  try {
    return JSON.parse(line) as BuildResult;
  } catch {
    throw new Error(`harness build did not return JSON for ${args.hostDir} — output was: ${stdout}`);
  }
}

/**
 * Builds the host `repeats` times in separate work roots and compares the output hashes
 * (doc 07 §8.4). Each build runs in its own process and its own work root, so the comparison is
 * between genuinely independent builds and the work dirs can be pruned afterwards.
 */
export async function checkHostDeterminism(hostDir: string, workRoot: string, repeats = 3): Promise<DeterminismCheck> {
  const hashes: string[] = [];
  const buildMsEach: number[] = [];
  const installMsEach: number[] = [];
  const roots: string[] = [];
  let last: BuildResult | null = null;
  const runId = Date.now().toString(36);
  for (let i = 0; i < repeats; i++) {
    const root = join(workRoot, 'determinism', `${runId}-${i}`);
    roots.push(root);
    const res = await buildInChildProcess({ hostDir, workRoot: root });
    hashes.push(await distHash(res.distDir));
    buildMsEach.push(res.buildMs);
    installMsEach.push(res.installMs);
    last = res;
  }
  // The children have exited, so their node_modules are no longer locked.
  for (const root of roots) await pruneBuildNodeModules(root);
  return {
    host: last!.host.name,
    deterministic: new Set(hashes).size === 1,
    hashes,
    build: last!,
    buildMsEach,
    installMsEach,
  };
}

/**
 * On-disk store for sessions and labels (FR-35, FR-51).
 *
 * Postgres is the dataset's home from P4 on (doc 06 §6), but the harness must be usable — and
 * resumable — without a database: every finished cell is written as one JSON file plus one line in
 * an append-only index. The index is what the campaign runner reads to skip cells it already has,
 * so killing the runner loses at most the session in flight.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import type { CellRequest, CellResult, CellValidity, PreparedCell } from './cell.ts';
import type { LabelMetric } from './session.ts';

export const SESSIONS_DIR = 'sessions';
export const INDEX_FILE = 'sessions/index.jsonl';

/**
 * Identity of a cell for resume purposes: everything that changes the measurement, nothing that
 * changes between runs. The seed is included because two seeds are two independent sessions.
 */
export function cellKey(req: Pick<CellRequest, 'hostDir' | 'spec' | 'deps' | 'profile' | 'cpuRate' | 'pairs' | 'seed'>): string {
  const parts = {
    host: basename(req.hostDir),
    spec: req.spec ? { code: req.spec.code.trim(), sink: req.spec.sink ?? null, placement: req.spec.placement ?? 'initial' } : null,
    deps: Object.fromEntries(Object.entries(req.deps ?? {}).sort(([a], [b]) => a.localeCompare(b))),
    profile: req.profile ?? null,
    cpuRate: req.cpuRate ?? null,
    pairs: req.pairs,
    seed: req.seed,
  };
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 20);
}

export interface IndexEntry {
  cellKey: string;
  sessionId: string | null;
  label: string;
  host: string;
  kind: string;
  profile: string | null;
  cpuRate: number;
  status: 'ok' | 'failed' | 'invalid';
  validity: CellValidity;
  deltaMinBytes: number;
  deltaBrotliBytes: number;
  /** Primary label and its CI, duplicated here so noise reports need not open every file. */
  scriptThread: { estimate: number; ciLow: number; ciHigh: number } | null;
  machineId: string | null;
  file: string | null;
  finishedAt: string;
  durationMs: number | null;
}

async function appendIndex(workRoot: string, entry: IndexEntry): Promise<void> {
  await mkdir(join(workRoot, SESSIONS_DIR), { recursive: true });
  await appendFile(join(workRoot, INDEX_FILE), JSON.stringify(entry) + '\n');
}

/** Persists a finished cell: full result as JSON, summary as one index line. */
export async function saveCellResult(workRoot: string, res: CellResult): Promise<string> {
  const dir = join(workRoot, SESSIONS_DIR);
  await mkdir(dir, { recursive: true });
  const file = `${res.session.id}.json`;
  await writeFile(join(dir, file), JSON.stringify(res, null, 2));
  const st = res.session.labels.scriptThread;
  await appendIndex(workRoot, {
    cellKey: cellKey(res.request),
    sessionId: res.session.id,
    label: res.request.label,
    host: basename(res.request.hostDir),
    kind: res.session.kind,
    profile: res.request.profile ?? null,
    cpuRate: res.cpuRate,
    status: res.session.status,
    validity: res.validity,
    deltaMinBytes: res.delta.minBytes,
    deltaBrotliBytes: res.delta.brotliBytes,
    scriptThread: { estimate: st.estimate, ciLow: st.ciLow, ciHigh: st.ciHigh },
    machineId: res.session.machineId,
    file: `${SESSIONS_DIR}/${file}`,
    finishedAt: new Date().toISOString(),
    durationMs: res.session.durationMs,
  });
  return join(dir, file);
}

/** Records a cell that the builds showed to be unmeasurable (FR-34) so it is never retried blindly. */
export async function saveInvalidCell(workRoot: string, prepared: PreparedCell): Promise<void> {
  await appendIndex(workRoot, {
    cellKey: cellKey(prepared.request),
    sessionId: null,
    label: prepared.request.label,
    host: basename(prepared.request.hostDir),
    kind: prepared.request.kind ?? 'ab',
    profile: prepared.request.profile ?? null,
    cpuRate: prepared.cpuRate,
    status: 'invalid',
    validity: prepared.validity,
    deltaMinBytes: prepared.delta.minBytes,
    deltaBrotliBytes: prepared.delta.brotliBytes,
    scriptThread: null,
    machineId: null,
    file: null,
    finishedAt: new Date().toISOString(),
    durationMs: null,
  });
}

export async function readIndex(workRoot: string): Promise<IndexEntry[]> {
  const p = join(workRoot, INDEX_FILE);
  if (!existsSync(p)) return [];
  const text = await readFile(p, 'utf8');
  return text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as IndexEntry);
}

/** Cell keys already measured (status ok) or ruled invalid — what a resuming campaign skips. */
export async function completedCellKeys(workRoot: string): Promise<Set<string>> {
  const entries = await readIndex(workRoot);
  return new Set(entries.filter((e) => e.status !== 'failed').map((e) => e.cellKey));
}

export async function loadCellResult(workRoot: string, entry: IndexEntry): Promise<CellResult> {
  if (!entry.file) throw new Error(`Index entry ${entry.cellKey} has no stored result (status ${entry.status})`);
  return JSON.parse(await readFile(join(workRoot, entry.file), 'utf8')) as CellResult;
}

/** Flat rows for a quick look at one metric across stored sessions (noise reports, exports). */
export async function labelRows(workRoot: string, metric: LabelMetric = 'scriptThread') {
  const entries = await readIndex(workRoot);
  const rows: { label: string; host: string; kind: string; cpuRate: number; estimate: number; ciLow: number; ciHigh: number }[] = [];
  for (const e of entries) {
    if (e.status !== 'ok' || !e.file) continue;
    const res = await loadCellResult(workRoot, e);
    const l = res.session.labels[metric];
    rows.push({ label: e.label, host: e.host, kind: e.kind, cpuRate: e.cpuRate, estimate: l.estimate, ciLow: l.ciLow, ciHigh: l.ciHigh });
  }
  return rows;
}

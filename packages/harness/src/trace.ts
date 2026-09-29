/**
 * Chrome trace → per-run metrics (doc 07 §4).
 *
 * We sum SELF time per bucket on the renderer main thread (duration minus nested children),
 * so nested events (e.g. V8.CompileCode inside v8.evaluateModule) are never double counted.
 * Both wall time (`dur`) and thread time (`tdur`) are reported; tdur falls back to dur when absent.
 * Bucket names follow estimo's documented taxonomy, extended with V8 compile events that
 * Chrome ≥ 120 emits under `disabled-by-default-v8.compile`.
 */

export interface TraceEvent {
  name: string;
  cat?: string;
  ph: string;
  ts: number; // µs
  dur?: number; // µs
  tdur?: number; // µs
  pid: number;
  tid: number;
  args?: Record<string, unknown> & { name?: string; data?: Record<string, unknown>; frame?: string };
}

export type Bucket = 'compile' | 'eval' | 'gc' | 'styleLayout' | 'paint' | 'parseHTML' | 'other';

const BUCKET_BY_NAME: Record<string, Bucket> = {
  // compile / parse
  'v8.compile': 'compile',
  'v8.compileModule': 'compile',
  'V8.CompileCode': 'compile',
  'V8.CompileIgnition': 'compile',
  'V8.CompileIgnitionFinalization': 'compile',
  'V8.CompileLazy': 'compile',
  'V8.ParseProgram': 'compile',
  'V8.ParseFunction': 'compile',
  'V8.PreParse': 'compile',
  'V8.CompileScript': 'compile',
  'V8.CompileModule': 'compile',
  'v8.produceCache': 'compile',
  'v8.produceModuleCache': 'compile',
  'v8.deserializeCache': 'compile',
  // evaluation
  EvaluateScript: 'eval',
  'v8.evaluateModule': 'eval',
  'v8.run': 'eval',
  'V8.Execute': 'eval',
  FunctionCall: 'eval',
  TimerFire: 'eval',
  FireAnimationFrame: 'eval',
  FireIdleCallback: 'eval',
  RunMicrotasks: 'eval',
  EventDispatch: 'eval',
  'V8.RunMicrotasks': 'eval',
  // garbage collection
  MinorGC: 'gc',
  MajorGC: 'gc',
  'V8.GCScavenger': 'gc',
  'V8.GC_SCAVENGER': 'gc',
  'V8.GCCompactor': 'gc',
  'V8.GCFinalizeMC': 'gc',
  'V8.GCIncrementalMarking': 'gc',
  'V8.GC_MC_BACKGROUND_MARKING': 'gc',
  'V8.GCIdleNotification': 'gc',
  'BlinkGC.AtomicPhase': 'gc',
  'ThreadState::performIdleLazySweep': 'gc',
  'ThreadState::completeSweep': 'gc',
  BlinkGCMarking: 'gc',
  // style & layout
  UpdateLayoutTree: 'styleLayout',
  Layout: 'styleLayout',
  RecalculateStyles: 'styleLayout',
  ScheduleStyleRecalculation: 'styleLayout',
  InvalidateLayout: 'styleLayout',
  // paint
  Paint: 'paint',
  PaintImage: 'paint',
  PrePaint: 'paint',
  Commit: 'paint',
  UpdateLayerTree: 'paint',
  CompositeLayers: 'paint',
  Layerize: 'paint',
  // HTML/CSS parsing
  ParseHTML: 'parseHTML',
  ParseAuthorStyleSheet: 'parseHTML',
};

export function bucketOf(name: string): Bucket {
  const b = BUCKET_BY_NAME[name];
  if (b) return b;
  if (name.startsWith('V8.GC') || name.startsWith('V8.GC_')) return 'gc';
  if (name.startsWith('V8.Compile') || name.startsWith('V8.Parse')) return 'compile';
  return 'other';
}

export type BucketTimes = Record<Bucket, number>;

export interface RunMetrics {
  /** self-time per bucket, wall clock (ms) */
  wall: BucketTimes;
  /** self-time per bucket, thread CPU time (ms) */
  thread: BucketTimes;
  /** compile + eval + gc (the primary ΔScript quantity), wall and thread */
  scriptWall: number;
  scriptThread: number;
  /** all top-level main-thread task time (ms) */
  mainThreadWall: number;
  tasks: number;
  longTasks: number;
  longestTaskMs: number;
  /** Σ max(0, task − 50 ms) for tasks starting after FCP (ms) */
  tbtAfterFcp: number;
  /** Σ max(0, task − 50 ms) over the whole load window (ms) — robust when FCP happens late */
  tbtLoad: number;
  fcpMs: number | null;
  lcpMs: number | null;
}

function emptyBuckets(): BucketTimes {
  return { compile: 0, eval: 0, gc: 0, styleLayout: 0, paint: 0, parseHTML: 0, other: 0 };
}

/** Finds the renderer main thread of the page under test. */
export function findMainThread(events: readonly TraceEvent[]): { pid: number; tid: number } {
  const mains = events.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
  if (mains.length === 0) throw new Error('No CrRendererMain thread in trace');
  const started = events.find((e) => e.name === 'TracingStartedInBrowser');
  const frames = (started?.args?.data?.frames as { processId?: number; isOutermostMainFrame?: boolean }[] | undefined) ?? [];
  const pagePid = frames.find((f) => f.isOutermostMainFrame)?.processId;
  const candidates = pagePid !== undefined ? mains.filter((m) => m.pid === pagePid) : mains;
  // Prefer the candidate with the most complete events (navigations can swap renderer processes).
  const pool = candidates.length > 0 ? candidates : mains;
  let best = pool[0]!;
  let bestCount = -1;
  for (const m of pool) {
    const c = events.reduce((n, e) => (e.pid === m.pid && e.tid === m.tid && e.ph === 'X' ? n + 1 : n), 0);
    if (c > bestCount) {
      best = m;
      bestCount = c;
    }
  }
  return { pid: best.pid, tid: best.tid };
}

export function parseTrace(traceJson: { traceEvents: TraceEvent[] } | TraceEvent[]): RunMetrics {
  const events = Array.isArray(traceJson) ? traceJson : traceJson.traceEvents;
  const main = findMainThread(events);
  const onMain = events
    .filter((e) => e.pid === main.pid && e.tid === main.tid && e.ph === 'X' && typeof e.dur === 'number')
    .sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));

  const wall = emptyBuckets();
  const thread = emptyBuckets();

  // Stack-based nesting: children are fully contained in their parent on one thread.
  interface Frame {
    e: TraceEvent;
    end: number;
    childWall: number;
    childThread: number;
    depth: number;
  }
  const stack: Frame[] = [];
  const topLevel: TraceEvent[] = [];
  const close = (f: Frame) => {
    const d = f.e.dur ?? 0;
    const td = f.e.tdur ?? d;
    const b = bucketOf(f.e.name);
    wall[b] += Math.max(0, d - f.childWall) / 1000;
    thread[b] += Math.max(0, td - f.childThread) / 1000;
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.childWall += d;
      parent.childThread += td;
    }
  };
  for (const e of onMain) {
    while (stack.length && e.ts >= stack[stack.length - 1]!.end) close(stack.pop()!);
    if (stack.length === 0) topLevel.push(e);
    stack.push({ e, end: e.ts + (e.dur ?? 0), childWall: 0, childThread: 0, depth: stack.length });
  }
  while (stack.length) close(stack.pop()!);

  // Tasks: top-level RunTask (fallback: any top-level event).
  let tasks = topLevel.filter((e) => e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask');
  if (tasks.length === 0) tasks = topLevel;
  const taskMs = tasks.map((t) => (t.dur ?? 0) / 1000);

  // Paint timings relative to navigationStart of the main frame.
  const navStart = events
    .filter((e) => e.name === 'navigationStart' && e.pid === main.pid)
    .sort((a, b) => b.ts - a.ts)[0]?.ts;
  const fcpEv = events.find((e) => e.name === 'firstContentfulPaint' && e.pid === main.pid);
  const lcpEvs = events.filter((e) => e.name === 'largestContentfulPaint::Candidate' && e.pid === main.pid);
  const lcpEv = lcpEvs.sort((a, b) => b.ts - a.ts)[0];
  const rel = (ts?: number) => (ts !== undefined && navStart !== undefined ? (ts - navStart) / 1000 : null);
  const fcpTs = fcpEv?.ts;

  const blocking = (ms: number) => Math.max(0, ms - 50);
  const tbtAfterFcp = fcpTs === undefined ? 0 : tasks.filter((t) => t.ts >= fcpTs).reduce((s, t) => s + blocking((t.dur ?? 0) / 1000), 0);

  return {
    wall,
    thread,
    scriptWall: wall.compile + wall.eval + wall.gc,
    scriptThread: thread.compile + thread.eval + thread.gc,
    mainThreadWall: taskMs.reduce((s, v) => s + v, 0),
    tasks: tasks.length,
    longTasks: taskMs.filter((v) => v > 50).length,
    longestTaskMs: taskMs.reduce((m, v) => Math.max(m, v), 0),
    tbtAfterFcp,
    tbtLoad: taskMs.reduce((s, v) => s + blocking(v), 0),
    fcpMs: rel(fcpTs),
    lcpMs: rel(lcpEv?.ts),
  };
}

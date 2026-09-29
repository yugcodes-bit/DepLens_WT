import { describe, expect, it } from 'vitest';
import { bucketOf, parseTrace, type TraceEvent } from '../src/trace.ts';

const PID = 10;
const TID = 10;
const ms = (v: number) => v * 1000;

function X(name: string, tsMs: number, durMs: number, tdurMs?: number, pid = PID, tid = TID): TraceEvent {
  return { name, ph: 'X', ts: ms(tsMs), dur: ms(durMs), ...(tdurMs !== undefined ? { tdur: ms(tdurMs) } : {}), pid, tid };
}

/** A synthetic trace with nesting: RunTask ⊃ EvaluateScript ⊃ { V8.CompileCode, MinorGC }. */
function syntheticTrace(): TraceEvent[] {
  return [
    { name: 'thread_name', ph: 'M', ts: 0, pid: PID, tid: TID, args: { name: 'CrRendererMain' } },
    { name: 'thread_name', ph: 'M', ts: 0, pid: 99, tid: 99, args: { name: 'CrRendererMain' } },
    { name: 'TracingStartedInBrowser', ph: 'I', ts: 0, pid: 1, tid: 1, args: { data: { frames: [{ processId: PID, isOutermostMainFrame: true }] } } },
    { name: 'navigationStart', ph: 'R', ts: ms(100), pid: PID, tid: TID },
    { name: 'firstContentfulPaint', ph: 'R', ts: ms(150), pid: PID, tid: TID },
    // task 1 (before FCP): 80 ms, with nested script work
    X('RunTask', 110, 80, 70),
    X('EvaluateScript', 115, 60, 55),
    X('V8.CompileCode', 120, 10, 9),
    X('MinorGC', 140, 5, 5),
    X('Layout', 180, 8, 7),
    // task 2 (after FCP): 120 ms long task
    X('RunTask', 200, 120, 100),
    X('FunctionCall', 210, 100, 90),
    // task 3 short
    X('RunTask', 400, 10, 10),
    X('Paint', 401, 4, 3),
    // noise on another renderer that must be ignored
    X('RunTask', 110, 500, 500, 99, 99),
    X('EvaluateScript', 110, 500, 500, 99, 99),
  ];
}

describe('trace parser', () => {
  it('maps event names to buckets', () => {
    expect(bucketOf('v8.evaluateModule')).toBe('eval');
    expect(bucketOf('V8.ParseProgram')).toBe('compile');
    expect(bucketOf('V8.GC_SCAVENGER_SCAVENGE')).toBe('gc');
    expect(bucketOf('SomethingElse')).toBe('other');
  });

  it('computes self time per bucket without double counting', () => {
    const m = parseTrace(syntheticTrace());
    // EvaluateScript self = 60 − 10 − 5 = 45 ; FunctionCall = 100 → eval 145
    expect(m.wall.eval).toBeCloseTo(145);
    expect(m.wall.compile).toBeCloseTo(10);
    expect(m.wall.gc).toBeCloseTo(5);
    expect(m.wall.styleLayout).toBeCloseTo(8);
    expect(m.wall.paint).toBeCloseTo(4);
    // other = RunTask self times: (80−60−8) + (120−100) + (10−4) = 12 + 20 + 6
    expect(m.wall.other).toBeCloseTo(38);
    expect(m.scriptWall).toBeCloseTo(160);
    // thread time: EvaluateScript 55 − 9 − 5 = 41, FunctionCall 90 → 131
    expect(m.thread.eval).toBeCloseTo(131);
    expect(m.scriptThread).toBeCloseTo(131 + 9 + 5);
  });

  it('computes tasks, long tasks and TBT', () => {
    const m = parseTrace(syntheticTrace());
    expect(m.tasks).toBe(3);
    expect(m.longTasks).toBe(2);
    expect(m.longestTaskMs).toBeCloseTo(120);
    expect(m.tbtLoad).toBeCloseTo(30 + 70);
    expect(m.tbtAfterFcp).toBeCloseTo(70);
    expect(m.fcpMs).toBeCloseTo(50);
    expect(m.mainThreadWall).toBeCloseTo(210);
  });
});

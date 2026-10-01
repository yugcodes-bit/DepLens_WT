import { describe, expect, it } from 'vitest';
import { DRIFT_ABORT_PCT, DriftAbortError, checkDrift, machineId, type MachineRecord } from '../src/machine.ts';
import { aaCoverage, mdeFromAA } from '../src/stats.ts';

const machine = {
  id: 'test',
  calibration: { '1': 20, '4': 80 },
} as unknown as MachineRecord;

describe('drift control (FR-33)', () => {
  it('passes within tolerance and fails outside it', () => {
    expect(checkDrift(machine, 1, 21).ok).toBe(true);
    expect(checkDrift(machine, 1, 21).deviationPct).toBeCloseTo(5, 5);
    const bad = checkDrift(machine, 1, 42);
    expect(bad.ok).toBe(false);
    expect(bad.deviationPct).toBeCloseTo(110, 5);
  });

  it('a machine that got faster also counts as drift', () => {
    // Not pedantry: a reference measured while the machine was busy makes every later label
    // incomparable, so both directions must stop the session.
    expect(checkDrift(machine, 1, 10).ok).toBe(false);
  });

  it('the default tolerance is the documented 10%', () => {
    expect(DRIFT_ABORT_PCT).toBe(10);
    expect(checkDrift(machine, 1, 22).ok).toBe(true);
    expect(checkDrift(machine, 1, 22.5).ok).toBe(false);
    expect(checkDrift(machine, 1, 22.5, 20).ok).toBe(true);
  });

  it('interpolates the reference for a fractional rate a profile resolved to', () => {
    // Profiles resolve to rates like 2.5, which are never measured points; the reference for
    // rate 2.5 on {1: 20, 4: 80} is 50 ms, so 50 ms observed is zero drift.
    const mid = checkDrift(machine, 2.5, 50);
    expect(mid.referenceMs).toBeCloseTo(50, 5);
    expect(mid.deviationPct).toBeCloseTo(0, 5);
    expect(mid.ok).toBe(true);
    expect(checkDrift(machine, 2.5, 60).ok).toBe(false);
  });

  it('refuses to guess outside the calibrated range', () => {
    expect(() => checkDrift(machine, 6, 200)).toThrow(/no calibration reference for rate 6/);
    expect(() => checkDrift(machine, 0.5, 10)).toThrow(/no calibration reference for rate 0.5/);
  });

  it('the abort error carries the numbers that caused it', () => {
    const check = checkDrift(machine, 4, 200);
    const err = new DriftAbortError(check, 4);
    expect(err.name).toBe('DriftAbortError');
    expect(err.check.referenceMs).toBe(80);
    expect(err.message).toMatch(/rate 4/);
  });

  it('machine id is stable within a machine', () => {
    expect(machineId()).toBe(machineId());
    expect(machineId()).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('A/A noise floor (doc 07 §7)', () => {
  it('MDE95 is the 95th percentile of the absolute A/A estimates', () => {
    const estimates = [0.1, -0.4, 0.3, -1.2, 0.8, -0.2, 1.9, 0.5, -0.7, 0.2];
    const mde = mdeFromAA(estimates);
    expect(mde).toBeGreaterThan(1.2);
    expect(mde).toBeLessThanOrEqual(1.9);
    // Sign must not matter: a −9 ms A/A result is just as much noise as +9 ms.
    expect(mdeFromAA([-9, 0, 0, 0])).toBe(mdeFromAA([9, 0, 0, 0]));
  });

  it('coverage counts how many A/A CIs contain zero', () => {
    expect(
      aaCoverage([
        { ciLow: -1, ciHigh: 1 },
        { ciLow: -2, ciHigh: 0 },
        { ciLow: 2, ciHigh: 5 },
        { ciLow: -5, ciHigh: -2 },
      ]),
    ).toBe(0.5);
    expect(aaCoverage([])).toBeNaN();
  });
});

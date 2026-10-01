import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, PROFILES, expectedCalibrationMs, networkMs, profileByName, resolveCpuRate } from '../src/profiles.ts';

/**
 * Profiles are defined by a target calibration slowdown, not by a raw CDP rate (doc 07 §3.3).
 * The curve below is one actually measured on the first dev machine (i7-11800H) — while it was under
 * load, which is why the slowdown runs well ahead of the rate. Idle, the same machine gives a nearly
 * proportional curve. Either way the rate has to be resolved from the machine's own curve, so this is
 * the right shape to test against.
 */
const MEASURED: Record<string, number> = { '1': 20.8, '2': 57.4, '3': 101.8, '4': 174.7, '6': 314.2 };

describe('profiles', () => {
  it('has three presets and a mobile default', () => {
    expect(Object.keys(PROFILES)).toEqual(['desktop', 'mid-tier-mobile', 'low-end-mobile']);
    expect(DEFAULT_PROFILE).toBe('mid-tier-mobile');
    expect(profileByName('desktop').targetSlowdown).toBe(1);
    expect(() => profileByName('phone')).toThrow(/Unknown profile/);
  });

  it('resolves the rate that reaches the target slowdown on the measured curve', () => {
    // 4× of 20.8 ms = 83.2 ms, which sits between rate 2 (57.4) and rate 3 (101.8).
    const rate = resolveCpuRate(MEASURED, 4);
    expect(rate).toBeGreaterThan(2);
    expect(rate).toBeLessThan(3);
  });

  it('a perfectly linear machine resolves the rate to the target itself', () => {
    const linear = { '1': 10, '2': 20, '4': 40, '8': 80 };
    expect(resolveCpuRate(linear, 4)).toBeCloseTo(4, 5);
    expect(resolveCpuRate(linear, 2)).toBeCloseTo(2, 5);
  });

  it('never throttles below 1 and extrapolates past the measured curve', () => {
    expect(resolveCpuRate(MEASURED, 1)).toBe(1);
    expect(resolveCpuRate(MEASURED, 0.5)).toBe(1);
    expect(resolveCpuRate(MEASURED, 30)).toBeGreaterThan(6);
  });

  it('refuses a curve without a rate-1 reference', () => {
    expect(() => resolveCpuRate({ '2': 50 }, 4)).toThrow(/no measurement at rate 1/);
  });

  it('models network time from brotli bytes and counts new round trips', () => {
    // 20 KB over slow 4G (1.6 Mbps) ≈ 100 ms; a second request adds one RTT.
    const slow4g = PROFILES['mid-tier-mobile'];
    expect(networkMs(20_000, slow4g)).toBeCloseTo(100, 0);
    expect(networkMs(20_000, slow4g, 1) - networkMs(20_000, slow4g)).toBe(slow4g.network.rttMs);
    expect(networkMs(0, slow4g)).toBe(0);
    // The same bytes cost far less on the desktop profile.
    expect(networkMs(20_000, PROFILES.desktop)).toBeLessThan(networkMs(20_000, slow4g));
  });

  it('interpolates calibration time at unmeasured rates and refuses to extrapolate', () => {
    expect(expectedCalibrationMs(MEASURED, 1)).toBe(20.8);
    const at2point5 = expectedCalibrationMs(MEASURED, 2.5);
    expect(at2point5).toBeGreaterThan(MEASURED['2']!);
    expect(at2point5).toBeLessThan(MEASURED['3']!);
    expect(() => expectedCalibrationMs(MEASURED, 8)).toThrow(/outside the calibrated range/);
    expect(() => expectedCalibrationMs({}, 1)).toThrow(/empty/);
  });
});

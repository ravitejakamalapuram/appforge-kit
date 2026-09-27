import { describe, it, expect } from 'vitest';
import { detectAnomalies, type MetricPoint } from '../src/anomaly-detection.js';

function series(values: number[], startDate = '2026-09-01'): MetricPoint[] {
  const start = new Date(startDate + 'T00:00:00Z');
  return values.map((value, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), value };
  });
}

describe('detectAnomalies', () => {
  it('flags no points in a normal, gently-varying series (Review Focus: no false positives)', () => {
    const results = detectAnomalies(series([10, 11, 9, 10, 12, 10, 11, 9, 10, 11]));
    expect(results.some((r) => r.isAnomaly)).toBe(false);
  });

  it('flags a clear spike day against a stable trailing history', () => {
    // 6 stable days around 10, then a day at 100 — a massive, obvious spike.
    const results = detectAnomalies(series([10, 10, 11, 9, 10, 10, 100]));
    const spikeDay = results[results.length - 1];
    expect(spikeDay.value).toBe(100);
    expect(spikeDay.isAnomaly).toBe(true);
    expect(spikeDay.zScore).toBeGreaterThan(3);
  });

  it('never flags a point before minHistory prior points exist, even if it looks extreme (Review Focus: short series)', () => {
    // Only 3 points total; default minHistory is 5, so nothing can be evaluated yet.
    const results = detectAnomalies(series([1, 1, 1000]));
    expect(results.every((r) => r.isAnomaly === false)).toBe(true);
  });

  it('does not divide by zero and does not flag a point matching a perfectly flat history (Review Focus: flat series)', () => {
    const results = detectAnomalies(series([5, 5, 5, 5, 5, 5]));
    const lastDay = results[results.length - 1];
    expect(lastDay.trailingStdDev).toBe(0);
    expect(lastDay.isAnomaly).toBe(false);
    expect(Number.isFinite(lastDay.zScore)).toBe(true);
  });

  it('flags any deviation from a perfectly flat history as an anomaly, without NaN/crash (Review Focus: flat series)', () => {
    const results = detectAnomalies(series([5, 5, 5, 5, 5, 6]));
    const lastDay = results[results.length - 1];
    expect(lastDay.trailingStdDev).toBe(0);
    expect(lastDay.isAnomaly).toBe(true);
    expect(lastDay.zScore).toBe(Infinity);
  });

  it('respects a custom minHistory and zThreshold', () => {
    const results = detectAnomalies(series([10, 10, 30]), { minHistory: 2, zThreshold: 1 });
    expect(results[2].isAnomaly).toBe(true);
  });

  it('returns one result per input point, in order, with dates preserved', () => {
    const input = series([1, 2, 3]);
    const results = detectAnomalies(input);
    expect(results.map((r) => r.date)).toEqual(input.map((p) => p.date));
    expect(results.map((r) => r.value)).toEqual(input.map((p) => p.value));
  });
});

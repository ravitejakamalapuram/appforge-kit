/**
 * Deterministic z-score anomaly check over a chronologically-ordered metric series (master plan
 * §6.2 Analyst role: "anomaly detection (deterministic z-score/threshold rules in
 * `appforge metrics anomalies`)"). No ML, no external calls — just arithmetic over the trailing
 * history of each point, so results are 100% reproducible given the same input.
 *
 * Design: for each point at index i, the "trailing window" is every prior point series[0..i-1] in
 * the given order (an expanding window, not a fixed-size rolling window — simplest deterministic
 * rule that needs no extra tuning parameter). A point is only evaluated once at least minHistory
 * (default 5) prior points exist; earlier points are always isAnomaly: false. If the trailing
 * window's population standard deviation is 0 (a perfectly flat history), a point equal to that
 * constant is not an anomaly (zScore: 0); a point that differs at all is treated as zScore:
 * Infinity and flagged, since any deviation from an exactly-constant history is real news, not a
 * division-by-zero artifact.
 */
export interface MetricPoint {
  date: string;
  value: number;
}

export interface AnomalyResult {
  date: string;
  value: number;
  trailingMean: number;
  trailingStdDev: number;
  zScore: number;
  isAnomaly: boolean;
}

export interface AnomalyOptions {
  /** Minimum number of prior points required before a point can be evaluated. Default 5. */
  minHistory?: number;
  /** |value - trailingMean| / trailingStdDev threshold to flag as an anomaly. Default 3. */
  zThreshold?: number;
}

const DEFAULT_MIN_HISTORY = 5;
const DEFAULT_Z_THRESHOLD = 3;

function trailingStats(prior: number[]): { mean: number; stdDev: number } {
  const mean = prior.reduce((sum, v) => sum + v, 0) / prior.length;
  const variance = prior.reduce((sum, v) => sum + (v - mean) ** 2, 0) / prior.length; // population variance
  return { mean, stdDev: Math.sqrt(variance) };
}

export function detectAnomalies(series: MetricPoint[], opts: AnomalyOptions = {}): AnomalyResult[] {
  const minHistory = opts.minHistory ?? DEFAULT_MIN_HISTORY;
  const zThreshold = opts.zThreshold ?? DEFAULT_Z_THRESHOLD;

  return series.map((point, i) => {
    if (i < minHistory) {
      return { date: point.date, value: point.value, trailingMean: 0, trailingStdDev: 0, zScore: 0, isAnomaly: false };
    }

    const prior = series.slice(0, i).map((p) => p.value);
    const { mean, stdDev } = trailingStats(prior);

    if (stdDev === 0) {
      const isAnomaly = point.value !== mean;
      return {
        date: point.date,
        value: point.value,
        trailingMean: mean,
        trailingStdDev: 0,
        zScore: isAnomaly ? Infinity : 0,
        isAnomaly,
      };
    }

    const zScore = Math.abs(point.value - mean) / stdDev;
    return {
      date: point.date,
      value: point.value,
      trailingMean: mean,
      trailingStdDev: stdDev,
      zScore,
      isAnomaly: zScore > zThreshold,
    };
  });
}

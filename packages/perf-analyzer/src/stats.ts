/**
 * Sample statistics for benchmark runs, after tachometer's model: report the
 * median with a 95% confidence interval of the mean rather than trusting any
 * single run. Counts (layout counts, DOM nodes) are deterministic and need no
 * interval; timings always get one.
 */

export interface SampleSummary {
  readonly n: number;
  readonly median: number;
  readonly mean: number;
  readonly stddev: number;
  readonly min: number;
  readonly max: number;
  /** 95% confidence interval of the mean; equals [mean, mean] when n === 1. */
  readonly ci95: readonly [number, number];
}

// Two-tailed 95% t critical values by degrees of freedom (1..30), then z.
const T_TABLE = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16,
  2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052,
  2.048, 2.045, 2.042,
] as const;

function tCritical(degreesOfFreedom: number): number {
  if (degreesOfFreedom < 1) return Number.NaN;
  return T_TABLE[Math.min(degreesOfFreedom, T_TABLE.length) - 1] ?? 1.96;
}

export function summarize(samples: ReadonlyArray<number>): SampleSummary {
  if (samples.length === 0) throw new Error("Cannot summarize zero samples.");
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const mid = Math.floor(n / 2);
  const lower = sorted[mid - 1] ?? mean;
  const upper = sorted[mid] ?? mean;
  const median = n % 2 === 1 ? upper : (lower + upper) / 2;
  if (n === 1) {
    return { n, median, mean, stddev: 0, min: mean, max: mean, ci95: [mean, mean] };
  }
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  const stddev = Math.sqrt(variance);
  const margin = tCritical(n - 1) * (stddev / Math.sqrt(n));
  return {
    n,
    median,
    mean,
    stddev,
    min: sorted[0] ?? mean,
    max: sorted[n - 1] ?? mean,
    ci95: [mean - margin, mean + margin],
  };
}

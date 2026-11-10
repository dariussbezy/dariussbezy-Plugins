export interface Metrics {
  samples: number;
  p95: number;
  max: number;
  mean: number;
  stalls: number;
}
export function summarize(values: number[]): Metrics {
  if (!values.length) return { samples: 0, p95: 0, max: 0, mean: 0, stalls: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: values.length,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted[sorted.length - 1],
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    stalls: values.filter((v) => v >= 50).length,
  };
}
export function singleDifference(a: string[], b: string[]): string | undefined {
  const left = new Set(a),
    right = new Set(b);
  const diff = [...left]
    .filter((id) => !right.has(id))
    .concat([...right].filter((id) => !left.has(id)));
  return diff.length === 1 ? diff[0] : undefined;
}
export function compareDelay(on: Metrics, off: Metrics) {
  const delta = on.p95 - off.p95;
  return { delta, percent: off.p95 >= 1 ? (delta / off.p95) * 100 : null };
}

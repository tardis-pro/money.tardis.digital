export interface Metric {
  name: string;
  value: number;
  labels: Record<string, string> | undefined;
  timestamp: string;
}

const metrics: Metric[] = [];
const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const histograms = new Map<string, number[]>();

export function incrementCounter(name: string, labels?: Record<string, string>, value = 1): void {
  const key = `${name}${JSON.stringify(labels ?? {})}`;
  counters.set(key, (counters.get(key) ?? 0) + value);
  
  metrics.push({
    name,
    value: counters.get(key) ?? value,
    labels,
    timestamp: new Date().toISOString(),
  });
}

export function setGauge(name: string, value: number, labels?: Record<string, string>): void {
  const key = `${name}${JSON.stringify(labels ?? {})}`;
  gauges.set(key, value);
  
  metrics.push({
    name,
    value,
    labels,
    timestamp: new Date().toISOString(),
  });
}

export function recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
  const key = `${name}${JSON.stringify(labels ?? {})}`;
  const values = histograms.get(key) ?? [];
  values.push(value);
  if (values.length > 1000) {
    values.shift();
  }
  histograms.set(key, values);
  
  metrics.push({
    name,
    value,
    labels,
    timestamp: new Date().toISOString(),
  });
}

export function getHistogramStats(name: string, labels?: Record<string, string>): { count: number; min: number; max: number; avg: number; p50: number; p95: number; p99: number } | null {
  const key = `${name}${JSON.stringify(labels ?? {})}`;
  const values = histograms.get(key);
  
  if (!values || values.length === 0) {
    return null;
  }
  
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    avg: sum / sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] ?? 0,
    p99: sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1] ?? 0,
  };
}

export function getMetrics(limit = 100): Metric[] {
  return metrics.slice(-limit);
}

export function getGauge(name: string, labels?: Record<string, string>): number | null {
  const key = `${name}${JSON.stringify(labels ?? {})}`;
  return gauges.get(key) ?? null;
}

export function getCounter(name: string, labels?: Record<string, string>): number | null {
  const key = `${name}${JSON.stringify(labels ?? {})}`;
  return counters.get(key) ?? null;
}

export function clearMetrics(): void {
  metrics.length = 0;
  counters.clear();
  gauges.clear();
  histograms.clear();
}

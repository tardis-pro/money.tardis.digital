import type { SignalRecord } from "../types.js";
import type { Store } from "../store.js";
import { clamp } from "../utils.js";

export interface PriceObservation {
  at: string;
  close: number;
}

export interface AnomalyCorrelationInput {
  ticker: string;
  observations?: PriceObservation[];
  windowSize?: number;
  zThreshold?: number;
  lookbackHours?: number;
  maxMatches?: number;
}

interface DataPoint {
  at: string;
  value: number;
}

interface CorrelatedEvent {
  signalId: string;
  eventType: SignalRecord["event"]["eventType"];
  title: string;
  publishedAt: string;
  score: number;
  rationale: string;
  components: {
    timeWeight: number;
    signalWeight: number;
    confidenceWeight: number;
    directionWeight: number;
  };
}

interface CorrelatedAnomaly {
  at: string;
  value: number;
  zScore: number;
  direction: "positive" | "negative";
  baselineMean: number;
  baselineStdDev: number;
  threshold: number;
  events: CorrelatedEvent[];
}

export interface AnomalyCorrelationResult {
  ticker: string;
  source: "observations" | "outcomes";
  analyzedPoints: number;
  anomalies: CorrelatedAnomaly[];
}

function asTime(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ISO datetime: ${value}`);
  }
  return parsed;
}

function seriesFromObservations(observations: PriceObservation[]): DataPoint[] {
  const sorted = [...observations].sort((a, b) => asTime(a.at) - asTime(b.at));
  const returns: DataPoint[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const current = sorted[i];
    if (!prev || !current) {
      continue;
    }
    const denom = Math.max(Math.abs(prev.close), 1e-9);
    returns.push({ at: current.at, value: (current.close - prev.close) / denom });
  }
  return returns;
}

function validateObservations(observations: PriceObservation[]): void {
  if (observations.length < 2) {
    throw new Error("At least 2 observations are required.");
  }
  const seen = new Set<string>();
  let previous = -1;
  for (const item of observations) {
    const at = asTime(item.at);
    if (seen.has(item.at)) {
      throw new Error(`Duplicate observation timestamp: ${item.at}`);
    }
    seen.add(item.at);
    if (at < previous) {
      throw new Error("Observations must be in ascending timestamp order.");
    }
    previous = at;
  }
}

function rollingZScores(series: DataPoint[], windowSize: number, threshold: number): CorrelatedAnomaly[] {
  const anomalies: CorrelatedAnomaly[] = [];
  for (let i = windowSize; i < series.length; i += 1) {
    const window = series.slice(i - windowSize, i).map((point) => point.value);
    const mean = window.reduce((sum, value) => sum + value, 0) / window.length;
    const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / window.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev < 1e-12) {
      continue;
    }
    const target = series[i];
    if (!target) {
      continue;
    }
    const zScore = (target.value - mean) / stdDev;
    if (Math.abs(zScore) < threshold) {
      continue;
    }
    anomalies.push({
      at: target.at,
      value: target.value,
      zScore,
      direction: target.value >= 0 ? "positive" : "negative",
      baselineMean: mean,
      baselineStdDev: stdDev,
      threshold,
      events: [],
    });
  }
  return anomalies;
}

function scoredEventMatch(
  signal: SignalRecord,
  anomalyAtMs: number,
  anomalyDirection: "positive" | "negative",
  lookbackHours: number,
): CorrelatedEvent | null {
  const publishedAt = signal.event.publishedAt ?? signal.createdAt;
  const eventMs = asTime(publishedAt);
  if (eventMs > anomalyAtMs) {
    return null;
  }
  const deltaHours = (anomalyAtMs - eventMs) / 3_600_000;
  if (deltaHours > lookbackHours) {
    return null;
  }

  const timeWeight = 1 - deltaHours / lookbackHours;
  const directionWeight =
    signal.impact.direction === "neutral"
      ? 0.55
      : signal.impact.direction === anomalyDirection
        ? 1
        : 0;
  const signalWeight = signal.score * 0.35;
  const confidenceWeight = signal.impact.confidence * 0.12;
  const directionComponent = directionWeight * 0.08;
  const score = clamp(timeWeight * 0.45 + signalWeight + confidenceWeight + directionComponent, 0, 1);
  return {
    signalId: signal.id,
    eventType: signal.event.eventType,
    title: signal.event.title,
    publishedAt,
    score,
    rationale: `time=${deltaHours.toFixed(1)}h signalScore=${signal.score.toFixed(3)} impactDir=${signal.impact.direction}`,
    components: {
      timeWeight: Number((timeWeight * 0.45).toFixed(6)),
      signalWeight: Number(signalWeight.toFixed(6)),
      confidenceWeight: Number(confidenceWeight.toFixed(6)),
      directionWeight: Number(directionComponent.toFixed(6)),
    },
  };
}

export class AnomalyCorrelationService {
  constructor(private readonly store: Store) {}

  async correlate(input: AnomalyCorrelationInput): Promise<AnomalyCorrelationResult> {
    const ticker = input.ticker.trim().toUpperCase();
    if (ticker.length === 0) {
      throw new Error("Ticker is required");
    }

    const state = await this.store.read();
    const windowSize = input.windowSize ?? 20;
    const zThreshold = input.zThreshold ?? 2.5;
    const lookbackHours = input.lookbackHours ?? 72;
    const maxMatches = input.maxMatches ?? 3;

    let source: "observations" | "outcomes" = "outcomes";
    let series: DataPoint[] = [];

    if ((input.observations ?? []).length > 0) {
      validateObservations(input.observations ?? []);
      source = "observations";
      series = seriesFromObservations(input.observations ?? []);
    } else {
      const outcomesSeries: DataPoint[] = [];
      for (const outcome of state.outcomes) {
        const signal = state.signals.find((item) => item.id === outcome.signalId);
        if (!signal) {
          continue;
        }
        const linked = signal.linkedEntities.some((entity) => entity.ticker === ticker);
        if (!linked) {
          continue;
        }
        outcomesSeries.push({ at: outcome.evaluatedAt, value: outcome.realizedReturn });
      }
      series = outcomesSeries.sort((a, b) => asTime(a.at) - asTime(b.at));
    }

    if (series.length <= windowSize) {
      throw new Error(`Need more points for anomaly detection. Have ${series.length}, need > ${windowSize}.`);
    }

    const tickerSignals = state.signals.filter((signal) =>
      signal.linkedEntities.some((entity) => entity.ticker.toUpperCase() === ticker),
    );

    const anomalies = rollingZScores(series, windowSize, zThreshold).map((anomaly) => {
      const anomalyAtMs = asTime(anomaly.at);
      const matches = tickerSignals
        .map((signal) => scoredEventMatch(signal, anomalyAtMs, anomaly.direction, lookbackHours))
        .filter((item): item is CorrelatedEvent => item !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxMatches);
      return { ...anomaly, events: matches };
    });

    return {
      ticker,
      source,
      analyzedPoints: series.length,
      anomalies,
    };
  }
}

import { z } from "zod";
import type { Store } from "../store.js";
import type { AttributionCalibrationReport, AttributionOverride } from "../types.js";
import { makeId, nowIso } from "../utils.js";

const overrideSchema = z.object({
  anomalyId: z.string().min(1).max(64),
  ticker: z.string().min(1).max(24),
  actor: z.string().min(1).max(64),
  previousConfidence: z.number().min(0).max(1),
  overrideConfidence: z.number().min(0).max(1),
  reason: z.string().min(5).max(400),
});

export type AttributionOverrideInput = z.infer<typeof overrideSchema>;

export class AnomalyV3Service {
  constructor(private readonly store: Store) {}

  async addOverride(input: AttributionOverrideInput): Promise<AttributionOverride> {
    const parsed = overrideSchema.parse(input);
    return this.store.transaction((state) => {
      const row: AttributionOverride = {
        id: makeId("override"),
        anomalyId: parsed.anomalyId,
        ticker: parsed.ticker.toUpperCase(),
        actor: parsed.actor,
        previousConfidence: parsed.previousConfidence,
        overrideConfidence: parsed.overrideConfidence,
        reason: parsed.reason,
        createdAt: nowIso(),
      };
      state.attributionOverrides.push(row);
      if (state.attributionOverrides.length > 4000) {
        state.attributionOverrides = state.attributionOverrides.slice(-4000);
      }
      return row;
    });
  }

  async listOverrides(limit: number = 100): Promise<AttributionOverride[]> {
    const state = await this.store.read();
    return [...state.attributionOverrides]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async calibration(): Promise<AttributionCalibrationReport> {
    const state = await this.store.read();
    const buckets = [
      { id: "0.0-0.2", lo: 0, hi: 0.2 },
      { id: "0.2-0.4", lo: 0.2, hi: 0.4 },
      { id: "0.4-0.6", lo: 0.4, hi: 0.6 },
      { id: "0.6-0.8", lo: 0.6, hi: 0.8 },
      { id: "0.8-1.0", lo: 0.8, hi: 1.01 },
    ];

    const points = buckets.map((bucket) => {
      const signals = state.signals.filter(
        (signal) => signal.prediction.calibratedConfidence >= bucket.lo && signal.prediction.calibratedConfidence < bucket.hi,
      );
      const outcomes = state.outcomes.filter((outcome) => {
        const signal = state.signals.find((item) => item.id === outcome.signalId);
        if (!signal) {
          return false;
        }
        return signal.prediction.calibratedConfidence >= bucket.lo && signal.prediction.calibratedConfidence < bucket.hi;
      });
      const predicted = signals.length > 0
        ? signals.reduce((sum, signal) => sum + signal.prediction.calibratedConfidence, 0) / signals.length
        : (bucket.lo + bucket.hi) / 2;
      const observed = outcomes.length > 0
        ? outcomes.filter((outcome) => outcome.matched).length / outcomes.length
        : predicted;
      return {
        bucket: bucket.id,
        predicted: Number(predicted.toFixed(4)),
        observed: Number(observed.toFixed(4)),
        count: outcomes.length,
      };
    });

    const nonZero = points.filter((point) => point.count > 0);
    const mae = nonZero.length > 0
      ? nonZero.reduce((sum, point) => sum + Math.abs(point.predicted - point.observed), 0) / nonZero.length
      : 0;

    return {
      generatedAt: nowIso(),
      meanAbsoluteError: Number(mae.toFixed(4)),
      points,
    };
  }
}

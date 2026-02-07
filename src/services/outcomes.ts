import type { Store } from "../store.js";
import type { Direction, Horizon, OutcomeRecord } from "../types.js";
import { makeId, nowIso } from "../utils.js";

function directionFromReturn(realizedReturn: number): Direction {
  if (realizedReturn > 0.0025) {
    return "positive";
  }
  if (realizedReturn < -0.0025) {
    return "negative";
  }
  return "neutral";
}

export interface OutcomeSummary {
  total: number;
  matched: number;
  hitRate: number;
  averageReturn: number;
}

export class OutcomeService {
  constructor(private readonly store: Store) {}

  async record(signalId: string, realizedReturn: number): Promise<OutcomeRecord> {
    return this.store.transaction((state) => {
      const signal = state.signals.find((item) => item.id === signalId);
      if (!signal) {
        throw new Error(`Unknown signal ${signalId}`);
      }
      const existing = state.outcomes.find((item) => item.signalId === signalId);
      if (existing) {
        throw new Error(`Outcome already recorded for signal ${signalId}`);
      }
      const realizedDirection = directionFromReturn(realizedReturn);
      const outcome: OutcomeRecord = {
        id: makeId("outcome"),
        signalId,
        horizon: signal.impact.horizon,
        predictedDirection: signal.impact.direction,
        realizedReturn,
        realizedDirection,
        matched: realizedDirection === signal.impact.direction,
        evaluatedAt: nowIso(),
      };
      state.outcomes.push(outcome);
      return outcome;
    });
  }

  async summary(horizon?: Horizon): Promise<OutcomeSummary> {
    const state = await this.store.read();
    const outcomes = horizon ? state.outcomes.filter((item) => item.horizon === horizon) : state.outcomes;
    if (outcomes.length === 0) {
      return {
        total: 0,
        matched: 0,
        hitRate: 0,
        averageReturn: 0,
      };
    }
    const matched = outcomes.filter((item) => item.matched).length;
    const averageReturn = outcomes.reduce((sum, item) => sum + item.realizedReturn, 0) / outcomes.length;
    return {
      total: outcomes.length,
      matched,
      hitRate: matched / outcomes.length,
      averageReturn,
    };
  }
}

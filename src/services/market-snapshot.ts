import corporateActions from "../config/corporate-actions.json" with { type: "json" };
import entityMap from "../config/entity-map.json" with { type: "json" };
import type { Store } from "../store.js";
import type { MarketSnapshotEntry } from "../types.js";

interface CorporateActionConfig {
  ticker: string;
  adjustmentFactor: number;
}

interface EntityConfig {
  ticker: string;
  sector: string;
}

const actionByTicker = new Map<string, CorporateActionConfig>(
  (corporateActions as CorporateActionConfig[]).map((row) => [row.ticker, row]),
);

const entityByTicker = new Map<string, EntityConfig>(
  (entityMap as EntityConfig[]).map((row) => [row.ticker, row]),
);

export class MarketSnapshotService {
  constructor(private readonly store: Store) {}

  async snapshots(limit: number = 50): Promise<MarketSnapshotEntry[]> {
    const state = await this.store.read();
    const tickerSet = new Set<string>();
    for (const signal of state.signals) {
      for (const entity of signal.linkedEntities) {
        tickerSet.add(entity.ticker);
      }
    }
    if (tickerSet.size === 0) {
      for (const entity of entityByTicker.values()) {
        tickerSet.add(entity.ticker);
      }
    }

    const entries = [...tickerSet].map((ticker) => {
      const entity = entityByTicker.get(ticker);
      const signals = state.signals.filter((signal) => signal.linkedEntities.some((item) => item.ticker === ticker));
      const outcomes = state.outcomes.filter((outcome) => {
        const signal = state.signals.find((item) => item.id === outcome.signalId);
        return signal ? signal.linkedEntities.some((item) => item.ticker === ticker) : false;
      });

      const breadthSignalScore = signals.length > 0
        ? signals.reduce((sum, signal) => sum + signal.score, 0) / signals.length
        : 0;

      const avgReturn = outcomes.length > 0
        ? outcomes.reduce((sum, outcome) => sum + outcome.realizedReturn, 0) / outcomes.length
        : breadthSignalScore * 0.01;

      const dayChangePct = Number((avgReturn * 100).toFixed(2));
      const latestPrice = Number((100 * (1 + avgReturn)).toFixed(2));
      const adjustmentFactor = actionByTicker.get(ticker)?.adjustmentFactor ?? 1;
      const adjustedPrice = Number((latestPrice * adjustmentFactor).toFixed(2));
      const updatedAt = [...signals]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt ?? new Date().toISOString();

      return {
        ticker,
        sector: entity?.sector ?? "unknown",
        latestPrice,
        adjustedPrice,
        adjustmentFactor,
        dayChangePct,
        breadthSignalScore: Number(breadthSignalScore.toFixed(4)),
        updatedAt,
      } satisfies MarketSnapshotEntry;
    });

    return entries
      .sort((a, b) => Math.abs(b.dayChangePct) - Math.abs(a.dayChangePct))
      .slice(0, limit);
  }
}

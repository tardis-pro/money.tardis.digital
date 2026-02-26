import corporateActions from "../config/corporate-actions.json" with { type: "json" };
import entityMap from "../config/entity-map.json" with { type: "json" };
import type { Store } from "../store.js";
import type { MarketSnapshotEntry } from "../types.js";
import { fetchQuotes } from "./yahoo-quote-client.js";

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

    const tickers = [...tickerSet];

    // Fetch live quotes from Yahoo Finance
    const { quotes, fetchedAt } = await fetchQuotes(tickers);

    const entries = tickers.map((ticker) => {
      const entity = entityByTicker.get(ticker);
      const signals = state.signals.filter((s) => s.linkedEntities.some((item) => item.ticker === ticker));

      const breadthSignalScore = signals.length > 0
        ? signals.reduce((sum, s) => sum + s.score, 0) / signals.length
        : 0;

      const quote = quotes.get(ticker.toUpperCase());
      const adjustmentFactor = actionByTicker.get(ticker)?.adjustmentFactor ?? 1;

      const latestPrice = quote ? Number((quote.regularMarketPrice * adjustmentFactor).toFixed(2)) : null;
      const dayChangePct = quote ? Number(quote.regularMarketChangePercent.toFixed(2)) : null;
      const updatedAt = quote
        ? new Date(quote.regularMarketTime * 1000).toISOString()
        : [...signals].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt ?? fetchedAt;

      return {
        ticker,
        sector: entity?.sector ?? "unknown",
        latestPrice,
        adjustedPrice: latestPrice,
        adjustmentFactor,
        dayChangePct,
        breadthSignalScore: Number(breadthSignalScore.toFixed(4)),
        updatedAt,
        quoteSource: quote ? "yahoo-finance" : "unavailable",
        quoteTime: quote ? new Date(quote.regularMarketTime * 1000).toISOString() : null,
        isDelayed: true,
        delayMinutes: 15,
      } as MarketSnapshotEntry;
    });

    return entries
      .sort((a, b) => Math.abs(b.dayChangePct ?? 0) - Math.abs(a.dayChangePct ?? 0))
      .slice(0, limit);
  }
}

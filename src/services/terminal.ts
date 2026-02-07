import type { SectorHeatmapEntry, SignalRecord } from "../types.js";
import type { Store } from "../store.js";

export class TerminalService {
  constructor(private readonly store: Store) {}

  async topSignals(limit: number = 25): Promise<SignalRecord[]> {
    const state = await this.store.read();
    return [...state.signals]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async sectorHeatmap(): Promise<SectorHeatmapEntry[]> {
    const state = await this.store.read();
    const sectorMap = new Map<string, { count: number; score: number }>();

    for (const signal of state.signals) {
      const seenSectors = new Set(signal.linkedEntities.map((item) => item.sector));
      for (const sector of seenSectors) {
        const current = sectorMap.get(sector) ?? { count: 0, score: 0 };
        current.count += 1;
        current.score += signal.score;
        sectorMap.set(sector, current);
      }
    }

    return Array.from(sectorMap.entries())
      .map(([sector, value]) => ({
        sector,
        signalCount: value.count,
        weightedScore: value.score,
      }))
      .sort((a, b) => b.weightedScore - a.weightedScore);
  }

  async sourceDrillDown(sourceId: string): Promise<SignalRecord[]> {
    const state = await this.store.read();
    return state.signals.filter((signal) => signal.sourceId === sourceId).sort((a, b) => b.score - a.score);
  }

  async watchlists() {
    const state = await this.store.read();
    return state.watchlists;
  }

  async signalsForWatchlist(watchlistId: string): Promise<SignalRecord[]> {
    const state = await this.store.read();
    const watchlist = state.watchlists.find((item) => item.id === watchlistId);
    if (!watchlist) {
      return [];
    }
    return state.signals
      .filter((signal) =>
        signal.linkedEntities.some((entity) => watchlist.tickers.includes(entity.ticker)),
      )
      .sort((a, b) => b.score - a.score);
  }
}

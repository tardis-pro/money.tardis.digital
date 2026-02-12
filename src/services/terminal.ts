import type { CommandLogRecord, SectorHeatmapEntry, SignalRecord, TerminalRoute } from "../types.js";
import type { Store } from "../store.js";
import { makeId, nowIso } from "../utils.js";

const ROUTE_ALIASES: Record<string, TerminalRoute> = {
  overview: "overview",
  home: "overview",
  signals: "signals",
  signal: "signals",
  heatmap: "heatmap",
  sectors: "heatmap",
  alerts: "alerts",
  alert: "alerts",
  supply: "supply-chain",
  graph: "supply-chain",
  watchlist: "watchlists",
  watchlists: "watchlists",
  mit: "mit",
  trading: "mit",
  system: "system",
  status: "system",
  help: "overview",
};

export class TerminalService {
  constructor(private readonly store: Store) {}

  private sourceAllowed(allowedSources: string[] | undefined, sourceId: string): boolean {
    if (!allowedSources || allowedSources.length === 0) {
      return true;
    }
    if (allowedSources.includes("*")) {
      return true;
    }
    return allowedSources.includes(sourceId);
  }

  async topSignals(limit: number = 25, allowedSources?: string[]): Promise<SignalRecord[]> {
    const state = await this.store.read();
    return [...state.signals]
      .filter((signal) => this.sourceAllowed(allowedSources, signal.sourceId))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async sectorHeatmap(allowedSources?: string[]): Promise<SectorHeatmapEntry[]> {
    const state = await this.store.read();
    const sectorMap = new Map<string, { count: number; score: number }>();

    for (const signal of state.signals) {
      if (!this.sourceAllowed(allowedSources, signal.sourceId)) {
        continue;
      }
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

  async sourceDrillDown(sourceId: string, allowedSources?: string[]): Promise<SignalRecord[]> {
    const state = await this.store.read();
    if (!this.sourceAllowed(allowedSources, sourceId)) {
      return [];
    }
    return state.signals.filter((signal) => signal.sourceId === sourceId).sort((a, b) => b.score - a.score);
  }

  async watchlists() {
    const state = await this.store.read();
    return state.watchlists;
  }

  async signalsForWatchlist(watchlistId: string, allowedSources?: string[]): Promise<SignalRecord[]> {
    const state = await this.store.read();
    const watchlist = state.watchlists.find((item) => item.id === watchlistId);
    if (!watchlist) {
      return [];
    }
    return state.signals
      .filter((signal) => this.sourceAllowed(allowedSources, signal.sourceId))
      .filter((signal) =>
        signal.linkedEntities.some((entity) => watchlist.tickers.includes(entity.ticker)),
      )
      .sort((a, b) => b.score - a.score);
  }

  async runCommand(input: string): Promise<{
    route: TerminalRoute;
    status: "success" | "error";
    errorMessage: string | null;
    latencyMs: number;
    log: CommandLogRecord;
  }> {
    const startedAt = performance.now();
    const normalizedInput = input.trim().toLowerCase();
    const commandToken = normalizedInput.split(/\s+/)[0] ?? "";
    const route = ROUTE_ALIASES[commandToken] ?? "overview";
    const status: "success" | "error" = commandToken === "" ? "error" : "success";
    const errorMessage = status === "error" ? "Command cannot be empty" : null;
    const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));

    const log = await this.store.transaction((state) => {
      const row: CommandLogRecord = {
        id: makeId("cmd"),
        input,
        normalizedInput,
        route,
        status,
        latencyMs,
        errorMessage,
        executedAt: nowIso(),
      };
      state.commandLogs.push(row);
      if (state.commandLogs.length > 500) {
        state.commandLogs = state.commandLogs.slice(-500);
      }
      return row;
    });

    return {
      route,
      status,
      errorMessage,
      latencyMs,
      log,
    };
  }

  async commandLogs(limit: number = 50): Promise<CommandLogRecord[]> {
    const state = await this.store.read();
    return [...state.commandLogs]
      .sort((a, b) => b.executedAt.localeCompare(a.executedAt))
      .slice(0, limit);
  }
}

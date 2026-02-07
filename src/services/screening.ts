import { z } from "zod";
import type { Store } from "../store.js";
import type { DiscoveryChangeRecord, ScreenDefinition, ScreenRun, SignalRecord } from "../types.js";
import { makeId, nowIso } from "../utils.js";

const screenSchema = z.object({
  name: z.string().min(2).max(80),
  filters: z.object({
    minSignalScore: z.number().min(0).max(1),
    sectors: z.array(z.string().min(1).max(60)).max(20),
    minLiquidityScore: z.number().min(0).max(1),
    policyTags: z.array(z.string().min(1).max(60)).max(20),
  }),
  scheduleCron: z.string().min(5).max(80).nullable(),
  createdBy: z.string().min(1).max(64),
});

export type CreateScreenInput = z.infer<typeof screenSchema>;

function signalLiquidityProxy(signal: SignalRecord): number {
  const entityConfidence = signal.linkedEntities.length > 0
    ? signal.linkedEntities.reduce((sum, entity) => sum + entity.confidence, 0) / signal.linkedEntities.length
    : 0.3;
  return Math.min(1, signal.score * 0.7 + entityConfidence * 0.3);
}

function signalMatches(screen: ScreenDefinition, signal: SignalRecord): boolean {
  if (signal.score < screen.filters.minSignalScore) {
    return false;
  }
  if (signalLiquidityProxy(signal) < screen.filters.minLiquidityScore) {
    return false;
  }
  if (screen.filters.sectors.length > 0) {
    const matchesSector = signal.linkedEntities.some((entity) => screen.filters.sectors.includes(entity.sector));
    if (!matchesSector) {
      return false;
    }
  }
  if (screen.filters.policyTags.length > 0) {
    const text = `${signal.event.title} ${signal.event.summary}`.toLowerCase();
    const matchesTag = screen.filters.policyTags.some((tag) => text.includes(tag.toLowerCase()));
    if (!matchesTag) {
      return false;
    }
  }
  return true;
}

export class ScreeningService {
  constructor(private readonly store: Store) {}

  async saveScreen(input: CreateScreenInput): Promise<ScreenDefinition> {
    const parsed = screenSchema.parse(input);
    return this.store.transaction((state) => {
      const now = nowIso();
      const row: ScreenDefinition = {
        id: makeId("screen"),
        name: parsed.name,
        filters: parsed.filters,
        scheduleCron: parsed.scheduleCron,
        createdBy: parsed.createdBy,
        createdAt: now,
        updatedAt: now,
      };
      state.screens.push(row);
      return row;
    });
  }

  async listScreens(): Promise<ScreenDefinition[]> {
    const state = await this.store.read();
    return [...state.screens].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async runScreen(screenId: string): Promise<ScreenRun> {
    const startedAt = nowIso();
    return this.store.transaction((state) => {
      const screen = state.screens.find((item) => item.id === screenId);
      if (!screen) {
        throw new Error(`Unknown screen ${screenId}`);
      }

      const matching = state.signals
        .filter((signal) => signalMatches(screen, signal))
        .sort((a, b) => b.score - a.score);

      const run: ScreenRun = {
        id: makeId("screenrun"),
        screenId,
        startedAt,
        completedAt: nowIso(),
        status: "completed",
        resultCount: matching.length,
        topTickers: matching.slice(0, 10).map((signal) => signal.linkedEntities[0]?.ticker ?? "NIFTY50"),
        error: null,
      };
      state.screenRuns.push(run);

      const previousRuns = state.screenRuns
        .filter((item) => item.screenId === screenId && item.id !== run.id && item.status === "completed")
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const previousTop = new Set(previousRuns[0]?.topTickers ?? []);
      const currentTop = run.topTickers;
      let rank = 1;
      for (const ticker of currentTop) {
        const reason = previousTop.has(ticker) ? "Still in top screen output" : "New entrant in top screen output";
        const score = matching.find((signal) => signal.linkedEntities.some((entity) => entity.ticker === ticker))?.score ?? 0;
        const change: DiscoveryChangeRecord = {
          id: makeId("discover"),
          screenId,
          runId: run.id,
          ticker,
          rank,
          reason,
          score,
          createdAt: nowIso(),
        };
        state.discoveryChanges.push(change);
        rank += 1;
      }

      if (state.discoveryChanges.length > 5000) {
        state.discoveryChanges = state.discoveryChanges.slice(-5000);
      }
      if (state.screenRuns.length > 2000) {
        state.screenRuns = state.screenRuns.slice(-2000);
      }
      return run;
    });
  }

  async discoveryFeed(limit: number = 50): Promise<DiscoveryChangeRecord[]> {
    const state = await this.store.read();
    return [...state.discoveryChanges]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async diagnostics(screenId: string): Promise<{
    screenId: string;
    totalRuns: number;
    avgResultCount: number;
    scheduled: boolean;
    latestRunAt: string | null;
  }> {
    const state = await this.store.read();
    const screen = state.screens.find((item) => item.id === screenId);
    if (!screen) {
      throw new Error(`Unknown screen ${screenId}`);
    }
    const runs = state.screenRuns.filter((item) => item.screenId === screenId && item.status === "completed");
    const avgResultCount = runs.length > 0
      ? runs.reduce((sum, item) => sum + item.resultCount, 0) / runs.length
      : 0;
    const latestRunAt = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]?.startedAt ?? null;
    return {
      screenId,
      totalRuns: runs.length,
      avgResultCount: Number(avgResultCount.toFixed(2)),
      scheduled: screen.scheduleCron !== null,
      latestRunAt,
    };
  }
}

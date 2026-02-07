import { z } from "zod";
import entityMap from "../config/entity-map.json" with { type: "json" };
import type { Store } from "../store.js";
import type {
  PortfolioAttributionRow,
  PortfolioExposureSummary,
  PortfolioRecord,
  ScenarioBookmark,
} from "../types.js";
import { makeId, nowIso } from "../utils.js";

const createPortfolioSchema = z.object({
  name: z.string().min(2).max(80),
  createdBy: z.string().min(1).max(64),
  positions: z.array(
    z.object({
      ticker: z.string().min(1).max(24),
      quantity: z.number().positive(),
      avgPrice: z.number().positive(),
      marketPrice: z.number().positive(),
    }),
  ).min(1),
});

const scenarioSchema = z.object({
  portfolioId: z.string().min(1).max(64),
  name: z.string().min(2).max(80),
  shockPct: z.number().min(-1).max(1),
  notes: z.string().min(1).max(400),
});

type EntityRow = { ticker: string; sector: string };
const sectorByTicker = new Map<string, string>((entityMap as EntityRow[]).map((row) => [row.ticker, row.sector]));

export type CreatePortfolioInput = z.infer<typeof createPortfolioSchema>;
export type CreateScenarioInput = z.infer<typeof scenarioSchema>;

export class PortfolioService {
  constructor(private readonly store: Store) {}

  async createPortfolio(input: CreatePortfolioInput): Promise<PortfolioRecord> {
    const parsed = createPortfolioSchema.parse(input);
    return this.store.transaction((state) => {
      const now = nowIso();
      const portfolio: PortfolioRecord = {
        id: makeId("portfolio"),
        name: parsed.name,
        positions: parsed.positions.map((row) => ({ ...row, ticker: row.ticker.toUpperCase() })),
        createdBy: parsed.createdBy,
        createdAt: now,
        updatedAt: now,
      };
      state.portfolios.push(portfolio);
      return portfolio;
    });
  }

  async listPortfolios(): Promise<PortfolioRecord[]> {
    const state = await this.store.read();
    return [...state.portfolios].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async exposure(portfolioId: string): Promise<PortfolioExposureSummary> {
    const state = await this.store.read();
    const portfolio = state.portfolios.find((item) => item.id === portfolioId);
    if (!portfolio) {
      throw new Error(`Unknown portfolio ${portfolioId}`);
    }
    const totalMarketValue = portfolio.positions.reduce((sum, row) => sum + row.quantity * row.marketPrice, 0);
    const sectorMap = new Map<string, number>();
    for (const position of portfolio.positions) {
      const sector = sectorByTicker.get(position.ticker) ?? "unknown";
      const mv = position.quantity * position.marketPrice;
      sectorMap.set(sector, (sectorMap.get(sector) ?? 0) + mv);
    }
    const sectorExposure = [...sectorMap.entries()].map(([sector, marketValue]) => ({
      sector,
      marketValue: Number(marketValue.toFixed(2)),
      weight: totalMarketValue > 0 ? Number((marketValue / totalMarketValue).toFixed(4)) : 0,
    }));
    const policySensitivityScore = state.signals.length > 0
      ? Number((state.signals.reduce((sum, signal) => sum + signal.score, 0) / state.signals.length).toFixed(4))
      : 0;

    return {
      portfolioId,
      totalMarketValue: Number(totalMarketValue.toFixed(2)),
      sectorExposure: sectorExposure.sort((a, b) => b.marketValue - a.marketValue),
      policySensitivityScore,
    };
  }

  async attribution(portfolioId: string): Promise<PortfolioAttributionRow[]> {
    const state = await this.store.read();
    const portfolio = state.portfolios.find((item) => item.id === portfolioId);
    if (!portfolio) {
      throw new Error(`Unknown portfolio ${portfolioId}`);
    }
    return portfolio.positions.map((position) => {
      const pnl = (position.marketPrice - position.avgPrice) * position.quantity;
      const signal = state.signals
        .filter((item) => item.linkedEntities.some((entity) => entity.ticker === position.ticker))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return {
        portfolioId,
        ticker: position.ticker,
        pnl: Number(pnl.toFixed(2)),
        latestSignalScore: Number((signal?.score ?? 0).toFixed(4)),
        eventTitle: signal?.event.title ?? null,
      } satisfies PortfolioAttributionRow;
    });
  }

  async saveScenario(input: CreateScenarioInput): Promise<ScenarioBookmark> {
    const parsed = scenarioSchema.parse(input);
    return this.store.transaction((state) => {
      const portfolio = state.portfolios.find((item) => item.id === parsed.portfolioId);
      if (!portfolio) {
        throw new Error(`Unknown portfolio ${parsed.portfolioId}`);
      }
      const row: ScenarioBookmark = {
        id: makeId("scenario"),
        portfolioId: parsed.portfolioId,
        name: parsed.name,
        shockPct: parsed.shockPct,
        notes: parsed.notes,
        createdAt: nowIso(),
      };
      state.scenarioBookmarks.push(row);
      return row;
    });
  }

  async listScenarios(portfolioId: string): Promise<ScenarioBookmark[]> {
    const state = await this.store.read();
    return state.scenarioBookmarks
      .filter((item) => item.portfolioId === portfolioId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

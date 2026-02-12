import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Store } from "./store.js";
import type { MitStore } from "./mit-store.js";
import type { MitUniverseEntry } from "./mit-types.js";
import mitUniverse from "./config/mit-universe.json" with { type: "json" };
import { evaluateNtLiteChecklist } from "./services/mit/nt-lite-checklist.js";
import { computePeerMedianPEBySector, peerMedianForTicker } from "./services/mit/peer-comparison.js";
import { detectMarketTone, governanceFlagsForTicker } from "./services/mit/sentiment-overlay.js";
import { parseScreenerCsv } from "./services/mit/screener-adapter.js";
import { MarketDataService } from "./services/mit/market-data.js";
import { computeTechnicalSnapshot } from "./services/mit/technical-indicators.js";
import { scoreComposite } from "./services/mit/composite-scorer.js";
import { computeEntryExitPlan } from "./services/mit/entry-exit-calc.js";
import { MitPortfolioService } from "./services/mit/portfolio-service.js";
import { MitTradeManager } from "./services/mit/trade-manager.js";
import { refreshPortfolioPnl } from "./services/mit/pnl-ledger.js";
import { checkGuard } from "./services/mit/exposure-guard.js";
import { holdingsCsv, closedTradesCsv } from "./services/mit/csv-export.js";
import { buildWeeklyReport } from "./services/mit/weekly-report.js";
import { buildMonthlyReport } from "./services/mit/monthly-report.js";
import { upsertDailyRun } from "./services/mit/daily-pipeline.js";

const manualFundamentalSchema = z.object({
  ticker: z.string().min(1),
  snapshot: z.object({
    fetchedAt: z.string().optional(),
    source: z.enum(["screener-csv", "manual", "morningstar"]).default("manual"),
    revenueHistory: z.array(z.object({ fy: z.string(), value: z.number() })).default([]),
    epsHistory: z.array(z.object({ fy: z.string(), value: z.number() })).default([]),
    opmHistory: z.array(z.object({ fy: z.string(), value: z.number() })).default([]),
    debtToEquity: z.number().nullable().default(null),
    interestCoverage: z.number().nullable().default(null),
    roce: z.number().nullable().default(null),
    roe: z.number().nullable().default(null),
    fcfHistory: z.array(z.object({ fy: z.string(), value: z.number() })).default([]),
    pe: z.number().nullable().default(null),
    peg: z.number().nullable().default(null),
    marketCap: z.number().nullable().default(null),
    promoterHoldingPct: z.number().nullable().default(null),
    promoterPledgePct: z.number().nullable().default(null),
    auditorRemarks: z.enum(["clean", "qualified", "adverse", "unknown"]).default("unknown"),
    revenueCAGR_3y: z.number().nullable().default(null),
    revenueCAGR_5y: z.number().nullable().default(null),
    epsCAGR_3y: z.number().nullable().default(null),
    epsCAGR_5y: z.number().nullable().default(null),
  }),
});

const tradeEnterSchema = z.object({
  ticker: z.string().min(1),
  feed: z.enum(["nt-lite", "quant"]),
  entryPrice: z.number().positive(),
  qty: z.number().int().positive().optional(),
  stopLoss: z.number().positive(),
  firstTarget: z.number().positive(),
  notes: z.string().optional(),
  entryDate: z.string().optional(),
  customAllocPct: z.number().positive().max(1).optional(),
});

const tradeExitSchema = z.object({
  positionId: z.string().min(1),
  qty: z.number().int().positive(),
  exitPrice: z.number().positive(),
  exitDate: z.string().optional(),
  reason: z.enum(["near-target", "rsi-rollover", "time-exit", "stop-breach", "momentum-decay", "manual"]),
});

const tradeConfirmSchema = z.object({
  positionId: z.string().min(1),
  entryPrice: z.number().positive(),
  entryDate: z.string().optional(),
});

const settingsSchema = z.object({
  capital: z.number().positive().optional(),
  allocPct: z.number().positive().max(1).optional(),
  stopPct: z.number().positive().max(1).optional(),
  pauseCashPct: z.number().positive().max(1).optional(),
  maxDeployedPct: z.number().positive().max(1).optional(),
  maxHorizonDays: z.number().int().positive().optional(),
  trailingActivationPct: z.number().positive().max(1).optional(),
});

const runStatus = new Map<string, { status: "started" | "completed" | "failed"; result?: unknown; error?: string }>();

export function registerMitRoutes(app: FastifyInstance, deps: { mitStore: MitStore; store: Store }): void {
  const marketData = new MarketDataService();
  const portfolioService = new MitPortfolioService();
  const tradeManager = new MitTradeManager();
  const universe = mitUniverse as MitUniverseEntry[];

  app.get("/api/mit/fundamentals/:ticker", async (request, reply) => {
    const ticker = String((request.params as { ticker?: string }).ticker ?? "").toUpperCase();
    const state = await deps.mitStore.read();
    const data = state.fundamentals[ticker];
    if (!data) {
      return reply.code(404).send({ error: "Not found" });
    }
    return data;
  });

  app.get("/api/mit/checklist/:ticker", async (request, reply) => {
    const ticker = String((request.params as { ticker?: string }).ticker ?? "").toUpperCase();
    const state = await deps.mitStore.read();
    const fundamental = state.fundamentals[ticker];
    if (!fundamental) {
      return reply.code(404).send({ error: "Fundamentals missing" });
    }
    const sector = universe.find((u) => u.ticker === ticker)?.sector ?? null;
    const peer = peerMedianForTicker(ticker, universe.map((u) => ({ ticker: u.ticker, sector: u.sector })), state.peerMedianPE);
    const result = evaluateNtLiteChecklist(fundamental, { sector, peerMedianPE: peer });
    await deps.mitStore.transaction((draft) => {
      draft.checklistResults[ticker] = result;
      return null;
    });
    return result;
  });

  app.post("/api/mit/screen/nt-lite", async () => {
    return deps.mitStore.transaction((draft) => {
      const out = Object.values(draft.fundamentals).map((f) => {
        const sector = universe.find((u) => u.ticker === f.ticker)?.sector ?? null;
        const peer = peerMedianForTicker(f.ticker, universe.map((u) => ({ ticker: u.ticker, sector: u.sector })), draft.peerMedianPE);
        const row = evaluateNtLiteChecklist(f, { sector, peerMedianPE: peer });
        draft.checklistResults[f.ticker] = row;
        return row;
      });
      return out;
    });
  });

  app.get("/api/mit/peers/:ticker", async (request) => {
    const ticker = String((request.params as { ticker?: string }).ticker ?? "").toUpperCase();
    const state = await deps.mitStore.read();
    const all = computePeerMedianPEBySector(universe.map((u) => ({ ticker: u.ticker, sector: u.sector })), state.fundamentals);
    const median = peerMedianForTicker(ticker, universe.map((u) => ({ ticker: u.ticker, sector: u.sector })), all);
    return { ticker, peerMedianPE: median, sectors: all };
  });

  app.get("/api/mit/sentiment/tone", async () => {
    const mit = await deps.mitStore.read();
    const state = await deps.store.read();
    const recent = state.signals.filter((s) => Date.now() - Date.parse(s.createdAt) <= 24 * 60 * 60 * 1000);
    return { marketTone: detectMarketTone(recent, mit.technicals) };
  });

  app.get("/api/mit/sentiment/:ticker/flags", async (request) => {
    const ticker = String((request.params as { ticker?: string }).ticker ?? "").toUpperCase();
    const mit = await deps.mitStore.read();
    const state = await deps.store.read();
    const fundamental = mit.fundamentals[ticker];
    const flags = governanceFlagsForTicker({
      ticker,
      signals: state.signals,
      promoterPledgePct: fundamental?.promoterPledgePct ?? null,
    });
    return { ticker, flags };
  });

  app.post("/api/mit/import/screener-csv", async (request, reply) => {
    const body = request.body as { csv?: string };
    if (!body?.csv) {
      return reply.code(400).send({ error: "csv is required" });
    }
    const parsed = parseScreenerCsv(body.csv, { source: "screener-csv" });
    await deps.mitStore.transaction((draft) => {
      for (const snapshot of parsed.success) {
        draft.fundamentals[snapshot.ticker] = snapshot;
      }
      return null;
    });
    return parsed;
  });

  app.post("/api/mit/import/fundamentals", async (request, reply) => {
    const parsed = manualFundamentalSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    const payload = parsed.data;
    await deps.mitStore.transaction((draft) => {
      draft.fundamentals[payload.ticker.toUpperCase()] = {
        ticker: payload.ticker.toUpperCase(),
        ...payload.snapshot,
        fetchedAt: payload.snapshot.fetchedAt ?? new Date().toISOString(),
      };
      return null;
    });
    return { ok: true };
  });

  app.get("/api/mit/technicals/:ticker", async (request, reply) => {
    const ticker = String((request.params as { ticker?: string }).ticker ?? "").toUpperCase();
    const state = await deps.mitStore.read();
    const technicals = state.technicals[ticker];
    if (!technicals) {
      return reply.code(404).send({ error: "Technicals missing" });
    }
    return technicals;
  });

  app.get("/api/mit/score/:ticker", async (request, reply) => {
    const ticker = String((request.params as { ticker?: string }).ticker ?? "").toUpperCase();
    const state = await deps.mitStore.read();
    const score = state.compositeScores[ticker];
    if (!score) {
      return reply.code(404).send({ error: "Score missing" });
    }
    return score;
  });

  app.get("/api/mit/entry-exit/:ticker", async (request, reply) => {
    const ticker = String((request.params as { ticker?: string }).ticker ?? "").toUpperCase();
    const state = await deps.mitStore.read();
    const technicals = state.technicals[ticker];
    const candles = state.candles[ticker];
    if (!technicals || !candles) {
      return reply.code(404).send({ error: "Data missing" });
    }
    const plan = computeEntryExitPlan({
      ticker,
      feed: "nt-lite",
      technicals,
      candles,
      stopPct: state.portfolio.settings.stopPct,
      trailingActivationPct: state.portfolio.settings.trailingActivationPct,
    });
    if (!plan) {
      return reply.code(404).send({ error: "No plan" });
    }
    return plan;
  });

  app.post("/api/mit/pipeline/run", async () => {
    const runId = `mit-run-${Date.now()}`;
    runStatus.set(runId, { status: "started" });

    (async () => {
      try {
        await deps.mitStore.transaction(async (draft) => {
          const technicals: typeof draft.technicals = {};
          const scores: typeof draft.compositeScores = {};
          const ideas: typeof draft.dailyRuns[number]["ideas"] = [];
          const tickers = [...new Set(universe.map((u) => u.ticker))];

          for (const ticker of tickers) {
            const candles = await marketData.fetchCandles(ticker, 300).catch(() => []);
            draft.candles[ticker] = candles.slice(-300);
            const t = computeTechnicalSnapshot(ticker, candles);
            if (!t) {
              continue;
            }
            technicals[ticker] = t;
            const f = draft.fundamentals[ticker];
            if (!f) {
              continue;
            }
            const peer = peerMedianForTicker(ticker, universe.map((u) => ({ ticker: u.ticker, sector: u.sector })), draft.peerMedianPE);
            const score = scoreComposite({
              ticker,
              fundamentals: f,
              technicals: t,
              peerMedianPE: peer,
              promoterHoldingTrendStable: true,
            });
            scores[ticker] = score;
            const plan = computeEntryExitPlan({
              ticker,
              feed: "nt-lite",
              technicals: t,
              candles,
              stopPct: draft.portfolio.settings.stopPct,
              trailingActivationPct: draft.portfolio.settings.trailingActivationPct,
            });
            if (!plan) {
              continue;
            }
            ideas.push({
              id: `mit-idea-${ticker}-${Date.now()}`,
              date: new Date().toISOString().slice(0, 10),
              ticker,
              feed: "nt-lite",
              thesis: ["Checklist and composite conditions satisfied"],
              compositeScore: score,
              entryExitPlan: plan,
              technicals: t,
              fundamentals: f,
              momentumLabel: `RSI ${(t.rsi14 ?? 0).toFixed(1)}`,
              risks: [],
              isAvoid: false,
              avoidReason: null,
            });
          }

          upsertDailyRun({ state: draft, technicals, fundamentals: draft.fundamentals, scores, ideas });
          draft.portfolio.lastPipelineRun = new Date().toISOString();
          return null;
        });
        runStatus.set(runId, { status: "completed", result: { runId } });
      } catch (error) {
        runStatus.set(runId, { status: "failed", error: error instanceof Error ? error.message : String(error) });
      }
    })();

    return { runId, status: "started" };
  });

  app.get("/api/mit/pipeline/status/:runId", async (request, reply) => {
    const runId = String((request.params as { runId?: string }).runId ?? "");
    const status = runStatus.get(runId);
    if (!status) {
      return reply.code(404).send({ error: "run not found" });
    }
    return status;
  });

  app.get("/api/mit/pipeline/latest", async (request, reply) => {
    const state = await deps.mitStore.read();
    const latest = [...state.dailyRuns].sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!latest) {
      return reply.code(404).send({ error: "No runs" });
    }
    return latest;
  });

  app.get("/api/mit/daily-ideas", async (request, reply) => {
    const state = await deps.mitStore.read();
    const latest = [...state.dailyRuns].sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!latest) {
      return reply.code(404).send({ error: "No runs" });
    }
    return latest.ideas;
  });

  app.get("/api/mit/portfolio", async () => {
    const state = await deps.mitStore.read();
    return portfolioService.toResponse(state.portfolio);
  });

  app.post("/api/mit/portfolio/settings", async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return deps.mitStore.transaction((draft) => portfolioService.updateSettings(draft, compactSettings({
      capital: parsed.data.capital,
      allocPct: parsed.data.allocPct,
      stopPct: parsed.data.stopPct,
      pauseCashPct: parsed.data.pauseCashPct,
      maxDeployedPct: parsed.data.maxDeployedPct,
      maxHorizonDays: parsed.data.maxHorizonDays,
      trailingActivationPct: parsed.data.trailingActivationPct,
    })));
  });

  app.post("/api/mit/trade/enter", async (request, reply) => {
    const parsed = tradeEnterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    const body = parsed.data;
    const result = await deps.mitStore.transaction((draft) => tradeManager.enter(draft, compactEnter({
      ticker: body.ticker,
      feed: body.feed,
      entryPrice: body.entryPrice,
      qty: body.qty,
      stopLoss: body.stopLoss,
      firstTarget: body.firstTarget,
      notes: body.notes,
      entryDate: body.entryDate,
      customAllocPct: body.customAllocPct,
    })));
    if (!result.ok) {
      return reply.code(400).send(result);
    }
    return result;
  });

  app.post("/api/mit/trade/exit", async (request, reply) => {
    const parsed = tradeExitSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    const result = await deps.mitStore.transaction((draft) => tradeManager.exit(draft, compactExit({
      positionId: parsed.data.positionId,
      qty: parsed.data.qty,
      exitPrice: parsed.data.exitPrice,
      reason: parsed.data.reason,
      exitDate: parsed.data.exitDate,
    })));
    if (!result.ok) {
      return reply.code(400).send(result);
    }
    return result;
  });

  app.post("/api/mit/trade/confirm", async (request, reply) => {
    const parsed = tradeConfirmSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    const result = await deps.mitStore.transaction((draft) => tradeManager.confirm(draft, compactConfirm({
      positionId: parsed.data.positionId,
      entryPrice: parsed.data.entryPrice,
      entryDate: parsed.data.entryDate,
    })));
    if (!result.ok) {
      return reply.code(400).send(result);
    }
    return result;
  });

  app.post("/api/mit/pnl/refresh", async () => {
    return deps.mitStore.transaction(async (draft) => {
      const latest: Record<string, number> = {};
      for (const pos of draft.portfolio.positions) {
        const candles = await marketData.fetchCandles(pos.ticker, 2).catch(() => []);
        const close = candles[candles.length - 1]?.close;
        if (close !== undefined) {
          latest[pos.ticker] = close;
        }
      }
      const refreshed = refreshPortfolioPnl(draft.portfolio, latest, {
        technicalsByTicker: draft.technicals,
        maxHorizonDays: draft.portfolio.settings.maxHorizonDays,
      });
      draft.portfolio = refreshed.portfolio;
      return refreshed;
    });
  });

  app.get("/api/mit/pnl", async () => {
    const state = await deps.mitStore.read();
    return {
      unrealized: state.portfolio.positions.reduce((sum, p) => sum + p.unrealizedPnl, 0),
      realized: state.portfolio.closedTrades.reduce((sum, t) => sum + t.realizedPnl, 0),
      positions: state.portfolio.positions,
    };
  });

  app.get("/api/mit/pnl/history", async () => {
    const state = await deps.mitStore.read();
    return state.portfolio.equityCurve;
  });

  app.get("/api/mit/indicators", async () => {
    const state = await deps.mitStore.read();
    return state.portfolio.positions.filter((p) => p.activeSellIndicators.length > 0);
  });

  app.get("/api/mit/guard", async () => {
    const state = await deps.mitStore.read();
    return checkGuard(state.portfolio);
  });

  app.get("/api/mit/trades", async () => {
    const state = await deps.mitStore.read();
    return state.portfolio.closedTrades;
  });

  app.get("/api/mit/quant/signals", async () => {
    const state = await deps.mitStore.read();
    const latest = [...state.dailyRuns].sort((a, b) => b.date.localeCompare(a.date))[0];
    return (latest?.ideas ?? []).filter((idea) => idea.feed === "quant");
  });

  app.post("/api/mit/reports/weekly", async () => {
    return deps.mitStore.transaction((draft) => {
      const end = new Date().toISOString().slice(0, 10);
      const startDate = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const report = buildWeeklyReport(draft, startDate, end);
      draft.weeklyReports = [...draft.weeklyReports, report].slice(-52);
      return report;
    });
  });

  app.post("/api/mit/reports/monthly", async () => {
    return deps.mitStore.transaction((draft) => {
      const month = new Date().toISOString().slice(0, 7);
      const report = buildMonthlyReport(draft, month);
      draft.monthlyReports = [...draft.monthlyReports.filter((r) => r.month !== month), report].slice(-24);
      return report;
    });
  });

  app.get("/api/mit/export/holdings.csv", async (request, reply) => {
    const state = await deps.mitStore.read();
    reply.header("content-type", "text/csv");
    reply.header("content-disposition", `attachment; filename="mit-holdings-${new Date().toISOString().slice(0, 10)}.csv"`);
    return holdingsCsv(state);
  });

  app.get("/api/mit/export/trades.csv", async (request, reply) => {
    const state = await deps.mitStore.read();
    reply.header("content-type", "text/csv");
    reply.header("content-disposition", `attachment; filename="mit-trades-${new Date().toISOString().slice(0, 10)}.csv"`);
    return closedTradesCsv(state);
  });
}

function compactSettings(input: {
  capital: number | undefined;
  allocPct: number | undefined;
  stopPct: number | undefined;
  pauseCashPct: number | undefined;
  maxDeployedPct: number | undefined;
  maxHorizonDays: number | undefined;
  trailingActivationPct: number | undefined;
}) {
  const out: {
    capital?: number;
    allocPct?: number;
    stopPct?: number;
    pauseCashPct?: number;
    maxDeployedPct?: number;
    maxHorizonDays?: number;
    trailingActivationPct?: number;
  } = {};
  if (input.capital !== undefined) out.capital = input.capital;
  if (input.allocPct !== undefined) out.allocPct = input.allocPct;
  if (input.stopPct !== undefined) out.stopPct = input.stopPct;
  if (input.pauseCashPct !== undefined) out.pauseCashPct = input.pauseCashPct;
  if (input.maxDeployedPct !== undefined) out.maxDeployedPct = input.maxDeployedPct;
  if (input.maxHorizonDays !== undefined) out.maxHorizonDays = input.maxHorizonDays;
  if (input.trailingActivationPct !== undefined) out.trailingActivationPct = input.trailingActivationPct;
  return out;
}

function compactEnter(input: {
  ticker: string;
  feed: "nt-lite" | "quant";
  entryPrice: number;
  qty: number | undefined;
  stopLoss: number;
  firstTarget: number;
  notes: string | undefined;
  entryDate: string | undefined;
  customAllocPct: number | undefined;
}) {
  const out: {
    ticker: string;
    feed: "nt-lite" | "quant";
    entryPrice: number;
    qty: number;
    stopLoss: number;
    firstTarget: number;
    notes?: string;
    entryDate?: string;
    customAllocPct?: number;
  } = {
    ticker: input.ticker,
    feed: input.feed,
    entryPrice: input.entryPrice,
    qty: input.qty ?? 0,
    stopLoss: input.stopLoss,
    firstTarget: input.firstTarget,
  };
  if (input.notes !== undefined) out.notes = input.notes;
  if (input.entryDate !== undefined) out.entryDate = input.entryDate;
  if (input.customAllocPct !== undefined) out.customAllocPct = input.customAllocPct;
  return out;
}

function compactExit(input: {
  positionId: string;
  qty: number;
  exitPrice: number;
  reason: "manual" | "near-target" | "rsi-rollover" | "time-exit" | "stop-breach" | "momentum-decay";
  exitDate: string | undefined;
}) {
  const out: {
    positionId: string;
    qty: number;
    exitPrice: number;
    reason: "manual" | "near-target" | "rsi-rollover" | "time-exit" | "stop-breach" | "momentum-decay";
    exitDate?: string;
  } = {
    positionId: input.positionId,
    qty: input.qty,
    exitPrice: input.exitPrice,
    reason: input.reason,
  };
  if (input.exitDate !== undefined) out.exitDate = input.exitDate;
  return out;
}

function compactConfirm(input: { positionId: string; entryPrice: number; entryDate: string | undefined }) {
  const out: { positionId: string; entryPrice: number; entryDate?: string } = {
    positionId: input.positionId,
    entryPrice: input.entryPrice,
  };
  if (input.entryDate !== undefined) out.entryDate = input.entryDate;
  return out;
}


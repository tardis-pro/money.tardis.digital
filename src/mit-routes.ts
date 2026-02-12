import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Store } from "./store.js";
import type { MitStore } from "./mit-store.js";
import type { MitUniverseEntry, MitWatchlistIdea, EntryExitPlan } from "./mit-types.js";
import mitUniverse from "./config/mit-universe.json" with { type: "json" };
import { evaluateNtLiteChecklist } from "./services/mit/nt-lite-checklist.js";
import { computePeerMedianPEBySector, peerMedianForTicker } from "./services/mit/peer-comparison.js";
import { detectMarketTone, governanceFlagsForTicker } from "./services/mit/sentiment-overlay.js";
import { parseScreenerCsv } from "./services/mit/screener-adapter.js";
import { MarketDataService } from "./services/mit/market-data.js";
import { computeTechnicalSnapshot } from "./services/mit/technical-indicators.js";
import { scoreComposite } from "./services/mit/composite-scorer.js";
import { computeEntryExitPlan } from "./services/mit/entry-exit-calc.js";
import { MITScreeniPyService, enrichWithMITScores, mapScreeniPyToTechnical } from "./services/mit/screenipy-mit-connector.js";
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
let screenipyCache: { rows: ReturnType<typeof enrichWithMITScores>; fetchedAt: string } | null = null;
const SCREENIPY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function registerMitRoutes(app: FastifyInstance, deps: { mitStore: MitStore; store: Store }): void {
  const marketData = new MarketDataService();
  const screeniPyService = new MITScreeniPyService();
  const portfolioService = new MitPortfolioService();
  const tradeManager = new MitTradeManager();
  const universe = mitUniverse as MitUniverseEntry[];

  // Screenipy real-data scan endpoints
  app.get("/api/mit/screenipy/run", async (request, reply) => {
    const query = request.query as { tickerOption?: string; executeOption?: string };
    const tickerOption = query.tickerOption ?? "1";
    const executeOption = query.executeOption ?? "0";
    
    try {
      const rows = await screeniPyService.runScan({ tickerOption, executeOption });
      screenipyCache = { rows, fetchedAt: new Date().toISOString() };
      return {
        scannedAt: screenipyCache.fetchedAt,
        totalScanned: rows.length,
        candidates: rows.sort((a, b) => (b.mitOverallScore ?? 0) - (a.mitOverallScore ?? 0)).slice(0, 50),
      };
    } catch (error) {
      return reply.code(500).send({ error: error instanceof Error ? error.message : "Scan failed" });
    }
  });

  app.get("/api/mit/screenipy/latest", async () => {
    if (!screenipyCache) {
      return { error: "No cached scan. Run /api/mit/screenipy/run first." };
    }
    return screenipyCache;
  });

  app.get("/api/mit/screenipy/candidates", async (request) => {
    const query = request.query as { limit?: string; feed?: string };
    if (!screenipyCache) {
      return { error: "No cached scan" };
    }
    const limit = parseInt(query.limit ?? "20", 10);
    const feed = query.feed ?? "all";
    
    let filtered = screenipyCache.rows;
    if (feed === "nt-lite") {
      filtered = screenipyCache.rows.filter(r => (r.mitQualityScore ?? 0) >= 60);
    } else if (feed === "quant") {
      filtered = screenipyCache.rows.filter(r => (r.mitMomentumScore ?? 0) >= 70);
    }
    
    return {
      scannedAt: screenipyCache.fetchedAt,
      feed,
      count: filtered.length,
      candidates: filtered.slice(0, limit),
    };
  });

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
        // Run screenipy scan first for real market data
        let screenipyRows: ReturnType<typeof enrichWithMITScores> = [];
        try {
          screenipyRows = await screeniPyService.runScan({ tickerOption: "5", executeOption: "0" });
          screenipyCache = { rows: screenipyRows, fetchedAt: new Date().toISOString() };
        } catch (e) {
          console.warn("Screenipy scan failed, using fallback", e);
        }

        await deps.mitStore.transaction(async (draft) => {
          const technicals: typeof draft.technicals = {};
          const scores: typeof draft.compositeScores = {};
          const ntLiteIdeas: typeof draft.dailyRuns[number]["ideas"] = [];
          const quantIdeas: typeof draft.dailyRuns[number]["ideas"] = [];
          const tickers = [...new Set(universe.map((u) => u.ticker))];

          // Build ticker -> screenipy data map
          const screenipyMap = new Map<string, ReturnType<typeof enrichWithMITScores>[0]>();
          for (const row of screenipyRows) {
            screenipyMap.set(row.stock, row);
          }

          for (const ticker of tickers) {
            // Prefer screenipy data, fallback to market data
            const screenipyRow = screenipyMap.get(ticker);
            const candles = screenipyRow 
              ? await marketData.fetchCandles(ticker, 300).catch(() => [])
              : await marketData.fetchCandles(ticker, 300).catch(() => []);
            
            if (candles.length === 0 && !screenipyRow) continue;
            
            draft.candles[ticker] = candles.slice(-300);
            
            // Use screenipy technicals if available, else compute from candles
            let t = screenipyRow 
              ? mapScreeniPyToTechnical(screenipyRow as any, ticker)
              : computeTechnicalSnapshot(ticker, candles);
            
            if (!t && !screenipyRow) continue;
            
            // Use screenipy data for technicals if available
            if (screenipyRow) {
              t = {
                ticker,
                computedAt: new Date().toISOString(),
                dma20: parseFloat(screenipyRow.ema20 || screenipyRow.sma20 || "0") || null,
                dma50: parseFloat(screenipyRow.ema50 || screenipyRow.sma50 || "0") || null,
                dma100: null,
                dma200: null,
                rsi14: parseFloat(screenipyRow.rsi || "0") || null,
                atr14: parseFloat(screenipyRow.atr14 || "0") || null,
                returnZScore20d: null,
                priceVsDma50Pct: t?.dma50 ? ((parseFloat(screenipyRow.ltp || "0") - t.dma50) / t.dma50 * 100) : null,
                priceVsDma200Pct: null,
                pullback5d: null,
                latestClose: parseFloat(screenipyRow.ltp || "0") || 0,
                latestVolume: parseFloat(screenipyRow.volume || "0") || 0,
              };
            }
            
            technicals[ticker] = t!;
            const f = draft.fundamentals[ticker];
            const peer = peerMedianForTicker(ticker, universe.map((u) => ({ ticker: u.ticker, sector: u.sector })), draft.peerMedianPE);
            const screenipyScore = screenipyRow 
              ? { quality: screenipyRow.mitQualityScore, momentum: screenipyRow.mitMomentumScore }
              : null;

            const score = scoreComposite({
              ticker,
              fundamentals: f!,
              technicals: t!,
              peerMedianPE: peer,
              promoterHoldingTrendStable: true,
            });
            scores[ticker] = score;

            const plan = computeEntryExitPlan({
              ticker,
              feed: "nt-lite",
              technicals: t!,
              candles,
              stopPct: draft.portfolio.settings.stopPct,
              trailingActivationPct: draft.portfolio.settings.trailingActivationPct,
            });
            if (!plan) continue;

            // NT-LITE ideas: checklist + quality focus
            if (f) {
              const ntLiteScore = score.breakdown.quality + score.breakdown.governance;
              if (ntLiteScore >= 50) {
                const checklist = evaluateNtLiteChecklist(f, { sector: universe.find(u => u.ticker === ticker)?.sector ?? null, peerMedianPE: peer });
                ntLiteIdeas.push({
                  id: `mit-idea-${ticker}-${Date.now()}`,
                  date: new Date().toISOString().slice(0, 10),
                  ticker,
                  feed: "nt-lite",
                  thesis: generateNtLiteThesis(checklist, screenipyRow, t!),
                  compositeScore: score,
                  entryExitPlan: plan,
                  technicals: t!,
                  fundamentals: f,
                  momentumLabel: generateMomentumLabel(screenipyRow, t!),
                  risks: [],
                  isAvoid: false,
                  avoidReason: null,
                });
              }
            }

            // QUANT ideas: momentum focus (return Z-score top decile)
            const zScore = t!.returnZScore20d;
            const priceAboveDma100 = t!.dma100 ? t!.latestClose > t!.dma100 : false;
            const pullback = t!.pullback5d ?? 1;
            const isTopMomentum = zScore !== null && zScore >= 1.28; // Top decile
            const isValidQuant = priceAboveDma100 && isTopMomentum && pullback < 0.05;
            
            if (isValidQuant && score.breakdown.momentum >= 50) {
              quantIdeas.push({
                id: `mit-quant-${ticker}-${Date.now()}`,
                date: new Date().toISOString().slice(0, 10),
                ticker,
                feed: "quant",
                thesis: generateQuantThesis(t!, zScore, pullback),
                compositeScore: score,
                entryExitPlan: plan,
                technicals: t!,
                fundamentals: f ?? { ticker, fetchedAt: "", source: "manual" as const, revenueHistory: [], epsHistory: [], opmHistory: [], debtToEquity: null, interestCoverage: null, roce: null, roe: null, fcfHistory: [], pe: null, peg: null, marketCap: null, promoterHoldingPct: null, promoterPledgePct: null, auditorRemarks: "unknown" as const, revenueCAGR_3y: null, revenueCAGR_5y: null, epsCAGR_3y: null, epsCAGR_5y: null },
                momentumLabel: `Z:${(zScore ?? 0).toFixed(2)} DMA100:${priceAboveDma100 ? "↑" : "↓"}`,
                risks: [],
                isAvoid: false,
                avoidReason: null,
              });
            }
          }

          // Merge ideas (prioritize NT-LITE, add Quant as secondary)
          const ideas = [...ntLiteIdeas];
          for (const q of quantIdeas) {
            if (!ideas.some(i => i.ticker === q.ticker)) {
              ideas.push(q);
            }
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

function generateNtLiteThesis(
  checklist: NonNullable<ReturnType<typeof evaluateNtLiteChecklist>>,
  screenipyRow: NonNullable<ReturnType<typeof enrichWithMITScores>[0]> | undefined,
  _technicals: NonNullable<ReturnType<typeof mapScreeniPyToTechnical>>
): string[] {
  const thesis: string[] = [];
  const items = checklist.items;

  if (items["valuation-sane"]?.pass) thesis.push(`Valuation acceptable (${items["valuation-sane"].value})`);
  if (items["roce-above-15"]?.pass) thesis.push(`Return metrics strong (${items["roce-above-15"].value})`);
  if (items["manageable-leverage"]?.pass) thesis.push(`Leverage manageable (${items["manageable-leverage"].value})`);
  if (items["improving-opm"]?.pass) thesis.push(`Operating margin positive (${items["improving-opm"].value})`);
  if (items["promoter-stable"]?.pass) thesis.push(`Promoter alignment (${items["promoter-stable"].value})`);
  if (items["clean-audit"]?.pass) thesis.push(`Audit clean (${items["clean-audit"].value})`);
  if (items["rising-revenue-eps"]?.pass) thesis.push(`Growth trend (${items["rising-revenue-eps"].value})`);
  if (items["strong-fcf"]?.pass) thesis.push(`Free cash flow strong (${items["strong-fcf"].value})`);

  if (screenipyRow?.trend === "Strong Up") thesis.push(`Strong uptrend (DMA alignment)`);
  if (screenipyRow?.trend === "Up") thesis.push(`Uptrend confirmed`);
  if (screenipyRow?.pattern && screenipyRow.pattern !== "None") thesis.push(`${screenipyRow.pattern} pattern`);
  if (screenipyRow?.rsi) {
    const rsi = parseFloat(screenipyRow.rsi);
    if (rsi >= 45 && rsi <= 65) thesis.push(`RSI ${rsi.toFixed(1)} in sweet spot`);
  }
  if (screenipyRow?.macd && screenipyRow.macdSignal) {
    const macd = parseFloat(screenipyRow.macd);
    const signal = parseFloat(screenipyRow.macdSignal);
    if (macd > signal) thesis.push(`MACD bullish crossover`);
  }

  if (thesis.length === 0) {
    thesis.push(`Quality checklist ${checklist.passCount}/${checklist.totalItems} passed`);
  }

  return thesis;
}

function generateQuantThesis(
  technicals: NonNullable<ReturnType<typeof mapScreeniPyToTechnical>>,
  zScore: number | null,
  pullbackPct: number
): string[] {
  const thesis: string[] = [];

  if (zScore !== null && zScore >= 1.28) {
    thesis.push(`Momentum Z-Score ${zScore.toFixed(2)} (top decile)`);
  }

  if (technicals.dma100 && technicals.latestClose > technicals.dma100) {
    thesis.push(`Price above DMA100`);
  }

  if (technicals.rsi14) {
    const rsi = technicals.rsi14;
    if (rsi >= 50 && rsi <= 75) thesis.push(`RSI ${rsi.toFixed(1)} in momentum zone`);
  }

  if (technicals.dma20 && technicals.dma50 && technicals.dma20 > technicals.dma50) {
    thesis.push(`Golden cross (DMA20 > DMA50)`);
  }

  if (pullbackPct > 0 && pullbackPct < 0.05) {
    thesis.push(`Pullback ${(pullbackPct * 100).toFixed(1)}% within buy zone`);
  }

  if (technicals.atr14 && technicals.latestClose) {
    const atrPct = (technicals.atr14 / technicals.latestClose) * 100;
    thesis.push(`ATR ${atrPct.toFixed(1)}% volatility`);
  }

  return thesis;
}

function generateMomentumLabel(
  screenipyRow: NonNullable<ReturnType<typeof enrichWithMITScores>[0]> | undefined,
  technicals: NonNullable<ReturnType<typeof mapScreeniPyToTechnical>>
): string {
  const parts: string[] = [];

  if (screenipyRow?.rsi) {
    parts.push(`RSI:${screenipyRow.rsi}`);
  } else if (technicals.rsi14) {
    parts.push(`RSI:${technicals.rsi14.toFixed(1)}`);
  }

  if (screenipyRow?.trend) {
    parts.push(screenipyRow.trend);
  } else if (technicals.dma20 && technicals.dma50) {
    const dmaCross = technicals.dma20 > technicals.dma50 ? "↑" : "↓";
    parts.push(`DMA${dmaCross}`);
  }

  if (screenipyRow?.pattern && screenipyRow.pattern !== "None") {
    parts.push(screenipyRow.pattern);
  }

  return parts.join(" | ");
}


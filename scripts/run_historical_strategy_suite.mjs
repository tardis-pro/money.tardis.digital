#!/usr/bin/env tsx

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { MitPostgresStore } from "../src/mit-store-postgres.js";
import { TimescaleTechnicalStore } from "../src/services/strategy-ai/ta-store.js";
import { StrategyStore } from "../src/services/strategy-ai/store.js";
import { HistoricalBacktester } from "../src/services/strategy-ai/historical-backtest.js";
import { StrategyGenerator, BUILTIN_TEMPLATES } from "../src/services/strategy-ai/generator.js";
import { Simulator } from "../src/services/strategy-ai/simulator.js";
import { BatchSimulator } from "../src/services/strategy-ai/batch-simulator.js";
import { Ranker } from "../src/services/strategy-ai/ranker.js";
import { GameTheoryEngine } from "../src/services/strategy-ai/game-theory/index.js";
import { MarketDataService } from "../src/services/mit/market-data.js";
import { FundamentalsProviderService } from "../src/services/mit/fundamentals-provider.js";
import mitUniverse from "../src/config/mit-universe.json" with { type: "json" };

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/policy_signal";
const OUTPUT_DIR = path.join(process.cwd(), "data", "strategy-ai-suite");
const HISTORICAL_DAYS = Number(process.env.MIT_HISTORICAL_DAYS ?? "7300");
const MIN_BACKTEST_CANDLES = Number(process.env.MIT_MIN_BACKTEST_CANDLES ?? "260");
const MIN_INDICATOR_CANDLES = 220;
const SKIP_REFRESH = process.env.MIT_SKIP_REFRESH === "true";

async function main() {
  const startedAt = new Date().toISOString();
  const runSuffix = startedAt.replace(/[-:.TZ]/g, "");
  const mitStore = new MitPostgresStore(DATABASE_URL, process.cwd());
  const taStore = new TimescaleTechnicalStore(DATABASE_URL);
  const strategyStore = new StrategyStore(DATABASE_URL);
  const marketData = new MarketDataService(process.cwd());
  const fundamentalsProvider = new FundamentalsProviderService();

  await mitStore.init();
  await taStore.init();
  await strategyStore.init();

  const mitState = await mitStore.read();
  const universeTickers = mitUniverse
    .filter((entry) => entry.nifty50)
    .map((entry) => entry.ticker.toUpperCase());

  const refreshStats = SKIP_REFRESH 
    ? { requestedDays: HISTORICAL_DAYS, requestedTickers: universeTickers.length, updated: 0, unchanged: universeTickers.length, failed: 0 }
    : await refreshHistoricalCandles(mitState, marketData, universeTickers, HISTORICAL_DAYS);
  const fundamentalsStats = SKIP_REFRESH
    ? { requestedTickers: universeTickers.length, refreshedTickers: 0, updated: 0, failed: 0, missingCriticalFields: [] }
    : await refreshFundamentals(mitState, fundamentalsProvider, universeTickers);
  await mitStore.write(mitState);

  const tickers = universeTickers
    .filter((ticker) => (mitState.candles[ticker] ?? []).length >= MIN_BACKTEST_CANDLES);
  if (tickers.length < 25) {
    throw new Error(`Need at least 25 NIFTY universe tickers with >=${MIN_BACKTEST_CANDLES} candles, found ${tickers.length}`);
  }

  for (const ticker of universeTickers) {
    const candles = (mitState.candles[ticker] ?? []).map((item) => ({
      ticker,
      timestamp: new Date(item.date),
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume,
    }));
    if (candles.length === 0) {
      continue;
    }
    await taStore.ingestCandles(ticker, candles);
    if (candles.length >= MIN_INDICATOR_CANDLES) {
      await taStore.computeAndSaveIndicators(ticker, [14, 20, 50, 100, 200]);
    }
  }

  const from = normalizeStartDate(tickers, mitState);
  const to = normalizeEndDate(tickers, mitState);
  const strategies = await loadOrCreateStrategies(strategyStore, tickers);

  const aggressiveStrategyIds = [
    "aggressive-momentum",
    "swing-trader",
    "breakout-volatility",
    "growth-momentum",
    "leveraged-breakout",
  ];

  const backtester = new HistoricalBacktester(taStore, {
    startDate: from,
    endDate: to,
    initialCapital: 1_000_000,
    commissionRate: 0.0005,
    slippageRate: 0.0005,
    maxPositionSize: 0.35,
    riskPerTrade: 0.025,
    allowMultiplePositions: true,
  });

  const backtestRuns = [];
  const walkforwardRuns = [];
  const detailedBacktests = [];
  const walkforwardProjections = [];

  for (const strategy of strategies) {
    const universeResults = [];
    for (const ticker of tickers) {
      try {
        const scopedStrategy = {
          ...strategy,
          universe: {
            ...strategy.universe,
            tickers: [ticker],
          },
        };
        const result = await backtester.run(scopedStrategy, ticker);
        universeResults.push(result);
      } catch (error) {
        console.warn(`Historical backtest skipped for ${strategy.id}/${ticker}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    for (const result of universeResults) {
      await strategyStore.createBacktestRun({
        id: `${result.runId}-${runSuffix}`,
        strategyId: result.strategyId,
        ticker: result.ticker,
        startDate: result.startDate,
        endDate: result.endDate,
        backtestType: "historical",
        createdAt: new Date().toISOString(),
        payload: result,
      });
      backtestRuns.push(`${result.runId}-${runSuffix}`);
      detailedBacktests.push(result);
    }

    const primaryTicker = strategy.universe.tickers[0] ?? tickers[0];
    const effectiveDays = universeResults[0]?.equityCurve.length ?? 0;
    const trainDays = Math.max(120, Math.floor(effectiveDays * 0.55));
    const testDays = Math.max(45, Math.floor(effectiveDays * 0.2));
    const stepDays = Math.max(20, Math.floor(testDays / 2));
    try {
      const walkforward = await backtester.runWalkForward(strategy, primaryTicker, trainDays, testDays, stepDays);
      for (const result of walkforward) {
        await strategyStore.createBacktestRun({
          id: `${result.runId}-${runSuffix}`,
          strategyId: result.strategyId,
          ticker: result.ticker,
          startDate: result.startDate,
          endDate: result.endDate,
          backtestType: "walkforward",
          createdAt: new Date().toISOString(),
          payload: result,
        });
        walkforwardRuns.push(`${result.runId}-${runSuffix}`);
        walkforwardProjections.push({
          strategyId: result.strategyId,
          ticker: result.ticker,
          runId: result.runId,
          annualizedReturn: result.metrics.annualizedReturn,
          sharpeRatio: result.metrics.sharpeRatio,
          maxDrawdown: result.metrics.maxDrawdown,
        });
      }
    } catch (error) {
      console.warn(`Walk-forward skipped for ${strategy.id}/${primaryTicker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const simulator = new Simulator({
    startDate: from,
    endDate: to,
    initialCapital: 1_000_000,
    commissionRate: 0.0005,
    slippageRate: 0.0005,
    taStore,
    tickers,
  });
  const batchSimulator = new BatchSimulator({ simulator, store: strategyStore });
  const simMap = await batchSimulator.runBatch(strategies, {
    startDate: from,
    endDate: to,
    initialCapital: 1_000_000,
    commissionRate: 0.0005,
    slippageRate: 0.0005,
    taStore,
    tickers,
  });

  const simResults = Array.from(simMap.values());
  const ranker = new Ranker({ store: strategyStore });
  const scores = ranker.computeScores(simResults);
  await ranker.saveRankings(scores);

  const gameTheory = new GameTheoryEngine({ store: strategyStore, simulator });
  const strategyIds = strategies.map((strategy) => strategy.id);
  const gameTypes = ["nash-equilibrium", "evolutionary", "zero-sum", "cooperator-defector", "signaling"];
  const gameResults = [];

  for (const type of gameTypes) {
    const experiment = gameTheory.createExperiment({
      name: `historical-suite-${type}`,
      type,
      strategies: strategyIds,
      config: {
        iterations: 120,
        generations: 12,
        populationSize: 12,
        numSimulations: 80,
      },
    });
    const result = await gameTheory.runExperiment(experiment);
    gameResults.push({
      experimentId: experiment.id,
      type,
      equilibriumFound: result.equilibriumFound,
      bestStrategies: result.bestStrategies,
    });
  }

  const stockLeaderboard = buildStockLeaderboard(detailedBacktests);
  const targetCandidates = stockLeaderboard.filter((item) => item.avgAnnualizedReturn >= 0.30 && item.avgAnnualizedReturn <= 0.40);
  const winningPicks = (targetCandidates.length >= 5 ? targetCandidates : stockLeaderboard).slice(0, 10);

  await strategyStore.setConfig("strategy-ai.last-suite-run", {
    startedAt,
    completedAt: new Date().toISOString(),
    historicalDaysRequested: HISTORICAL_DAYS,
    tickers,
    universeTickers,
    strategies: strategyIds,
    backtestRuns: backtestRuns.length,
    walkforwardRuns: walkforwardRuns.length,
    simulationRuns: simResults.length,
    rankingCount: scores.length,
    stockLeaderboard,
    winningPicks,
    gameResults,
    refreshStats,
    fundamentalsStats,
  });

  await mkdir(OUTPUT_DIR, { recursive: true });
  const report = {
    startedAt,
    completedAt: new Date().toISOString(),
    tickers,
    strategyIds,
    historicalDaysRequested: HISTORICAL_DAYS,
    universeCoverage: {
      configuredUniverse: universeTickers.length,
      withCandles: universeTickers.filter((ticker) => (mitState.candles[ticker] ?? []).length > 0).length,
      withFundamentals: universeTickers.filter((ticker) => mitState.fundamentals[ticker]).length,
      eligibleForBacktest: tickers.length,
    },
    runCounts: {
      backtest: backtestRuns.length,
      walkforward: walkforwardRuns.length,
      simulation: simResults.length,
      rankings: scores.length,
      gameExperiments: gameResults.length,
    },
    refreshStats,
    fundamentalsStats,
    winningPicks,
    stockLeaderboard,
    walkforwardProjections,
    gameResults,
  };
  await writeFile(path.join(OUTPUT_DIR, "latest-run.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(OUTPUT_DIR, "backtest-results.json"), `${JSON.stringify(detailedBacktests, null, 2)}\n`, "utf8");
  await writeFile(path.join(OUTPUT_DIR, "simulation-results.json"), `${JSON.stringify(simResults, null, 2)}\n`, "utf8");
  await writeFile(path.join(OUTPUT_DIR, "ranking-results.json"), `${JSON.stringify(scores, null, 2)}\n`, "utf8");
  await writeFile(path.join(OUTPUT_DIR, "game-results.json"), `${JSON.stringify(gameResults, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(report, null, 2));

  await taStore.close();
  await strategyStore.close();
}

function normalizeStartDate(tickers, state) {
  const starts = [];
  for (const ticker of tickers) {
    const first = state.candles[ticker]?.[0];
    if (first) {
      starts.push(new Date(first.date).getTime());
    }
  }
  if (starts.length === 0) {
    return new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  }
  return new Date(Math.max(...starts)).toISOString();
}

function normalizeEndDate(tickers, state) {
  const ends = [];
  for (const ticker of tickers) {
    const list = state.candles[ticker] ?? [];
    const last = list[list.length - 1];
    if (last) {
      ends.push(new Date(last.date).getTime());
    }
  }
  if (ends.length === 0) {
    return new Date().toISOString();
  }
  return new Date(Math.min(...ends)).toISOString();
}

async function loadOrCreateStrategies(store, tickers) {
  const existing = await store.listStrategies({ limit: 200, offset: 0 });
  const ready = existing.filter((strategy) => strategy.universe.mode === "custom_tickers" && strategy.universe.tickers.length > 0);
  if (ready.length >= 9) {
    return ready.slice(0, 9);
  }

  const generator = new StrategyGenerator({
    numVariations: 3,
    mutationRate: 0.35,
    crossoverRate: 0.3,
    randomSearchRatio: 0.25,
  });

  const templates = [
    BUILTIN_TEMPLATES.trendFollowing,
    BUILTIN_TEMPLATES.meanReversion,
    BUILTIN_TEMPLATES.momentum,
    BUILTIN_TEMPLATES.breakout,
    BUILTIN_TEMPLATES.aggressiveMomentum,
    BUILTIN_TEMPLATES.swingTrader,
    BUILTIN_TEMPLATES.breakoutVolatility,
    BUILTIN_TEMPLATES.growthMomentum,
    BUILTIN_TEMPLATES.leveragedBreakout,
  ];

  const created = [];
  for (const template of templates) {
    const candidates = generator.generateFromTemplate(template).slice(0, 1);
    for (const candidate of candidates) {
      const strategy = {
        ...candidate,
        status: "validated",
        updatedAt: new Date().toISOString(),
        universe: {
          mode: "custom_tickers",
          exchanges: ["NSE"],
          indexIds: [],
          tickers,
        },
        tags: [...new Set([...(candidate.tags ?? []), "historical-suite", "historical-only"])],
      };
      const saved = await store.createStrategy(strategy);
      created.push(saved);
    }
  }

  if (created.length === 0) {
    throw new Error("Unable to load or create strategies for historical suite");
  }
  return created;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function refreshHistoricalCandles(state, marketData, tickers, requestedDays) {
  const stats = {
    requestedDays,
    requestedTickers: tickers.length,
    updated: 0,
    unchanged: 0,
    failed: 0,
  };

  for (const ticker of tickers) {
    const current = state.candles[ticker] ?? [];
    const lastDate = current[current.length - 1]?.date;
    const lastAgeDays = lastDate ? (Date.now() - new Date(lastDate).getTime()) / (24 * 60 * 60 * 1000) : Number.POSITIVE_INFINITY;
    if (current.length >= Math.floor(requestedDays * 0.95) && lastAgeDays <= 7) {
      stats.unchanged += 1;
      continue;
    }
    try {
      const fetched = await marketData.fetchCandles(ticker, requestedDays);
      if (fetched.length > current.length) {
        state.candles[ticker] = fetched;
        stats.updated += 1;
      } else {
        stats.unchanged += 1;
      }
    } catch {
      state.candles[ticker] = current;
      stats.failed += 1;
    }
  }

  return stats;
}

async function refreshFundamentals(state, fundamentalsProvider, tickers) {
  const refreshCandidates = tickers.filter((ticker) => {
    const snapshot = state.fundamentals[ticker];
    if (!snapshot?.fetchedAt) {
      return true;
    }
    const ageDays = (Date.now() - new Date(snapshot.fetchedAt).getTime()) / (24 * 60 * 60 * 1000);
    return !Number.isFinite(ageDays) || ageDays > 14;
  });
  const refresh = refreshCandidates.length > 0
    ? await fundamentalsProvider.refreshTickers(refreshCandidates)
    : { updated: [], failed: [], missingCriticalFields: [] };
  for (const snapshot of refresh.updated) {
    state.fundamentals[snapshot.ticker] = snapshot;
  }
  return {
    requestedTickers: tickers.length,
    refreshedTickers: refreshCandidates.length,
    updated: refresh.updated.length,
    failed: refresh.failed.length,
    missingCriticalFields: refresh.missingCriticalFields,
  };
}

function buildStockLeaderboard(results) {
  const byTicker = new Map();
  for (const result of results) {
    const existing = byTicker.get(result.ticker) ?? {
      ticker: result.ticker,
      runIds: [],
      annualizedReturns: [],
      sharpeRatios: [],
      winRates: [],
      maxDrawdowns: [],
    };
    existing.runIds.push(result.runId);
    existing.annualizedReturns.push(result.metrics.annualizedReturn);
    existing.sharpeRatios.push(result.metrics.sharpeRatio);
    existing.winRates.push(result.metrics.winRate);
    existing.maxDrawdowns.push(result.metrics.maxDrawdown);
    byTicker.set(result.ticker, existing);
  }

  const leaderboard = [];
  for (const row of byTicker.values()) {
    const avgAnnualizedReturn = mean(row.annualizedReturns);
    const avgSharpe = mean(row.sharpeRatios);
    const avgWinRate = mean(row.winRates);
    const avgMaxDrawdown = mean(row.maxDrawdowns);
    const composite = (avgAnnualizedReturn * 100 * 0.55) + (avgSharpe * 20 * 0.3) + (avgWinRate * 100 * 0.15);
    leaderboard.push({
      ticker: row.ticker,
      samples: row.runIds.length,
      runIds: row.runIds,
      avgAnnualizedReturn,
      avgSharpe,
      avgWinRate,
      avgMaxDrawdown,
      composite,
    });
  }

  return leaderboard.sort((a, b) => b.composite - a.composite);
}

function mean(values) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

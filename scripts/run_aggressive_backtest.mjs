#!/usr/bin/env tsx

import { MitPostgresStore } from "../src/mit-store-postgres.js";
import { TimescaleTechnicalStore } from "../src/services/strategy-ai/ta-store.js";
import { StrategyStore } from "../src/services/strategy-ai/store.js";
import { HistoricalBacktester } from "../src/services/strategy-ai/historical-backtest.js";
import { StrategyGenerator, BUILTIN_TEMPLATES } from "../src/services/strategy-ai/generator.js";
import mitUniverse from "../src/config/mit-universe.json" with { type: "json" };

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/policy_signal";

async function main() {
  console.log("Starting optimized historical strategy suite...");
  
  const mitStore = new MitPostgresStore(DATABASE_URL, process.cwd());
  const taStore = new TimescaleTechnicalStore(DATABASE_URL);
  const strategyStore = new StrategyStore(DATABASE_URL);
  
  await mitStore.init();
  await taStore.init();
  await strategyStore.init();
  
  const mitState = await mitStore.read();
  
  const universeTickers = mitUniverse
    .filter((entry) => entry.nifty50)
    .map((entry) => entry.ticker.toUpperCase());

  // Use only top 10 tickers for speed
  const top10 = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "SBIN", "BHARTIARTL", "TITAN", "TATASTEEL", "BAJFINANCE", "ADANIPORTS"];
  const tickers = universeTickers.filter(t => top10.includes(t));
  
  console.log(`Using ${tickers.length} tickers:`, tickers.join(", "));
  
  // Skip ingesting - use existing data from TimescaleDB
  // Data already exists from previous runs
  
  const from = "2022-01-01";
  const to = "2026-01-01";
  
  // Create aggressive strategies
  const generator = new StrategyGenerator({
    numVariations: 1,
    mutationRate: 0.35,
    crossoverRate: 0.3,
    randomSearchRatio: 0.25,
  });

  const aggressiveTemplates = [
    BUILTIN_TEMPLATES.aggressiveMomentum,
    BUILTIN_TEMPLATES.growthMomentum,
  ];

  const strategies = [];
  for (const template of aggressiveTemplates) {
    const candidates = generator.generateFromTemplate(template);
    if (candidates.length > 0) {
      const strategy = {
        ...candidates[0],
        status: "validated",
        updatedAt: new Date().toISOString(),
        universe: {
          mode: "custom_tickers",
          exchanges: ["NSE"],
          indexIds: [],
          tickers,
        },
        tags: ["aggressive-suite", "high-return"],
      };
      const saved = await strategyStore.createStrategy(strategy);
      strategies.push(saved);
      console.log(`Created strategy: ${saved.name} (${saved.id})`);
    }
  }

  const backtester = new HistoricalBacktester(taStore, {
    startDate: from,
    endDate: to,
    initialCapital: 1_000_000,
    commissionRate: 0.0005,
    slippageRate: 0.0005,
    maxPositionSize: 0.4,
    riskPerTrade: 0.03,
    allowMultiplePositions: true,
  });

  const results = [];
  
  for (const strategy of strategies) {
    console.log(`\nRunning backtests for ${strategy.name}...`);
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
        results.push(result);
        console.log(`  ${ticker}: ${(result.metrics.annualizedReturn * 100).toFixed(1)}% return, Sharpe: ${result.metrics.sharpeRatio.toFixed(2)}, WinRate: ${(result.metrics.winRate * 100).toFixed(0)}%`);
      } catch (error) {
        console.warn(`  ${ticker}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Aggregate results by ticker
  const byTicker = {};
  for (const r of results) {
    if (!byTicker[r.ticker]) byTicker[r.ticker] = [];
    byTicker[r.ticker].push(r.metrics);
  }

  const summary = Object.entries(byTicker).map(([ticker, metrics]) => {
    const avgReturn = metrics.reduce((a,b) => a + b.annualizedReturn, 0) / metrics.length;
    const avgSharpe = metrics.reduce((a,b) => a + b.sharpeRatio, 0) / metrics.length;
    const avgWinRate = metrics.reduce((a,b) => a + b.winRate, 0) / metrics.length;
    return { ticker, avgReturn, avgSharpe, avgWinRate, count: metrics.length };
  }).sort((a,b) => b.avgReturn - a.avgReturn);

  console.log("\n=== TOP STOCKS BY AGGRESSIVE STRATEGIES ===");
  summary.slice(0, 15).forEach(r => {
    console.log(`${r.ticker}: ${(r.avgReturn*100).toFixed(1)}% annualized, Sharpe: ${r.avgSharpe.toFixed(2)}, WinRate: ${(r.avgWinRate*100).toFixed(0)}%`);
  });

  const targetCandidates = summary.filter(r => r.avgReturn >= 0.25);
  console.log(`\n=== TARGET: 25%+ RETURNS ===`);
  if (targetCandidates.length > 0) {
    targetCandidates.forEach(r => {
      console.log(`${r.ticker}: ${(r.avgReturn*100).toFixed(1)}% annualized`);
    });
  } else {
    console.log("No stocks achieved 25%+ returns. Top performers:");
    summary.slice(0, 5).forEach(r => {
      console.log(`${r.ticker}: ${(r.avgReturn*100).toFixed(1)}% annualized`);
    });
  }

  await taStore.close();
  await strategyStore.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

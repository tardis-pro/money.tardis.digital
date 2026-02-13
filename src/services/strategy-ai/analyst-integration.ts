import type { DailyCandle } from "../../mit-types.js";
import { AnalystAgent, type FundamentalAnalysis, type TechnicalAnalysis } from "../mit/analyst-agent.js";
import type { Strategy } from "./dsl/strategy-schema.js";
import { Ranker } from "./ranker.js";
import { type ContextFeatures, type Recommendation, RulebookEngine } from "./rulebook.js";
import { type PerformanceMetrics, Simulator, type SimulationResult } from "./simulator.js";
import { StrategyStore } from "./store.js";
import { TimescaleTechnicalStore } from "./ta-store.js";

type AnalystAgentDeps = ConstructorParameters<typeof AnalystAgent>[0];

export interface EnhancedAnalysis extends FundamentalAnalysis, TechnicalAnalysis {
  ticker: string;
  relatedStrategies: Strategy[];
  recommendations: Recommendation;
  backtestSummary: Array<{
    strategyId: string;
    strategyName: string;
    metrics: PerformanceMetrics;
  }>;
}

export interface ComparisonResult {
  strategies: Array<{
    id: string;
    name: string;
    metrics: PerformanceMetrics;
  }>;
  winner: string;
  recommendation: string;
}

interface StrategyAnalysisExtensionDeps extends AnalystAgentDeps {
  technicalStore: TimescaleTechnicalStore;
  strategyStore: StrategyStore;
  ranker: Ranker;
  rulebook?: RulebookEngine;
}

const DEFAULT_LOOKBACK_DAYS = 252;

export class StrategyAnalysisExtension extends AnalystAgent {
  private readonly technicalStore: TimescaleTechnicalStore;
  private readonly strategyStore: StrategyStore;
  private readonly ranker: Ranker;
  private readonly rulebook: RulebookEngine;

  constructor(deps: StrategyAnalysisExtensionDeps) {
    super({ mitStore: deps.mitStore, marketData: deps.marketData });
    this.technicalStore = deps.technicalStore;
    this.strategyStore = deps.strategyStore;
    this.ranker = deps.ranker;
    this.rulebook = deps.rulebook ?? new RulebookEngine({ store: deps.strategyStore, ranker: deps.ranker });
  }

  async analyzeWithStrategyContext(ticker: string, strategyId?: string): Promise<EnhancedAnalysis> {
    const symbol = ticker.toUpperCase();
    const [fundamentals, technicals, relatedStrategies, context] = await Promise.all([
      this.analyzeFundamentals(symbol),
      this.analyzeTechnicals(symbol),
      this.findRelatedStrategies(symbol),
      this.deriveContextFeatures(symbol),
    ]);

    const recommendations = await this.getStrategyRecommendations(symbol, context);
    const candidateIds = this.selectBacktestCandidates(strategyId, recommendations, relatedStrategies);
    const backtestSummary = await this.runBacktestSummary(candidateIds, symbol, relatedStrategies);

    return {
      ticker: symbol,
      ...fundamentals,
      ...technicals,
      relatedStrategies,
      recommendations,
      backtestSummary,
    };
  }

  async findRelatedStrategies(ticker: string): Promise<Strategy[]> {
    const symbol = ticker.toUpperCase();
    const strategies = await this.strategyStore.listStrategies({
      limit: 10_000,
      offset: 0,
    });

    return strategies.filter((strategy) => this.isTickerRelatedToStrategy(symbol, strategy));
  }

  async getStrategyRecommendations(ticker: string, context: ContextFeatures): Promise<Recommendation> {
    const relatedStrategies = await this.findRelatedStrategies(ticker);
    const relatedIds = new Set(relatedStrategies.map((strategy) => strategy.id));
    const baseRecommendation = await this.rulebook.recommend(context);

    if (relatedIds.size === 0) {
      return baseRecommendation;
    }

    const filtered = baseRecommendation.strategies.filter((item) => relatedIds.has(item.strategyId));
    if (filtered.length > 0) {
      const total = filtered.reduce((sum, item) => sum + item.allocation, 0);
      const normalized = total > 0
        ? filtered.map((item) => ({ ...item, allocation: Number((item.allocation / total).toFixed(6)) }))
        : filtered;

      return {
        ...baseRecommendation,
        strategies: normalized,
        totalAllocation: Number(normalized.reduce((sum, item) => sum + item.allocation, 0).toFixed(4)),
      };
    }

    const topRanked = await this.ranker.getTopStrategies(3, { regime: context.marketRegime });
    const fromRelatedRankings = topRanked.filter((score) => relatedIds.has(score.strategyId));
    const fallbackIds = fromRelatedRankings.map((score) => score.strategyId);
    const selectedIds = fallbackIds.length > 0 ? fallbackIds : relatedStrategies.slice(0, 3).map((strategy) => strategy.id);
    const equalWeight = selectedIds.length > 0 ? Number((1 / selectedIds.length).toFixed(6)) : 0;

    return {
      strategies: selectedIds.map((strategyId) => ({
        strategyId,
        allocation: equalWeight,
        reason: "Related to ticker universe; equal-weight fallback recommendation.",
      })),
      totalAllocation: selectedIds.length > 0 ? Number((equalWeight * selectedIds.length).toFixed(4)) : 0,
      riskEnvelope: baseRecommendation.riskEnvelope,
      context,
      confidence: baseRecommendation.confidence,
    };
  }

  async backtestStrategyOnTicker(strategyId: string, ticker: string): Promise<SimulationResult> {
    const symbol = ticker.toUpperCase();
    const strategy = await this.strategyStore.getStrategy(strategyId);
    if (!strategy) {
      throw new Error(`Strategy not found: ${strategyId}`);
    }

    const { startDate, endDate } = await this.resolveBacktestWindow(symbol);
    const simulator = new Simulator({
      startDate,
      endDate,
      initialCapital: 1_000_000,
      commissionRate: 0.0005,
      slippageRate: 0.0005,
      ...(strategy.regime ? { regime: strategy.regime } : {}),
    });

    const strategyForTicker: Strategy = {
      ...strategy,
      universe: {
        mode: "custom_tickers",
        exchanges: strategy.universe.exchanges,
        indexIds: [],
        tickers: [symbol],
      },
      updatedAt: new Date().toISOString(),
    };

    return simulator.run(strategyForTicker);
  }

  async compareStrategies(strategyIds: string[], ticker: string): Promise<ComparisonResult> {
    const symbol = ticker.toUpperCase();
    const uniqueIds = [...new Set(strategyIds.map((id) => id.trim()).filter((id) => id.length > 0))];
    if (uniqueIds.length === 0) {
      return {
        strategies: [],
        winner: "",
        recommendation: "No strategies provided for comparison.",
      };
    }

    const [strategies, simulations] = await Promise.all([
      Promise.all(uniqueIds.map((id) => this.strategyStore.getStrategy(id))),
      Promise.all(uniqueIds.map((id) => this.backtestStrategyOnTicker(id, symbol))),
    ]);

    const comparisonRows = simulations.map((result, index) => ({
      id: result.strategyId,
      name: strategies[index]?.name ?? result.strategyId,
      metrics: this.toPerformanceMetrics(result),
    }));

    const best = [...comparisonRows].sort((a, b) => {
      if (b.metrics.totalReturn !== a.metrics.totalReturn) {
        return b.metrics.totalReturn - a.metrics.totalReturn;
      }
      return b.metrics.sharpeRatio - a.metrics.sharpeRatio;
    })[0];

    const winner = best?.id ?? "";
    const recommendation = best
      ? `Prefer ${best.name} (${best.id}) on ${symbol}; it leads on total return (${(best.metrics.totalReturn * 100).toFixed(2)}%) with Sharpe ${best.metrics.sharpeRatio.toFixed(2)}.`
      : "No winner could be determined from the provided strategies.";

    return {
      strategies: comparisonRows,
      winner,
      recommendation,
    };
  }

  private async runBacktestSummary(
    strategyIds: string[],
    ticker: string,
    relatedStrategies: Strategy[],
  ): Promise<EnhancedAnalysis["backtestSummary"]> {
    if (strategyIds.length === 0) {
      return [];
    }

    const names = new Map(relatedStrategies.map((strategy) => [strategy.id, strategy.name]));
    const results = await Promise.all(strategyIds.map((id) => this.backtestStrategyOnTicker(id, ticker)));

    return results.map((result) => ({
      strategyId: result.strategyId,
      strategyName: names.get(result.strategyId) ?? result.strategyId,
      metrics: this.toPerformanceMetrics(result),
    }));
  }

  private selectBacktestCandidates(
    strategyId: string | undefined,
    recommendations: Recommendation,
    relatedStrategies: Strategy[],
  ): string[] {
    if (strategyId) {
      return [strategyId];
    }

    const fromRecommendations = recommendations.strategies.map((item) => item.strategyId);
    if (fromRecommendations.length > 0) {
      return [...new Set(fromRecommendations)].slice(0, 3);
    }

    return relatedStrategies.slice(0, 3).map((strategy) => strategy.id);
  }

  private async deriveContextFeatures(ticker: string): Promise<ContextFeatures> {
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const quarter = Math.floor((month - 1) / 3) + 1;
    const dayOfWeek = now.getUTCDay();
    const candles = await this.technicalStore.getLatestCandles(ticker, DEFAULT_LOOKBACK_DAYS).catch(() => []);

    const closes = candles.map((candle) => candle.close);
    const dailyReturns = this.computeDailyReturns(candles.map((candle) => ({
      date: candle.timestamp.toISOString().slice(0, 10),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    })));
    const volatility = this.stdDev(dailyReturns);
    const recentReturn = this.computePeriodReturn(closes, Math.min(21, closes.length - 1));
    const mediumReturn = this.computePeriodReturn(closes, Math.min(63, closes.length - 1));

    const marketRegime: ContextFeatures["marketRegime"] = recentReturn > 0.03 && mediumReturn > 0
      ? "bull"
      : recentReturn < -0.03 && mediumReturn < 0
        ? "bear"
        : "sideways";
    const volatilityState: ContextFeatures["volatilityState"] = volatility >= 0.02
      ? "high"
      : volatility >= 0.012
        ? "medium"
        : "low";

    return {
      marketRegime,
      volatilityState,
      sectorMomentum: {
        [ticker]: Number((recentReturn * 100).toFixed(4)),
        broadMarket: Number((mediumReturn * 100).toFixed(4)),
      },
      seasonality: { month, quarter },
      policyFlags: [],
      dayOfWeek,
    };
  }

  private isTickerRelatedToStrategy(ticker: string, strategy: Strategy): boolean {
    const inUniverse = strategy.universe.mode === "custom_tickers"
      && strategy.universe.tickers.some((item) => item.toUpperCase() === ticker);
    if (inUniverse) {
      return true;
    }

    const searchPool = [
      strategy.name,
      strategy.description,
      ...(strategy.tags ?? []),
      ...(strategy.universe.tickers ?? []),
    ].map((value) => value.toUpperCase());
    return searchPool.some((value) => value.includes(ticker));
  }

  private async resolveBacktestWindow(ticker: string): Promise<{ startDate: string; endDate: string }> {
    const candles = await this.technicalStore.getLatestCandles(ticker, DEFAULT_LOOKBACK_DAYS).catch(() => []);
    if (candles.length > 10) {
      const startDate = candles[0]?.timestamp.toISOString();
      const endDate = candles[candles.length - 1]?.timestamp.toISOString();
      if (startDate && endDate) {
        return { startDate, endDate };
      }
    }

    const end = new Date();
    const start = new Date(end.getTime() - 365 * 24 * 60 * 60 * 1000);
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }

  private toPerformanceMetrics(result: SimulationResult): PerformanceMetrics {
    return {
      totalReturn: result.totalReturn,
      annualizedReturn: result.annualizedReturn,
      sharpeRatio: result.sharpeRatio,
      maxDrawdown: result.maxDrawdown,
      winRate: result.winRate,
      profitFactor: result.profitFactor,
      turnover: result.turnover,
      volatility: result.volatility,
      beta: result.beta,
      var95: result.var95,
    };
  }

  private computeDailyReturns(candles: DailyCandle[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < candles.length; i += 1) {
      const previous = candles[i - 1]?.close;
      const current = candles[i]?.close;
      if (!previous || current === undefined || previous <= 0) {
        continue;
      }
      returns.push(current / previous - 1);
    }
    return returns;
  }

  private computePeriodReturn(closes: number[], days: number): number {
    if (days <= 0 || closes.length <= days) {
      return 0;
    }
    const start = closes[closes.length - 1 - days];
    const end = closes[closes.length - 1];
    if (start === undefined || end === undefined || start <= 0) {
      return 0;
    }
    return end / start - 1;
  }

  private stdDev(values: number[]): number {
    if (values.length < 2) {
      return 0;
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => {
      const diff = value - mean;
      return sum + diff * diff;
    }, 0) / (values.length - 1);
    return Math.sqrt(Math.max(variance, 0));
  }
}

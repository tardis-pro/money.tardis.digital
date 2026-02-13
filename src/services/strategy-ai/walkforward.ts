import type { Strategy } from "./dsl/strategy-schema.js";
import {
  type EquityPoint,
  type PerformanceMetrics,
  type SimulationConfig,
  type SimulationResult,
  Simulator,
} from "./simulator.js";
import { TimescaleTechnicalStore } from "./ta-store.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EPSILON = 1e-9;

type OptimizationMetric = keyof PerformanceMetrics;

interface ParameterTrial {
  params: Record<string, number>;
  score: number;
  metrics: PerformanceMetrics;
}

interface FoldComputation {
  fold: FoldResult;
  outOfSample: OutOfSampleResult;
}

export interface WalkForwardConfig {
  trainPeriodDays: number;
  testPeriodDays: number;
  stepDays: number;
  numFolds?: number;
  optimizationMetric?: OptimizationMetric;
}

export interface FoldResult {
  trainStart: Date;
  trainEnd: Date;
  testStart: Date;
  testEnd: Date;
  trainMetrics: PerformanceMetrics;
  testMetrics: PerformanceMetrics;
  params: Record<string, number>;
  trainEquityCurve?: EquityPoint[];
  testEquityCurve?: EquityPoint[];
}

export interface InSampleResult {
  metrics: PerformanceMetrics;
  optimizedParams: OptimizedParams;
  paramsTried: ParameterTrial[];
}

export interface OutOfSampleResult {
  metrics: PerformanceMetrics;
  degradation: number;
  pValue: number;
}

export interface OptimizedParams {
  params: Record<string, number>;
  confidence: number;
  stability: number;
}

export interface WalkForwardResult {
  folds: FoldResult[];
  combinedMetrics: {
    train: PerformanceMetrics;
    test: PerformanceMetrics;
    degradation: number;
    pValue: number;
    confidenceIntervals: {
      totalReturn: { low: number; high: number };
      sharpeRatio: { low: number; high: number };
    };
  };
  stability: {
    metricStability: number;
    parameterStability: number;
    foldConsistency: number;
  };
  overfittingScore: number;
  optimalParams: OptimizedParams;
}

export interface EquityCurveData {
  fold: number;
  dates: string[];
  values: number[];
}

export interface MetricsData {
  labels: string[];
  datasets: Array<{
    label: string;
    values: number[];
  }>;
}

export interface ComparisonTable {
  strategies: string[];
  metrics: Array<{
    name: string;
    values: number[];
  }>;
  rankings: Array<{
    strategy: string;
    rank: number;
    score: number;
  }>;
}

export class WalkForwardAnalyzer {
  private readonly simulator: Simulator;
  private readonly taStore: TimescaleTechnicalStore;
  private optimizationMetric: OptimizationMetric = "sharpeRatio";
  private lastTrials: ParameterTrial[] = [];

  constructor(deps: { simulator: Simulator; taStore: TimescaleTechnicalStore }) {
    this.simulator = deps.simulator;
    this.taStore = deps.taStore;
  }

  async analyze(strategy: Strategy, config: WalkForwardConfig): Promise<WalkForwardResult> {
    this.validateConfig(config);
    this.optimizationMetric = config.optimizationMetric ?? "sharpeRatio";

    const dateRange = await this.resolveDateRange(strategy);
    const windows = this.buildRollingWindows(dateRange.start, dateRange.end, config);
    if (windows.length === 0) {
      throw new Error("No valid walk-forward windows could be generated for the provided periods");
    }

    const foldComputations: FoldComputation[] = [];
    const allParamMaps: Record<string, number>[] = [];

    for (const window of windows) {
      const inSample = await this.runInSample(strategy, window.trainStart, window.trainEnd);
      const tunedStrategy = this.applyParamsToStrategy(strategy, inSample.optimizedParams.params);
      const outOfSample = await this.runOutOfSample(tunedStrategy, window.testStart, window.testEnd);

      const trainMetric = this.pickMetric(inSample.metrics, this.optimizationMetric);
      const testMetric = this.pickMetric(outOfSample.metrics, this.optimizationMetric);
      outOfSample.degradation = this.computeRelativeDegradation(trainMetric, testMetric);

      allParamMaps.push(inSample.optimizedParams.params);

      const fold: FoldResult = {
        trainStart: window.trainStart,
        trainEnd: window.trainEnd,
        testStart: window.testStart,
        testEnd: window.testEnd,
        trainMetrics: inSample.metrics,
        testMetrics: outOfSample.metrics,
        params: inSample.optimizedParams.params,
      };
      if (this.lastTrainEquityCurve) {
        fold.trainEquityCurve = this.lastTrainEquityCurve;
      }
      if (this.lastTestEquityCurve) {
        fold.testEquityCurve = this.lastTestEquityCurve;
      }

      foldComputations.push({
        fold,
        outOfSample,
      });
    }

    const folds = foldComputations.map((entry) => entry.fold);
    const trainMetrics = folds.map((fold) => fold.trainMetrics);
    const testMetrics = folds.map((fold) => fold.testMetrics);
    const testReturns = testMetrics.map((metric) => metric.totalReturn);
    const testSharpes = testMetrics.map((metric) => metric.sharpeRatio);

    const ciTotalReturn = this.bootstrapConfidenceInterval(testReturns);
    const ciSharpe = this.bootstrapConfidenceInterval(testSharpes);

    const degradationValues = foldComputations.map((entry) => entry.outOfSample.degradation);
    const pValues = foldComputations.map((entry) => entry.outOfSample.pValue);

    const combinedMetrics = {
      train: this.aggregateMetrics(trainMetrics),
      test: this.aggregateMetrics(testMetrics),
      degradation: this.mean(degradationValues),
      pValue: this.combinePValuesFisher(pValues),
      confidenceIntervals: {
        totalReturn: ciTotalReturn,
        sharpeRatio: ciSharpe,
      },
    };

    const stability = {
      metricStability: this.stabilityScoreFromSeries(testReturns),
      parameterStability: this.parameterStabilityFromMaps(allParamMaps),
      foldConsistency: this.foldConsistency(folds),
    };

    const optimalParams = this.computeGlobalOptimalParams(folds);
    const overfittingScore = this.computeOverfittingScore(folds, degradationValues, pValues);

    return {
      folds,
      combinedMetrics,
      stability,
      overfittingScore,
      optimalParams,
    };
  }

  private lastTrainEquityCurve: EquityPoint[] | undefined;
  private lastTestEquityCurve: EquityPoint[] | undefined;

  async runInSample(strategy: Strategy, start: Date, end: Date): Promise<InSampleResult> {
    const candidateParams = this.buildCandidateParamSets(strategy);
    const trials: ParameterTrial[] = [];

    for (const params of candidateParams) {
      const candidateStrategy = this.applyParamsToStrategy(strategy, params);
      const result = await this.runSimulationWindow(candidateStrategy, start, end, "train");
      const score = this.pickMetric(result, this.optimizationMetric);
      trials.push({ params, score, metrics: result });
    }

    trials.sort((a, b) => b.score - a.score);
    const best = trials[0];
    if (!best) {
      throw new Error("Failed to produce in-sample trial results");
    }

    this.lastTrials = trials;
    const optimizedParams = this.computeOptimizedParamsFromTrials(trials);

    return {
      metrics: best.metrics,
      optimizedParams,
      paramsTried: trials,
    };
  }

  async runOutOfSample(strategy: Strategy, start: Date, end: Date): Promise<OutOfSampleResult> {
    const result = await this.runSimulationWindow(strategy, start, end, "test");
    const returns = this.equityCurveToReturns(this.lastTestEquityCurve ?? []);
    const pValue = this.bootstrapPValueAboveZero(returns);

    return {
      metrics: result,
      degradation: 0,
      pValue,
    };
  }

  computeOptimalParams(inSample: InSampleResult): OptimizedParams {
    if (inSample.optimizedParams) {
      return inSample.optimizedParams;
    }
    return this.computeOptimizedParamsFromTrials(inSample.paramsTried);
  }

  generateEquityCurves(result: WalkForwardResult): EquityCurveData[] {
    return result.folds.map((fold, index) => {
      const curve = fold.testEquityCurve ?? [];
      return {
        fold: index + 1,
        dates: curve.map((point) => point.date),
        values: curve.map((point) => point.equity),
      };
    });
  }

  generateMetricsChart(result: WalkForwardResult): MetricsData {
    return {
      labels: result.folds.map((_, index) => `Fold ${index + 1}`),
      datasets: [
        {
          label: "Train Sharpe",
          values: result.folds.map((fold) => fold.trainMetrics.sharpeRatio),
        },
        {
          label: "Test Sharpe",
          values: result.folds.map((fold) => fold.testMetrics.sharpeRatio),
        },
        {
          label: "Test Return",
          values: result.folds.map((fold) => fold.testMetrics.totalReturn),
        },
      ],
    };
  }

  generateComparisonTable(results: WalkForwardResult[]): ComparisonTable {
    const strategies = results.map((_, index) => `Strategy ${index + 1}`);
    const scoreRows = results.map((result) => this.comparisonScore(result));

    const rankings = strategies
      .map((strategy, index) => ({ strategy, score: scoreRows[index] ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));

    return {
      strategies,
      metrics: [
        {
          name: "Avg Test Return",
          values: results.map((result) => result.combinedMetrics.test.totalReturn),
        },
        {
          name: "Avg Test Sharpe",
          values: results.map((result) => result.combinedMetrics.test.sharpeRatio),
        },
        {
          name: "Overfitting Score",
          values: results.map((result) => result.overfittingScore),
        },
      ],
      rankings,
    };
  }

  private async resolveDateRange(strategy: Strategy): Promise<{ start: Date; end: Date }> {
    const baseConfig = this.getBaseSimulationConfig();
    let start = new Date(baseConfig.startDate);
    let end = new Date(baseConfig.endDate);

    const ticker = strategy.universe.mode === "custom_tickers" ? strategy.universe.tickers[0] : undefined;
    if (!ticker) {
      return { start, end };
    }

    try {
      const candles = await this.taStore.getCandles(ticker, start, end);
      const first = candles[0];
      const last = candles[candles.length - 1];
      if (first && last) {
        start = first.timestamp;
        end = last.timestamp;
      }
    } catch {
      return { start, end };
    }

    return { start, end };
  }

  private validateConfig(config: WalkForwardConfig): void {
    if (config.trainPeriodDays <= 0 || config.testPeriodDays <= 0 || config.stepDays <= 0) {
      throw new Error("trainPeriodDays, testPeriodDays and stepDays must be > 0");
    }
    if (config.numFolds !== undefined && config.numFolds <= 0) {
      throw new Error("numFolds must be > 0 when provided");
    }
  }

  private buildRollingWindows(start: Date, end: Date, config: WalkForwardConfig): Array<{
    trainStart: Date;
    trainEnd: Date;
    testStart: Date;
    testEnd: Date;
  }> {
    const windows: Array<{ trainStart: Date; trainEnd: Date; testStart: Date; testEnd: Date }> = [];
    let cursor = start.getTime();

    while (cursor <= end.getTime()) {
      const trainStart = new Date(cursor);
      const trainEnd = this.addDays(trainStart, config.trainPeriodDays - 1);
      const testStart = this.addDays(trainEnd, 1);
      const testEnd = this.addDays(testStart, config.testPeriodDays - 1);

      if (testEnd.getTime() > end.getTime()) {
        break;
      }

      windows.push({ trainStart, trainEnd, testStart, testEnd });

      if (config.numFolds !== undefined && windows.length >= config.numFolds) {
        break;
      }

      cursor = this.addDays(new Date(cursor), config.stepDays).getTime();
    }

    return windows;
  }

  private buildCandidateParamSets(strategy: Strategy): Record<string, number>[] {
    const current = this.extractCurrentParamMap(strategy);
    const keys = Object.keys(current);
    if (keys.length === 0) {
      return [{}];
    }

    const selectedKeys = keys.slice(0, 3);
    const scales = [0.8, 1, 1.2];

    const grid: Record<string, number>[] = [];
    const recurse = (index: number, partial: Record<string, number>): void => {
      if (index >= selectedKeys.length) {
        grid.push({ ...partial });
        return;
      }

      const key = selectedKeys[index];
      if (!key) {
        recurse(index + 1, partial);
        return;
      }

      const base = current[key];
      if (base === undefined) {
        recurse(index + 1, partial);
        return;
      }

      const bounds = this.paramBounds(key, base);
      for (const scale of scales) {
        partial[key] = this.roundValue(this.clamp(base * scale, bounds.min, bounds.max));
        recurse(index + 1, partial);
      }
    };

    recurse(0, {});

    const dedup = new Map<string, Record<string, number>>();
    for (const params of grid) {
      dedup.set(JSON.stringify(params), params);
    }

    return [...dedup.values()];
  }

  private extractCurrentParamMap(strategy: Strategy): Record<string, number> {
    const params: Record<string, number> = {};
    const sizing = strategy.riskParams.positionSizing;

    if (sizing.riskPerTradePct !== undefined) {
      params["riskParams.positionSizing.riskPerTradePct"] = sizing.riskPerTradePct;
    }
    params["riskParams.positionSizing.maxPositionSizePct"] = sizing.maxPositionSizePct;
    params["riskParams.maxDrawdownPct"] = strategy.riskParams.maxDrawdownPct;

    if (strategy.riskParams.stopLoss.value !== undefined) {
      params["riskParams.stopLoss.value"] = strategy.riskParams.stopLoss.value;
    }
    if (strategy.riskParams.takeProfit?.value !== undefined) {
      params["riskParams.takeProfit.value"] = strategy.riskParams.takeProfit.value;
    }

    return params;
  }

  private applyParamsToStrategy(strategy: Strategy, params: Record<string, number>): Strategy {
    const clone = structuredClone(strategy);
    for (const [path, value] of Object.entries(params)) {
      this.setNestedNumber(clone as Record<string, unknown>, path, value);
    }
    clone.updatedAt = new Date().toISOString();
    return clone;
  }

  private setNestedNumber(target: Record<string, unknown>, path: string, value: number): void {
    const segments = path.split(".");
    let node: Record<string, unknown> = target;

    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      if (!segment) {
        return;
      }
      if (i === segments.length - 1) {
        node[segment] = value;
        return;
      }

      const next = node[segment];
      if (typeof next !== "object" || next === null || Array.isArray(next)) {
        return;
      }

      node = next as Record<string, unknown>;
    }
  }

  private async runSimulationWindow(
    strategy: Strategy,
    start: Date,
    end: Date,
    phase: "train" | "test",
  ): Promise<PerformanceMetrics> {
    const base = this.getBaseSimulationConfig();
    const windowSimulator = new Simulator({
      ...base,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });
    const result = await windowSimulator.run(strategy);

    const metrics = this.toPerformanceMetrics(result);
    const equity = result.equityCurve;
    if (phase === "train") {
      this.lastTrainEquityCurve = equity;
    } else {
      this.lastTestEquityCurve = equity;
    }

    return metrics;
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

  private getBaseSimulationConfig(): SimulationConfig {
    const config = (this.simulator as unknown as { config?: SimulationConfig }).config;
    if (!config) {
      throw new Error("Simulator base configuration is unavailable");
    }
    return config;
  }

  private computeOptimizedParamsFromTrials(trials: ParameterTrial[]): OptimizedParams {
    const best = trials[0];
    if (!best) {
      return { params: {}, confidence: 0, stability: 0 };
    }

    const scores = trials.map((trial) => trial.score);
    const ci = this.bootstrapConfidenceInterval(scores);
    const meanScore = this.mean(scores);
    const ciWidth = Math.abs(ci.high - ci.low);
    const confidence = this.clamp01(1 - ciWidth / (Math.abs(meanScore) + EPSILON));

    const topCount = Math.max(1, Math.ceil(trials.length * 0.25));
    const topParams = trials.slice(0, topCount).map((trial) => trial.params);
    const stability = this.parameterStabilityFromMaps(topParams);

    return {
      params: best.params,
      confidence,
      stability,
    };
  }

  private computeGlobalOptimalParams(folds: FoldResult[]): OptimizedParams {
    const params = folds.map((fold) => fold.params);
    const aggregate: Record<string, number> = {};
    const keys = [...new Set(params.flatMap((param) => Object.keys(param)))];

    for (const key of keys) {
      const values = params.map((param) => param[key]).filter((value): value is number => value !== undefined);
      aggregate[key] = this.mean(values);
    }

    const confidence = this.clamp01(this.stabilityScoreFromSeries(folds.map((fold) => fold.testMetrics.sharpeRatio)));
    const stability = this.parameterStabilityFromMaps(params);

    return {
      params: aggregate,
      confidence,
      stability,
    };
  }

  private computeOverfittingScore(folds: FoldResult[], degradationValues: number[], pValues: number[]): number {
    const trainScores = folds.map((fold) => this.pickMetric(fold.trainMetrics, this.optimizationMetric));
    const testScores = folds.map((fold) => this.pickMetric(fold.testMetrics, this.optimizationMetric));
    const relativeGap = this.computeRelativeDegradation(this.mean(trainScores), this.mean(testScores));
    const degradation = this.mean(degradationValues);
    const weakSignificance = this.mean(pValues.map((p) => this.clamp01(p / 0.5)));
    return this.clamp01(relativeGap * 0.5 + degradation * 0.3 + weakSignificance * 0.2);
  }

  private pickMetric(metrics: PerformanceMetrics, metric: OptimizationMetric): number {
    const value = metrics[metric];
    if (!Number.isFinite(value)) {
      return 0;
    }
    if (metric === "maxDrawdown" || metric === "volatility" || metric === "var95") {
      return -Math.abs(value);
    }
    return value;
  }

  private aggregateMetrics(metrics: PerformanceMetrics[]): PerformanceMetrics {
    if (metrics.length === 0) {
      return {
        totalReturn: 0,
        annualizedReturn: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        winRate: 0,
        profitFactor: 0,
        turnover: 0,
        volatility: 0,
        beta: 0,
        var95: 0,
      };
    }

    return {
      totalReturn: this.mean(metrics.map((m) => m.totalReturn)),
      annualizedReturn: this.mean(metrics.map((m) => m.annualizedReturn)),
      sharpeRatio: this.mean(metrics.map((m) => m.sharpeRatio)),
      maxDrawdown: this.mean(metrics.map((m) => m.maxDrawdown)),
      winRate: this.mean(metrics.map((m) => m.winRate)),
      profitFactor: this.mean(metrics.map((m) => m.profitFactor)),
      turnover: this.mean(metrics.map((m) => m.turnover)),
      volatility: this.mean(metrics.map((m) => m.volatility)),
      beta: this.mean(metrics.map((m) => m.beta)),
      var95: this.mean(metrics.map((m) => m.var95)),
    };
  }

  private equityCurveToReturns(equityCurve: EquityPoint[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i += 1) {
      const prev = equityCurve[i - 1];
      const curr = equityCurve[i];
      if (!prev || !curr || prev.equity === 0) {
        continue;
      }
      returns.push(curr.equity / prev.equity - 1);
    }
    return returns;
  }

  private bootstrapConfidenceInterval(values: number[], iterations: number = 500): { low: number; high: number } {
    if (values.length === 0) {
      return { low: 0, high: 0 };
    }
    if (values.length === 1) {
      const only = values[0] ?? 0;
      return { low: only, high: only };
    }

    const estimates: number[] = [];
    for (let i = 0; i < iterations; i += 1) {
      const sample: number[] = [];
      for (let j = 0; j < values.length; j += 1) {
        const idx = Math.floor(Math.random() * values.length);
        const sampled = values[idx];
        if (sampled !== undefined) {
          sample.push(sampled);
        }
      }
      estimates.push(this.mean(sample));
    }

    estimates.sort((a, b) => a - b);
    const low = estimates[Math.floor(iterations * 0.025)] ?? estimates[0] ?? 0;
    const high = estimates[Math.floor(iterations * 0.975)] ?? estimates[estimates.length - 1] ?? 0;
    return { low, high };
  }

  private bootstrapPValueAboveZero(values: number[], iterations: number = 400): number {
    if (values.length === 0) {
      return 1;
    }

    const observed = this.mean(values);
    let extremeCount = 0;
    for (let i = 0; i < iterations; i += 1) {
      const sample: number[] = [];
      for (let j = 0; j < values.length; j += 1) {
        const idx = Math.floor(Math.random() * values.length);
        const sampled = values[idx];
        if (sampled !== undefined) {
          sample.push(sampled - observed);
        }
      }
      if (this.mean(sample) >= observed) {
        extremeCount += 1;
      }
    }

    return this.clamp01((extremeCount + 1) / (iterations + 1));
  }

  private combinePValuesFisher(pValues: number[]): number {
    const sanitized = pValues.map((p) => this.clamp(p, EPSILON, 1));
    if (sanitized.length === 0) {
      return 1;
    }
    const stat = -2 * sanitized.reduce((sum, p) => sum + Math.log(p), 0);
    return this.clamp01(Math.exp(-0.5 * stat));
  }

  private computeRelativeDegradation(train: number, test: number): number {
    if (!Number.isFinite(train) || Math.abs(train) < EPSILON) {
      return 0;
    }
    return this.clamp01((train - test) / (Math.abs(train) + EPSILON));
  }

  private parameterStabilityFromMaps(paramMaps: Record<string, number>[]): number {
    if (paramMaps.length <= 1) {
      return 1;
    }

    const keys = [...new Set(paramMaps.flatMap((params) => Object.keys(params)))];
    if (keys.length === 0) {
      return 1;
    }

    const perKeyStability = keys.map((key) => {
      const values = paramMaps
        .map((params) => params[key])
        .filter((value): value is number => value !== undefined);
      if (values.length <= 1) {
        return 1;
      }
      const mu = this.mean(values);
      const sd = Math.sqrt(this.variance(values));
      const cv = sd / (Math.abs(mu) + EPSILON);
      return this.clamp01(1 - cv);
    });

    return this.mean(perKeyStability);
  }

  private foldConsistency(folds: FoldResult[]): number {
    if (folds.length <= 1) {
      return 1;
    }
    const directionalHits = folds.map((fold) => {
      const trainSign = Math.sign(fold.trainMetrics.totalReturn);
      const testSign = Math.sign(fold.testMetrics.totalReturn);
      return trainSign === testSign ? 1 : 0;
    });
    return this.mean(directionalHits);
  }

  private stabilityScoreFromSeries(values: number[]): number {
    if (values.length <= 1) {
      return 1;
    }
    const mu = this.mean(values);
    const sd = Math.sqrt(this.variance(values));
    const cv = sd / (Math.abs(mu) + EPSILON);
    return this.clamp01(1 - cv);
  }

  private paramBounds(path: string, fallback: number): { min: number; max: number } {
    switch (path) {
      case "riskParams.positionSizing.riskPerTradePct":
      case "riskParams.positionSizing.maxPositionSizePct":
      case "riskParams.maxDrawdownPct":
        return { min: 0.001, max: 1 };
      case "riskParams.stopLoss.value":
        return { min: 0.001, max: 5 };
      case "riskParams.takeProfit.value":
        return { min: 0.001, max: 10 };
      default:
        return { min: fallback * 0.5, max: fallback * 1.5 };
    }
  }

  private comparisonScore(result: WalkForwardResult): number {
    const testReturn = result.combinedMetrics.test.totalReturn;
    const testSharpe = result.combinedMetrics.test.sharpeRatio;
    const overfitPenalty = result.overfittingScore;
    return testReturn * 0.5 + testSharpe * 0.35 - overfitPenalty * 0.15;
  }

  private addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * MS_PER_DAY);
  }

  private mean(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private variance(values: number[]): number {
    if (values.length <= 1) {
      return 0;
    }
    const mu = this.mean(values);
    return values.reduce((sum, value) => {
      const diff = value - mu;
      return sum + diff * diff;
    }, 0) / values.length;
  }

  private roundValue(value: number): number {
    return Number(value.toFixed(6));
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.max(min, Math.min(max, value));
  }

  private clamp01(value: number): number {
    return this.clamp(value, 0, 1);
  }
}

import type { Strategy } from "./dsl/strategy-schema.js";
import type { Ranker } from "./ranker.js";
import type { SimulationResult } from "./simulator.js";
import { StrategyStore } from "./store.js";

const TRADING_DAYS_PER_YEAR = 252;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_FRONTIER_POINTS = 20;

export interface Portfolio {
  id: string;
  name: string;
  weights: Record<string, number>;
  expectedReturn: number;
  volatility: number;
  createdAt: string;
}

export interface OptimizationConstraints {
  maxWeight?: number;
  minWeight?: number;
  maxStrategyRisk?: number;
  targetVolatility?: number;
}

export interface MarketView {
  strategyId: string;
  return: number;
  confidence: number;
}

export interface BacktestResult {
  portfolio: Portfolio;
  equityCurve: Array<{ date: string; equity: number; drawdown: number }>;
  metrics: {
    totalReturn: number;
    annualizedReturn: number;
    volatility: number;
    sharpeRatio: number;
    maxDrawdown: number;
    var: number;
    cvar: number;
  };
  trades: Array<{ date: string; strategyId: string; action: "rebalance"; weight: number }>;
}

export interface EfficientFrontierPoint {
  return: number;
  volatility: number;
  weights: Record<string, number>;
}

export interface RiskAnalysis {
  correlationMatrix: Record<string, Record<string, number>>;
  factorExposure: {
    sector: Record<string, number>;
    regime: Record<string, number>;
  };
  stressTests: Array<{
    scenario: string;
    expectedReturnShift: number;
    projectedLoss: number;
  }>;
}

interface StrategyStats {
  strategy: Strategy;
  expectedReturn: number;
  volatility: number;
  downsideRisk: number;
  sampleReturns: number[];
}

interface PreparedData {
  strategies: Strategy[];
  ids: string[];
  stats: StrategyStats[];
  expectedReturns: number[];
  covariance: number[][];
}

type SimMetrics = Partial<SimulationResult> & Record<string, unknown>;

export class PortfolioOptimizer {
  private readonly store: StrategyStore;
  private readonly ranker: Ranker;

  constructor(deps: { store: StrategyStore; ranker: Ranker }) {
    this.store = deps.store;
    this.ranker = deps.ranker;
  }

  async optimizeMeanVariance(strategies: Strategy[], constraints?: OptimizationConstraints): Promise<Portfolio> {
    const prepared = await this.prepareData(strategies);
    const best = this.optimizeMeanVarianceWeights(prepared.expectedReturns, prepared.covariance, prepared.stats, constraints);
    return this.toPortfolio("mean-variance", prepared.ids, best.weights, prepared.expectedReturns, prepared.covariance);
  }

  async optimizeRiskParity(strategies: Strategy[]): Promise<Portfolio> {
    const prepared = await this.prepareData(strategies);
    const n = prepared.ids.length;
    let weights = Array.from({ length: n }, () => 1 / n);

    for (let iter = 0; iter < 200; iter += 1) {
      const marginal = matVec(prepared.covariance, weights);
      const vol = Math.sqrt(Math.max(1e-12, dot(weights, marginal)));
      const totalRisk = vol;
      const targetContribution = totalRisk / n;

      for (let i = 0; i < n; i += 1) {
        const m = marginal[i] ?? 0;
        const contribution = vol === 0 ? 0 : ((weights[i] ?? 0) * m) / vol;
        if (contribution > 0) {
          weights[i] = (weights[i] ?? 0) * (targetContribution / contribution);
        }
      }

      weights = normalizeWeights(weights);
    }

    return this.toPortfolio("risk-parity", prepared.ids, weights, prepared.expectedReturns, prepared.covariance);
  }

  async optimizeMinimumVariance(strategies: Strategy[]): Promise<Portfolio> {
    const prepared = await this.prepareData(strategies);
    const n = prepared.ids.length;
    let weights = Array.from({ length: n }, () => 1 / n);

    for (let iter = 0; iter < 300; iter += 1) {
      const gradient = matVec(prepared.covariance, weights).map((v) => 2 * v);
      const step = 0.03 / Math.sqrt(iter + 1);
      const candidate = weights.map((w, i) => w - step * (gradient[i] ?? 0));
      weights = normalizeWeights(candidate);
    }

    return this.toPortfolio("minimum-variance", prepared.ids, weights, prepared.expectedReturns, prepared.covariance);
  }

  async optimizeTargetReturn(strategies: Strategy[], targetReturn: number): Promise<Portfolio> {
    const prepared = await this.prepareData(strategies);
    const n = prepared.ids.length;
    let weights = Array.from({ length: n }, () => 1 / n);
    const penalty = 12;

    for (let iter = 0; iter < 350; iter += 1) {
      const portfolioReturn = dot(weights, prepared.expectedReturns);
      const varianceGradient = matVec(prepared.covariance, weights).map((v) => 2 * v);
      const returnPenaltyGradient = prepared.expectedReturns.map((mu) => 2 * penalty * (portfolioReturn - targetReturn) * mu);
      const gradient = varianceGradient.map((v, i) => v + (returnPenaltyGradient[i] ?? 0));
      const step = 0.02 / Math.sqrt(iter + 1);
      const candidate = weights.map((w, i) => w - step * (gradient[i] ?? 0));
      weights = normalizeWeights(candidate);
    }

    return this.toPortfolio("target-return", prepared.ids, weights, prepared.expectedReturns, prepared.covariance);
  }

  async optimizeBlackLitterman(strategies: Strategy[], views: MarketView[]): Promise<Portfolio> {
    const prepared = await this.prepareData(strategies);
    const n = prepared.ids.length;
    const marketWeights = Array.from({ length: n }, () => 1 / n);
    const delta = 2.5;
    const tau = 0.05;

    const equilibrium = matVec(prepared.covariance, marketWeights).map((x) => delta * x);
    const scaledCov = scaleMatrix(prepared.covariance, tau);
    const scaledCovInv = invertMatrixWithRidge(scaledCov, 1e-6);

    const p: number[][] = [];
    const q: number[] = [];
    const omegaDiag: number[] = [];

    for (const view of views) {
      const idx = prepared.ids.indexOf(view.strategyId);
      if (idx < 0) {
        continue;
      }
      const row = Array.from({ length: n }, () => 0);
      row[idx] = 1;
      p.push(row);
      q.push(view.return);

      const variance = prepared.covariance[idx]?.[idx] ?? 0.04;
      const confidence = clamp(view.confidence, 0.01, 0.999);
      omegaDiag.push(variance / confidence);
    }

    if (p.length === 0) {
      return this.optimizeMeanVariance(strategies);
    }

    const pt = transpose(p);
    const omegaInv = invertDiagonal(omegaDiag);
    const left = addMatrix(scaledCovInv, multiplyMatrix(multiplyMatrix(pt, omegaInv), p));
    const right = addVec(matVec(scaledCovInv, equilibrium), matVec(multiplyMatrix(pt, omegaInv), q));
    const posterior = matVec(invertMatrixWithRidge(left, 1e-6), right);

    const optimized = this.optimizeMeanVarianceWeights(posterior, prepared.covariance, prepared.stats);
    return this.toPortfolio("black-litterman", prepared.ids, optimized.weights, posterior, prepared.covariance);
  }

  async backtestPortfolio(portfolio: Portfolio, from: Date, to: Date): Promise<BacktestResult> {
    const fromTime = from.getTime();
    const toTime = to.getTime();
    if (toTime < fromTime) {
      throw new Error("Backtest 'to' must be >= 'from'");
    }

    const strategyIds = Object.keys(portfolio.weights);
    const totalDays = Math.max(1, Math.floor((toTime - fromTime) / MS_PER_DAY));
    const startDate = new Date(fromTime).toISOString();
    const trades = strategyIds.map((strategyId) => ({
      date: startDate,
      strategyId,
      action: "rebalance" as const,
      weight: portfolio.weights[strategyId] ?? 0,
    }));

    const seriesByStrategy = new Map<string, Array<{ date: string; value: number }>>();
    for (const strategyId of strategyIds) {
      const runs = await this.store.listSimRuns(strategyId);
      const curve = this.extractNormalizedCurve(runs);
      if (curve.length > 1) {
        seriesByStrategy.set(strategyId, curve);
        continue;
      }

      const fallback = this.syntheticCurveFromPortfolio(portfolio, strategyId, fromTime, totalDays);
      seriesByStrategy.set(strategyId, fallback);
    }

    const equityCurve: Array<{ date: string; equity: number; drawdown: number }> = [];
    let peak = 1;
    for (let i = 0; i <= totalDays; i += 1) {
      const ts = fromTime + i * MS_PER_DAY;
      if (ts > toTime) {
        break;
      }
      const date = new Date(ts).toISOString();

      let equity = 0;
      for (const strategyId of strategyIds) {
        const w = portfolio.weights[strategyId] ?? 0;
        const curve = seriesByStrategy.get(strategyId);
        const v = this.valueOnDate(curve, date, i);
        equity += w * v;
      }

      peak = Math.max(peak, equity);
      const drawdown = peak === 0 ? 0 : equity / peak - 1;
      equityCurve.push({ date, equity, drawdown });
    }

    const metrics = this.computeBacktestMetrics(equityCurve);
    return {
      portfolio,
      equityCurve,
      metrics,
      trades,
    };
  }

  async rollingOptimization(portfolio: Portfolio, windowDays: number, rebalanceDays: number): Promise<Portfolio[]> {
    if (windowDays <= 0 || rebalanceDays <= 0) {
      throw new Error("windowDays and rebalanceDays must be > 0");
    }

    const strategyIds = Object.keys(portfolio.weights);
    const strategyList = await this.store.listStrategies({ limit: 10_000, offset: 0 });
    const selected = strategyList.filter((strategy) => strategyIds.includes(strategy.id));
    if (selected.length === 0) {
      return [];
    }

    const outputs: Portfolio[] = [];
    const start = new Date(portfolio.createdAt).getTime();
    const end = Date.now();

    for (let current = start + windowDays * MS_PER_DAY; current <= end; current += rebalanceDays * MS_PER_DAY) {
      const optimized = await this.optimizeMeanVariance(selected);
      outputs.push({
        ...optimized,
        id: `${portfolio.id}-roll-${new Date(current).toISOString().slice(0, 10)}`,
        name: `${portfolio.name} Rolling`,
        createdAt: new Date(current).toISOString(),
      });
    }

    return outputs;
  }

  async computeEfficientFrontier(strategies: Strategy[]): Promise<EfficientFrontierPoint[]> {
    const prepared = await this.prepareData(strategies);
    const minRet = Math.min(...prepared.expectedReturns);
    const maxRet = Math.max(...prepared.expectedReturns);
    if (!Number.isFinite(minRet) || !Number.isFinite(maxRet)) {
      return [];
    }

    const points: EfficientFrontierPoint[] = [];
    const denominator = Math.max(1, DEFAULT_FRONTIER_POINTS - 1);

    for (let i = 0; i < DEFAULT_FRONTIER_POINTS; i += 1) {
      const alpha = i / denominator;
      const target = minRet + (maxRet - minRet) * alpha;
      const optimized = this.optimizeTargetReturnWeights(prepared.expectedReturns, prepared.covariance, target);
      points.push({
        return: dot(optimized, prepared.expectedReturns),
        volatility: Math.sqrt(Math.max(0, quadraticForm(optimized, prepared.covariance))),
        weights: toWeightMap(prepared.ids, optimized),
      });
    }

    return points;
  }

  async analyzePortfolioRisk(portfolio: Portfolio): Promise<RiskAnalysis> {
    const strategyIds = Object.keys(portfolio.weights);
    const allStrategies = await this.store.listStrategies({ limit: 10_000, offset: 0 });
    const selected = allStrategies.filter((strategy) => strategyIds.includes(strategy.id));
    const prepared = await this.prepareData(selected);

    const correlationMatrix: Record<string, Record<string, number>> = {};
    for (let i = 0; i < prepared.ids.length; i += 1) {
      const row: Record<string, number> = {};
      for (let j = 0; j < prepared.ids.length; j += 1) {
        const c = covarianceToCorrelation(prepared.covariance, i, j);
        const id = prepared.ids[j];
        if (id) {
          row[id] = c;
        }
      }
      const rowId = prepared.ids[i];
      if (rowId) {
        correlationMatrix[rowId] = row;
      }
    }

    const factorExposure = {
      sector: {} as Record<string, number>,
      regime: {} as Record<string, number>,
    };

    for (const strategy of selected) {
      const weight = portfolio.weights[strategy.id] ?? 0;
      const sector = strategy.sector ?? "unknown";
      const regime = strategy.regime ?? "unknown";
      factorExposure.sector[sector] = (factorExposure.sector[sector] ?? 0) + weight;
      factorExposure.regime[regime] = (factorExposure.regime[regime] ?? 0) + weight;
    }

    const stressTests = [
      {
        scenario: "market-crash",
        expectedReturnShift: -0.25,
        projectedLoss: Math.max(0, 2.2 * portfolio.volatility),
      },
      {
        scenario: "volatility-spike",
        expectedReturnShift: -0.12,
        projectedLoss: Math.max(0, 1.5 * portfolio.volatility),
      },
      {
        scenario: "sector-rotation",
        expectedReturnShift: -0.08,
        projectedLoss: Math.max(0, 0.9 * portfolio.volatility),
      },
    ];

    return {
      correlationMatrix,
      factorExposure,
      stressTests,
    };
  }

  computeVaR(portfolio: Portfolio, confidence: number): number {
    const c = clamp(confidence, 0.5, 0.999);
    const z = inverseNormal(c);
    const dailyMu = portfolio.expectedReturn / TRADING_DAYS_PER_YEAR;
    const dailySigma = portfolio.volatility / Math.sqrt(TRADING_DAYS_PER_YEAR);
    return Math.max(0, z * dailySigma - dailyMu);
  }

  computeCVaR(portfolio: Portfolio, confidence: number): number {
    const c = clamp(confidence, 0.5, 0.999);
    const z = inverseNormal(c);
    const dailyMu = portfolio.expectedReturn / TRADING_DAYS_PER_YEAR;
    const dailySigma = portfolio.volatility / Math.sqrt(TRADING_DAYS_PER_YEAR);
    const tailDensity = normalPdf(z) / (1 - c);
    return Math.max(0, dailySigma * tailDensity - dailyMu);
  }

  private async prepareData(strategies: Strategy[]): Promise<PreparedData> {
    if (strategies.length === 0) {
      throw new Error("At least one strategy is required for optimization");
    }

    const ids = strategies.map((strategy) => strategy.id);
    const rankingMap = await this.loadRankingProxy(strategies.length);
    const stats: StrategyStats[] = [];

    for (const strategy of strategies) {
      const runs = await this.store.listSimRuns(strategy.id);
      const runReturns = runs
        .map((run) => this.extractAnnualizedReturn(run.metrics as SimMetrics))
        .filter((value): value is number => Number.isFinite(value));

      const expectedReturn = runReturns.length > 0
        ? mean(runReturns)
        : (rankingMap.get(strategy.id) ?? 0.08);

      const runVols = runs
        .map((run) => this.extractVolatility(run.metrics as SimMetrics))
        .filter((value): value is number => Number.isFinite(value));

      const volatility = runVols.length > 0
        ? Math.max(0.01, mean(runVols))
        : Math.max(0.08, Math.abs(expectedReturn) * 1.4);

      const downside = runs
        .map((run) => this.extractDrawdown(run.metrics as SimMetrics))
        .filter((value): value is number => Number.isFinite(value));

      stats.push({
        strategy,
        expectedReturn,
        volatility,
        downsideRisk: downside.length > 0 ? mean(downside.map((v) => Math.abs(v))) : volatility * 0.65,
        sampleReturns: runReturns.length > 0 ? runReturns : syntheticReturnSamples(strategy.id, expectedReturn, volatility),
      });
    }

    const expectedReturns = stats.map((s) => s.expectedReturn);
    const covariance = buildCovarianceMatrix(stats);

    return {
      strategies,
      ids,
      stats,
      expectedReturns,
      covariance,
    };
  }

  private async loadRankingProxy(n: number): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    try {
      const rankings = await this.ranker.getTopStrategies(Math.max(10, n * 4));
      for (const rank of rankings) {
        const proxyReturn = rank.returnScore / 100 * 0.35 - 0.05;
        map.set(rank.strategyId, proxyReturn);
      }
    } catch {
      return map;
    }
    return map;
  }

  private optimizeMeanVarianceWeights(
    expectedReturns: number[],
    covariance: number[][],
    stats: StrategyStats[],
    constraints?: OptimizationConstraints,
  ): { weights: number[]; score: number } {
    const n = expectedReturns.length;
    const lambdas = [0.4, 0.7, 1.0, 1.5, 2.0, 3.0, 4.5, 6.0];
    let best = {
      weights: Array.from({ length: n }, () => 1 / n),
      score: Number.NEGATIVE_INFINITY,
    };

    for (const lambda of lambdas) {
      let weights = Array.from({ length: n }, () => 1 / n);
      for (let iter = 0; iter < 260; iter += 1) {
        const gradient = expectedReturns.map((mu, i) => mu - lambda * (matVec(covariance, weights)[i] ?? 0));
        const step = 0.04 / Math.sqrt(iter + 1);
        const candidate = weights.map((w, i) => w + step * (gradient[i] ?? 0));
        weights = this.projectWeights(candidate, stats, constraints);
      }

      const adjusted = this.applyTargetVolatility(weights, covariance, constraints?.targetVolatility);
      const portfolioReturn = dot(adjusted, expectedReturns);
      const portfolioVol = Math.sqrt(Math.max(1e-12, quadraticForm(adjusted, covariance)));
      const sharpe = portfolioVol === 0 ? 0 : portfolioReturn / portfolioVol;

      if (sharpe > best.score) {
        best = { weights: adjusted, score: sharpe };
      }
    }

    return best;
  }

  private optimizeTargetReturnWeights(expectedReturns: number[], covariance: number[][], targetReturn: number): number[] {
    const n = expectedReturns.length;
    let weights = Array.from({ length: n }, () => 1 / n);
    const penalty = 15;

    for (let iter = 0; iter < 320; iter += 1) {
      const pReturn = dot(weights, expectedReturns);
      const varGrad = matVec(covariance, weights).map((v) => 2 * v);
      const retGrad = expectedReturns.map((mu) => 2 * penalty * (pReturn - targetReturn) * mu);
      const grad = varGrad.map((v, i) => v + (retGrad[i] ?? 0));
      const step = 0.02 / Math.sqrt(iter + 1);
      const candidate = weights.map((w, i) => w - step * (grad[i] ?? 0));
      weights = normalizeWeights(candidate);
    }

    return weights;
  }

  private projectWeights(weights: number[], stats: StrategyStats[], constraints?: OptimizationConstraints): number[] {
    const minWeight = clamp(constraints?.minWeight ?? 0, 0, 1);
    const maxWeight = clamp(constraints?.maxWeight ?? 1, minWeight, 1);
    const constrained = [...weights];

    for (let i = 0; i < constrained.length; i += 1) {
      const vol = stats[i]?.volatility ?? 0.2;
      const maxRiskBound = constraints?.maxStrategyRisk !== undefined
        ? clamp(constraints.maxStrategyRisk / Math.max(1e-6, vol), minWeight, maxWeight)
        : maxWeight;
      constrained[i] = clamp(constrained[i] ?? 0, minWeight, maxRiskBound);
    }

    return normalizeWeights(constrained);
  }

  private applyTargetVolatility(weights: number[], covariance: number[][], targetVolatility?: number): number[] {
    if (targetVolatility === undefined || targetVolatility <= 0) {
      return weights;
    }

    const currentVol = Math.sqrt(Math.max(1e-12, quadraticForm(weights, covariance)));
    if (currentVol <= targetVolatility) {
      return weights;
    }

    const n = weights.length;
    const equal = Array.from({ length: n }, () => 1 / n);
    const minVar = this.optimizeTargetReturnWeights(Array.from({ length: n }, () => 0), covariance, 0);

    let best = weights;
    let bestDiff = Math.abs(currentVol - targetVolatility);
    for (let a = 0; a <= 20; a += 1) {
      const alpha = a / 20;
      const blend = normalizeWeights(weights.map((w, i) => (1 - alpha) * w + alpha * ((minVar[i] ?? 0) * 0.85 + (equal[i] ?? 0) * 0.15)));
      const vol = Math.sqrt(Math.max(1e-12, quadraticForm(blend, covariance)));
      const diff = Math.abs(vol - targetVolatility);
      if (diff < bestDiff) {
        best = blend;
        bestDiff = diff;
      }
    }

    return best;
  }

  private toPortfolio(
    kind: string,
    ids: string[],
    weights: number[],
    expectedReturns: number[],
    covariance: number[][],
  ): Portfolio {
    const pReturn = dot(weights, expectedReturns);
    const pVol = Math.sqrt(Math.max(0, quadraticForm(weights, covariance)));
    return {
      id: `portfolio-${kind}-${Date.now()}`,
      name: `Portfolio ${kind}`,
      weights: toWeightMap(ids, weights),
      expectedReturn: pReturn,
      volatility: pVol,
      createdAt: new Date().toISOString(),
    };
  }

  private extractAnnualizedReturn(metrics: SimMetrics): number {
    const annualized = toNumber(metrics.annualizedReturn);
    if (annualized !== null) {
      return annualized;
    }
    const total = toNumber(metrics.totalReturn);
    if (total !== null) {
      return total;
    }
    return 0.08;
  }

  private extractVolatility(metrics: SimMetrics): number {
    const vol = toNumber(metrics.volatility);
    if (vol !== null) {
      return Math.abs(vol);
    }
    const var95 = toNumber(metrics.var95);
    if (var95 !== null) {
      return Math.abs(var95) * Math.sqrt(TRADING_DAYS_PER_YEAR / 2);
    }
    return 0.15;
  }

  private extractDrawdown(metrics: SimMetrics): number {
    const dd = toNumber(metrics.maxDrawdown);
    return dd ?? 0;
  }

  private extractNormalizedCurve(runs: Array<{ equityCurve?: unknown[] }>): Array<{ date: string; value: number }> {
    for (const run of runs) {
      const raw = run.equityCurve;
      if (!Array.isArray(raw) || raw.length < 2) {
        continue;
      }
      const parsed = raw
        .map((point) => {
          const date = typeof (point as { date?: unknown }).date === "string" ? (point as { date: string }).date : null;
          const equity = toNumber((point as { equity?: unknown }).equity);
          if (!date || equity === null) {
            return null;
          }
          return { date, equity };
        })
        .filter((point): point is { date: string; equity: number } => point !== null)
        .sort((a, b) => a.date.localeCompare(b.date));

      if (parsed.length < 2) {
        continue;
      }

      const first = parsed[0]?.equity ?? 1;
      if (first === 0) {
        continue;
      }

      return parsed.map((point) => ({
        date: point.date,
        value: point.equity / first,
      }));
    }

    return [];
  }

  private syntheticCurveFromPortfolio(portfolio: Portfolio, strategyId: string, fromTs: number, days: number): Array<{ date: string; value: number }> {
    const w = portfolio.weights[strategyId] ?? 0;
    const mu = portfolio.expectedReturn * (w === 0 ? 1 : Math.max(0.3, w));
    const sigma = Math.max(0.04, portfolio.volatility * (0.6 + w));
    const series: Array<{ date: string; value: number }> = [];
    let value = 1;

    for (let i = 0; i <= days; i += 1) {
      const dailyMu = mu / TRADING_DAYS_PER_YEAR;
      const shock = (hashNoise(`${strategyId}:${i}`) - 0.5) * sigma / 12;
      value *= Math.max(0.9, 1 + dailyMu + shock);
      series.push({
        date: new Date(fromTs + i * MS_PER_DAY).toISOString(),
        value,
      });
    }

    return series;
  }

  private valueOnDate(curve: Array<{ date: string; value: number }> | undefined, date: string, idx: number): number {
    if (!curve || curve.length === 0) {
      return 1;
    }
    if (idx < curve.length) {
      return curve[idx]?.value ?? 1;
    }

    const found = curve.find((point) => point.date >= date);
    if (found) {
      return found.value;
    }

    return curve[curve.length - 1]?.value ?? 1;
  }

  private computeBacktestMetrics(equityCurve: Array<{ date: string; equity: number; drawdown: number }>): BacktestResult["metrics"] {
    if (equityCurve.length < 2) {
      return {
        totalReturn: 0,
        annualizedReturn: 0,
        volatility: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        var: 0,
        cvar: 0,
      };
    }

    const start = equityCurve[0]?.equity ?? 1;
    const end = equityCurve[equityCurve.length - 1]?.equity ?? 1;
    const totalReturn = start === 0 ? 0 : end / start - 1;
    const dailyReturns: number[] = [];
    for (let i = 1; i < equityCurve.length; i += 1) {
      const prev = equityCurve[i - 1]?.equity;
      const curr = equityCurve[i]?.equity;
      if (prev === undefined || curr === undefined || prev === 0) {
        continue;
      }
      dailyReturns.push(curr / prev - 1);
    }

    const meanDaily = mean(dailyReturns);
    const volDaily = stdDev(dailyReturns);
    const annualizedReturn = Math.pow(1 + totalReturn, TRADING_DAYS_PER_YEAR / Math.max(1, dailyReturns.length)) - 1;
    const volatility = volDaily * Math.sqrt(TRADING_DAYS_PER_YEAR);
    const sharpeRatio = volDaily === 0 ? 0 : meanDaily / volDaily * Math.sqrt(TRADING_DAYS_PER_YEAR);
    const maxDrawdown = Math.min(...equityCurve.map((point) => point.drawdown));
    const var95 = valueAtRiskFromReturns(dailyReturns, 0.95);
    const cvar95 = cvarFromReturns(dailyReturns, 0.95);

    return {
      totalReturn,
      annualizedReturn,
      volatility,
      sharpeRatio,
      maxDrawdown,
      var: var95,
      cvar: cvar95,
    };
  }
}

function buildCovarianceMatrix(stats: StrategyStats[]): number[][] {
  const n = stats.length;
  const matrix = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));

  for (let i = 0; i < n; i += 1) {
    const si = stats[i];
    if (!si) {
      continue;
    }
    const rowI = matrix[i];
    if (!rowI) {
      continue;
    }
    rowI[i] = Math.max(1e-6, si.volatility * si.volatility);

    for (let j = i + 1; j < n; j += 1) {
      const sj = stats[j];
      if (!sj) {
        continue;
      }
      const corr = estimateCorrelation(si, sj);
      const cov = corr * si.volatility * sj.volatility;
      const r1 = matrix[i];
      const r2 = matrix[j];
      if (r1 && r2) {
        r1[j] = cov;
        r2[i] = cov;
      }
    }
  }

  return matrix;
}

function estimateCorrelation(a: StrategyStats, b: StrategyStats): number {
  const sampleCov = covariance(a.sampleReturns, b.sampleReturns);
  const sampleStdA = stdDev(a.sampleReturns);
  const sampleStdB = stdDev(b.sampleReturns);
  if (sampleStdA > 0 && sampleStdB > 0) {
    return clamp(sampleCov / (sampleStdA * sampleStdB), -0.95, 0.95);
  }

  let corr = 0.25;
  if (a.strategy.sector && b.strategy.sector && a.strategy.sector === b.strategy.sector) {
    corr += 0.2;
  }
  if (a.strategy.regime && b.strategy.regime && a.strategy.regime === b.strategy.regime) {
    corr += 0.1;
  }
  corr += (hashNoise(`${a.strategy.id}:${b.strategy.id}`) - 0.5) * 0.2;
  return clamp(corr, -0.8, 0.9);
}

function syntheticReturnSamples(id: string, mu: number, sigma: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < 24; i += 1) {
    const noise = (hashNoise(`${id}:${i}`) - 0.5) * sigma;
    values.push(mu + noise);
  }
  return values;
}

function toWeightMap(ids: string[], weights: number[]): Record<string, number> {
  const entries = ids.map((id, idx) => [id, round6(weights[idx] ?? 0)] as const);
  return Object.fromEntries(entries);
}

function normalizeWeights(weights: number[]): number[] {
  const cleaned = weights.map((w) => (Number.isFinite(w) ? Math.max(0, w) : 0));
  const sum = cleaned.reduce((acc, value) => acc + value, 0);
  if (sum <= 0) {
    const n = Math.max(1, cleaned.length);
    return Array.from({ length: n }, () => 1 / n);
  }
  return cleaned.map((w) => w / sum);
}

function valueAtRiskFromReturns(returns: number[], confidence: number): number {
  if (returns.length === 0) {
    return 0;
  }
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.max(0, Math.floor((1 - confidence) * sorted.length) - 1);
  const q = sorted[idx] ?? 0;
  return Math.max(0, -q);
}

function cvarFromReturns(returns: number[], confidence: number): number {
  if (returns.length === 0) {
    return 0;
  }
  const sorted = [...returns].sort((a, b) => a - b);
  const cutoff = Math.max(1, Math.floor((1 - confidence) * sorted.length));
  const tail = sorted.slice(0, cutoff);
  if (tail.length === 0) {
    return 0;
  }
  return Math.max(0, -mean(tail));
}

function covariance(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) {
    return 0;
  }
  const x = xs.slice(xs.length - n);
  const y = ys.slice(ys.length - n);
  const mx = mean(x);
  const my = mean(y);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const xv = x[i] ?? mx;
    const yv = y[i] ?? my;
    sum += (xv - mx) * (yv - my);
  }
  return sum / n;
}

function covarianceToCorrelation(cov: number[][], i: number, j: number): number {
  const c = cov[i]?.[j] ?? 0;
  const vi = cov[i]?.[i] ?? 0;
  const vj = cov[j]?.[j] ?? 0;
  if (vi <= 0 || vj <= 0) {
    return i === j ? 1 : 0;
  }
  return clamp(c / Math.sqrt(vi * vj), -1, 1);
}

function dot(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
}

function matVec(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => dot(row, vector));
}

function quadraticForm(weights: number[], covariance: number[][]): number {
  return dot(weights, matVec(covariance, weights));
}

function addVec(a: number[], b: number[]): number[] {
  const n = Math.max(a.length, b.length);
  return Array.from({ length: n }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0));
}

function transpose(matrix: number[][]): number[][] {
  const rows = matrix.length;
  const cols = rows > 0 ? (matrix[0]?.length ?? 0) : 0;
  const out = Array.from({ length: cols }, () => Array.from({ length: rows }, () => 0));
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const outRow = out[c];
      if (outRow) {
        outRow[r] = matrix[r]?.[c] ?? 0;
      }
    }
  }
  return out;
}

function multiplyMatrix(a: number[][], b: number[][]): number[][] {
  const aRows = a.length;
  const aCols = aRows > 0 ? (a[0]?.length ?? 0) : 0;
  const bCols = b.length > 0 ? (b[0]?.length ?? 0) : 0;
  const out = Array.from({ length: aRows }, () => Array.from({ length: bCols }, () => 0));

  for (let i = 0; i < aRows; i += 1) {
    for (let k = 0; k < aCols; k += 1) {
      const aik = a[i]?.[k] ?? 0;
      if (aik === 0) {
        continue;
      }
      for (let j = 0; j < bCols; j += 1) {
        const outRow = out[i];
        if (outRow) {
          outRow[j] = (outRow[j] ?? 0) + aik * (b[k]?.[j] ?? 0);
        }
      }
    }
  }

  return out;
}

function addMatrix(a: number[][], b: number[][]): number[][] {
  const rows = Math.max(a.length, b.length);
  const cols = Math.max(a[0]?.length ?? 0, b[0]?.length ?? 0);
  const out = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));

  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const outRow = out[i];
      if (outRow) {
        outRow[j] = (a[i]?.[j] ?? 0) + (b[i]?.[j] ?? 0);
      }
    }
  }
  return out;
}

function scaleMatrix(matrix: number[][], scale: number): number[][] {
  return matrix.map((row) => row.map((x) => x * scale));
}

function invertDiagonal(diagonal: number[]): number[][] {
  const n = diagonal.length;
  const matrix = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (let i = 0; i < n; i += 1) {
    const row = matrix[i];
    if (row) {
      row[i] = 1 / Math.max(1e-12, diagonal[i] ?? 1);
    }
  }
  return matrix;
}

function invertMatrixWithRidge(matrix: number[][], ridge: number): number[][] {
  const n = matrix.length;
  const aug = Array.from({ length: n }, (_, i) => {
    const row = Array.from({ length: 2 * n }, () => 0);
    for (let j = 0; j < n; j += 1) {
      const base = matrix[i]?.[j] ?? 0;
      row[j] = i === j ? base + ridge : base;
      row[n + j] = i === j ? 1 : 0;
    }
    return row;
  });

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(aug[row]?.[col] ?? 0) > Math.abs(aug[pivot]?.[col] ?? 0)) {
        pivot = row;
      }
    }

    const pivotValue = aug[pivot]?.[col] ?? 0;
    if (Math.abs(pivotValue) < 1e-12) {
      continue;
    }

    if (pivot !== col) {
      const tmp = aug[col];
      aug[col] = aug[pivot] ?? [];
      aug[pivot] = tmp ?? [];
    }

    const normalizeBy = aug[col]?.[col] ?? 1;
    for (let j = 0; j < 2 * n; j += 1) {
      const colRow = aug[col];
      if (colRow) {
        colRow[j] = (colRow[j] ?? 0) / normalizeBy;
      }
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) {
        continue;
      }
      const factor = aug[row]?.[col] ?? 0;
      for (let j = 0; j < 2 * n; j += 1) {
        const targetRow = aug[row];
        if (targetRow) {
          targetRow[j] = (targetRow[j] ?? 0) - factor * (aug[col]?.[j] ?? 0);
        }
      }
    }
  }

  return aug.map((row) => row.slice(n));
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const m = mean(values);
  const v = values.reduce((sum, value) => {
    const diff = value - m;
    return sum + diff * diff;
  }, 0) / values.length;
  return Math.sqrt(Math.max(0, v));
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function hashNoise(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1_000_000) / 1_000_000;
}

function normalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

function inverseNormal(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];

  const plow = 0.02425;
  const phigh = 1 - plow;

  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    const num = ((((c[0] ?? 0) * q + (c[1] ?? 0)) * q + (c[2] ?? 0)) * q + (c[3] ?? 0)) * q + (c[4] ?? 0);
    const den = (((d[0] ?? 0) * q + (d[1] ?? 0)) * q + (d[2] ?? 0)) * q + (d[3] ?? 0);
    return (num * q + (c[5] ?? 0)) / (den * q + 1);
  }

  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    const num = ((((c[0] ?? 0) * q + (c[1] ?? 0)) * q + (c[2] ?? 0)) * q + (c[3] ?? 0)) * q + (c[4] ?? 0);
    const den = (((d[0] ?? 0) * q + (d[1] ?? 0)) * q + (d[2] ?? 0)) * q + (d[3] ?? 0);
    return -((num * q + (c[5] ?? 0)) / (den * q + 1));
  }

  const q = p - 0.5;
  const r = q * q;
  const num = (((((a[0] ?? 0) * r + (a[1] ?? 0)) * r + (a[2] ?? 0)) * r + (a[3] ?? 0)) * r + (a[4] ?? 0)) * r + (a[5] ?? 0);
  const den = ((((b[0] ?? 0) * r + (b[1] ?? 0)) * r + (b[2] ?? 0)) * r + (b[3] ?? 0)) * r + (b[4] ?? 0);
  return (num * q) / (den * r + 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round6(value: number): number {
  return Number(value.toFixed(6));
}

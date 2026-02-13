import { randomUUID } from "node:crypto";
import { calculateReturns, macd, rSquared, rsi } from "../mit/technical-indicators.js";
import type { DailyCandle } from "../../mit-types.js";
import type { Strategy } from "./dsl/strategy-schema.js";
import type { StrategyStore, SimRun } from "./store.js";
import type { OHLCV, TimescaleTechnicalStore } from "./ta-store.js";

const TRADING_DAYS = 252;

export type AlertType =
  | "maxDrawdownExceeded"
  | "volatilitySpike"
  | "signalDrift"
  | "performanceDegradation"
  | "correlationBreakdown"
  | "regimeChange";

export type AlertCondition = "gt" | "gte" | "lt" | "lte" | "eq";
export type AlertSeverity = "info" | "warning" | "critical";

export interface StrategyMetrics {
  return: number;
  drawdown: number;
  volatility: number;
  sharpe: number;
  turnover: number;
  winRate: number;
}

export interface MetricsSnapshot {
  timestamp: Date;
  metrics: StrategyMetrics;
  benchmark: number;
}

export interface HealthCheckResult {
  check: "drawdown" | "volatility" | "signalDrift";
  ok: boolean;
  severity: AlertSeverity;
  score: number;
  message: string;
}

export interface HealthReport {
  status: "healthy" | "warning" | "critical";
  checks: HealthCheckResult[];
  score: number;
}

export interface HealthAlert {
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  threshold: number;
  current: number;
}

export interface AlertConfig {
  type: AlertType;
  condition: AlertCondition;
  threshold: number;
  severity: AlertSeverity;
  enabled: boolean;
}

export interface Alert {
  id: string;
  config: AlertConfig;
  triggered: boolean;
  lastTriggered: string | null;
  count: number;
}

export interface DashboardSummary {
  totalStrategies: number;
  active: number;
  atRisk: number;
  topPerformers: Array<{
    strategyId: string;
    name: string;
    return: number;
    sharpe: number;
  }>;
}

export interface StrategyDashboard {
  strategy: Strategy;
  metrics: StrategyMetrics;
  alerts: Alert[];
  recommendations: string[];
}

type MonitoringState = {
  metrics: StrategyMetrics;
  benchmark: number;
  signalDrift: number;
  correlation: number;
  regimeChange: number;
};

export class StrategyMonitor {
  private readonly store: StrategyStore;
  private readonly taStore: TimescaleTechnicalStore;
  private readonly snapshots = new Map<string, MetricsSnapshot[]>();
  private readonly alerts = new Map<string, Alert[]>();
  private readonly latestState = new Map<string, MonitoringState>();

  constructor(deps: { store: StrategyStore; taStore: TimescaleTechnicalStore }) {
    this.store = deps.store;
    this.taStore = deps.taStore;
  }

  async collectMetrics(strategyId: string): Promise<StrategyMetrics> {
    const strategy = await this.store.getStrategy(strategyId);
    if (!strategy) {
      throw new Error(`Strategy not found: ${strategyId}`);
    }

    const simRuns = await this.store.listSimRuns(strategyId);
    const latestRun = simRuns[0] ?? null;

    const ticker = this.resolvePrimaryTicker(strategy);
    const candles = ticker ? await this.taStore.getLatestCandles(ticker, 260).catch(() => []) : [];

    const closes = candles.map((candle) => candle.close);
    const returns = calculateReturns(closes);
    const impliedReturn = closes.length > 1 && closes[0] && closes[0] > 0
      ? closes[closes.length - 1]! / closes[0] - 1
      : 0;

    const runMetrics = this.extractRunMetrics(latestRun);
    const metricReturn = runMetrics.return ?? impliedReturn;
    const metricDrawdown = runMetrics.drawdown ?? this.computeMaxDrawdownFromReturns(returns);
    const metricVolatility = runMetrics.volatility ?? this.computeAnnualizedVolatility(returns);
    const metricSharpe = runMetrics.sharpe ?? this.computeSharpe(returns);
    const metricTurnover = runMetrics.turnover ?? 0;
    const metricWinRate = runMetrics.winRate ?? this.estimateWinRate(latestRun, returns);

    const metrics: StrategyMetrics = {
      return: this.clean(metricReturn),
      drawdown: this.clean(metricDrawdown),
      volatility: this.clean(metricVolatility),
      sharpe: this.clean(metricSharpe),
      turnover: this.clean(metricTurnover),
      winRate: this.clean(metricWinRate),
    };

    const benchmark = this.computeBenchmarkReturn(returns);
    const signalDrift = this.computeSignalDrift(candles);
    const correlation = this.computeCorrelationToBenchmark(returns, benchmark);
    const regimeChange = this.computeRegimeChangeSignal(candles, returns);

    this.latestState.set(strategyId, {
      metrics,
      benchmark,
      signalDrift,
      correlation,
      regimeChange,
    });

    return metrics;
  }

  async trackPerformance(strategyId: string): Promise<void> {
    const metrics = await this.collectMetrics(strategyId);
    const state = this.latestState.get(strategyId);
    const snapshot: MetricsSnapshot = {
      timestamp: new Date(),
      metrics,
      benchmark: state?.benchmark ?? 0,
    };

    const history = this.snapshots.get(strategyId) ?? [];
    history.push(snapshot);
    if (history.length > 2_000) {
      history.splice(0, history.length - 2_000);
    }
    this.snapshots.set(strategyId, history);
  }

  async getMetricsHistory(strategyId: string, from: Date, to: Date): Promise<MetricsSnapshot[]> {
    const history = this.snapshots.get(strategyId) ?? [];
    const fromMs = from.getTime();
    const toMs = to.getTime();
    return history.filter((snapshot) => {
      const time = snapshot.timestamp.getTime();
      return time >= fromMs && time <= toMs;
    });
  }

  async healthCheck(strategyId: string): Promise<HealthReport> {
    const hasState = this.latestState.has(strategyId);
    if (!hasState) {
      await this.trackPerformance(strategyId);
    }

    const drawdownAlert = this.checkDrawdown(strategyId);
    const volatilityAlert = this.checkVolatility(strategyId);
    const driftAlert = this.checkSignalDrift(strategyId);

    const checks: HealthCheckResult[] = [
      this.toHealthCheck("drawdown", drawdownAlert),
      this.toHealthCheck("volatility", volatilityAlert),
      this.toHealthCheck("signalDrift", driftAlert),
    ];

    const critical = checks.some((check) => check.severity === "critical" && !check.ok);
    const warning = checks.some((check) => check.severity === "warning" && !check.ok);
    const status: HealthReport["status"] = critical ? "critical" : warning ? "warning" : "healthy";
    const score = Math.max(0, Math.min(100, Math.round(checks.reduce((sum, check) => sum + check.score, 0) / checks.length)));

    return { status, checks, score };
  }

  checkDrawdown(strategyId: string): HealthAlert | null {
    const metrics = this.latestState.get(strategyId)?.metrics;
    if (!metrics) {
      return null;
    }
    const threshold = -0.15;
    if (metrics.drawdown > threshold) {
      return null;
    }
    return {
      type: "maxDrawdownExceeded",
      severity: metrics.drawdown <= -0.25 ? "critical" : "warning",
      message: `Drawdown ${toPct(metrics.drawdown)} breached limit ${toPct(threshold)}`,
      threshold,
      current: metrics.drawdown,
    };
  }

  checkVolatility(strategyId: string): HealthAlert | null {
    const metrics = this.latestState.get(strategyId)?.metrics;
    if (!metrics) {
      return null;
    }
    const threshold = 0.35;
    if (metrics.volatility < threshold) {
      return null;
    }
    return {
      type: "volatilitySpike",
      severity: metrics.volatility >= 0.5 ? "critical" : "warning",
      message: `Annualized volatility ${toPct(metrics.volatility)} is elevated`,
      threshold,
      current: metrics.volatility,
    };
  }

  checkSignalDrift(strategyId: string): HealthAlert | null {
    const state = this.latestState.get(strategyId);
    if (!state) {
      return null;
    }
    const threshold = 0.65;
    if (state.signalDrift < threshold) {
      return null;
    }
    return {
      type: "signalDrift",
      severity: state.signalDrift >= 0.8 ? "critical" : "warning",
      message: `Signal drift score ${state.signalDrift.toFixed(2)} indicates behavior divergence`,
      threshold,
      current: state.signalDrift,
    };
  }

  registerAlert(strategyId: string, alert: AlertConfig): string {
    const id = `alert-${randomUUID()}`;
    const record: Alert = {
      id,
      config: { ...alert },
      triggered: false,
      lastTriggered: null,
      count: 0,
    };
    const current = this.alerts.get(strategyId) ?? [];
    current.push(record);
    this.alerts.set(strategyId, current);
    return id;
  }

  deleteAlert(alertId: string): void {
    for (const [strategyId, alerts] of this.alerts.entries()) {
      const filtered = alerts.filter((alert) => alert.id !== alertId);
      if (filtered.length !== alerts.length) {
        this.alerts.set(strategyId, filtered);
        return;
      }
    }
  }

  getAlerts(strategyId: string): Alert[] {
    return (this.alerts.get(strategyId) ?? []).map((alert) => ({
      ...alert,
      config: { ...alert.config },
    }));
  }

  evaluateAlerts(strategyId: string): Alert[] {
    const state = this.latestState.get(strategyId);
    const strategyAlerts = this.alerts.get(strategyId) ?? [];
    if (!state || strategyAlerts.length === 0) {
      return [];
    }

    const triggered: Alert[] = [];
    const now = new Date().toISOString();
    for (const alert of strategyAlerts) {
      if (!alert.config.enabled) {
        alert.triggered = false;
        continue;
      }

      const current = this.resolveAlertValue(alert.config.type, state);
      const isTriggered = this.matchesCondition(current, alert.config.condition, alert.config.threshold);
      alert.triggered = isTriggered;
      if (isTriggered) {
        alert.lastTriggered = now;
        alert.count += 1;
        triggered.push({ ...alert, config: { ...alert.config } });
      }
    }

    this.alerts.set(strategyId, strategyAlerts);
    return triggered;
  }

  async getDashboardSummary(): Promise<DashboardSummary> {
    const strategies = await this.store.listStrategies({ limit: 10_000, offset: 0 });
    const production = strategies.filter((strategy) => strategy.status === "production");

    const scored: Array<{ strategy: Strategy; metrics: StrategyMetrics }> = [];
    let atRisk = 0;

    for (const strategy of production) {
      await this.trackPerformance(strategy.id);
      const state = this.latestState.get(strategy.id);
      if (!state) {
        continue;
      }

      const health = await this.healthCheck(strategy.id);
      if (health.status !== "healthy") {
        atRisk += 1;
      }
      scored.push({ strategy, metrics: state.metrics });
    }

    scored.sort((a, b) => {
      if (b.metrics.return !== a.metrics.return) {
        return b.metrics.return - a.metrics.return;
      }
      return b.metrics.sharpe - a.metrics.sharpe;
    });

    return {
      totalStrategies: strategies.length,
      active: production.length,
      atRisk,
      topPerformers: scored.slice(0, 5).map(({ strategy, metrics }) => ({
        strategyId: strategy.id,
        name: strategy.name,
        return: metrics.return,
        sharpe: metrics.sharpe,
      })),
    };
  }

  async getStrategyDashboard(strategyId: string): Promise<StrategyDashboard> {
    const strategy = await this.store.getStrategy(strategyId);
    if (!strategy) {
      throw new Error(`Strategy not found: ${strategyId}`);
    }

    await this.trackPerformance(strategyId);
    const state = this.latestState.get(strategyId);
    if (!state) {
      throw new Error(`Unable to build dashboard state for strategy ${strategyId}`);
    }

    const health = await this.healthCheck(strategyId);
    const activeAlerts = this.evaluateAlerts(strategyId);
    const recommendations = this.buildRecommendations(state.metrics, health, activeAlerts);

    return {
      strategy,
      metrics: state.metrics,
      alerts: this.getAlerts(strategyId),
      recommendations,
    };
  }

  private resolvePrimaryTicker(strategy: Strategy): string | null {
    if (strategy.universe.mode === "custom_tickers" && strategy.universe.tickers.length > 0) {
      return strategy.universe.tickers[0] ?? null;
    }
    return null;
  }

  private extractRunMetrics(simRun: SimRun | null): {
    return: number | null;
    drawdown: number | null;
    volatility: number | null;
    sharpe: number | null;
    turnover: number | null;
    winRate: number | null;
  } {
    if (!simRun) {
      return {
        return: null,
        drawdown: null,
        volatility: null,
        sharpe: null,
        turnover: null,
        winRate: null,
      };
    }

    const metrics = isRecord(simRun.metrics) ? simRun.metrics : {};
    return {
      return: getNumber(metrics, ["totalReturn", "return"]),
      drawdown: getNumber(metrics, ["maxDrawdown", "drawdown"]),
      volatility: getNumber(metrics, ["volatility"]),
      sharpe: getNumber(metrics, ["sharpeRatio", "sharpe"]),
      turnover: getNumber(metrics, ["turnover"]),
      winRate: getNumber(metrics, ["winRate"]),
    };
  }

  private estimateWinRate(simRun: SimRun | null, returns: number[]): number {
    if (simRun && Array.isArray(simRun.trades) && simRun.trades.length > 0) {
      const pnlValues = simRun.trades
        .map((trade) => (isRecord(trade) ? getNumber(trade, ["pnl", "pnlPct"]) : null))
        .filter((value): value is number => value !== null);
      if (pnlValues.length > 0) {
        const wins = pnlValues.filter((value) => value > 0).length;
        return wins / pnlValues.length;
      }
    }

    if (returns.length === 0) {
      return 0;
    }
    const wins = returns.filter((value) => value > 0).length;
    return wins / returns.length;
  }

  private computeAnnualizedVolatility(returns: number[]): number {
    if (returns.length < 2) {
      return 0;
    }
    const meanValue = mean(returns);
    const variance = mean(returns.map((value) => {
      const diff = value - meanValue;
      return diff * diff;
    }));
    return Math.sqrt(Math.max(0, variance)) * Math.sqrt(TRADING_DAYS);
  }

  private computeSharpe(returns: number[]): number {
    if (returns.length < 2) {
      return 0;
    }
    const meanValue = mean(returns);
    const std = this.computeAnnualizedVolatility(returns) / Math.sqrt(TRADING_DAYS);
    if (std === 0) {
      return 0;
    }
    return (meanValue / std) * Math.sqrt(TRADING_DAYS);
  }

  private computeMaxDrawdownFromReturns(returns: number[]): number {
    if (returns.length === 0) {
      return 0;
    }

    let equity = 1;
    let peak = 1;
    let maxDrawdown = 0;
    for (const ret of returns) {
      equity *= 1 + ret;
      peak = Math.max(peak, equity);
      const drawdown = peak === 0 ? 0 : equity / peak - 1;
      maxDrawdown = Math.min(maxDrawdown, drawdown);
    }
    return maxDrawdown;
  }

  private computeBenchmarkReturn(returns: number[]): number {
    if (returns.length === 0) {
      return 0;
    }
    const benchmarkWindow = returns.slice(-Math.min(63, returns.length));
    return benchmarkWindow.reduce((acc, value) => acc * (1 + value), 1) - 1;
  }

  private computeSignalDrift(candles: OHLCV[]): number {
    if (candles.length < 40) {
      return 0;
    }

    const daily = candles.map(toDailyCandle);
    const closes = candles.map((candle) => candle.close);
    const latestRsi = rsi(daily, 14) ?? 50;
    const momentum = Math.abs((macd(closes)?.histogram ?? 0));
    const trendFit = rSquared(closes) ?? 0.5;

    const rsiDrift = Math.min(1, Math.abs(latestRsi - 50) / 50);
    const trendDrift = Math.min(1, 1 - trendFit);
    const momentumDrift = Math.min(1, momentum / 5);

    return this.clean(rsiDrift * 0.4 + trendDrift * 0.4 + momentumDrift * 0.2);
  }

  private computeCorrelationToBenchmark(returns: number[], benchmarkReturn: number): number {
    if (returns.length === 0) {
      return 1;
    }

    const benchmarkSeries = returns.map(() => benchmarkReturn / Math.max(1, returns.length));
    const xMean = mean(returns);
    const yMean = mean(benchmarkSeries);

    let cov = 0;
    let xVar = 0;
    let yVar = 0;
    for (let i = 0; i < returns.length; i += 1) {
      const x = returns[i];
      const y = benchmarkSeries[i];
      if (x === undefined || y === undefined) {
        continue;
      }
      const dx = x - xMean;
      const dy = y - yMean;
      cov += dx * dy;
      xVar += dx * dx;
      yVar += dy * dy;
    }

    const denominator = Math.sqrt(xVar * yVar);
    if (denominator === 0) {
      return 1;
    }
    return this.clean(cov / denominator);
  }

  private computeRegimeChangeSignal(candles: OHLCV[], returns: number[]): number {
    if (candles.length < 60 || returns.length < 40) {
      return 0;
    }

    const shortVol = this.computeAnnualizedVolatility(returns.slice(-20));
    const longVol = this.computeAnnualizedVolatility(returns.slice(-60));
    const volShift = longVol === 0 ? 0 : Math.max(0, shortVol / longVol - 1);

    const closes = candles.map((candle) => candle.close);
    const recentChange = closes[closes.length - 1] && closes[closes.length - 21]
      ? closes[closes.length - 1]! / closes[closes.length - 21]! - 1
      : 0;

    const trendBreak = Math.min(1, Math.abs(recentChange) / 0.12);
    return this.clean(Math.min(1, volShift) * 0.6 + trendBreak * 0.4);
  }

  private resolveAlertValue(type: AlertType, state: MonitoringState): number {
    switch (type) {
      case "maxDrawdownExceeded":
        return state.metrics.drawdown;
      case "volatilitySpike":
        return state.metrics.volatility;
      case "signalDrift":
        return state.signalDrift;
      case "performanceDegradation":
        return state.metrics.return - state.benchmark;
      case "correlationBreakdown":
        return state.correlation;
      case "regimeChange":
        return state.regimeChange;
      default:
        return 0;
    }
  }

  private matchesCondition(value: number, condition: AlertCondition, threshold: number): boolean {
    switch (condition) {
      case "gt":
        return value > threshold;
      case "gte":
        return value >= threshold;
      case "lt":
        return value < threshold;
      case "lte":
        return value <= threshold;
      case "eq":
        return value === threshold;
      default:
        return false;
    }
  }

  private toHealthCheck(check: HealthCheckResult["check"], alert: HealthAlert | null): HealthCheckResult {
    if (!alert) {
      return {
        check,
        ok: true,
        severity: "info",
        score: 100,
        message: `${check} within expected range`,
      };
    }

    const penalty = alert.severity === "critical" ? 55 : 25;
    return {
      check,
      ok: false,
      severity: alert.severity,
      score: Math.max(0, 100 - penalty),
      message: alert.message,
    };
  }

  private buildRecommendations(metrics: StrategyMetrics, health: HealthReport, activeAlerts: Alert[]): string[] {
    const recommendations: string[] = [];

    if (health.status === "critical") {
      recommendations.push("Reduce exposure and tighten risk limits until health recovers.");
    }
    if (metrics.drawdown <= -0.15) {
      recommendations.push("Apply stricter stop-loss rules or reduce position sizing.");
    }
    if (metrics.volatility >= 0.35) {
      recommendations.push("Shift to lower-volatility assets or lower leverage.");
    }
    if (metrics.sharpe < 0.5) {
      recommendations.push("Recalibrate entry/exit rules to improve risk-adjusted returns.");
    }
    if (activeAlerts.some((alert) => alert.config.type === "signalDrift")) {
      recommendations.push("Retrain or retune signal parameters to address drift.");
    }
    if (recommendations.length === 0) {
      recommendations.push("No critical issues detected; continue monitoring at current cadence.");
    }

    return recommendations;
  }

  private clean(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Number(value.toFixed(6));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function toDailyCandle(candle: OHLCV): DailyCandle {
  return {
    date: candle.timestamp.toISOString().slice(0, 10),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  };
}

export type MonitoringDeps = ConstructorParameters<typeof StrategyMonitor>[0];

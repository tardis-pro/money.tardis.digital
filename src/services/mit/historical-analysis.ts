import type { DailyCandle } from "../../mit-types.js";
import { MarketDataService } from "./market-data.js";

export interface HistoricalAnalysisResult {
  ticker: string;
  period: string;
  startPrice: number;
  endPrice: number;
  absoluteReturn: number;
  percentageReturn: number;
  cagr: number | null;
  volatility: VolatilityMetrics;
  maxDrawdown: MaxDrawdown;
  trend: TrendAnalysis;
  insights: string[];
}

export interface PeriodReturns {
  "1M": number | null;
  "3M": number | null;
  "6M": number | null;
  "1Y": number | null;
  "2Y": number | null;
  "5Y": number | null;
}

export interface VolatilityMetrics {
  daily: number;
  annualized: number;
  sharpeRatio: number | null;
}

export interface MaxDrawdown {
  value: number;
  percentage: number;
  startDate: string;
  endDate: string;
}

export interface TrendAnalysis {
  direction: "uptrend" | "downtrend" | "sideways";
  strength: number;
  description: string;
}

const PERIOD_TO_DAYS: Record<string, number> = {
  "1M": 21,
  "3M": 63,
  "6M": 126,
  "1Y": 252,
  "2Y": 504,
  "5Y": 1260,
};

const DEFAULT_PERIOD_DAYS = 252;
const MAX_LOOKBACK_DAYS = 1260;

const RETURN_PERIODS = ["1M", "3M", "6M", "1Y", "2Y", "5Y"] as const;

export class HistoricalAnalysisService {
  private readonly riskFreeRate: number;

  constructor(private readonly deps: { marketData: MarketDataService }) {
    const parsedRiskFreeRate = Number.parseFloat(process.env.MIT_RISK_FREE_RATE ?? "");
    this.riskFreeRate = Number.isFinite(parsedRiskFreeRate) ? parsedRiskFreeRate : 0.06;
  }

  async analyze(ticker: string, period: string): Promise<HistoricalAnalysisResult> {
    const symbol = ticker.trim().toUpperCase();
    const requestedDays = this.resolvePeriodDays(period);
    const candles = await this.deps.marketData.fetchCandles(symbol, Math.max(MAX_LOOKBACK_DAYS, requestedDays));
    const ordered = this.normalizeCandles(candles);

    if (ordered.length < 2) {
      throw new Error(`Insufficient historical candles for ${symbol}`);
    }

    const window = ordered.slice(-Math.min(requestedDays, ordered.length));
    const startPrice = window[0]?.close ?? 0;
    const endPrice = window[window.length - 1]?.close ?? 0;

    if (startPrice <= 0 || endPrice <= 0) {
      throw new Error(`Invalid candle prices for ${symbol}`);
    }

    const absoluteReturn = endPrice - startPrice;
    const percentageReturn = ((endPrice - startPrice) / startPrice) * 100;
    const cagr = this.calculateCagr(window);
    const volatility = this.calculateVolatility(window);
    const maxDrawdown = this.calculateMaxDrawdown(window);
    const trend = this.identifyTrend(window);
    const periodReturns = this.calculateReturns(ordered, period);

    return {
      ticker: symbol,
      period,
      startPrice,
      endPrice,
      absoluteReturn,
      percentageReturn,
      cagr,
      volatility,
      maxDrawdown,
      trend,
      insights: this.generateInsights({
        ticker: symbol,
        period,
        periodReturns,
        percentageReturn,
        cagr,
        volatility,
        maxDrawdown,
        trend,
      }),
    };
  }

  calculateReturns(candles: DailyCandle[], _period: string): PeriodReturns {
    const ordered = this.normalizeCandles(candles);
    const out: PeriodReturns = {
      "1M": null,
      "3M": null,
      "6M": null,
      "1Y": null,
      "2Y": null,
      "5Y": null,
    };

    for (const label of RETURN_PERIODS) {
      const days = PERIOD_TO_DAYS[label];
      if (!days || ordered.length <= days) {
        continue;
      }
      const end = ordered[ordered.length - 1]?.close;
      const start = ordered[ordered.length - 1 - days]?.close;
      if (end === undefined || start === undefined || start <= 0) {
        continue;
      }
      out[label] = ((end - start) / start) * 100;
    }

    return out;
  }

  calculateVolatility(candles: DailyCandle[]): VolatilityMetrics {
    const ordered = this.normalizeCandles(candles);
    if (ordered.length < 3) {
      return { daily: 0, annualized: 0, sharpeRatio: null };
    }

    const returns = this.dailyReturns(ordered);
    if (returns.length < 2) {
      return { daily: 0, annualized: 0, sharpeRatio: null };
    }

    const meanDailyReturn = this.mean(returns);
    const dailyVolatility = this.standardDeviation(returns);
    const annualizedVolatility = dailyVolatility * Math.sqrt(252);
    const annualizedReturn = meanDailyReturn * 252;
    const sharpeRatio = annualizedVolatility > 0
      ? (annualizedReturn - this.riskFreeRate) / annualizedVolatility
      : null;

    return {
      daily: dailyVolatility,
      annualized: annualizedVolatility,
      sharpeRatio,
    };
  }

  calculateCagr(candles: DailyCandle[]): number | null {
    const ordered = this.normalizeCandles(candles);
    if (ordered.length < 2) {
      return null;
    }

    const start = ordered[0]?.close;
    const end = ordered[ordered.length - 1]?.close;
    if (start === undefined || end === undefined || start <= 0 || end <= 0) {
      return null;
    }

    const years = this.yearsBetween(ordered[0]?.date, ordered[ordered.length - 1]?.date);
    if (years <= 0) {
      return null;
    }

    return (end / start) ** (1 / years) - 1;
  }

  calculateMaxDrawdown(candles: DailyCandle[]): MaxDrawdown {
    const ordered = this.normalizeCandles(candles);
    if (ordered.length < 2) {
      const fallbackDate = ordered[0]?.date ?? "";
      return {
        value: 0,
        percentage: 0,
        startDate: fallbackDate,
        endDate: fallbackDate,
      };
    }

    let peakPrice = ordered[0]?.close ?? 0;
    let peakDate = ordered[0]?.date ?? "";
    let troughPrice = peakPrice;
    let troughDate = peakDate;
    let maxDrawdownPercentage = 0;
    let maxDrawdownValue = 0;
    let maxDrawdownStartDate = peakDate;
    let maxDrawdownEndDate = peakDate;

    for (const candle of ordered) {
      if (candle.close > peakPrice) {
        peakPrice = candle.close;
        peakDate = candle.date;
        troughPrice = candle.close;
        troughDate = candle.date;
      }

      if (candle.close < troughPrice) {
        troughPrice = candle.close;
        troughDate = candle.date;
      }

      if (peakPrice <= 0) {
        continue;
      }

      const drawdownPercentage = (peakPrice - troughPrice) / peakPrice;
      if (drawdownPercentage > maxDrawdownPercentage) {
        maxDrawdownPercentage = drawdownPercentage;
        maxDrawdownValue = peakPrice - troughPrice;
        maxDrawdownStartDate = peakDate;
        maxDrawdownEndDate = troughDate;
      }
    }

    return {
      value: maxDrawdownValue,
      percentage: maxDrawdownPercentage,
      startDate: maxDrawdownStartDate,
      endDate: maxDrawdownEndDate,
    };
  }

  identifyTrend(candles: DailyCandle[]): TrendAnalysis {
    const ordered = this.normalizeCandles(candles);
    if (ordered.length < 20) {
      return {
        direction: "sideways",
        strength: 0,
        description: "Insufficient data to identify a reliable trend.",
      };
    }

    const closes = ordered.map((item) => item.close).filter((value) => Number.isFinite(value) && value > 0);
    if (closes.length < 20) {
      return {
        direction: "sideways",
        strength: 0,
        description: "Insufficient valid price points to identify trend.",
      };
    }

    const shortWindow = closes.slice(-20);
    const longWindow = closes.slice(-Math.min(50, closes.length));
    const sma20 = this.mean(shortWindow);
    const sma50 = this.mean(longWindow);
    const start = closes[0] ?? 0;
    const end = closes[closes.length - 1] ?? 0;
    const totalReturn = start > 0 ? (end - start) / start : 0;
    const linearSlope = this.linearRegressionSlope(closes);
    const normalizedSlope = sma50 > 0 ? (linearSlope / sma50) * 100 : 0;
    const trendMagnitude = Math.abs(totalReturn * 100);
    const slopeMagnitude = Math.min(100, Math.abs(normalizedSlope) * 12);
    const strength = Math.min(100, Math.round(trendMagnitude * 0.6 + slopeMagnitude * 0.4));

    let direction: TrendAnalysis["direction"] = "sideways";
    if (sma20 > sma50 && totalReturn > 0.03 && normalizedSlope > 0) {
      direction = "uptrend";
    } else if (sma20 < sma50 && totalReturn < -0.03 && normalizedSlope < 0) {
      direction = "downtrend";
    }

    const description = this.describeTrend({
      direction,
      strength,
      totalReturn,
      sma20,
      sma50,
      normalizedSlope,
    });

    return {
      direction,
      strength,
      description,
    };
  }

  private generateInsights(input: {
    ticker: string;
    period: string;
    periodReturns: PeriodReturns;
    percentageReturn: number;
    cagr: number | null;
    volatility: VolatilityMetrics;
    maxDrawdown: MaxDrawdown;
    trend: TrendAnalysis;
  }): string[] {
    const insights: string[] = [];
    insights.push(
      `${input.ticker} returned ${formatPercent(input.percentageReturn / 100)} over ${input.period.toUpperCase()}.`,
    );

    if (input.cagr !== null) {
      insights.push(`CAGR over the selected window is ${formatPercent(input.cagr)}.`);
    }

    insights.push(
      `Annualized volatility is ${formatPercent(input.volatility.annualized)} with daily volatility at ${formatPercent(input.volatility.daily)}.`,
    );

    if (input.volatility.sharpeRatio !== null) {
      insights.push(`Risk-adjusted performance (Sharpe ratio) is ${input.volatility.sharpeRatio.toFixed(2)}.`);
    }

    insights.push(
      `Maximum drawdown is ${formatPercent(input.maxDrawdown.percentage)} from ${input.maxDrawdown.startDate} to ${input.maxDrawdown.endDate}.`,
    );

    insights.push(
      `Trend is ${input.trend.direction} (strength ${input.trend.strength}/100): ${input.trend.description}`,
    );

    const strongPeriods = RETURN_PERIODS
      .map((label) => ({ label, value: input.periodReturns[label] }))
      .filter((item): item is { label: typeof RETURN_PERIODS[number]; value: number } => item.value !== null)
      .sort((a, b) => b.value - a.value);

    if (strongPeriods.length > 0) {
      const best = strongPeriods[0];
      const worst = strongPeriods[strongPeriods.length - 1];
      if (best && worst) {
        insights.push(`Best trailing period is ${best.label} (${formatPercent(best.value / 100)}), while the weakest is ${worst.label} (${formatPercent(worst.value / 100)}).`);
      }
    }

    return insights;
  }

  private resolvePeriodDays(period: string): number {
    const normalized = period.trim().toUpperCase();
    const predefinedDays = PERIOD_TO_DAYS[normalized];
    if (predefinedDays !== undefined) {
      return predefinedDays;
    }

    const match = normalized.match(/^(\d+)(D|W|M|Y)$/);
    if (!match) {
      return DEFAULT_PERIOD_DAYS;
    }

    const value = Number.parseInt(match[1] ?? "0", 10);
    const unit = match[2];
    if (!Number.isFinite(value) || value <= 0) {
      return DEFAULT_PERIOD_DAYS;
    }
    if (unit === "D") return Math.max(2, value);
    if (unit === "W") return Math.max(2, value * 5);
    if (unit === "M") return Math.max(2, value * 21);
    return Math.max(2, value * 252);
  }

  private normalizeCandles(candles: DailyCandle[]): DailyCandle[] {
    return [...candles].sort((a, b) => a.date.localeCompare(b.date));
  }

  private dailyReturns(candles: DailyCandle[]): number[] {
    const out: number[] = [];
    for (let i = 1; i < candles.length; i += 1) {
      const current = candles[i]?.close;
      const previous = candles[i - 1]?.close;
      if (current === undefined || previous === undefined || current <= 0 || previous <= 0) {
        continue;
      }
      out.push((current - previous) / previous);
    }
    return out;
  }

  private mean(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private standardDeviation(values: number[]): number {
    if (values.length < 2) {
      return 0;
    }
    const avg = this.mean(values);
    const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
    return Math.sqrt(Math.max(0, variance));
  }

  private yearsBetween(startDate: string | undefined, endDate: string | undefined): number {
    if (!startDate || !endDate) {
      return 0;
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      return 0;
    }
    const diffDays = Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays / 365.25;
  }

  private linearRegressionSlope(values: number[]): number {
    if (values.length < 2) {
      return 0;
    }

    const n = values.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    for (let i = 0; i < n; i += 1) {
      const x = i + 1;
      const y = values[i] ?? 0;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }

    const denominator = n * sumXX - sumX * sumX;
    if (denominator === 0) {
      return 0;
    }

    return (n * sumXY - sumX * sumY) / denominator;
  }

  private describeTrend(input: {
    direction: TrendAnalysis["direction"];
    strength: number;
    totalReturn: number;
    sma20: number;
    sma50: number;
    normalizedSlope: number;
  }): string {
    if (input.direction === "uptrend") {
      return `Price action is constructive with SMA20 (${input.sma20.toFixed(2)}) above SMA50 (${input.sma50.toFixed(2)}), total return ${formatPercent(input.totalReturn)}, and positive slope (${input.normalizedSlope.toFixed(2)}%).`;
    }
    if (input.direction === "downtrend") {
      return `Price action is weakening with SMA20 (${input.sma20.toFixed(2)}) below SMA50 (${input.sma50.toFixed(2)}), total return ${formatPercent(input.totalReturn)}, and negative slope (${input.normalizedSlope.toFixed(2)}%).`;
    }
    if (input.strength < 20) {
      return "Sideways consolidation with low directional conviction and choppy momentum.";
    }
    return `Mixed signals: SMA20 (${input.sma20.toFixed(2)}) and SMA50 (${input.sma50.toFixed(2)}) are close, with muted slope (${input.normalizedSlope.toFixed(2)}%) and return ${formatPercent(input.totalReturn)}.`;
  }
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

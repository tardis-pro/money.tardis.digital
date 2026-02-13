import type { DailyCandle } from "../../mit-types.js";
import { macd, rsi, sma } from "./technical-indicators.js";
import type { MarketDataService } from "./market-data.js";

export interface ChartParams {
  period: "1M" | "3M" | "6M" | "1Y" | "2Y";
  type: "candle" | "line" | "area";
}

export interface ChartData {
  ticker: string;
  type: string;
  labels: string[];
  datasets: ChartDataset[];
  options: Record<string, unknown>;
}

export interface ChartDataset {
  label: string;
  data: number[];
  type?: string;
  color?: string;
}

export interface ComparisonChartData {
  tickers: string[];
  labels: string[];
  datasets: ChartDataset[];
  baseValue: number;
}

export interface TechnicalChartData extends ChartData {
  indicators: {
    name: string;
    data: number[];
    overlay: boolean;
  }[];
}

const PERIOD_TO_DAYS: Record<ChartParams["period"], number> = {
  "1M": 22,
  "3M": 66,
  "6M": 132,
  "1Y": 252,
  "2Y": 504,
};

const DEFAULT_CHART_COLORS = {
  open: "#1d4ed8",
  high: "#15803d",
  low: "#b91c1c",
  close: "#0f172a",
  volume: "#64748b",
  rsi: "#9333ea",
  macd: "#0f766e",
  signal: "#f97316",
  histogram: "#475569",
  sma20: "#2563eb",
  sma50: "#f59e0b",
  sma200: "#059669",
};

export class ChartGenerator {
  constructor(private readonly deps: { marketData: MarketDataService }) {}

  async generatePriceChart(ticker: string, params: ChartParams): Promise<ChartData> {
    const normalizedTicker = ticker.trim().toUpperCase();
    const candles = await this.getCandlesForPeriod(normalizedTicker, params.period);
    const labels = candles.map((candle) => candle.date);

    return {
      ticker: normalizedTicker,
      type: params.type,
      labels,
      datasets: [
        { label: "Open", data: candles.map((candle) => candle.open), type: "line", color: DEFAULT_CHART_COLORS.open },
        { label: "High", data: candles.map((candle) => candle.high), type: "line", color: DEFAULT_CHART_COLORS.high },
        { label: "Low", data: candles.map((candle) => candle.low), type: "line", color: DEFAULT_CHART_COLORS.low },
        {
          label: "Close",
          data: candles.map((candle) => candle.close),
          type: params.type === "candle" ? "line" : params.type,
          color: DEFAULT_CHART_COLORS.close,
        },
        { label: "Volume", data: candles.map((candle) => candle.volume), type: "bar", color: DEFAULT_CHART_COLORS.volume },
      ],
      options: {
        chartType: params.type,
        hasOHLCV: true,
        pricePanel: {
          ohlcFields: {
            open: "Open",
            high: "High",
            low: "Low",
            close: "Close",
          },
        },
        volumePanel: {
          field: "Volume",
          yAxisId: "volume",
        },
      },
    };
  }

  async generateComparisonChart(tickers: string[], params: ChartParams): Promise<ComparisonChartData> {
    const uniqueTickers = [...new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))];
    if (uniqueTickers.length < 2) {
      throw new Error("Comparison chart needs at least two tickers");
    }

    const candlesByTicker = new Map<string, DailyCandle[]>();
    for (const ticker of uniqueTickers) {
      candlesByTicker.set(ticker, await this.getCandlesForPeriod(ticker, params.period));
    }

    const commonLabels = getSharedDates([...candlesByTicker.values()]);
    if (commonLabels.length === 0) {
      throw new Error("No overlapping candles available for comparison chart");
    }

    const datasets: ChartDataset[] = uniqueTickers.map((ticker, index) => {
      const candleMap = new Map((candlesByTicker.get(ticker) ?? []).map((candle) => [candle.date, candle.close]));
      const closes = commonLabels.map((label) => candleMap.get(label)).filter((value): value is number => value !== undefined);
      const baseClose = closes[0];
      if (baseClose === undefined || baseClose <= 0) {
        return { label: ticker, data: [] };
      }
      return {
        label: ticker,
        data: closes.map((close) => Number(((close / baseClose) * 100).toFixed(2))),
        type: "line",
        color: pickColor(index),
      };
    });

    return {
      tickers: uniqueTickers,
      labels: commonLabels,
      datasets,
      baseValue: 100,
    };
  }

  async generateTechnicalChart(ticker: string, indicators: string[]): Promise<TechnicalChartData> {
    const normalizedTicker = ticker.trim().toUpperCase();
    const candles = await this.getCandlesForPeriod(normalizedTicker, "1Y");
    const labels = candles.map((candle) => candle.date);
    const requestedIndicators = [...new Set(indicators.map((value) => value.trim().toLowerCase()))];

    const baseDatasets: ChartDataset[] = [
      {
        label: "Close",
        data: candles.map((candle) => candle.close),
        type: "line",
        color: DEFAULT_CHART_COLORS.close,
      },
      {
        label: "Volume",
        data: candles.map((candle) => candle.volume),
        type: "bar",
        color: DEFAULT_CHART_COLORS.volume,
      },
    ];

    const technicalIndicators: TechnicalChartData["indicators"] = [];

    if (requestedIndicators.includes("sma") || requestedIndicators.includes("sma20")) {
      const sma20 = buildSmaSeries(candles, 20);
      baseDatasets.push({ label: "SMA 20", data: sma20, type: "line", color: DEFAULT_CHART_COLORS.sma20 });
      technicalIndicators.push({ name: "SMA 20", data: sma20, overlay: true });
    }

    if (requestedIndicators.includes("sma50")) {
      const sma50 = buildSmaSeries(candles, 50);
      baseDatasets.push({ label: "SMA 50", data: sma50, type: "line", color: DEFAULT_CHART_COLORS.sma50 });
      technicalIndicators.push({ name: "SMA 50", data: sma50, overlay: true });
    }

    if (requestedIndicators.includes("sma200")) {
      const sma200 = buildSmaSeries(candles, 200);
      baseDatasets.push({ label: "SMA 200", data: sma200, type: "line", color: DEFAULT_CHART_COLORS.sma200 });
      technicalIndicators.push({ name: "SMA 200", data: sma200, overlay: true });
    }

    if (requestedIndicators.includes("rsi")) {
      const rsi14 = buildRsiSeries(candles, 14);
      baseDatasets.push({ label: "RSI 14", data: rsi14, type: "line", color: DEFAULT_CHART_COLORS.rsi });
      technicalIndicators.push({ name: "RSI 14", data: rsi14, overlay: false });
    }

    if (requestedIndicators.includes("macd")) {
      const { macdLine, signalLine, histogram } = buildMacdSeries(candles.map((candle) => candle.close));
      baseDatasets.push({ label: "MACD", data: macdLine, type: "line", color: DEFAULT_CHART_COLORS.macd });
      baseDatasets.push({ label: "MACD Signal", data: signalLine, type: "line", color: DEFAULT_CHART_COLORS.signal });
      baseDatasets.push({ label: "MACD Histogram", data: histogram, type: "bar", color: DEFAULT_CHART_COLORS.histogram });
      technicalIndicators.push({ name: "MACD", data: macdLine, overlay: false });
      technicalIndicators.push({ name: "MACD Signal", data: signalLine, overlay: false });
      technicalIndicators.push({ name: "MACD Histogram", data: histogram, overlay: false });
    }

    return {
      ticker: normalizedTicker,
      type: "technical",
      labels,
      datasets: baseDatasets,
      options: {
        chartType: "line",
        panels: {
          price: ["Close", "SMA 20", "SMA 50", "SMA 200"],
          volume: ["Volume"],
          momentum: ["RSI 14", "MACD", "MACD Signal", "MACD Histogram"],
        },
        rsiBounds: { overbought: 70, oversold: 30 },
      },
      indicators: technicalIndicators,
    };
  }

  private async getCandlesForPeriod(ticker: string, period: ChartParams["period"]): Promise<DailyCandle[]> {
    const days = PERIOD_TO_DAYS[period];
    const candles = await this.deps.marketData.fetchCandles(ticker, days);
    if (candles.length === 0) {
      throw new Error(`No candles available for ${ticker}`);
    }
    return candles.slice(-days);
  }
}

function getSharedDates(candleGroups: DailyCandle[][]): string[] {
  if (candleGroups.length === 0) {
    return [];
  }
  let intersection = new Set(candleGroups[0]?.map((candle) => candle.date) ?? []);
  for (let i = 1; i < candleGroups.length; i += 1) {
    const current = new Set(candleGroups[i]?.map((candle) => candle.date) ?? []);
    intersection = new Set([...intersection].filter((date) => current.has(date)));
  }
  return [...intersection].sort((a, b) => a.localeCompare(b));
}

function buildSmaSeries(candles: DailyCandle[], period: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < candles.length; i += 1) {
    const value = sma(candles.slice(0, i + 1), period);
    out.push(value === null ? 0 : Number(value.toFixed(4)));
  }
  return out;
}

function buildRsiSeries(candles: DailyCandle[], period: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < candles.length; i += 1) {
    const value = rsi(candles.slice(0, i + 1), period);
    out.push(value === null ? 0 : Number(value.toFixed(4)));
  }
  return out;
}

function buildMacdSeries(closes: number[]): { macdLine: number[]; signalLine: number[]; histogram: number[] } {
  const macdLine: number[] = [];
  const signalLine: number[] = [];
  const histogram: number[] = [];

  for (let i = 0; i < closes.length; i += 1) {
    const value = macd(closes.slice(0, i + 1));
    if (value === null) {
      macdLine.push(0);
      signalLine.push(0);
      histogram.push(0);
      continue;
    }
    macdLine.push(Number(value.macd.toFixed(6)));
    signalLine.push(Number(value.signal.toFixed(6)));
    histogram.push(Number(value.histogram.toFixed(6)));
  }

  return { macdLine, signalLine, histogram };
}

function pickColor(index: number): string {
  const palette = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0e7490"];
  return palette[index % palette.length] ?? "#334155";
}

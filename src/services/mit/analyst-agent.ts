import type {
  AnalystQueryRequest,
  AnalystQueryResponse,
  CompositeScore,
  DailyCandle,
  FundamentalSnapshot,
  NTLiteChecklistResult,
  PeerComparison,
  TechnicalSnapshot,
  MitUniverseEntry,
} from "../../mit-types.js";
import type { MitStore } from "../../mit-store.js";
import { MIT_UNIVERSE } from "./universe-loader.js";
import { scoreComposite } from "./composite-scorer.js";
import { evaluateNtLiteChecklist } from "./nt-lite-checklist.js";
import { computePeerMedianPEBySector, peerMedianForTicker } from "./peer-comparison.js";
import { computeTechnicalSnapshot, macd } from "./technical-indicators.js";
import { MarketDataService } from "./market-data.js";

export interface FundamentalAnalysis {
  score: CompositeScore;
  checklist: NTLiteChecklistResult;
  peers: PeerComparison[];
}

export interface TechnicalAnalysis {
  snapshot: TechnicalSnapshot;
  trend: "bullish" | "bearish" | "neutral";
  signals: string[];
}

export interface HistoricalAnalysis {
  returns: { period: string; value: number }[];
  volatility: number;
  cagr: number;
  maxDrawdown: number;
}

const PERIOD_TO_DAYS: Record<string, number> = {
  "1M": 21,
  "3M": 63,
  "6M": 126,
  "1Y": 252,
  "2Y": 504,
  "5Y": 1260,
};

const RETURN_PERIODS: Array<{ label: string; days: number }> = [
  { label: "1M", days: 21 },
  { label: "3M", days: 63 },
  { label: "6M", days: 126 },
  { label: "1Y", days: 252 },
  { label: "2Y", days: 504 },
  { label: "5Y", days: 1260 },
];

export class AnalystAgent {
  private readonly universe: MitUniverseEntry[];

  constructor(private readonly deps: { mitStore: MitStore; marketData: MarketDataService }) {
    this.universe = [...MIT_UNIVERSE];
  }

  async analyzeFundamentals(ticker: string): Promise<FundamentalAnalysis> {
    const symbol = ticker.toUpperCase();
    const state = await this.deps.mitStore.read();
    const fundamentals = state.fundamentals[symbol];
    if (!fundamentals) {
      throw new Error(`Fundamentals not found for ${symbol}`);
    }

    const candles = state.candles[symbol] ?? (await this.deps.marketData.fetchCandles(symbol, 300));
    const technicals = state.technicals[symbol] ?? computeTechnicalSnapshot(symbol, candles);
    if (!technicals) {
      throw new Error(`Technicals unavailable for ${symbol}`);
    }

    const peerUniverse = this.universe.map((item) => ({ ticker: item.ticker.toUpperCase(), sector: item.sector }));
    const peerMedianBySector = Object.keys(state.peerMedianPE).length > 0
      ? state.peerMedianPE
      : computePeerMedianPEBySector(peerUniverse, state.fundamentals);
    const peerMedianPE = peerMedianForTicker(symbol, peerUniverse, peerMedianBySector);
    const sector = this.universe.find((item) => item.ticker.toUpperCase() === symbol)?.sector ?? null;

    const checklist = evaluateNtLiteChecklist(fundamentals, { sector, peerMedianPE });
    const score = state.compositeScores[symbol] ?? scoreComposite({
      ticker: symbol,
      fundamentals,
      technicals,
      peerMedianPE,
      promoterHoldingTrendStable: true,
    });

    const peers = this.buildPeerComparison(symbol, state.fundamentals, state.compositeScores, sector);
    return { score, checklist, peers };
  }

  async analyzeTechnicals(ticker: string): Promise<TechnicalAnalysis> {
    const symbol = ticker.toUpperCase();
    const candles = await this.deps.marketData.fetchCandles(symbol, 300);
    const snapshot = computeTechnicalSnapshot(symbol, candles);
    if (!snapshot) {
      throw new Error(`Insufficient candles for ${symbol}`);
    }

    const closes = candles.map((item) => item.close);
    const macdSnapshot = macd(closes);

    const bullishStructure = snapshot.dma50 !== null
      && snapshot.dma200 !== null
      && snapshot.latestClose > snapshot.dma50
      && snapshot.dma50 > snapshot.dma200;
    const bearishStructure = snapshot.dma50 !== null
      && snapshot.dma200 !== null
      && snapshot.latestClose < snapshot.dma50
      && snapshot.dma50 < snapshot.dma200;
    const macdBullish = (macdSnapshot?.histogram ?? 0) > 0;
    const macdBearish = (macdSnapshot?.histogram ?? 0) < 0;

    let trend: "bullish" | "bearish" | "neutral" = "neutral";
    if (bullishStructure && macdBullish) {
      trend = "bullish";
    } else if (bearishStructure && macdBearish) {
      trend = "bearish";
    }

    const signals: string[] = [];
    if (snapshot.rsi14 !== null) {
      if (snapshot.rsi14 >= 70) {
        signals.push("RSI overbought");
      } else if (snapshot.rsi14 <= 30) {
        signals.push("RSI oversold");
      } else {
        signals.push(`RSI neutral (${snapshot.rsi14.toFixed(1)})`);
      }
    }
    if (snapshot.dma50 !== null) {
      signals.push(snapshot.latestClose >= snapshot.dma50 ? "Price above 50-DMA" : "Price below 50-DMA");
    }
    if (snapshot.dma200 !== null) {
      signals.push(snapshot.latestClose >= snapshot.dma200 ? "Price above 200-DMA" : "Price below 200-DMA");
    }
    if (macdSnapshot) {
      signals.push(macdSnapshot.histogram >= 0 ? "MACD bullish momentum" : "MACD bearish momentum");
    }

    return { snapshot, trend, signals };
  }

  async analyzeHistorical(ticker: string, period: string): Promise<HistoricalAnalysis> {
    const symbol = ticker.toUpperCase();
    const requestedDays = this.resolvePeriodDays(period);
    const candles = await this.deps.marketData.fetchCandles(symbol, Math.max(1260, requestedDays));
    if (candles.length < 2) {
      throw new Error(`Insufficient historical candles for ${symbol}`);
    }

    const returns = RETURN_PERIODS
      .filter((item) => candles.length > item.days)
      .map((item) => ({ period: item.label, value: this.computeReturn(candles, item.days) }));

    if (!PERIOD_TO_DAYS[period] && requestedDays > 0 && candles.length > requestedDays) {
      returns.push({ period, value: this.computeReturn(candles, requestedDays) });
    }

    const window = candles.slice(-Math.min(requestedDays, candles.length));
    return {
      returns,
      volatility: this.computeAnnualizedVolatility(window),
      cagr: this.computeCagr(window),
      maxDrawdown: this.computeMaxDrawdown(window),
    };
  }

  async calculateCustomMetric(ticker: string, metric: string): Promise<number | null> {
    const symbol = ticker.toUpperCase();
    const metricKey = metric.trim().toLowerCase();
    const state = await this.deps.mitStore.read();

    if (metricKey.startsWith("roi")) {
      const position = state.portfolio.positions.find((item) => item.ticker.toUpperCase() === symbol);
      const entry = position?.entryPrice;
      const current = await this.getCurrentPrice(symbol, state.technicals[symbol]?.latestClose ?? null);
      if (!entry || entry <= 0 || current === null) {
        return null;
      }
      return (current - entry) / entry;
    }

    if (metricKey.startsWith("fire")) {
      const annualExpenses = this.parseAnnualExpenses(metricKey) ?? this.parseNumber(process.env.MIT_ANNUAL_EXPENSES);
      if (annualExpenses === null || annualExpenses <= 0) {
        return null;
      }
      const holdingsValue = state.portfolio.positions.reduce((sum, item) => sum + item.currentPrice * item.qty, 0);
      const portfolioValue = state.portfolio.cash + holdingsValue;
      return portfolioValue / annualExpenses;
    }

    const fundamentals = state.fundamentals[symbol];
    if (!fundamentals) {
      return null;
    }

    switch (metricKey) {
      case "pe":
        return fundamentals.pe;
      case "peg":
        return fundamentals.peg;
      case "roce":
        return fundamentals.roce;
      case "roe":
        return fundamentals.roe;
      case "de":
      case "debt_to_equity":
      case "debt-to-equity":
        return fundamentals.debtToEquity;
      case "market_cap":
      case "marketcap":
        return fundamentals.marketCap;
      default:
        return null;
    }
  }

  async processRequest(request: AnalystQueryRequest): Promise<AnalystQueryResponse> {
    const ticker = request.ticker.toUpperCase();
    const response: AnalystQueryResponse = {
      ticker,
      analysisType: request.analysisType,
    };

    if (request.analysisType === "fundamental" || request.analysisType === "full") {
      response.fundamentals = await this.analyzeFundamentals(ticker);
    }

    if (request.analysisType === "technical" || request.analysisType === "full") {
      const technicalAnalysis = await this.analyzeTechnicals(ticker);
      response.technicals = technicalAnalysis.snapshot;
    }

    if (request.analysisType === "historical" || request.analysisType === "full") {
      const historical = await this.analyzeHistorical(ticker, request.params?.period ?? "1Y");
      response.historical = {
        returns: historical.returns,
        volatility: historical.volatility,
        cagr: historical.cagr,
      };
    }

    if (request.analysisType === "custom" || request.analysisType === "full") {
      const metrics = request.params?.customMetrics ?? ["roi", "fire"];
      const customMetrics: Record<string, number> = {};
      for (const metric of metrics) {
        const value = await this.calculateCustomMetric(ticker, metric);
        if (value !== null) {
          customMetrics[metric] = value;
        }
      }
      if (Object.keys(customMetrics).length > 0) {
        response.customMetrics = customMetrics;
      }
    }

    return response;
  }

  private resolvePeriodDays(period: string): number {
    const normalized = period.trim().toUpperCase();
    if (PERIOD_TO_DAYS[normalized]) {
      return PERIOD_TO_DAYS[normalized];
    }

    const match = normalized.match(/^(\d+)(D|W|M|Y)$/);
    if (!match) {
      return PERIOD_TO_DAYS["1Y"] ?? 252;
    }

    const value = Number.parseInt(match[1] ?? "0", 10);
    const unit = match[2];
    if (unit === "D") return Math.max(2, value);
    if (unit === "W") return Math.max(2, value * 5);
    if (unit === "M") return Math.max(2, value * 21);
    return Math.max(2, value * 252);
  }

  private computeReturn(candles: DailyCandle[], days: number): number {
    const end = candles[candles.length - 1]?.close;
    const start = candles[candles.length - 1 - days]?.close;
    if (end === undefined || start === undefined || start <= 0) {
      return 0;
    }
    return (end - start) / start;
  }

  private computeAnnualizedVolatility(candles: DailyCandle[]): number {
    if (candles.length < 3) {
      return 0;
    }
    const returns: number[] = [];
    for (let i = 1; i < candles.length; i += 1) {
      const current = candles[i]?.close;
      const previous = candles[i - 1]?.close;
      if (current === undefined || previous === undefined || previous <= 0) {
        continue;
      }
      returns.push((current - previous) / previous);
    }
    if (returns.length < 2) {
      return 0;
    }
    const mean = returns.reduce((sum, item) => sum + item, 0) / returns.length;
    const variance = returns.reduce((sum, item) => sum + (item - mean) ** 2, 0) / (returns.length - 1);
    return Math.sqrt(Math.max(0, variance)) * Math.sqrt(252);
  }

  private computeCagr(candles: DailyCandle[]): number {
    if (candles.length < 2) {
      return 0;
    }
    const start = candles[0]?.close;
    const end = candles[candles.length - 1]?.close;
    if (start === undefined || end === undefined || start <= 0 || end <= 0) {
      return 0;
    }
    const years = candles.length / 252;
    if (years <= 0) {
      return 0;
    }
    return (end / start) ** (1 / years) - 1;
  }

  private computeMaxDrawdown(candles: DailyCandle[]): number {
    if (candles.length < 2) {
      return 0;
    }
    let peak = candles[0]?.close ?? 0;
    let maxDrawdown = 0;
    for (const candle of candles) {
      if (candle.close > peak) {
        peak = candle.close;
      }
      if (peak <= 0) {
        continue;
      }
      const drawdown = (peak - candle.close) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    return maxDrawdown;
  }

  private buildPeerComparison(
    ticker: string,
    fundamentalsByTicker: Record<string, FundamentalSnapshot>,
    scoresByTicker: Record<string, CompositeScore>,
    sector: string | null,
  ): PeerComparison[] {
    if (!sector) {
      return [];
    }

    const peersInSector = this.universe
      .filter((item) => item.sector === sector && item.ticker.toUpperCase() !== ticker)
      .map((item) => item.ticker.toUpperCase())
      .slice(0, 8);

    const rows: PeerComparison[] = [];
    for (const peerTicker of peersInSector) {
      const fundamentals = fundamentalsByTicker[peerTicker];
      if (!fundamentals) {
        continue;
      }
      rows.push({
        ticker: peerTicker,
        sector,
        pe: fundamentals.pe,
        roe: fundamentals.roe,
        roce: fundamentals.roce,
        compositeScore: scoresByTicker[peerTicker]?.total ?? null,
      });
    }
    return rows;
  }

  private async getCurrentPrice(ticker: string, cached: number | null): Promise<number | null> {
    if (cached !== null) {
      return cached;
    }
    const candles = await this.deps.marketData.fetchCandles(ticker, 2).catch(() => []);
    return candles[candles.length - 1]?.close ?? null;
  }

  private parseAnnualExpenses(metric: string): number | null {
    const fromExpr = metric.match(/fire[^\d]*(\d+(?:\.\d+)?)/);
    if (fromExpr && fromExpr[1]) {
      return Number.parseFloat(fromExpr[1]);
    }
    return null;
  }

  private parseNumber(raw: string | undefined): number | null {
    if (!raw) {
      return null;
    }
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
}

import type { DailyCandle, FundamentalSnapshot, MitWatchlistIdea, TechnicalSnapshot } from "../../mit-types.js";
import { atrPct, beta, calculateReturns, rSquared, sma } from "./technical-indicators.js";
import { MarketDataService } from "./market-data.js";
import mitUniverse from "../../config/mit-universe.json" with { type: "json" };

export interface HeroScore {
  symbol: string;
  totalScore: number;
  narrative: string;
  metrics: {
    atrPct: number;
    beta: number;
    r2: number;
    sectorTrend: "Up" | "Down";
  };
  candidate: MitWatchlistIdea;
}

export interface HeroAnalysisResult {
  scanned: number;
  validCandidates: number;
  heroPick: HeroScore | null;
  allCandidates: HeroScore[];
  fallbackPick: HeroScore | null;
}

const SECTOR_INDEX_MAP: Record<string, string> = {
  it: "NIFTY IT",
  bfsi: "NIFTY BANK",
  auto: "NIFTY AUTO",
  pharma: "NIFTY PHARMA",
  consumer: "NIFTY CONSUMER",
  energy: "NIFTY ENERGY",
  infra: "NIFTY INFRA",
  metals: "NIFTY METAL",
  power: "NIFTY POWER",
  materials: "NIFTY MATERIALS",
  telecom: "NIFTY COMMS",
  healthcare: "NIFTY HEALTHCARE",
};

const DEFAULT_WEIGHTS = {
  volatility: 0.3,
  trend: 0.3,
  correlation: 0.2,
  sector: 0.2,
};

const DEFAULT_THRESHOLDS = {
  maxBeta: 1.5,
  minR2: 0.5,
  minTurnoverCr: 5,
};

export class HeroAnalyst {
  private marketData: MarketDataService | null = null;
  private benchmarkCache: Map<string, DailyCandle[]> = new Map();
  private readonly sectorByTicker = new Map(
    (mitUniverse as Array<{ ticker: string; sector: string }>).map((row) => [row.ticker.toUpperCase(), row.sector.toLowerCase()]),
  );

  constructor(private config?: { weights?: typeof DEFAULT_WEIGHTS; thresholds?: typeof DEFAULT_THRESHOLDS }) {
    this.config = {
      weights: { ...DEFAULT_WEIGHTS, ...config?.weights },
      thresholds: { ...DEFAULT_THRESHOLDS, ...config?.thresholds },
    };
  }

  setMarketDataService(service: MarketDataService): void {
    this.marketData = service;
  }

  async analyzeCandidates(candidates: MitWatchlistIdea[]): Promise<HeroAnalysisResult> {
    const scanned = candidates.length;
    const scoredCandidates: HeroScore[] = [];

    for (const candidate of candidates) {
      const score = await this.scoreCandidate(candidate);
      if (score !== null) {
        scoredCandidates.push(score);
      }
    }

    scoredCandidates.sort((a, b) => b.totalScore - a.totalScore);

    const heroPick = scoredCandidates.length > 0 ? scoredCandidates[0] ?? null : null;
    const fallbackPick = scoredCandidates.length > 1 ? scoredCandidates[1] ?? null : null;

    return {
      scanned,
      validCandidates: scoredCandidates.length,
      heroPick,
      allCandidates: scoredCandidates,
      fallbackPick,
    };
  }

  private async scoreCandidate(candidate: MitWatchlistIdea): Promise<HeroScore | null> {
    const { ticker, technicals } = candidate;

    let candles: DailyCandle[] | null = null;
    if (this.marketData && technicals.latestClose) {
      try {
        candles = await this.marketData.fetchCandles(ticker, 300);
      } catch {
        return null;
      }
    }
    if (!candles || candles.length < 90) {
      return null;
    }

    const volatilityScore = this.scoreVolatility(candles);
    const correlation = await this.scoreCorrelation(candles, ticker);
    const trendScore = this.scoreTrend(candles);
    const sectorScore = await this.scoreSector(candles, candidate);

    if (correlation === null) {
      return null;
    }

    const weights = this.config!.weights!;
    const totalScore =
      volatilityScore * weights.volatility +
      trendScore * weights.trend +
      correlation.score * weights.correlation +
      sectorScore * weights.sector;

    const narrative = this.buildNarrative(volatilityScore, correlation.score, trendScore, sectorScore, candidate);

    return {
      symbol: ticker,
      totalScore: Math.round(totalScore),
      narrative,
      metrics: {
        atrPct: this.getAtrPct(candles),
        beta: correlation.beta,
        r2: trendScore / 30,
        sectorTrend: sectorScore > 0 ? "Up" : "Down",
      },
      candidate,
    };
  }

  private scoreVolatility(candles: DailyCandle[]): number {
    const atrPctValue = atrPct(candles, 14);
    if (atrPctValue === null) {
      return 15;
    }

    const weights = this.config!.weights!;
    const maxScore = 30;

    const score = maxScore * (1 - (atrPctValue * 100 - 1) / 4);
    return Math.max(0, Math.min(maxScore, score));
  }

  private async scoreCorrelation(candles: DailyCandle[], ticker: string): Promise<{ score: number; beta: number } | null> {
    const stockReturns = calculateReturns(candles.map(c => c.close));

    let benchmarkCandles: DailyCandle[] | undefined;

    if (this.marketData) {
      if (!this.benchmarkCache.has("^NSEI")) {
        try {
          const data = await this.marketData.fetchCandles("^NSEI", 300);
          this.benchmarkCache.set("^NSEI", data);
        } catch {
          return null;
        }
      }
      benchmarkCandles = this.benchmarkCache.get("^NSEI");
    }

    if (!benchmarkCandles || benchmarkCandles.length < 30) {
      return { score: 10, beta: 1 };
    }

    const benchmarkReturns = calculateReturns(benchmarkCandles.map(c => c.close));
    const betaValue = beta(stockReturns, benchmarkReturns);

    if (betaValue === null) {
      return { score: 10, beta: 1 };
    }

    const maxScore = 20;
    let score: number;

    if (betaValue >= 0.8 && betaValue <= 1.2) {
      score = maxScore;
      return { score, beta: betaValue };
    }

    if (betaValue > 1.5) {
      score = Math.max(0, maxScore - (betaValue - 1.5) * 10);
      return { score, beta: betaValue };
    }

    if (betaValue < 0) {
      score = Math.max(0, 5 + betaValue * 2);
      return { score, beta: betaValue };
    }

    score = maxScore - Math.abs(betaValue - 1) * 10;
    return { score, beta: betaValue };
  }

  private scoreTrend(candles: DailyCandle[]): number {
    const closes = candles.slice(-90).map(c => c.close);
    const r2 = rSquared(closes);

    if (r2 === null) {
      return 15;
    }

    const maxScore = 30;
    const minR2 = this.config!.thresholds!.minR2;

    if (r2 >= 0.9) {
      return maxScore;
    }

    if (r2 < minR2) {
      return Math.max(0, (r2 / minR2) * 15);
    }

    return 15 + ((r2 - minR2) / (0.9 - minR2)) * 15;
  }

  private async scoreSector(candles: DailyCandle[], candidate: MitWatchlistIdea): Promise<number> {
    const sector = candidate.fundamentals.marketCap ? this.getSectorFromTicker(candidate.ticker) : null;
    if (!sector) {
      return 0;
    }

    const indexName = SECTOR_INDEX_MAP[sector];
    if (!indexName) {
      return 0;
    }

    let sectorCandles: DailyCandle[] | undefined;

    if (this.marketData) {
      const cached = this.benchmarkCache.get(indexName);
      if (cached) {
        sectorCandles = cached;
      } else {
        try {
          sectorCandles = await this.marketData.fetchCandles(indexName, 300);
          this.benchmarkCache.set(indexName, sectorCandles);
        } catch {
          return 0;
        }
      }
    }

    if (!sectorCandles || sectorCandles.length < 200) {
      return 0;
    }

    const sma50 = sma(sectorCandles, 50);
    const sma200 = sma(sectorCandles, 200);

    if (sma50 === null || sma200 === null) {
      return 0;
    }

    const latestClose = sectorCandles[sectorCandles.length - 1]?.close;
    if (!latestClose) {
      return 0;
    }

    if (latestClose > sma50 && sma50 > sma200) {
      return 20;
    }

    return 0;
  }

  private getSectorFromTicker(ticker: string): string | null {
    return this.sectorByTicker.get(ticker.toUpperCase()) ?? null;
  }

  private getAtrPct(candles: DailyCandle[]): number {
    const value = atrPct(candles, 14);
    return value !== null ? value * 100 : 0;
  }

  private buildNarrative(
    volScore: number,
    corrScore: number,
    trendScore: number,
    sectorScore: number,
    candidate: MitWatchlistIdea
  ): string {
    const parts: string[] = [];

    const atrVal = candidate.technicals.atr14;
    if (atrVal !== null) {
      const price = candidate.technicals.latestClose;
      if (price > 0) {
        const atrPctValue = (atrVal / price) * 100;
        parts.push(`Low vol (${atrPctValue.toFixed(1)}%)`);
      }
    }

    if (sectorScore > 0) {
      parts.push("Sector Breakout");
    }

    if (trendScore >= 25) {
      parts.push("Strong Trend");
    }

    if (parts.length === 0) {
      parts.push("Valid Setup");
    }

    return parts.join(" + ");
  }
}

export function createHeroAnalyst(config?: { weights?: typeof DEFAULT_WEIGHTS; thresholds?: typeof DEFAULT_THRESHOLDS }): HeroAnalyst {
  return new HeroAnalyst(config);
}

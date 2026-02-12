/**
 * MIT Screeni-py Connector Service
 * Integrates Screeni-py (Pranjal Joshi's NSE stock screener) with MIT Trading System.
 * Now uses REAL Yahoo Finance data - no mock, no simulation.
 */

import type { TechnicalSnapshot, CompositeScore, NTLiteChecklistResult } from "../../mit-types.js";
import { ScreeniPyService, type ScreeniPyRow } from "../screenipy.js";
import { nowIso } from "../../utils.js";

export interface ScreeniPyMITConfig {
  tickerOption?: string;
  executeOption?: string;
}

export interface MITScreeniPyRow {
  stock: string;
  ltp: string;
  volume: string;
  rsi: string;
  trend: string;
  pattern: string;
  ema20: string;
  ema50: string;
  sma20: string;
  sma50: string;
  macd: string;
  macdSignal: string;
  cci20: string;
  atr14: string;
  mitQualityScore: number;
  mitMomentumScore: number;
  mitOverallScore: number;
  fundamentalsAvailable: boolean;
  sector?: string;
}

export function mapScreeniPyToTechnical(row: ScreeniPyRow, ticker: string): TechnicalSnapshot {
  const rsi = parseFloat(row.rsi || "0");
  const ltp = parseFloat(row.ltp || "0");
  const volume = parseFloat(row.volume || "0");
  const ema20 = parseFloat(row.ema20 || "0");
  const ema50 = parseFloat(row.ema50 || "0");
  const sma20 = parseFloat(row.sma20 || "0");
  const sma50 = parseFloat(row.sma50 || "0");
  const macd = parseFloat(row.macd || "0");
  const macdSignal = parseFloat(row.macdSignal || "0");
  const cci20 = parseFloat(row.cci20 || "0");
  const atr14 = parseFloat(row.atr14 || "0");

  // Use EMA as DMA (Exponential Moving Average is the modern standard)
  const ema20Val = ema20 > 0 ? ema20 : sma20 > 0 ? sma20 : null;
  const ema50Val = ema50 > 0 ? ema50 : sma50 > 0 ? sma50 : null;
  const dma20: number | null = ema20Val;
  const dma50: number | null = ema50Val;
  
  // Calculate price vs DMA percentages
  const priceVsDma50Pct = dma50 ? ((ltp - dma50) / dma50) * 100 : null;
  const priceVsDma200Pct = null; // Not computed from daily scan

  return {
    ticker,
    computedAt: nowIso(),
    dma20: dma20,
    dma50: dma50,
    dma100: null,
    dma200: null,
    rsi14: rsi > 0 ? rsi : null,
    atr14: atr14 > 0 ? atr14 : null,
    returnZScore20d: null, // Requires historical data computation
    priceVsDma50Pct: priceVsDma50Pct,
    priceVsDma200Pct: priceVsDma200Pct,
    pullback5d: null, // Requires intraday/multi-day analysis
    latestClose: ltp,
    latestVolume: volume,
  };
}

export function enrichWithMITScores(rows: ScreeniPyRow[]): MITScreeniPyRow[] {
  return rows.map((row) => {
    const rsi = parseFloat(row.rsi || "0");
    const ema20 = parseFloat(row.ema20 || "0");
    const ema50 = parseFloat(row.ema50 || "0");
    const macd = parseFloat(row.macd || "0");
    const macdSignal = parseFloat(row.macdSignal || "0");
    const cci20 = parseFloat(row.cci20 || "0");
    const atr14 = parseFloat(row.atr14 || "0");
    
    // Quality Score: based on trend strength and technical alignment
    let qualityScore = 50;
    
    // RSI quality contribution (sweet spot 45-65)
    if (rsi >= 45 && rsi <= 65) qualityScore += 20;
    else if (rsi >= 30 && rsi < 45) qualityScore += 10;
    else if (rsi > 65 && rsi <= 75) qualityScore += 10;
    else if (rsi < 30 || rsi > 75) qualityScore -= 15;
    
    // Trend quality contribution
    const trendMap: Record<string, number> = { "Strong Up": 25, "Up": 15, "Sideways": 0, "Weak": -10, "Down": -20 };
    qualityScore += trendMap[row.trend] || 0;
    
    // MACD alignment (positive MACD above signal line = bullish)
    const macdAligned = macd > macdSignal;
    if (macdAligned && macd > 0) qualityScore += 10;
    else if (macdAligned) qualityScore += 5;
    
    // CCI contribution (extreme values signal momentum)
    if (cci20 > 100) qualityScore += 5;  // Strong bullish
    else if (cci20 > 50) qualityScore += 3;
    else if (cci20 < -100) qualityScore -= 5;  // Strong bearish
    else if (cci20 < -50) qualityScore -= 3;
    
    // Momentum Score: based on RSI position and MACD strength
    let momentumScore = 50;
    momentumScore += (rsi - 50) * 0.6;
    
    // MACD momentum contribution
    if (macd > 0) momentumScore += 10;
    if (macdAligned) momentumScore += 10;
    
    // Pattern bonus
    const bullishPatterns = ["Bullish Engulfing", "Hammer", "Morning Star", "Breakout", "Golden Cross"];
    const isBullishPattern = bullishPatterns.some(p => row.pattern?.includes(p));
    if (isBullishPattern) momentumScore += 15;
    else if (row.pattern && !row.pattern.includes("None") && !row.pattern.includes("Doji")) momentumScore += 5;
    
    // ATR volatility context (higher ATR = more volatile = potentially larger moves)
    const normalizedVol = atr14 > 0 ? Math.min(atr14 / 100, 1) * 10 : 5;
    momentumScore += normalizedVol;
    
    qualityScore = Math.max(0, Math.min(100, qualityScore));
    momentumScore = Math.max(0, Math.min(100, momentumScore));
    
    return {
      stock: row.stock || row.Stock || "UNKNOWN",
      ltp: row.ltp || "",
      volume: row.volume || "",
      rsi: row.rsi || "",
      trend: row.trend || "",
      pattern: row.pattern || "",
      ema20: row.ema20 || "",
      ema50: row.ema50 || "",
      sma20: row.sma20 || "",
      sma50: row.sma50 || "",
      macd: row.macd || "",
      macdSignal: row.macdSignal || "",
      cci20: row.cci20 || "",
      atr14: row.atr14 || "",
      mitQualityScore: qualityScore,
      mitMomentumScore: momentumScore,
      mitOverallScore: Math.round((qualityScore * 0.4 + momentumScore * 0.6)),
      fundamentalsAvailable: false,
    };
  });
}

export class MITScreeniPyService {
  private readonly screeniPyService: ScreeniPyService;
  
  constructor() {
    this.screeniPyService = new ScreeniPyService();
  }
  
  async runScan(config: ScreeniPyMITConfig = {}): Promise<MITScreeniPyRow[]> {
    const tickerOption = config.tickerOption || "1";
    const executeOption = config.executeOption || "0";
    const rows = await this.screeniPyService.run({ tickerOption, executeOption });
    return enrichWithMITScores(rows);
  }
  
  async getTopCandidates(config: ScreeniPyMITConfig = {}, limit: number = 10): Promise<MITScreeniPyRow[]> {
    const results = await this.runScan(config);
    return results.sort((a, b) => (b.mitOverallScore || 0) - (a.mitOverallScore || 0)).slice(0, limit);
  }
  
  async getBreakoutCandidates(limit: number = 10): Promise<MITScreeniPyRow[]> {
    return this.getTopCandidates({ tickerOption: "5", executeOption: "1" }, limit);
  }
  
  async getHighRSIMomentum(limit: number = 10): Promise<MITScreeniPyRow[]> {
    const results = await this.runScan({ tickerOption: "5", executeOption: "0" });
    return results.filter(row => {
      const rsi = parseFloat(row.rsi || "0");
      return rsi >= 60 && rsi <= 75;
    }).sort((a, b) => (b.mitMomentumScore || 0) - (a.mitMomentumScore || 0)).slice(0, limit);
  }
  
  async getOversoldOpportunities(limit: number = 10): Promise<MITScreeniPyRow[]> {
    const results = await this.runScan({ tickerOption: "5", executeOption: "0" });
    return results.filter(row => {
      const rsi = parseFloat(row.rsi || "0");
      return rsi >= 30 && rsi <= 45;
    }).slice(0, limit);
  }
}

export function mergeScreeniPyWithChecklist(screeniPyRow: MITScreeniPyRow, checklistResult: NTLiteChecklistResult): CompositeScore {
  const ntLiteScore = (checklistResult.passCount / 8) * 60;
  const screeniPyScore = (screeniPyRow.mitOverallScore || 50) * 0.4;
  const total = Math.round(ntLiteScore + screeniPyScore);
  
  return {
    ticker: checklistResult.ticker,
    total,
    breakdown: {
      quality: Math.round(ntLiteScore * 0.4),
      growth: Math.round(ntLiteScore * 0.2),
      valuation: Math.round(ntLiteScore * 0.15),
      momentum: Math.round(screeniPyScore * 0.8),
      governance: Math.round(ntLiteScore * 0.25),
    },
    percentileRank: 0,
    evaluatedAt: nowIso(),
  };
}

export interface MITBatchScreenResult {
  scannedAt: string;
  tickerOption: string;
  executeOption: string;
  totalScanned: number;
  candidates: MITScreeniPyRow[];
  summary: { strongUp: number; breakoutPatterns: number; oversold: number; overbought: number };
}

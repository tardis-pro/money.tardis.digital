/**
 * MIT Screeni-py Connector Service
 * Integrates Screeni-py (Pranjal Joshi's NSE stock screener) with MIT Trading System.
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
  
  return {
    ticker,
    computedAt: nowIso(),
    dma20: null,
    dma50: null,
    dma100: null,
    dma200: null,
    rsi14: rsi > 0 ? rsi : null,
    atr14: null,
    returnZScore20d: null,
    priceVsDma50Pct: null,
    priceVsDma200Pct: null,
    pullback5d: null,
    latestClose: ltp,
    latestVolume: volume,
  };
}

export function enrichWithMITScores(rows: ScreeniPyRow[]): MITScreeniPyRow[] {
  return rows.map((row) => {
    const rsi = parseFloat(row.rsi || "0");
    let qualityScore = 50;
    
    if (rsi >= 45 && rsi <= 65) qualityScore += 25;
    else if (rsi >= 30 && rsi < 45) qualityScore += 10;
    else if (rsi > 65 && rsi <= 75) qualityScore += 10;
    else if (rsi < 30 || rsi > 75) qualityScore -= 15;
    
    const trendMap: Record<string, number> = { "Strong Up": 20, "Up": 10, "Sideways": 0, "Weak": -10, "Down": -20 };
    qualityScore += trendMap[row.trend] || 0;
    
    let momentumScore = 50;
    momentumScore += (rsi - 50) * 0.8;
    if (row.pattern && !row.pattern.includes("None")) momentumScore += 20;
    
    qualityScore = Math.max(0, Math.min(100, qualityScore));
    momentumScore = Math.max(0, Math.min(100, momentumScore));
    
    return {
      stock: row.stock || row.Stock || "UNKNOWN",
      ltp: row.ltp || "",
      volume: row.volume || "",
      rsi: row.rsi || "",
      trend: row.trend || "",
      pattern: row.pattern || "",
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

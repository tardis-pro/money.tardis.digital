import { nowIso } from "../../utils.js";
import type { MitPortfolioState, MitPosition } from "../../mit-types.js";
import type { HeroScore } from "./hero-analyst.js";

export interface BlacklistEntry {
  ticker: string;
  reason: string;
  addedAt: string;
  expiresAt: string;
}

export interface SurveillanceConfig {
  maxDailyLossPct: number;
  blacklistDurationDays: number;
  driftThresholdPct: number;
  checkIntervalMs: number;
}

const DEFAULT_CONFIG: SurveillanceConfig = {
  maxDailyLossPct: 2.0,
  blacklistDurationDays: 30,
  driftThresholdPct: 5.0,
  checkIntervalMs: 60000,
};

export class SurveillanceBot {
  private blacklist: Map<string, BlacklistEntry> = new Map();
  private config: SurveillanceConfig;
  private lastCheckTime: string | null = null;
  private lastCheckLoss: number = 0;

  constructor(config?: Partial<SurveillanceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  isBlacklisted(ticker: string): boolean {
    const entry = this.blacklist.get(ticker.toUpperCase());
    if (!entry) return false;
    
    if (new Date(entry.expiresAt) < new Date()) {
      this.blacklist.delete(ticker.toUpperCase());
      return false;
    }
    return true;
  }

  addToBlacklist(ticker: string, reason: string): void {
    const now = new Date();
    const expires = new Date(now.getTime() + this.config.blacklistDurationDays * 24 * 60 * 60 * 1000);
    
    this.blacklist.set(ticker.toUpperCase(), {
      ticker: ticker.toUpperCase(),
      reason,
      addedAt: nowIso(),
      expiresAt: expires.toISOString(),
    });
  }

  getBlacklist(): BlacklistEntry[] {
    const now = new Date();
    const active: BlacklistEntry[] = [];
    
    for (const entry of this.blacklist.values()) {
      if (new Date(entry.expiresAt) > now) {
        active.push(entry);
      }
    }
    
    return active;
  }

  checkKillSwitch(portfolio: MitPortfolioState): { triggered: boolean; action: string; details: string } {
    const deployed = portfolio.positions.reduce((sum, p) => sum + (p.qty * p.entryPrice), 0);
    const currentValue = portfolio.positions.reduce((sum, p) => sum + (p.qty * p.currentPrice), 0);
    
    if (deployed === 0) {
      return { triggered: false, action: "none", details: "No positions" };
    }

    const unrealizedPnl = currentValue - deployed;
    const unrealizedPnlPct = (unrealizedPnl / deployed) * 100;
    
    if (unrealizedPnlPct < -this.config.maxDailyLossPct) {
      return {
        triggered: true,
        action: "LIQUIDATE_ALL",
        details: `Daily loss ${Math.abs(unrealizedPnlPct).toFixed(2)}% exceeds ${this.config.maxDailyLossPct}% threshold`,
      };
    }

    return { triggered: false, action: "none", details: "Within limits" };
  }

  checkPositionDrift(position: MitPosition): { drifting: boolean; driftPct: number } {
    if (position.qty <= 0) {
      return { drifting: false, driftPct: 0 };
    }

    const expectedValue = position.qty * position.entryPrice;
    const currentValue = position.qty * position.currentPrice;
    
    if (expectedValue === 0) {
      return { drifting: false, driftPct: 0 };
    }

    const driftPct = Math.abs((currentValue - expectedValue) / expectedValue) * 100;
    
    return {
      drifting: driftPct > this.config.driftThresholdPct,
      driftPct,
    };
  }

  generateWhyExplanation(heroScore: HeroScore, allCandidates: Array<{
    symbol: string;
    totalScore: number;
    metrics: { atrPct: number; beta: number; r2: number };
  }>): string {
    const hero = heroScore;
    const others = allCandidates.filter(c => c.symbol !== hero.symbol);
    
    const explanations: string[] = [];
    
    explanations.push(`🏆 Selected ${hero.symbol} with score ${hero.totalScore}/100\n`);
    
    explanations.push(`📊 Score Breakdown:`);
    explanations.push(`   • Volatility: ATR ${hero.metrics.atrPct.toFixed(2)}% (target: <3%)`);
    explanations.push(`   • Beta: ${hero.metrics.beta.toFixed(2)} (target: 0.8-1.2)`);
    explanations.push(`   • Trend R²: ${hero.metrics.r2.toFixed(2)} (target: >0.9)`);
    explanations.push(`   • Sector: ${hero.metrics.sectorTrend}\n`);
    
    if (hero.candidate.thesis.length > 0) {
      explanations.push(`📝 Thesis:`);
      for (const t of hero.candidate.thesis.slice(0, 3)) {
        explanations.push(`   • ${t}`);
      }
      explanations.push("");
    }
    
    if (others.length > 0) {
      explanations.push(`🔍 Why not others?`);
      for (const other of others.slice(0, 3)) {
        const scoreDiff = hero.totalScore - other.totalScore;
        explanations.push(`   • ${other.symbol}: -${scoreDiff.toFixed(0)} pts (${other.metrics.atrPct.toFixed(1)}% ATR, β=${other.metrics.beta.toFixed(2)})`);
      }
    }
    
    const marketCap = hero.candidate.fundamentals.marketCap;
    if (marketCap) {
      explanations.push(`\n💰 Market Cap: ₹${(marketCap / 10000).toFixed(1)}L Cr`);
    }
    
    explanations.push(`\n💡 Say /hero to see current recommendation`);
    
    return explanations.join("\n");
  }

  createDriftAlert(position: MitPosition): string {
    const drift = this.checkPositionDrift(position);
    return `⚠️ *Position Drift Detected*

*Symbol:* ${position.ticker}
*Expected:* ${position.qty} shares @ ₹${position.entryPrice.toFixed(2)}
*Current:* ₹${position.currentPrice.toFixed(2)}
*Drift:* ${drift.driftPct.toFixed(2)}%

Please verify with your broker.`;
  }

  createKillSwitchAlert(portfolio: MitPortfolioState): string {
    const deployed = portfolio.positions.reduce((sum, p) => sum + (p.qty * p.entryPrice), 0);
    const currentValue = portfolio.positions.reduce((sum, p) => sum + (p.qty * p.currentPrice), 0);
    const pnl = currentValue - deployed;
    const pnlPct = (pnl / deployed) * 100;

    return `🛑 *KILL SWITCH TRIGGERED*

*Loss:* ₹${Math.abs(pnl).toFixed(0)} (${pnlPct.toFixed(2)}%)
*Threshold:* ${this.config.maxDailyLossPct}%

⚠️ ALL POSITIONS WILL BE LIQUIDATED

Contact administrator immediately.`;
  }

  getSurveillanceStatus(portfolio: MitPortfolioState): {
    blacklist: BlacklistEntry[];
    killSwitch: { triggered: boolean; lossPct: number };
    positions: Array<{ ticker: string; drifting: boolean; driftPct: number }>;
  } {
    const blacklist = this.getBlacklist();
    
    const deployed = portfolio.positions.reduce((sum, p) => sum + (p.qty * p.entryPrice), 0);
    const currentValue = portfolio.positions.reduce((sum, p) => sum + (p.qty * p.currentPrice), 0);
    const pnl = currentValue - deployed;
    const lossPct = deployed > 0 ? (pnl / deployed) * 100 : 0;
    
    const killSwitch = {
      triggered: lossPct < -this.config.maxDailyLossPct,
      lossPct,
    };
    
    const positions = portfolio.positions.map(p => ({
      ticker: p.ticker,
      ...this.checkPositionDrift(p),
    }));
    
    return { blacklist, killSwitch, positions };
  }
}

let surveillanceInstance: SurveillanceBot | null = null;

export function getSurveillanceBot(config?: Partial<SurveillanceConfig>): SurveillanceBot {
  if (!surveillanceInstance) {
    surveillanceInstance = new SurveillanceBot(config);
  }
  return surveillanceInstance;
}

import type { HeroScore } from "./mit/hero-analyst.js";
import type { MitWatchlistIdea, MitState } from "../mit-types.js";
import { nowIso } from "../utils.js";

export interface ChartConfig {
  type: string;
  data: {
    labels: string[];
    datasets: Array<{
      label: string;
      data: number[];
      backgroundColor?: string | string[];
      borderColor?: string;
      fill?: boolean;
    }>;
  };
  options?: Record<string, unknown>;
}

export interface ExtendedCandidate {
  rank: number;
  symbol: string;
  score: number;
  narrative: string;
  metrics: {
    atrPct: number;
    beta: number;
    r2: number;
    sectorTrend: string;
  };
  tradeDetails: {
    buyPrice: number;
    stopLoss: number;
    target: number;
  };
}

export class TelegramFeatureService {
  private readonly quickChartBaseUrl = "https://quickchart.io/chart";

  generatePriceChartUrl(ticker: string, candles: Array<{ date: string; close: number }>): string {
    const labels = candles.slice(-30).map(c => c.date.slice(5));
    const data = candles.slice(-30).map(c => c.close);

    const config: ChartConfig = {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: ticker,
          data,
          borderColor: "#4ade80",
          backgroundColor: "rgba(74, 222, 128, 0.1)",
          fill: true,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: `${ticker} - 30 Day Price` },
        },
        scales: {
          y: { beginAtZero: false },
        },
      },
    };

    const encodedConfig = encodeURIComponent(JSON.stringify(config));
    return `${this.quickChartBaseUrl}?c=${encodedConfig}`;
  }

  generateScoreBreakdownChartUrl(candidates: ExtendedCandidate[]): string {
    const labels = candidates.slice(0, 5).map(c => c.symbol);
    const scores = candidates.slice(0, 5).map(c => c.score);

    const config: ChartConfig = {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Score",
          data: scores,
          backgroundColor: ["#4ade80", "#60a5fa", "#f59e0b", "#ef4444", "#8b5cf6"],
        }],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: "Top 5 Hero Scores" },
        },
        scales: {
          y: { beginAtZero: true, max: 100 },
        },
      },
    };

    const encodedConfig = encodeURIComponent(JSON.stringify(config));
    return `${this.quickChartBaseUrl}?c=${encodedConfig}`;
  }

  generateVolatilityComparisonChartUrl(candidates: ExtendedCandidate[]): string {
    const labels = candidates.slice(0, 5).map(c => c.symbol);
    const atrPcts = candidates.slice(0, 5).map(c => c.metrics.atrPct);
    const betas = candidates.slice(0, 5).map(c => c.metrics.beta);

    const config: ChartConfig = {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "ATR%",
            data: atrPcts,
            backgroundColor: "#60a5fa",
          },
          {
            label: "Beta",
            data: betas,
            backgroundColor: "#f59e0b",
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: "Volatility Comparison" },
        },
      },
    };

    const encodedConfig = encodeURIComponent(JSON.stringify(config));
    return `${this.quickChartBaseUrl}?c=${encodedConfig}`;
  }

  formatTable(candidates: ExtendedCandidate[]): string {
    const lines: string[] = [];
    
    lines.push("```\nRank | Symbol    | Score | ATR%  | Beta  | Trend");
    lines.push("-----|-----------|-------|-------|-------|-------");
    
    for (const c of candidates.slice(0, 10)) {
      const rank = String(c.rank).padStart(2);
      const symbol = c.symbol.padEnd(9);
      const score = String(c.score).padStart(3);
      const atr = c.metrics.atrPct.toFixed(1).padStart(4);
      const beta = c.metrics.beta.toFixed(2).padStart(4);
      const trend = c.metrics.r2 > 0.8 ? "Strong" : c.metrics.r2 > 0.5 ? "Moderate" : "Weak";
      
      lines.push(`${rank}  | ${symbol} | ${score}  | ${atr}% | ${beta} | ${trend}`);
    }
    
    lines.push("```");
    return lines.join("\n");
  }

  formatExtendedMessage(candidate: ExtendedCandidate): string {
    return `📊 *Extended Hero Analysis*

🎖️ *Rank #${candidate.rank}: ${candidate.symbol}*
*Score:* ${candidate.score}/100

📝 *Why:*
${candidate.narrative}

📈 *Metrics:*
• ATR%: ${candidate.metrics.atrPct.toFixed(2)}%
• Beta: ${candidate.metrics.beta.toFixed(2)}
• R² (Trend): ${candidate.metrics.r2.toFixed(2)}
• Sector: ${candidate.metrics.sectorTrend}

💰 *Trade Details:*
• Buy @ ₹${candidate.tradeDetails.buyPrice.toFixed(0)}
• Stop @ ₹${candidate.tradeDetails.stopLoss.toFixed(0)}
• Target @ ₹${candidate.tradeDetails.target.toFixed(0)}

💡 Use /links ${candidate.symbol} for more info`;
  }

  generateCsvExport(candidates: ExtendedCandidate[]): string {
    const rows = ["rank,symbol,score,atr_pct,beta,r_squared,sector_trend,buy_price,stop_loss,target"];
    
    for (const c of candidates) {
      rows.push([
        String(c.rank),
        c.symbol,
        String(c.score),
        c.metrics.atrPct.toFixed(2),
        c.metrics.beta.toFixed(2),
        c.metrics.r2.toFixed(2),
        c.metrics.sectorTrend,
        c.tradeDetails.buyPrice.toFixed(2),
        c.tradeDetails.stopLoss.toFixed(2),
        c.tradeDetails.target.toFixed(2),
      ].join(","));
    }
    
    return rows.join("\n");
  }

  generateLinksMessage(ticker: string): string {
    const symbol = ticker.toUpperCase();
    
    const links: Array<{ label: string; url: string }> = [
      { label: "📊 Screener.in", url: `https://www.screener.in/company/${symbol}/` },
      { label: "📈 Yahoo Finance", url: `https://finance.yahoo.com/quote/${symbol}.NS/` },
      { label: "💰 NSE India", url: `https://www.nseindia.com/get-quotes/equity?symbol=${symbol}` },
      { label: "📰 Google News", url: `https://news.google.com/search?q=${symbol}+stock+india` },
      { label: "📄 Moneycontrol", url: `https://www.moneycontrol.com/india/stockpricequote/${symbol.toLowerCase()}` },
    ];

    let message = `🔗 *Quick Links for ${symbol}*\n\n`;
    
    for (const link of links) {
      message += `${link.label}: ${link.url}\n\n`;
    }
    
    message += "💡 Balance sheet available on Screener.in (Financials tab)";
    
    return message;
  }

  generateVizMessage(ticker1: string, ticker2: string, chartUrls: string[]): string {
    return `📈 *Price Visualization*

Stocks: ${ticker1} vs ${ticker2}

[Chart 1 - Price History](${chartUrls[0]})
[Chart 2 - Score Comparison](${chartUrls[1]})

💡 Click links to view charts`;
  }

  convertHeroScoreToExtended(hero: HeroScore, rank: number): ExtendedCandidate {
    return {
      rank,
      symbol: hero.symbol,
      score: hero.totalScore,
      narrative: hero.narrative,
      metrics: {
        atrPct: hero.metrics.atrPct,
        beta: hero.metrics.beta,
        r2: hero.metrics.r2,
        sectorTrend: hero.metrics.sectorTrend,
      },
      tradeDetails: {
        buyPrice: hero.candidate.entryExitPlan?.buyZoneHigh ?? 0,
        stopLoss: hero.candidate.entryExitPlan?.stopLoss ?? 0,
        target: hero.candidate.entryExitPlan?.firstTarget ?? 0,
      },
    };
  }

  getExtendedCandidates(allCandidates: HeroScore[], requestedRank: number): ExtendedCandidate[] {
    return allCandidates.map((hero, index) => this.convertHeroScoreToExtended(hero, index + 1));
  }

  generateHelpMessage(): string {
    return `📖 *Available Commands*

📊 *Analysis:*
/hero - Get current hero pick with buttons
/why - Why was this stock selected
/extended [n] - Show nth ranked stock (default: 6)
/extended 10 - Show top 10 ranking

📈 *Visualization:*
/viz - Chart for last 2 analyzed stocks
/viz TCS INFY - Chart for specific stocks

📊 *Export:*
/export - Get CSV of all candidates
/table - View ranking table

🔗 *Research:*
/links SYMBOL - Balance sheet & news links
/status - Portfolio surveillance

💡 *Need Help?*
/help - Show this message`;
  }
}

let featureServiceInstance: TelegramFeatureService | null = null;

export function getTelegramFeatureService(): TelegramFeatureService {
  if (!featureServiceInstance) {
    featureServiceInstance = new TelegramFeatureService();
  }
  return featureServiceInstance;
}

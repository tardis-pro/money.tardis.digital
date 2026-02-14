import type { EntryExitPlan, MitDailyRunResult, MitWatchlistIdea, TechnicalSnapshot } from "../../mit-types.js";
import type { FundamentalSnapshot } from "../../mit-types.js";

const COOLDOWN_DAYS = 5;

export interface QuantSignalInput {
  ticker: string;
  technicals: TechnicalSnapshot;
  fundamentals: FundamentalSnapshot;
  entryExitPlan: EntryExitPlan;
  zScoreThreshold: number;
}

export function qualifiesQuantSignal(input: QuantSignalInput): boolean {
  const t = input.technicals;
  const zPass = (t.returnZScore20d ?? Number.NEGATIVE_INFINITY) >= input.zScoreThreshold;
  const trendPass = t.dma100 !== null && t.latestClose > t.dma100;
  const pullbackPass = (t.pullback5d ?? 1) < 0.05;
  return zPass && trendPass && pullbackPass;
}

export function selectTopQuantSignals(
  inputs: QuantSignalInput[],
  topDecileCount: number,
  recentRuns?: MitDailyRunResult[],
): QuantSignalInput[] {
  const coolingOff = buildCooldownSet(recentRuns ?? []);
  const filtered = inputs.filter((x) => qualifiesQuantSignal(x) && !coolingOff.has(x.ticker));
  return filtered
    .sort((a, b) => (b.technicals.returnZScore20d ?? -Infinity) - (a.technicals.returnZScore20d ?? -Infinity))
    .slice(0, Math.max(1, topDecileCount));
}

function buildCooldownSet(runs: MitDailyRunResult[]): Set<string> {
  const tickers = new Set<string>();
  const cutoff = Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  for (const run of runs) {
    const runTs = Date.parse(run.date);
    if (!Number.isFinite(runTs) || runTs < cutoff) continue;
    for (const idea of run.ideas) {
      if (idea.feed === "quant" && !idea.isAvoid) {
        tickers.add(idea.ticker);
      }
    }
  }
  return tickers;
}

export function toQuantIdea(input: QuantSignalInput): MitWatchlistIdea {
  return {
    id: `mit-idea-${input.ticker}-${Date.now()}`,
    date: new Date().toISOString().slice(0, 10),
    ticker: input.ticker,
    feed: "quant",
    thesis: [
      "Top decile momentum setup",
      "Price above 100-DMA",
      "Controlled pullback in recent sessions",
    ],
    compositeScore: {
      ticker: input.ticker,
      total: 0,
      breakdown: { quality: 0, growth: 0, valuation: 0, momentum: 0, governance: 0 },
      percentileRank: 0,
      evaluatedAt: new Date().toISOString(),
    },
    entryExitPlan: input.entryExitPlan,
    technicals: input.technicals,
    fundamentals: input.fundamentals,
    momentumLabel: `Z:${(input.technicals.returnZScore20d ?? 0).toFixed(2)} RSI:${(input.technicals.rsi14 ?? 0).toFixed(1)}`,
    risks: [],
    isAvoid: false,
    avoidReason: null,
  };
}

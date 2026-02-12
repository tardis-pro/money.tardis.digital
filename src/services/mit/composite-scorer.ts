import type {
  CompositeScore,
  CompositeScoreBreakdown,
  FundamentalSnapshot,
  TechnicalSnapshot,
} from "../../mit-types.js";

export function scoreComposite(input: {
  ticker: string;
  fundamentals: FundamentalSnapshot;
  technicals: TechnicalSnapshot;
  peerMedianPE: number | null;
  promoterHoldingTrendStable: boolean;
}): CompositeScore {
  const breakdown: CompositeScoreBreakdown = {
    quality: scoreQuality(input.fundamentals),
    growth: scoreGrowth(input.fundamentals),
    valuation: scoreValuation(input.fundamentals, input.peerMedianPE),
    momentum: scoreMomentum(input.technicals),
    governance: scoreGovernance(input.fundamentals, input.promoterHoldingTrendStable),
  };
  const total = round1(breakdown.quality + breakdown.growth + breakdown.valuation + breakdown.momentum + breakdown.governance);
  return {
    ticker: input.ticker,
    total,
    breakdown,
    percentileRank: 0,
    evaluatedAt: new Date().toISOString(),
  };
}

export function applyPercentile(scores: CompositeScore[]): CompositeScore[] {
  const sorted = [...scores].sort((a, b) => a.total - b.total);
  const lastIndex = Math.max(1, sorted.length - 1);
  return sorted.map((score, index) => ({
    ...score,
    percentileRank: round1((index / lastIndex) * 100),
  }));
}

function scoreQuality(f: FundamentalSnapshot): number {
  const roceOrRoe = f.roce ?? f.roe;
  const returns = linearScale(roceOrRoe ?? 0, 10, 20, 15);
  const fcfPositives = f.fcfHistory.slice(-5).filter((x) => x.value > 0).length;
  const fcf = fcfPositives >= 5 ? 10 : fcfPositives >= 3 ? 5 : 0;
  const opmSlope = slope(f.opmHistory.slice(-5));
  const opm = opmSlope > 0.5 ? 10 : opmSlope >= 0 ? 5 : 0;
  const leverage = f.debtToEquity !== null && f.debtToEquity < 0.5
    ? 5
    : f.interestCoverage !== null && f.interestCoverage > 5
      ? 5
      : f.debtToEquity !== null && f.debtToEquity <= 1
        ? 2.5
        : 0;
  return round1(returns + fcf + opm + leverage);
}

function scoreGrowth(f: FundamentalSnapshot): number {
  const revenue = linearScale(Math.max(f.revenueCAGR_3y ?? -1, f.revenueCAGR_5y ?? -1), 0, 20, 10);
  const eps = linearScale(Math.max(f.epsCAGR_3y ?? -1, f.epsCAGR_5y ?? -1), 0, 25, 10);
  return round1(revenue + eps);
}

function scoreValuation(f: FundamentalSnapshot, peerMedianPE: number | null): number {
  let peg = 0;
  if (f.peg !== null) {
    peg = f.peg <= 0.8 ? 10 : f.peg <= 1.0 ? 7 : f.peg <= 1.2 ? 5 : 0;
  }
  let pe = 0;
  if (f.pe !== null && peerMedianPE !== null) {
    pe = f.pe < peerMedianPE ? 5 : f.pe <= peerMedianPE * 1.1 ? 2.5 : 0;
  }
  return round1(peg + pe);
}

function scoreMomentum(t: TechnicalSnapshot): number {
  const above50 = t.dma50 !== null && t.latestClose > t.dma50 ? 5 : 0;
  const above200 = t.dma200 !== null && t.latestClose > t.dma200 ? 5 : 0;
  const rsi = t.rsi14;
  const rsiScore = rsi !== null && rsi >= 45 && rsi <= 65 ? 5 : rsi !== null && rsi >= 30 && rsi <= 70 ? 2.5 : 0;
  return round1(above50 + above200 + rsiScore);
}

function scoreGovernance(f: FundamentalSnapshot, stablePromoter: boolean): number {
  const promoter = stablePromoter ? 5 : 0;
  const pledge = f.promoterPledgePct === null ? 0 : f.promoterPledgePct === 0 ? 3 : f.promoterPledgePct < 5 ? 1.5 : 0;
  const audit = f.auditorRemarks === "clean" ? 2 : 0;
  return round1(promoter + pledge + audit);
}

function linearScale(value: number, min: number, max: number, maxPoints: number): number {
  if (value <= min) {
    return 0;
  }
  if (value >= max) {
    return maxPoints;
  }
  return ((value - min) / (max - min)) * maxPoints;
}

function slope(values: Array<{ fy: string; value: number }>): number {
  if (values.length < 2) {
    return 0;
  }
  const n = values.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i += 1) {
    const y = values[i]?.value;
    if (y === undefined) {
      continue;
    }
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumX2 += i * i;
  }
  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) {
    return 0;
  }
  return (n * sumXY - sumX * sumY) / denominator;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

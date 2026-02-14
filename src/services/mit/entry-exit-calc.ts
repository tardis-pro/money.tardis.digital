import type { DailyCandle, EntryExitPlan, FundamentalSnapshot, MitFeed, MitMarketTone, TechnicalSnapshot } from "../../mit-types.js";

export interface EntryExitInput {
  ticker: string;
  feed: MitFeed;
  technicals: TechnicalSnapshot;
  candles: DailyCandle[];
  fundamentals?: FundamentalSnapshot;
  stopPct: number;
  trailingActivationPct: number;
  marketTone?: MitMarketTone;
}

export function computeEntryExitPlan(input: EntryExitInput): EntryExitPlan | null {
  const latest = input.candles[input.candles.length - 1];
  if (!latest || input.technicals.dma50 === null) {
    return null;
  }

  const dma50 = input.technicals.dma50;
  const extended = latest.close > dma50 * 1.15;
  if (extended) {
    return null;
  }

  const tone = input.marketTone ?? "neutral";
  const nearDma = latest.close >= dma50 * 0.97 && latest.close <= dma50 * 1.03;
  const resistance = highestClose(input.candles, 60);
  const breakoutRetest = latest.close <= resistance * 1.02 && latest.close >= resistance * 0.98;

  // Blueprint Section 3: risk-off → narrow buy zones; risk-on → allow breakout entries
  const zoneSpread = tone === "risk-off" ? { lo: 0.995, hi: 1.01 } : tone === "risk-on" ? { lo: 0.985, hi: 1.025 } : { lo: 0.99, hi: 1.02 };
  const buyZoneLow = nearDma ? dma50 * zoneSpread.lo : breakoutRetest ? resistance * (zoneSpread.lo - 0.005) : latest.close * zoneSpread.lo;
  const buyZoneHigh = nearDma ? dma50 * zoneSpread.hi : breakoutRetest ? resistance * (zoneSpread.hi - 0.01) : latest.close * zoneSpread.hi;
  const mid = (buyZoneLow + buyZoneHigh) / 2;

  const structuralSupport = lowestLow(input.candles, 20);
  // Blueprint Section 3: risk-on breakouts use tighter stops (5% instead of 6%)
  const effectiveStopPct = tone === "risk-on" && breakoutRetest ? Math.min(input.stopPct, 0.05) : input.stopPct;
  const stopFromPct = mid * (1 - effectiveStopPct);
  const stopLoss = Math.max(stopFromPct, structuralSupport);
  const risk = mid - stopLoss;
  if (risk <= 0) {
    return null;
  }

  const atr = input.technicals.atr14 ?? 0;
  const atrPct = latest.close > 0 ? atr / latest.close : 0;
  const dynamicR = atrPct < 0.015 ? 2.5 : atrPct <= 0.03 ? 2.0 : 1.5;
  const desiredR = input.feed === "nt-lite" ? 2.5 : dynamicR;

  let firstTarget = mid + risk * desiredR;
  const minTarget = mid * 1.12;
  const maxTarget = mid * 1.25;
  firstTarget = Math.max(minTarget, Math.min(maxTarget, firstTarget));

  const rMultiple = (firstTarget - mid) / risk;
  const firstTargetPct = Number(((firstTarget - mid) / mid).toFixed(6));
  const rsiOverbought = (input.technicals.rsi14 ?? 50) > 70;
  const trailingActivationPrice = rsiOverbought 
    ? latest.close 
    : mid + (firstTarget - mid) * input.trailingActivationPct;

  const invalidation = computeInvalidation(input.fundamentals);

  return {
    ticker: input.ticker,
    feed: input.feed,
    buyZoneLow,
    buyZoneHigh,
    stopLoss,
    stopLossPct: input.stopPct,
    firstTarget,
    firstTargetPct,
    rMultiple,
    trailingActivationPrice,
    invalidation,
    computedAt: new Date().toISOString(),
  };
}

function computeInvalidation(fundamentals: FundamentalSnapshot | undefined): string[] {
  if (!fundamentals) return [];
  
  const conditions: string[] = [];
  
  if (fundamentals.epsHistory.length >= 2) {
    const recent = fundamentals.epsHistory.slice(-2);
    const bothWeak = recent.every(e => e.value < 0) || 
      (recent.length === 2 && recent[1] && recent[0] && 
       recent[1].value < recent[0].value * 0.5);
    if (bothWeak) {
      conditions.push("Two consecutive weak quarters (EPS decline or negative)");
    }
  }
  
  if (fundamentals.opmHistory.length >= 2) {
    const recent = fundamentals.opmHistory.slice(-2);
    if (recent.length === 2 && recent[1] && recent[0] && 
        recent[1].value < recent[0].value * 0.8) {
      conditions.push("Significant margin compression detected");
    }
  }
  
  if (fundamentals.fcfHistory.length >= 1) {
    const latestFcf = fundamentals.fcfHistory[fundamentals.fcfHistory.length - 1];
    if (latestFcf && latestFcf.value < 0) {
      conditions.push("Negative FCF shock - free cash flow turned negative");
    }
  }
  
  if (fundamentals.promoterHoldingPct !== null && fundamentals.promoterHoldingPct < 30) {
    conditions.push(`Low promoter holding (${fundamentals.promoterHoldingPct.toFixed(1)}%) - potential governance concern`);
  }
  
  if (fundamentals.promoterPledgePct !== null && fundamentals.promoterPledgePct > 50) {
    conditions.push(`High promoter pledging (${fundamentals.promoterPledgePct.toFixed(1)}%) - governance red flag`);
  }
  
  if (fundamentals.auditorRemarks === "adverse") {
    conditions.push("Adverse auditor remarks - avoid entry");
  } else if (fundamentals.auditorRemarks === "qualified") {
    conditions.push("Qualified auditor opinion - review before entry");
  }
  
  return conditions;
}

function highestClose(candles: DailyCandle[], lookback: number): number {
  const recent = candles.slice(-lookback);
  return Math.max(...recent.map((c) => c.close));
}

function lowestLow(candles: DailyCandle[], lookback: number): number {
  const recent = candles.slice(-lookback);
  return Math.min(...recent.map((c) => c.low));
}

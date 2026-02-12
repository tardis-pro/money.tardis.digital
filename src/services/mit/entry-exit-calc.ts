import type { DailyCandle, EntryExitPlan, MitFeed, TechnicalSnapshot } from "../../mit-types.js";

export interface EntryExitInput {
  ticker: string;
  feed: MitFeed;
  technicals: TechnicalSnapshot;
  candles: DailyCandle[];
  stopPct: number;
  trailingActivationPct: number;
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

  const nearDma = latest.close >= dma50 * 0.97 && latest.close <= dma50 * 1.03;
  const resistance = highestClose(input.candles, 60);
  const breakoutRetest = latest.close <= resistance * 1.02 && latest.close >= resistance * 0.98;

  const buyZoneLow = nearDma ? dma50 * 0.99 : breakoutRetest ? resistance * 0.98 : latest.close * 0.99;
  const buyZoneHigh = nearDma ? dma50 * 1.02 : breakoutRetest ? resistance * 1.01 : latest.close * 1.01;
  const mid = (buyZoneLow + buyZoneHigh) / 2;

  const structuralSupport = lowestLow(input.candles, 20);
  const stopFromPct = mid * (1 - input.stopPct);
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
  const firstTargetPct = (firstTarget - mid) / mid;
  const trailingActivationPrice = mid + (firstTarget - mid) * input.trailingActivationPct;

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
    invalidation: [],
    computedAt: new Date().toISOString(),
  };
}

function highestClose(candles: DailyCandle[], lookback: number): number {
  const recent = candles.slice(-lookback);
  return Math.max(...recent.map((c) => c.close));
}

function lowestLow(candles: DailyCandle[], lookback: number): number {
  const recent = candles.slice(-lookback);
  return Math.min(...recent.map((c) => c.low));
}

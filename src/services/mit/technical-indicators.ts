import type { DailyCandle, TechnicalSnapshot } from "../../mit-types.js";

export function computeTechnicalSnapshot(ticker: string, candles: DailyCandle[]): TechnicalSnapshot | null {
  if (candles.length === 0) {
    return null;
  }
  const latest = candles[candles.length - 1];
  if (!latest) {
    return null;
  }
  const dma50 = sma(candles, 50);
  const dma200 = sma(candles, 200);

  return {
    ticker,
    computedAt: new Date().toISOString(),
    dma20: sma(candles, 20),
    dma50,
    dma100: sma(candles, 100),
    dma200,
    rsi14: rsi(candles, 14),
    atr14: atr(candles, 14),
    returnZScore20d: returnZScore(candles, 20, 60),
    priceVsDma50Pct: pctDistance(latest.close, dma50),
    priceVsDma200Pct: pctDistance(latest.close, dma200),
    pullback5d: pullback(candles, 5),
    latestClose: latest.close,
    latestVolume: latest.volume,
  };
}

export function sma(candles: DailyCandle[], period: number): number | null {
  if (candles.length < period) {
    return null;
  }
  const slice = candles.slice(-period);
  return slice.reduce((sum, c) => sum + c.close, 0) / period;
}

export function rsi(candles: DailyCandle[], period: number): number | null {
  if (candles.length < period + 1) {
    return null;
  }
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const current = candles[i]?.close;
    const prev = candles[i - 1]?.close;
    if (current === undefined || prev === undefined) {
      continue;
    }
    const delta = current - prev;
    gains += delta > 0 ? delta : 0;
    losses += delta < 0 ? Math.abs(delta) : 0;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < candles.length; i += 1) {
    const current = candles[i]?.close;
    const prev = candles[i - 1]?.close;
    if (current === undefined || prev === undefined) {
      continue;
    }
    const delta = current - prev;
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) {
    return 100;
  }
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function atr(candles: DailyCandle[], period: number): number | null {
  if (candles.length < period + 1) {
    return null;
  }
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i];
    const p = candles[i - 1];
    if (!c || !p) {
      continue;
    }
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    trs.push(tr);
  }
  if (trs.length < period) {
    return null;
  }
  const initial = trs.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  let value = initial;
  for (let i = period; i < trs.length; i += 1) {
    const current = trs[i];
    if (current === undefined) {
      continue;
    }
    value = (value * (period - 1) + current) / period;
  }
  return value;
}

export function returnZScore(candles: DailyCandle[], returnWindow: number, distributionWindow: number): number | null {
  if (candles.length < distributionWindow + 1 || candles.length < returnWindow + 1) {
    return null;
  }
  const returns: number[] = [];
  const start = Math.max(1, candles.length - distributionWindow);
  for (let i = start; i < candles.length; i += 1) {
    const c = candles[i]?.close;
    const p = candles[i - 1]?.close;
    if (c === undefined || p === undefined || p === 0) {
      continue;
    }
    returns.push(c / p - 1);
  }
  if (returns.length < 2) {
    return null;
  }
  const mean = returns.reduce((sum, v) => sum + v, 0) / returns.length;
  const variance = returns.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / returns.length;
  const stdev = Math.sqrt(variance);
  if (stdev === 0) {
    return null;
  }

  const current = candles[candles.length - 1]?.close;
  const base = candles[candles.length - 1 - returnWindow]?.close;
  if (current === undefined || base === undefined || base === 0) {
    return null;
  }
  const currentReturn = current / base - 1;
  return (currentReturn - mean) / stdev;
}

export function pullback(candles: DailyCandle[], sessions: number): number | null {
  if (candles.length < sessions) {
    return null;
  }
  const recent = candles.slice(-sessions);
  const high = Math.max(...recent.map((c) => c.high));
  const close = recent[recent.length - 1]?.close;
  if (close === undefined || high <= 0) {
    return null;
  }
  return (high - close) / high;
}

function pctDistance(price: number, reference: number | null): number | null {
  if (reference === null || reference === 0) {
    return null;
  }
  return ((price - reference) / reference) * 100;
}

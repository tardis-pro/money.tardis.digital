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

export function ema(candles: DailyCandle[], period: number): number | null {
  if (candles.length < period) {
    return null;
  }
  const alpha = 2.0 / (period + 1);
  let ema = candles[candles.length - period]?.close ?? 0;
  for (let i = candles.length - period + 1; i < candles.length; i += 1) {
    const close = candles[i]?.close;
    if (close === undefined) continue;
    ema = close * alpha + ema * (1 - alpha);
  }
  return ema;
}

export function macd(closes: number[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9): { macd: number; signal: number; histogram: number } | null {
  if (closes.length < slowPeriod + signalPeriod) {
    return null;
  }
  const fastEMA = emaFromArray(closes, fastPeriod);
  const slowEMA = emaFromArray(closes, slowPeriod);
  if (fastEMA === null || slowEMA === null) return null;
  
  const macdLine = fastEMA - slowEMA;
  const macdArray: number[] = [macdLine];
  for (let i = 1; i < closes.length; i += 1) {
    const subFast = emaFromArray(closes.slice(0, i + 1), fastPeriod);
    const subSlow = emaFromArray(closes.slice(0, i + 1), slowPeriod);
    if (subFast !== null && subSlow !== null) {
      macdArray.push(subFast - subSlow);
    }
  }
  
  const signalEMA = emaFromArray(macdArray, signalPeriod);
  if (signalEMA === null) return null;
  
  return {
    macd: macdLine,
    signal: signalEMA,
    histogram: macdLine - signalEMA,
  };
}

function emaFromArray(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const alpha = 2.0 / (period + 1);
  let emaVal: number = values[values.length - period] ?? 0;
  for (let i = values.length - period + 1; i < values.length; i += 1) {
    const val = values[i];
    if (val === undefined) continue;
    emaVal = val * alpha + emaVal * (1 - alpha);
  }
  return emaVal;
}

export function cci(highs: number[], lows: number[], closes: number[], period: number = 20): number | null {
  if (highs.length < period || lows.length < period || closes.length < period) {
    return null;
  }
  const typicalPrices: number[] = [];
  for (let i = 0; i < highs.length; i += 1) {
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    if (h !== undefined && l !== undefined && c !== undefined) {
      typicalPrices.push((h + l + c) / 3);
    }
  }
  if (typicalPrices.length < period) return null;
  const recentTP = typicalPrices.slice(-period);
  const smaTP = recentTP.reduce((sum, v) => sum + v, 0) / period;
  const meanDev = recentTP.reduce((sum, v) => sum + Math.abs(v - smaTP), 0) / period;
  if (meanDev === 0) return null;
  const lastTP = typicalPrices[typicalPrices.length - 1];
  if (lastTP === undefined) return null;
  return (lastTP - smaTP) / (0.015 * meanDev);
}

export function detectPattern(candles: DailyCandle[]): string {
  if (candles.length < 3) return "None";
  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (!latest || !prev) return "None";
  
  const latestBody = Math.abs(latest.close - latest.open);
  const latestRange = Math.max(latest.high - latest.low, 0.0001);
  const lowerWick = Math.min(latest.open, latest.close) - latest.low;
  const upperWick = latest.high - Math.max(latest.open, latest.close);
  
  // Bullish Engulfing
  const prevBullish = prev.close > prev.open;
  const latestBullish = latest.close > latest.open;
  if (prevBullish && !latestBullish && latest.open <= prev.close && latest.close >= prev.open) {
    return "Bullish Engulfing";
  }
  
  // Hammer
  if (lowerWick > latestBody * 2 && upperWick < latestBody && latestBody / latestRange < 0.5) {
    return "Hammer";
  }
  
  // Doji
  if (latestBody / latestRange < 0.1) {
    return "Doji";
  }
  
  // Breakout detection
  const prev20High = Math.max(...candles.slice(-21, -1).map(c => c.high));
  if (latest.close > prev20High) {
    return "Breakout";
  }
  
  return "None";
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

/**
 * Calculate Beta of a stock vs benchmark (NIFTY 50)
 * Beta measures the stock's volatility relative to the benchmark.
 * Beta = Cov(Stock, Benchmark) / Var(Benchmark)
 * 
 * @param stockReturns - Daily returns of the stock
 * @param benchmarkReturns - Daily returns of the benchmark (NIFTY 50)
 * @returns Beta value or null if insufficient data
 */
export function beta(stockReturns: number[], benchmarkReturns: number[]): number | null {
  if (stockReturns.length < 30 || benchmarkReturns.length < 30) {
    return null;
  }
  
  // Align arrays to same length (use minimum)
  const n = Math.min(stockReturns.length, benchmarkReturns.length);
  const stock = stockReturns.slice(-n);
  const benchmark = benchmarkReturns.slice(-n);
  
  // Calculate means
  const stockMean = stock.reduce((sum, v) => sum + v, 0) / n;
  const benchmarkMean = benchmark.reduce((sum, v) => sum + v, 0) / n;
  
  // Calculate covariance and variance
  let covariance = 0;
  let benchmarkVariance = 0;
  
  for (let i = 0; i < n; i++) {
    const stockDev = stock[i]! - stockMean;
    const benchmarkDev = benchmark[i]! - benchmarkMean;
    covariance += stockDev * benchmarkDev;
    benchmarkVariance += benchmarkDev * benchmarkDev;
  }
  
  covariance /= n;
  benchmarkVariance /= n;
  
  if (benchmarkVariance === 0) {
    return null;
  }
  
  return covariance / benchmarkVariance;
}

/**
 * Calculate R-squared (Coefficient of Determination) for a trendline
 * Measures how well the trendline fits the data (0-1, higher is better)
 * 
 * @param prices - Array of closing prices
 * @returns R-squared value (0-1) or null if insufficient data
 */
export function rSquared(prices: number[]): number | null {
  if (prices.length < 10) {
    return null;
  }
  
  // Use log prices for percentage-based trend analysis
  const logPrices = prices.map(p => Math.log(p));
  const n = logPrices.length;
  
  // Calculate linear regression: y = mx + b
  // Where y = log(price), x = time index
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  
  for (let i = 0; i < n; i++) {
    sumX += i;
    const logPrice = logPrices[i];
    if (logPrice === undefined) continue;
    sumY += logPrice;
    sumXY += i * logPrice;
    sumXX += i * i;
  }
  
  const xMean = sumX / n;
  const yMean = sumY / n;
  
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) {
    return null;
  }
  
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  
  // Calculate R-squared
  // SSres = sum((y - y_predicted)^2)
  // SStot = sum((y - y_mean)^2)
  // R2 = 1 - SSres/SStot
  
  let ssRes = 0;
  let ssTot = 0;
  
  for (let i = 0; i < n; i++) {
    const yPredicted = slope * i + intercept;
    const yActual = logPrices[i];
    if (yActual === undefined) continue;
    ssRes += Math.pow(yActual - yPredicted, 2);
    ssTot += Math.pow(yActual - yMean, 2);
  }
  
  if (ssTot === 0) {
    return null;
  }
  
  return 1 - (ssRes / ssTot);
}

/**
 * Calculate ATR percentage (ATR / Price) for volatility scoring
 * @param candles - Array of daily candles
 * @param period - ATR period (default 14)
 * @returns ATR% as decimal (e.g., 0.02 = 2%) or null
 */
export function atrPct(candles: DailyCandle[], period: number = 14): number | null {
  const atrValue = atr(candles, period);
  if (atrValue === null || candles.length === 0) {
    return null;
  }
  
  const latestClose = candles[candles.length - 1]?.close;
  if (latestClose === undefined || latestClose === 0) {
    return null;
  }
  
  return atrValue / latestClose;
}

/**
 * Calculate daily returns from price data
 * @param prices - Array of closing prices
 * @returns Array of daily returns (as decimals)
 */
export function calculateReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prevPrice = prices[i - 1];
    const currentPrice = prices[i];
    if (prevPrice !== 0 && prevPrice !== undefined && currentPrice !== undefined) {
      returns.push((currentPrice - prevPrice) / prevPrice);
    }
  }
  return returns;
}

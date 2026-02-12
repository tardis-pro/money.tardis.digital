import type { DailyCandle, MitAnomaly } from "../../mit-types.js";

export function detectMitAnomalies(candlesByTicker: Record<string, DailyCandle[]>): MitAnomaly[] {
  const anomalies: MitAnomaly[] = [];
  for (const [ticker, candles] of Object.entries(candlesByTicker)) {
    if (candles.length < 61) {
      continue;
    }
    const latest = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    if (!latest || !prev || prev.close === 0) {
      continue;
    }

    const returns = candles.slice(-61).map((c, i, arr) => {
      if (i === 0) return null;
      const p = arr[i - 1];
      if (!p || p.close === 0) return null;
      return c.close / p.close - 1;
    }).filter((v): v is number => v !== null);

    const latestRet = latest.close / prev.close - 1;
    const z = zScore(latestRet, returns.slice(0, -1));
    if (z !== null && Math.abs(z) >= 2.5) {
      anomalies.push({
        ticker,
        date: latest.date,
        type: "price-shock",
        score: Math.abs(z),
        detail: `Daily return ${(latestRet * 100).toFixed(2)}% z=${z.toFixed(2)}`,
      });
    }

    const recentVolumes = candles.slice(-21, -1).map((c) => c.volume).filter((v) => Number.isFinite(v));
    const avgVolume = mean(recentVolumes);
    if (avgVolume !== null && latest.volume > avgVolume * 2) {
      anomalies.push({
        ticker,
        date: latest.date,
        type: "volume-spike",
        score: latest.volume / avgVolume,
        detail: `Volume ${latest.volume} vs avg ${Math.round(avgVolume)}`,
      });
    }

    const trSeries = trueRangeSeries(candles.slice(-25));
    const latestTr = trSeries[trSeries.length - 1] ?? null;
    const medianTr = median(trSeries.slice(0, -1));
    if (latestTr !== null && medianTr !== null && medianTr > 0 && latestTr > medianTr * 1.8) {
      anomalies.push({
        ticker,
        date: latest.date,
        type: "volatility-spike",
        score: latestTr / medianTr,
        detail: `True range spike ${latestTr.toFixed(2)} vs median ${medianTr.toFixed(2)}`,
      });
    }
  }

  return anomalies.sort((a, b) => b.score - a.score).slice(0, 100);
}

function zScore(value: number, history: number[]): number | null {
  if (history.length < 20) {
    return null;
  }
  const m = mean(history);
  if (m === null) return null;
  const v = history.reduce((sum, x) => sum + (x - m) * (x - m), 0) / history.length;
  const sd = Math.sqrt(v);
  if (sd === 0) return null;
  return (value - m) / sd;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (left === undefined || right === undefined) {
    return sorted[mid] ?? null;
  }
  return sorted.length % 2 === 0 ? (left + right) / 2 : right;
}

function trueRangeSeries(candles: DailyCandle[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i];
    const p = candles[i - 1];
    if (!c || !p) continue;
    out.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  return out;
}

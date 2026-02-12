import type { MitMarketTone, TechnicalSnapshot } from "../../mit-types.js";

export interface MarketModeResult {
  mode: MitMarketTone;
  positionAllocPct: number;
  rsiMin: number;
  rsiMax: number;
  reasons: string[];
}

export async function detectMarketMode(technicals: Record<string, TechnicalSnapshot>): Promise<MarketModeResult> {
  const reasons: string[] = [];
  const [nifty, vix] = await Promise.all([
    fetchCloses("^NSEI", 260).catch(() => [] as number[]),
    fetchCloses("^INDIAVIX", 10).catch(() => [] as number[]),
  ]);

  const niftyLatest = nifty[nifty.length - 1] ?? null;
  const niftyDma200 = sma(nifty, 200);
  const vixRising3d = isRising(vix, 3);

  let mode: MitMarketTone = "risk-on";
  if ((niftyLatest !== null && niftyDma200 !== null && niftyLatest < niftyDma200) || vixRising3d) {
    mode = "risk-off";
  }

  if (mode === "risk-off") {
    if (niftyLatest !== null && niftyDma200 !== null && niftyLatest < niftyDma200) {
      reasons.push("NIFTY below 200DMA");
    }
    if (vixRising3d) {
      reasons.push("VIX rising for 3 sessions");
    }
    return { mode, positionAllocPct: 0.03, rsiMin: 40, rsiMax: 55, reasons };
  }

  const breadthOff = Object.values(technicals).filter((t) => t.dma50 !== null && t.latestClose < t.dma50).length;
  const breadthTotal = Object.values(technicals).filter((t) => t.dma50 !== null).length;
  if (breadthTotal > 0 && breadthOff / breadthTotal > 0.6) {
    mode = "risk-off";
    reasons.push("Broad market breadth below 50DMA");
    return { mode, positionAllocPct: 0.03, rsiMin: 40, rsiMax: 55, reasons };
  }

  reasons.push("NIFTY trend supportive");
  return { mode, positionAllocPct: 0.05, rsiMin: 45, rsiMax: 70, reasons };
}

async function fetchCloses(symbol: string, days: number): Promise<number[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`;
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0", accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Market mode fetch failed ${response.status}`);
  }
  const payload = (await response.json()) as {
    chart?: {
      result?: Array<{
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };
  const closes = payload.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  return closes.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).slice(-days);
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) {
    return null;
  }
  const slice = values.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}

function isRising(values: number[], days: number): boolean {
  if (values.length < days + 1) {
    return false;
  }
  const recent = values.slice(-(days + 1));
  for (let i = 1; i < recent.length; i += 1) {
    const prev = recent[i - 1];
    const cur = recent[i];
    if (prev === undefined || cur === undefined || cur <= prev) {
      return false;
    }
  }
  return true;
}

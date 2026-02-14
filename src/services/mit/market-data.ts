import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import type { DailyCandle } from "../../mit-types.js";
import { ensureDir } from "../../utils.js";

export class MarketDataService {
  private readonly candlesDir: string;
  private cookieHeader: string | null = null;
  private cookieExpiry = 0;

  constructor(baseDir: string = process.cwd()) {
    this.candlesDir = path.join(baseDir, "data", "mit-candles");
  }

  async refreshCookies(): Promise<void> {
    const response = await fetch("https://www.nseindia.com", {
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "text/html,application/json",
      },
    });
    const raw = response.headers.get("set-cookie");
    this.cookieHeader = raw;
    this.cookieExpiry = Date.now() + 25 * 60 * 1000;
  }

  async fetchCandles(ticker: string, days: number = 300): Promise<DailyCandle[]> {
    const normalizedTicker = sanitizeTicker(ticker);
    const cached = await this.readCache(normalizedTicker);
    if (cached.length >= days) {
      return cached.slice(-days);
    }

    const fresh = await this.fetchFromNse(normalizedTicker, days).catch(async () => this.fetchFromYahoo(normalizedTicker, days));
    const merged = mergeCandles(cached, fresh).slice(-days);
    await this.writeCache(normalizedTicker, merged);
    return merged;
  }

  async refreshUniverse(tickers: string[]): Promise<Map<string, DailyCandle[]>> {
    const out = new Map<string, DailyCandle[]>();
    for (const ticker of tickers) {
      const candles = await this.fetchCandles(ticker, 300).catch(() => []);
      out.set(ticker, candles);
      await sleep(500);
    }
    return out;
  }

  private async fetchFromNse(ticker: string, days: number): Promise<DailyCandle[]> {
    if (!this.cookieHeader || Date.now() >= this.cookieExpiry) {
      await this.refreshCookies();
    }
    const to = formatNseDate(new Date());
    const from = formatNseDate(new Date(Date.now() - Math.max(365, days * 2) * 24 * 60 * 60 * 1000));
    const url = `https://www.nseindia.com/api/historical/cm/equity?symbol=${encodeURIComponent(ticker)}&from=${from}&to=${to}`;
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "application/json",
        referer: "https://www.nseindia.com",
        cookie: this.cookieHeader ?? "",
      },
    });
    if (!response.ok) {
      throw new Error(`NSE fetch failed: ${response.status}`);
    }
    const payload = (await response.json()) as {
      data?: Array<{ CH_TIMESTAMP: string; CH_OPENING_PRICE: string; CH_TRADE_HIGH_PRICE: string; CH_TRADE_LOW_PRICE: string; CH_CLOSING_PRICE: string; CH_TOT_TRADED_QTY: string }>;
    };
    const rows = payload.data ?? [];
    return rows.map((row) => ({
      date: toIsoDate(row.CH_TIMESTAMP),
      open: num(row.CH_OPENING_PRICE),
      high: num(row.CH_TRADE_HIGH_PRICE),
      low: num(row.CH_TRADE_LOW_PRICE),
      close: num(row.CH_CLOSING_PRICE),
      volume: num(row.CH_TOT_TRADED_QTY),
    })).filter((c) => c.date.length > 0);
  }

  private async fetchFromYahoo(ticker: string, days: number): Promise<DailyCandle[]> {
    const symbol = `${ticker}.NS`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`;
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Yahoo fetch failed: ${response.status}`);
    }
    const payload = (await response.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null>; volume?: Array<number | null> }> };
        }>;
      };
    };
    const result = payload.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    const ts = result?.timestamp ?? [];
    const out: DailyCandle[] = [];
    for (let i = 0; i < ts.length; i += 1) {
      const epoch = ts[i];
      const open = quote?.open?.[i];
      const high = quote?.high?.[i];
      const low = quote?.low?.[i];
      const close = quote?.close?.[i];
      const volume = quote?.volume?.[i];
      if (
        epoch === undefined
        || open === null || high === null || low === null || close === null || volume === null
        || open === undefined || high === undefined || low === undefined || close === undefined || volume === undefined
      ) {
        continue;
      }
      out.push({
        date: new Date(epoch * 1000).toISOString().slice(0, 10),
        open,
        high,
        low,
        close,
        volume,
      });
    }
    return out.slice(-days);
  }

  private async readCache(ticker: string): Promise<DailyCandle[]> {
    const file = path.join(this.candlesDir, `${sanitizeTicker(ticker)}.json`);
    try {
      const content = await readFile(file, "utf8");
      const parsed = JSON.parse(content) as DailyCandle[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn(`Failed to read cache file ${file}:`, e instanceof Error ? e.message : e);
      return [];
    }
  }

  private async writeCache(ticker: string, candles: DailyCandle[]): Promise<void> {
    await ensureDir(this.candlesDir);
    const file = path.join(this.candlesDir, `${sanitizeTicker(ticker)}.json`);
    await writeFile(file, `${JSON.stringify(candles.slice(-300), null, 2)}\n`, "utf8");
  }
}

function sanitizeTicker(ticker: string): string {
  const value = ticker.trim().toUpperCase();
  if (!/^[A-Z0-9._^\-]{1,30}$/.test(value)) {
    throw new Error(`Invalid ticker: ${ticker}`);
  }
  return value;
}

function mergeCandles(existing: DailyCandle[], incoming: DailyCandle[]): DailyCandle[] {
  const map = new Map<string, DailyCandle>();
  for (const c of existing) {
    map.set(c.date, c);
  }
  for (const c of incoming) {
    map.set(c.date, c);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function formatNseDate(value: Date): string {
  const day = String(value.getDate()).padStart(2, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const year = String(value.getFullYear());
  return `${day}-${month}-${year}`;
}

function toIsoDate(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
}

function num(value: string): number {
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

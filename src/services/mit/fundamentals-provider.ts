import type { FundamentalSnapshot } from "../../mit-types.js";
import { getScreenerFetcher, mergeFundamentals } from "./screener-fundamentals-fetcher.js";

// Hardening constants
const FETCH_TIMEOUT_MS = 15000; // 15 second timeout per fetch
const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 1000;
const RATE_LIMIT_DELAY_MS = 220;

export interface FundamentalsRefreshResult {
  updated: FundamentalSnapshot[];
  failed: Array<{ ticker: string; error: string; retries: number }>;
  missingCriticalFields: Array<{ ticker: string; fields: string[] }>;
}

export interface FundamentalsProviderService {
  refreshTickers(tickers: string[]): Promise<FundamentalsRefreshResult>;
}

export class FundamentalsProviderService {
  // Critical fields that must be populated for a valid fundamentals record
  private readonly criticalFields: (keyof FundamentalSnapshot)[] = [
    "pe",
    "peg",
    "marketCap",
    "revenueHistory",
    "epsHistory",
    "roe",
    "debtToEquity",
    "fcfHistory",
  ];

  async fetchTicker(ticker: string): Promise<FundamentalSnapshot> {
    const symbol = `${ticker.toUpperCase()}.NS`;
    const [quote, timeseries, screenerData] = await Promise.all([
      this.fetchWithTimeout(this.fetchQuoteSummary(symbol), FETCH_TIMEOUT_MS, `quoteSummary for ${symbol}`),
      this.fetchWithTimeout(this.fetchTimeseries(symbol), FETCH_TIMEOUT_MS, `timeseries for ${symbol}`),
      this.fetchWithTimeout(getScreenerFetcher().fetchTicker(ticker).catch(() => null), FETCH_TIMEOUT_MS, `screener for ${ticker}`),
    ]);

    const revenueHistory = pickSeries(timeseries, ["annualTotalRevenue", "annualOperatingRevenue"]);
    const epsHistory = pickSeries(timeseries, ["annualDilutedEPS", "annualBasicEPS"]);
    const fcfHistory = pickSeries(timeseries, ["annualFreeCashFlow"]);
    const operatingIncomeHistory = pickSeries(timeseries, ["annualOperatingIncome"]);
    const opmHistory = deriveOpmHistory(revenueHistory, operatingIncomeHistory);

    const pe = n(quote.summaryDetail?.trailingPE) ?? n(quote.defaultKeyStatistics?.trailingPE);
    const peg = n(quote.defaultKeyStatistics?.pegRatio);
    const marketCap = n(quote.summaryDetail?.marketCap) !== null ? (n(quote.summaryDetail?.marketCap) ?? 0) / 1e7 : null;

    const yahooData: FundamentalSnapshot = {
      ticker: ticker.toUpperCase(),
      fetchedAt: new Date().toISOString(),
      source: "morningstar",
      revenueHistory,
      epsHistory,
      opmHistory,
      debtToEquity: n(quote.financialData?.debtToEquity),
      interestCoverage: null,
      roce: null,
      roe: pctFromRatio(n(quote.financialData?.returnOnEquity)),
      fcfHistory,
      pe,
      peg,
      marketCap,
      promoterHoldingPct: null,
      promoterPledgePct: null,
      auditorRemarks: "unknown",
      revenueCAGR_3y: cagr(revenueHistory, 3),
      revenueCAGR_5y: cagr(revenueHistory, 5),
      epsCAGR_3y: cagr(epsHistory, 3),
      epsCAGR_5y: cagr(epsHistory, 5),
    };

    return mergeFundamentals(yahooData, screenerData);
  }

  async refreshTickers(tickers: string[]): Promise<FundamentalsRefreshResult> {
    const updated: FundamentalSnapshot[] = [];
    const failed: Array<{ ticker: string; error: string; retries: number }> = [];
    const missingCriticalFields: Array<{ ticker: string; fields: string[] }> = [];

    for (const ticker of tickers) {
      let retries = 0;
      let lastError: string | null = null;

      while (retries <= MAX_RETRIES) {
        try {
          const snapshot = await this.fetchTicker(ticker);

          // Track missing critical fields
          const missing = this.criticalFields
            .filter((field) => {
              const value = snapshot[field];
              if (Array.isArray(value)) {
                return value.length === 0;
              }
              return value === null || value === undefined;
            })
            .map((field) => field as string);

          if (missing.length > 0) {
            missingCriticalFields.push({ ticker: ticker.toUpperCase(), fields: missing });
          }

          updated.push(snapshot);
          break; // Success, exit retry loop
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          retries++;

          if (retries <= MAX_RETRIES) {
            // Exponential backoff
            const delay = BASE_RETRY_DELAY_MS * Math.pow(2, retries - 1);
            await sleep(delay);
          }
        }
      }

      if (retries > MAX_RETRIES && lastError) {
        failed.push({ ticker: ticker.toUpperCase(), error: lastError, retries });
      }

      await sleep(RATE_LIMIT_DELAY_MS);
    }

    return { updated, failed, missingCriticalFields };
  }

  private async fetchWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout (${timeoutMs}ms) during ${operationName}`)), timeoutMs)
      ),
    ]);
  }

  private async fetchQuoteSummary(symbol: string): Promise<Record<string, Record<string, unknown>>> {
    const modules = ["summaryDetail", "financialData", "defaultKeyStatistics", "assetProfile"].join(",");
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;
    const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0", accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`quoteSummary ${response.status}`);
    }
    const payload = (await response.json()) as {
      quoteSummary?: {
        result?: Array<Record<string, Record<string, unknown>>>;
      };
    };
    return payload.quoteSummary?.result?.[0] ?? {};
  }

  private async fetchTimeseries(symbol: string): Promise<Record<string, Array<{ asOfDate?: string; reportedValue?: { raw?: number } }>>> {
    const now = Math.floor(Date.now() / 1000);
    const from = now - 8 * 365 * 24 * 60 * 60;
    const types = ["annualTotalRevenue", "annualOperatingRevenue", "annualDilutedEPS", "annualBasicEPS", "annualFreeCashFlow", "annualOperatingIncome"].join(",");
    const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?type=${types}&period1=${from}&period2=${now}`;
    const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0", accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`timeseries ${response.status}`);
    }
    const payload = (await response.json()) as {
      timeseries?: {
        result?: Array<Record<string, Array<{ asOfDate?: string; reportedValue?: { raw?: number } }>>>;
      };
    };
    const out: Record<string, Array<{ asOfDate?: string; reportedValue?: { raw?: number } }>> = {};
    for (const row of payload.timeseries?.result ?? []) {
      for (const [key, value] of Object.entries(row)) {
        if (key === "meta") {
          continue;
        }
        if (Array.isArray(value)) {
          out[key] = value;
        }
      }
    }
    return out;
  }
}

function pickSeries(
  source: Record<string, Array<{ asOfDate?: string; reportedValue?: { raw?: number } }>>,
  keys: string[],
): Array<{ fy: string; value: number }> {
  for (const key of keys) {
    const values = source[key];
    if (!values || values.length === 0) {
      continue;
    }
    const series = values
      .map((item) => {
        const date = item.asOfDate;
        const value = item.reportedValue?.raw;
        if (!date || value === undefined || !Number.isFinite(value)) {
          return null;
        }
        const fy = `FY${date.slice(2, 4)}`;
        return { fy, value };
      })
      .filter((entry): entry is { fy: string; value: number } => entry !== null)
      .sort((a, b) => a.fy.localeCompare(b.fy));
    if (series.length > 0) {
      return series;
    }
  }
  return [];
}

function deriveOpmHistory(
  revenue: Array<{ fy: string; value: number }>,
  operatingIncome: Array<{ fy: string; value: number }>,
): Array<{ fy: string; value: number }> {
  const opIncomeByFy = new Map(operatingIncome.map((item) => [item.fy, item.value]));
  const out: Array<{ fy: string; value: number }> = [];
  for (const rev of revenue) {
    const op = opIncomeByFy.get(rev.fy);
    if (op === undefined || rev.value === 0) {
      continue;
    }
    out.push({ fy: rev.fy, value: (op / rev.value) * 100 });
  }
  return out;
}

function cagr(values: Array<{ fy: string; value: number }>, years: 3 | 5): number | null {
  if (values.length < years + 1) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a.fy.localeCompare(b.fy));
  const start = sorted[sorted.length - 1 - years]?.value;
  const end = sorted[sorted.length - 1]?.value;
  if (start === undefined || end === undefined || start <= 0 || end < 0) {
    return null;
  }
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

function n(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    const maybeRaw = (value as { raw?: unknown }).raw;
    if (typeof maybeRaw === "number" && Number.isFinite(maybeRaw)) {
      return maybeRaw;
    }
  }
  return null;
}

function pctFromRatio(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  if (Math.abs(value) <= 1.5) {
    return value * 100;
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

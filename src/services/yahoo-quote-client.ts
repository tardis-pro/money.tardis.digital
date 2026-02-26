/**
 * Yahoo Finance Quote Client
 * Fetches current quotes for NSE tickers (no API key required).
 * Returns ~15 minute delayed data for free tier.
 */

export interface YahooQuote {
  ticker: string;
  regularMarketPrice: number;
  regularMarketChangePercent: number;
  regularMarketTime: number;
  quoteType: string;
  isMarketOpen: boolean;
}

export interface QuoteBatchResult {
  quotes: Map<string, YahooQuote>;
  failedTickers: string[];
  fetchedAt: string;
}

const YAHOO_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";

/** Retry with exponential backoff + jitter (1s, 2s, 4s base delays). */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
      console.warn(`[rate-limit] yahoo-quote retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms`);
      await new Promise<void>(r => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

export async function fetchQuotes(tickers: string[]): Promise<QuoteBatchResult> {
  const symbols = tickers.map(t => `${t.toUpperCase()}.NS`).join(",");
  const fetchedAt = new Date().toISOString();

  try {
    const url = `${YAHOO_QUOTE_URL}?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketTime,quoteType,marketState`;
    const response = await withRetry(async () => {
      const r = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0",
          "accept": "application/json"
        },
        signal: AbortSignal.timeout(10000),
      });
      if (r.status === 429) {
        console.warn('[rate-limit] Yahoo Finance returned 429, will retry with backoff');
        throw new Error('rate-limit-429');
      }
      return r;
    });

    if (!response.ok) {
      return { quotes: new Map(), failedTickers: tickers, fetchedAt };
    }

    const payload = await response.json() as {
      quoteResponse?: {
        result?: Array<{
          symbol: string;
          regularMarketPrice?: number;
          regularMarketChangePercent?: number;
          regularMarketTime?: number;
          quoteType?: string;
          marketState?: string;
        }>;
        error?: unknown;
      };
    };

    const results = payload.quoteResponse?.result ?? [];
    const quotes = new Map<string, YahooQuote>();
    const resolvedTickers = new Set<string>();

    for (const item of results) {
      const ticker = item.symbol.replace(/\.NS$/, "");
      if (
        item.regularMarketPrice !== undefined &&
        item.regularMarketChangePercent !== undefined
      ) {
        quotes.set(ticker, {
          ticker,
          regularMarketPrice: item.regularMarketPrice,
          regularMarketChangePercent: item.regularMarketChangePercent,
          regularMarketTime: item.regularMarketTime ?? Math.floor(Date.now() / 1000),
          quoteType: item.quoteType ?? "EQUITY",
          isMarketOpen: item.marketState === "REGULAR",
        });
        resolvedTickers.add(ticker);
      }
    }

    const failedTickers = tickers.filter(t => !resolvedTickers.has(t.toUpperCase()));
    return { quotes, failedTickers, fetchedAt };

  } catch {
    return { quotes: new Map(), failedTickers: tickers, fetchedAt };
  }
}

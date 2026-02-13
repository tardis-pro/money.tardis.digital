/**
 * Screener.in Fundamentals Fetcher
 * Fetches comprehensive fundamentals including ROCE, promoter holding, interest coverage
 * from Screener.in's API which provides India-specific data not available from Yahoo Finance.
 */

import type { FundamentalSnapshot } from "../../mit-types.js";

export interface ScreenerFundamentalsData {
  ticker: string;
  roce: number | null;
  roe: number | null;
  debtToEquity: number | null;
  interestCoverage: number | null;
  promoterHoldingPct: number | null;
  promoterPledgePct: number | null;
  fiiHoldingPct: number | null;
  diiHoldingPct: number | null;
  pe: number | null;
  peg: number | null;
  marketCap: number | null;
  revenueHistory: { fy: string; value: number }[];
  epsHistory: { fy: string; value: number }[];
  opmHistory: { fy: string; value: number }[];
  fcfHistory: { fy: string; value: number }[];
  auditorRemarks: "clean" | "qualified" | "adverse" | "unknown";
  fetchedAt: string;
}

export interface ScreenerFetchResult {
  success: ScreenerFundamentalsData[];
  failed: Array<{ ticker: string; error: string }>;
}

interface ScreenerCompanySearchResult {
  id: number;
  name: string;
  url: string;
  sector?: string;
}

export class ScreenerFundamentalsFetcher {
  private readonly companyUrlBase = "https://www.screener.in/company";
  private readonly searchUrl = "https://www.screener.in/api/company/search";

  /**
   * Fetch fundamentals for a single ticker from Screener.in
   */
  async fetchTicker(ticker: string): Promise<ScreenerFundamentalsData | null> {
    try {
      const directData = await this.tryTickerPageFetch(ticker);
      if (directData) {
        return directData;
      }

      const searchData = await this.searchAndFetch(ticker);
      if (searchData) {
        return searchData;
      }

      console.warn(`[screener-fetcher] No data found for ticker ${ticker} from Screener.in`);
      return null;
    } catch (error) {
      console.error(`[screener-fetcher] Failed to fetch ${ticker} from Screener.in:`, error);
      return null;
    }
  }

  /**
   * Fetch fundamentals for multiple tickers
   */
  async fetchTickers(tickers: string[]): Promise<ScreenerFetchResult> {
    const success: ScreenerFundamentalsData[] = [];
    const failed: Array<{ ticker: string; error: string }> = [];

    for (const ticker of tickers) {
      const data = await this.fetchTicker(ticker);
      if (data) {
        success.push(data);
      } else {
        failed.push({ ticker, error: "No data available from Screener.in" });
      }
      // Rate limiting: respect Screener.in API
      await this.sleep(500);
    }

    console.log(`[screener-fetcher] Fetched ${success.length} tickers, ${failed.length} failed`);
    return { success, failed };
  }

  private async tryTickerPageFetch(ticker: string): Promise<ScreenerFundamentalsData | null> {
    const directUrl = `${this.companyUrlBase}/${ticker.toUpperCase()}/consolidated/`;
    return this.fetchAndParseCompanyPage(ticker, directUrl);
  }

  private async searchAndFetch(ticker: string): Promise<ScreenerFundamentalsData | null> {
    try {
      const searchUrl = `${this.searchUrl}/?q=${encodeURIComponent(ticker)}`;
      const searchResponse = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; MIT-Trading-System/1.0)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!searchResponse.ok) {
        return null;
      }

      const results = (await searchResponse.json()) as ScreenerCompanySearchResult[];
      if (!Array.isArray(results) || results.length === 0) {
        return null;
      }

      const match = results.find(
        (r) => this.normalizeCompanyPath(r.url).includes(`/${ticker.toUpperCase()}/`)
      ) || results[0];

      if (!match?.url) {
        return null;
      }

      const pageUrl = this.toAbsoluteCompanyUrl(this.normalizeCompanyPath(match.url));
      return this.fetchAndParseCompanyPage(ticker, pageUrl);
    } catch {
      return null;
    }
  }

  private async fetchAndParseCompanyPage(ticker: string, pageUrl: string): Promise<ScreenerFundamentalsData | null> {
    const response = await fetch(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MIT-Trading-System/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    if (!html || !html.includes("company-ratios")) {
      return null;
    }

    return this.transformHtmlResponse(ticker, html);
  }

  private transformHtmlResponse(ticker: string, html: string): ScreenerFundamentalsData {
    const topRatios = this.parseTopRatios(html);
    const revenueHistory = this.parseHistoryRow(html, "profit-loss", ["sales"]);
    const epsHistory = this.parseHistoryRow(html, "profit-loss", ["eps in rs"]);
    const opmHistory = this.parseHistoryRow(html, "profit-loss", ["opm %"]);
    const fcfHistory = this.parseHistoryRow(html, "cash-flow", ["cash from operating activity", "free cash flow"]);

    const promoterHoldingPct = this.parseLatestShareholding(html, ["promoters"]);
    const fiiHoldingPct = this.parseLatestShareholding(html, ["fiis"]);
    const diiHoldingPct = this.parseLatestShareholding(html, ["diis"]);

    const debtToEquity = this.parseDebtToEquityFromBalanceSheet(html);

    return {
      ticker: ticker.toUpperCase(),
      roce: this.pickRatio(topRatios, ["roce"]) ?? null,
      roe: this.pickRatio(topRatios, ["roe"]) ?? null,
      debtToEquity,
      interestCoverage: this.pickRatio(topRatios, ["interest coverage", "interest cover"]) ?? null,
      promoterHoldingPct,
      promoterPledgePct: this.pickRatio(topRatios, ["promoter pledged", "pledge"]) ?? null,
      fiiHoldingPct,
      diiHoldingPct,
      pe: this.pickRatio(topRatios, ["stock p/e", "p/e", "stock pe", "pe"]) ?? null,
      peg: this.pickRatio(topRatios, ["peg ratio", "peg"]) ?? null,
      marketCap: this.pickRatio(topRatios, ["market cap"]) ?? null,
      revenueHistory,
      epsHistory,
      opmHistory,
      fcfHistory,
      auditorRemarks: "unknown",
      fetchedAt: new Date().toISOString(),
    };
  }

  private parseNumber(value: string | null | undefined): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    const normalized = value
      .replace(/&nbsp;/gi, " ")
      .replace(/[₹,()%]/g, "")
      .replace(/Cr\.?/gi, "")
      .replace(/x$/i, "")
      .trim();
    if (normalized.length === 0 || normalized === "-" || normalized === "--") {
      return null;
    }
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private parseTopRatios(html: string): Map<string, number> {
    const out = new Map<string, number>();
    const topRatiosSection = this.extractBlock(html, /<ul id="top-ratios">([\s\S]*?)<\/ul>/i);
    if (!topRatiosSection) {
      return out;
    }
    const liRegex = /<li class="flex flex-space-between"[^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch: RegExpExecArray | null;
    while ((liMatch = liRegex.exec(topRatiosSection)) !== null) {
      const li = liMatch[1] ?? "";
      const name = this.cleanHtml(this.extractBlock(li, /<span class="name">([\s\S]*?)<\/span>/i) ?? "");
      const value = this.cleanHtml(this.extractBlock(li, /<span class="nowrap value">([\s\S]*?)<\/span>/i) ?? "");
      const key = this.normalizeKey(name);
      const number = this.parseNumber(value);
      if (key && number !== null) {
        out.set(key, number);
      }
    }
    return out;
  }

  private pickRatio(ratios: Map<string, number>, candidateKeys: string[]): number | null {
    for (const key of candidateKeys) {
      const normalized = this.normalizeKey(key);
      const value = ratios.get(normalized);
      if (value !== undefined) {
        return value;
      }
    }
    return null;
  }

  private parseHistoryRow(html: string, sectionId: string, rowLabels: string[]): { fy: string; value: number }[] {
    const section = this.extractSection(html, sectionId);
    if (!section) {
      return [];
    }
    const table = this.extractBlock(section, /<table class="data-table responsive-text-nowrap">([\s\S]*?)<\/table>/i);
    if (!table) {
      return [];
    }
    const headers = this.parseHeaderYears(table);
    const cells = this.parseRowCells(table, rowLabels);
    if (headers.length === 0 || cells.length === 0) {
      return [];
    }

    const out: { fy: string; value: number }[] = [];
    const max = Math.min(headers.length, cells.length);
    for (let i = 0; i < max; i += 1) {
      const year = headers[i];
      if (year === null) {
        continue;
      }
      const value = this.parseNumber(cells[i]);
      if (value === null) {
        continue;
      }
      out.push({ fy: `FY${String(year).slice(-2)}`, value });
    }

    out.sort((a, b) => a.fy.localeCompare(b.fy));
    return out;
  }

  private parseLatestShareholding(html: string, rowLabels: string[]): number | null {
    const cells = this.parseRowCells(html, rowLabels);
    if (cells.length === 0) {
      return null;
    }
    for (let i = cells.length - 1; i >= 0; i -= 1) {
      const parsed = this.parseNumber(cells[i]);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }

  private parseDebtToEquityFromBalanceSheet(html: string): number | null {
    const section = this.extractSection(html, "balance-sheet");
    if (!section) {
      return null;
    }
    const borrowings = this.parseLatestRowValue(section, ["borrowings"]);
    const equityCapital = this.parseLatestRowValue(section, ["equity capital"]);
    const reserves = this.parseLatestRowValue(section, ["reserves"]);
    if (borrowings === null || equityCapital === null || reserves === null) {
      return null;
    }
    const equityBase = equityCapital + reserves;
    if (equityBase <= 0) {
      return null;
    }
    return borrowings / equityBase;
  }

  private parseLatestRowValue(sectionHtml: string, rowLabels: string[]): number | null {
    const cells = this.parseRowCells(sectionHtml, rowLabels);
    for (let i = cells.length - 1; i >= 0; i -= 1) {
      const parsed = this.parseNumber(cells[i]);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }

  private parseHeaderYears(tableHtml: string): Array<number | null> {
    const headerBlock = this.extractBlock(tableHtml, /<thead>([\s\S]*?)<\/thead>/i);
    if (!headerBlock) {
      return [];
    }
    const cells = [...headerBlock.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((match) => this.cleanHtml(match[1] ?? ""));
    return cells.slice(1).map((label) => {
      const yearMatch = label.match(/(19\d{2}|20\d{2})/);
      if (!yearMatch) {
        return null;
      }
      const year = Number.parseInt(yearMatch[1] ?? "", 10);
      return Number.isFinite(year) ? year : null;
    });
  }

  private parseRowCells(tableHtml: string, rowLabels: string[]): string[] {
    const normalizedTargets = new Set(rowLabels.map((label) => this.normalizeKey(label)));
    const rowMatches = tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    for (const rowMatch of rowMatches) {
      const row = rowMatch[1] ?? "";
      const allTds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => this.cleanHtml(match[1] ?? ""));
      if (allTds.length < 2) {
        continue;
      }
      const rowName = this.normalizeKey(allTds[0] ?? "");
      if (!normalizedTargets.has(rowName)) {
        continue;
      }
      return allTds.slice(1);
    }
    return [];
  }

  private extractSection(html: string, sectionId: string): string | null {
    return this.extractBlock(html, new RegExp(`<section id="${sectionId}"[\\s\\S]*?<\\/section>`, "i"));
  }

  private normalizeCompanyPath(pathOrUrl: string): string {
    const pathOnly = pathOrUrl.startsWith("http") ? new URL(pathOrUrl).pathname : pathOrUrl;
    const normalized = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
    if (normalized.endsWith("/consolidated/")) {
      return normalized;
    }
    if (normalized.endsWith("/")) {
      return `${normalized}consolidated/`;
    }
    return `${normalized}/consolidated/`;
  }

  private toAbsoluteCompanyUrl(path: string): string {
    return path.startsWith("http") ? path : `https://www.screener.in${path}`;
  }

  private extractBlock(input: string, regex: RegExp): string | null {
    const match = input.match(regex);
    if (!match) {
      return null;
    }
    return match[1] ?? match[0] ?? null;
  }

  private cleanHtml(input: string): string {
    return input
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  private normalizeKey(input: string): string {
    return input
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Merge Screener.in fundamentals with Yahoo Finance fundamentals
 * Screener.in values take precedence for India-specific metrics
 */
export function mergeFundamentals(
  yahooData: FundamentalSnapshot,
  screenerData: ScreenerFundamentalsData | null
): FundamentalSnapshot {
  if (!screenerData) {
    return yahooData;
  }

  const revenueHistory = screenerData.revenueHistory.length > 0 ? screenerData.revenueHistory : yahooData.revenueHistory;
  const epsHistory = screenerData.epsHistory.length > 0 ? screenerData.epsHistory : yahooData.epsHistory;
  const opmHistory = screenerData.opmHistory.length > 0 ? screenerData.opmHistory : yahooData.opmHistory;
  const fcfHistory = screenerData.fcfHistory.length > 0 ? screenerData.fcfHistory : yahooData.fcfHistory;

  return {
    ...yahooData,
    // Screener.in values take precedence for India-specific data
    pe: screenerData.pe ?? yahooData.pe,
    peg: screenerData.peg ?? yahooData.peg,
    marketCap: screenerData.marketCap ?? yahooData.marketCap,
    roce: screenerData.roce ?? yahooData.roce,
    roe: screenerData.roe ?? yahooData.roe,
    debtToEquity: screenerData.debtToEquity ?? yahooData.debtToEquity,
    interestCoverage: screenerData.interestCoverage ?? yahooData.interestCoverage,
    promoterHoldingPct: screenerData.promoterHoldingPct ?? yahooData.promoterHoldingPct,
    promoterPledgePct: screenerData.promoterPledgePct ?? yahooData.promoterPledgePct,
    auditorRemarks: screenerData.auditorRemarks !== "unknown" ? screenerData.auditorRemarks : yahooData.auditorRemarks,
    // Also update if Screener has better historical data
    revenueHistory,
    epsHistory,
    opmHistory,
    fcfHistory,
    revenueCAGR_3y: cagr(revenueHistory, 3),
    revenueCAGR_5y: cagr(revenueHistory, 5),
    epsCAGR_3y: cagr(epsHistory, 3),
    epsCAGR_5y: cagr(epsHistory, 5),
    // Source tracking
    source: "screener-csv",
  };
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

// Singleton instance
let fetcherInstance: ScreenerFundamentalsFetcher | null = null;

export function getScreenerFetcher(): ScreenerFundamentalsFetcher {
  if (!fetcherInstance) {
    fetcherInstance = new ScreenerFundamentalsFetcher();
  }
  return fetcherInstance;
}

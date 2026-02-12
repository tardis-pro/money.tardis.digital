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

interface ScreenerApiResponse {
  name?: string;
  sector?: string;
  industry?: string;
  market_cap?: number;
  pe_ratio?: number;
  peg_ratio?: number;
  roe?: number;
  roce?: number;
  debt_to_equity?: number;
  interest_coverage?: number;
  promoter_holding?: number;
  promoter_pledged?: number;
  fii_holding?: number;
  dii_holding?: number;
  // Historical data arrays
  revenue?: Array<{ year: number; value: number }>;
  eps?: Array<{ year: number; value: number }>;
  opm?: Array<{ year: number; value: number }>;
  fcf?: Array<{ year: number; value: number }>;
  // Audit and governance
  audit_opinion?: string;
}

interface ScreenerCompanySearchResult {
  id: number;
  name: string;
  url: string;
  sector?: string;
}

export class ScreenerFundamentalsFetcher {
  private readonly baseUrl = "https://www.screener.in/api/1";
  private readonly searchUrl = "https://www.screener.in/api/company/search";

  /**
   * Fetch fundamentals for a single ticker from Screener.in
   */
  async fetchTicker(ticker: string): Promise<ScreenerFundamentalsData | null> {
    try {
      // First try direct API call with ticker
      const directData = await this.tryDirectFetch(ticker);
      if (directData) {
        return directData;
      }

      // Fallback: search for company to get proper URL/slug
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

  /**
   * Try direct fetch using the company API endpoint
   */
  private async tryDirectFetch(ticker: string): Promise<ScreenerFundamentalsData | null> {
    const url = `${this.baseUrl}/company/${ticker.toUpperCase()}/`;

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; MIT-Trading-System/1.0)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return null;
      }

      const data: ScreenerApiResponse = await response.json();
      return this.transformResponse(ticker, data);
    } catch {
      return null;
    }
  }

  /**
   * Search for company and fetch data using the found URL
   */
  private async searchAndFetch(ticker: string): Promise<ScreenerFundamentalsData | null> {
    try {
      const searchUrl = `${this.searchUrl}?q=${encodeURIComponent(ticker)}`;
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

      const searchPayload = (await searchResponse.json()) as {
        results?: ScreenerCompanySearchResult[];
      };
      const results = searchPayload.results || [];

      // Find best match (exact ticker match preferred)
      const match = results.find(
        (r) => r.name?.toUpperCase() === ticker.toUpperCase() || r.url?.includes(ticker.toLowerCase())
      ) || results[0];

      if (!match?.url) {
        return null;
      }

      // Extract company slug from URL (e.g., "/company/reliance-industries/" -> "reliance-industries")
      const slugMatch = match.url.match(/\/company\/([^/]+)/);
      if (!slugMatch) {
        return null;
      }

      const slug = slugMatch[1];
      if (!slug) {
        return null;
      }

      // Fetch company data using slug
      const companyUrl = `${this.baseUrl}/company/${slug}/`;
      const companyResponse = await fetch(companyUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; MIT-Trading-System/1.0)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!companyResponse.ok) {
        return null;
      }

      const data: ScreenerApiResponse = await companyResponse.json();
      return this.transformResponse(ticker, data);
    } catch {
      return null;
    }
  }

  /**
   * Transform Screener API response to our internal format
   */
  private transformResponse(ticker: string, data: ScreenerApiResponse): ScreenerFundamentalsData {
    return {
      ticker: ticker.toUpperCase(),
      roce: this.parseNumber(data.roce),
      roe: this.parseNumber(data.roe),
      debtToEquity: this.parseNumber(data.debt_to_equity),
      interestCoverage: this.parseNumber(data.interest_coverage),
      promoterHoldingPct: this.parseNumber(data.promoter_holding),
      promoterPledgePct: this.parseNumber(data.promoter_pledged),
      fiiHoldingPct: this.parseNumber(data.fii_holding),
      diiHoldingPct: this.parseNumber(data.dii_holding),
      pe: this.parseNumber(data.pe_ratio),
      peg: this.parseNumber(data.peg_ratio),
      marketCap: this.parseNumber(data.market_cap),
      revenueHistory: this.transformHistory(data.revenue),
      epsHistory: this.transformHistory(data.eps),
      opmHistory: this.transformHistory(data.opm),
      fcfHistory: this.transformHistory(data.fcf),
      auditorRemarks: this.parseAuditorRemarks(data.audit_opinion),
      fetchedAt: new Date().toISOString(),
    };
  }

  private parseNumber(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string") {
      const parsed = parseFloat(value.replace(/[,%₹]/g, ""));
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private transformHistory(
    data: Array<{ year: number; value: number }> | undefined
  ): { fy: string; value: number }[] {
    if (!data || !Array.isArray(data)) {
      return [];
    }
    return data
      .filter((item) => item.year && Number.isFinite(item.value))
      .map((item) => ({
        fy: `FY${String(item.year).slice(-2)}`,
        value: item.value,
      }))
      .sort((a, b) => a.fy.localeCompare(b.fy));
  }

  private parseAuditorRemarks(opinion: string | undefined): "clean" | "qualified" | "adverse" | "unknown" {
    if (!opinion) {
      return "unknown";
    }
    const lower = opinion.toLowerCase();
    if (lower.includes("adverse") || lower.includes("disclaimer")) {
      return "adverse";
    }
    if (lower.includes("qualified") || lower.includes("emphasis") || lower.includes("except")) {
      return "qualified";
    }
    if (lower.includes("unmodified") || lower.includes("clean") || lower.includes("standard")) {
      return "clean";
    }
    return "unknown";
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

  return {
    ...yahooData,
    // Screener.in values take precedence for India-specific data
    roce: screenerData.roce ?? yahooData.roce,
    interestCoverage: screenerData.interestCoverage ?? yahooData.interestCoverage,
    promoterHoldingPct: screenerData.promoterHoldingPct ?? yahooData.promoterHoldingPct,
    promoterPledgePct: screenerData.promoterPledgePct ?? yahooData.promoterPledgePct,
    auditorRemarks: screenerData.auditorRemarks !== "unknown" ? screenerData.auditorRemarks : yahooData.auditorRemarks,
    // Also update if Screener has better historical data
    revenueHistory: screenerData.revenueHistory.length > 0 ? screenerData.revenueHistory : yahooData.revenueHistory,
    epsHistory: screenerData.epsHistory.length > 0 ? screenerData.epsHistory : yahooData.epsHistory,
    opmHistory: screenerData.opmHistory.length > 0 ? screenerData.opmHistory : yahooData.opmHistory,
    fcfHistory: screenerData.fcfHistory.length > 0 ? screenerData.fcfHistory : yahooData.fcfHistory,
    // Update ROE/DE if Screener has them and Yahoo doesn't
    roe: yahooData.roe ?? screenerData.roe,
    debtToEquity: yahooData.debtToEquity ?? screenerData.debtToEquity,
    // Source tracking
    source: "screener-csv",
  };
}

// Singleton instance
let fetcherInstance: ScreenerFundamentalsFetcher | null = null;

export function getScreenerFetcher(): ScreenerFundamentalsFetcher {
  if (!fetcherInstance) {
    fetcherInstance = new ScreenerFundamentalsFetcher();
  }
  return fetcherInstance;
}

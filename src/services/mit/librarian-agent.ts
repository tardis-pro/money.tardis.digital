import type {
  LibrarianQueryRequest,
  LibrarianQueryResponse,
  NewsArticle,
} from "../../mit-types.js";

type CacheEntry = { data: unknown; expiry: number };

const NEWS_CACHE_TTL_MS = 15 * 60 * 1000;
const LINKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ARTICLE_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_NEWS_LIMIT = 5;

export interface BalanceSheetLinks {
  screener: string;
  moneycontrol: string;
  trendlyne: string;
  nse: string;
  bse: string;
}

export interface ResearchLinks {
  googleFinance: string;
  yahooFinance: string;
  tradingView: string;
}

export class LibrarianAgent {
  private readonly cache: Map<string, CacheEntry>;

  constructor(deps?: { cache?: Map<string, CacheEntry> }) {
    this.cache = deps?.cache ?? new Map<string, CacheEntry>();
  }

  async fetchNews(
    ticker: string,
    params?: { limit?: number; dateRange?: { start: string; end: string } },
  ): Promise<NewsArticle[]> {
    const normalizedTicker = normalizeTicker(ticker);
    const limit = normalizeLimit(params?.limit);
    const key = `news:${normalizedTicker}:${limit}:${params?.dateRange?.start ?? ""}:${params?.dateRange?.end ?? ""}`;

    return this.getOrSetCache<NewsArticle[]>(key, NEWS_CACHE_TTL_MS, async () => {
      const rssUrl = buildGoogleNewsRssUrl(normalizedTicker);
      const fallbackNews = fallbackNewsLinks(normalizedTicker).slice(0, limit);

      try {
        const response = await fetchWithTimeout(rssUrl, 10_000);
        if (!response.ok) {
          return fallbackNews;
        }

        const xml = await response.text();
        const parsed = parseRssArticles(xml, limit);
        const withSource = parsed.map((article) => ({
          ...article,
          source: article.source || "Google News",
        }));

        const filtered = filterByDateRange(withSource, params?.dateRange);
        if (filtered.length > 0) {
          return filtered.slice(0, limit);
        }
        return fallbackNews;
      } catch {
        return fallbackNews;
      }
    });
  }

  async getBalanceSheetLinks(ticker: string): Promise<BalanceSheetLinks> {
    const normalizedTicker = normalizeTicker(ticker);
    const key = `balance-links:${normalizedTicker}`;

    return this.getOrSetCache<BalanceSheetLinks>(key, LINKS_CACHE_TTL_MS, async () => {
      const encodedTicker = encodeURIComponent(normalizedTicker);
      const moneycontrol = buildMoneycontrolUrl(normalizedTicker);

      return {
        screener: `https://www.screener.in/company/${encodedTicker}/`,
        moneycontrol,
        trendlyne: `https://trendlyne.com/fundamentals/stock/${encodedTicker}/`,
        nse: `https://www.nseindia.com/get-quotes/equity?symbol=${encodedTicker}`,
        bse: `https://www.bseindia.com/stock-share-price/searchresults.html?q=${encodedTicker}`,
      };
    });
  }

  async getResearchLinks(ticker: string): Promise<ResearchLinks> {
    const normalizedTicker = normalizeTicker(ticker);
    const key = `research-links:${normalizedTicker}`;

    return this.getOrSetCache<ResearchLinks>(key, LINKS_CACHE_TTL_MS, async () => {
      const encodedTicker = encodeURIComponent(normalizedTicker);

      return {
        googleFinance: `https://www.google.com/finance/quote/${encodedTicker}:NSE`,
        yahooFinance: `https://finance.yahoo.com/quote/${encodedTicker}.NS`,
        tradingView: `https://www.tradingview.com/symbols/NSE-${encodedTicker}/`,
      };
    });
  }

  async processRequest(request: LibrarianQueryRequest): Promise<LibrarianQueryResponse> {
    const fetchedAt = new Date().toISOString();

    try {
      if (request.action === "news") {
        const ticker = resolveTicker(request.ticker, request.params?.query);
        if (!ticker) {
          return this.errorResponse("news", "Ticker is required for news action", fetchedAt);
        }

        const news = await this.fetchNews(ticker, buildNewsParams(request.params));

        return {
          action: request.action,
          results: {
            type: "news",
            items: news.map((item) => toResponseItem(item)),
          },
          metadata: {
            fetchedAt,
            source: "librarian-agent",
          },
        };
      }

      if (request.action === "balance_sheet") {
        const ticker = resolveTicker(request.ticker, request.params?.query);
        if (!ticker) {
          return this.errorResponse("balance_sheet", "Ticker is required for balance sheet action", fetchedAt);
        }

        const [balanceSheetLinks, researchLinks] = await Promise.all([
          this.getBalanceSheetLinks(ticker),
          this.getResearchLinks(ticker),
        ]);

        return {
          action: request.action,
          results: {
            type: "balance_sheet",
            items: [
              {
                title: `${normalizeTicker(ticker)} balance sheet and research links`,
                content: {
                  ticker: normalizeTicker(ticker),
                  balanceSheetLinks,
                  researchLinks,
                },
              },
            ],
          },
          metadata: {
            fetchedAt,
            source: "librarian-agent",
          },
        };
      }

      if (request.action === "articles") {
        const urls = collectUrls(request.params?.query, request.params?.sources);
        const ticker = resolveTicker(request.ticker, request.params?.query);
        const newsSeed = urls.length > 0 ? [] : ticker ? await this.fetchNews(ticker, buildNewsParams(request.params, { includeDateRange: false })) : [];
        const targets = (urls.length > 0 ? urls : newsSeed.map((item) => item.url)).slice(0, normalizeLimit(request.params?.limit));

        const articleItems = await Promise.all(targets.map(async (url) => this.fetchAndSummarizeArticle(url)));

        return {
          action: request.action,
          results: {
            type: "article",
            items: articleItems,
          },
          metadata: {
            fetchedAt,
            source: "librarian-agent",
          },
        };
      }

      const ticker = resolveTicker(request.ticker, request.params?.query);
      if (!ticker) {
        return this.errorResponse("search", "Provide a ticker or query containing a ticker", fetchedAt);
      }

      const [balanceSheetLinks, researchLinks, recentNews] = await Promise.all([
        this.getBalanceSheetLinks(ticker),
        this.getResearchLinks(ticker),
        this.fetchNews(ticker, buildNewsParams(request.params)),
      ]);

      return {
        action: request.action,
        results: {
          type: "news",
          items: [
            {
              title: `${normalizeTicker(ticker)} research data`,
              summary: "Consolidated external balance sheet and research links",
              content: {
                ticker: normalizeTicker(ticker),
                balanceSheetLinks,
                researchLinks,
              },
            },
            ...recentNews.map((item) => toResponseItem(item)),
          ],
        },
        metadata: {
          fetchedAt,
          source: "librarian-agent",
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown librarian error";
      return this.errorResponse(request.action, message, fetchedAt);
    }
  }

  private async fetchAndSummarizeArticle(url: string): Promise<{ title?: string; url?: string; date?: string; summary?: string; content?: Record<string, unknown> }> {
    const key = `article:${url}`;

    return this.getOrSetCache(key, ARTICLE_CACHE_TTL_MS, async () => {
      const output = {
        title: "Article",
        url,
        date: new Date().toISOString(),
        summary: "Summary unavailable",
      };

      try {
        const response = await fetchWithTimeout(url, 10_000);
        if (!response.ok) {
          return {
            ...output,
            summary: `Unable to fetch article (status ${response.status})`,
          };
        }

        const html = await response.text();
        const title = extractHtmlTitle(html) ?? output.title;
        const bodyText = stripHtmlToText(html);
        const summary = summarizeText(bodyText);

        return {
          title,
          url,
          date: new Date().toISOString(),
          summary,
        };
      } catch {
        return {
          ...output,
          summary: "Unable to fetch article content. Returned link only.",
        };
      }
    });
  }

  private errorResponse(action: LibrarianQueryRequest["action"], message: string, fetchedAt: string): LibrarianQueryResponse {
    return {
      action,
      results: {
        type: "article",
        items: [{ title: "Librarian Agent Error", summary: message }],
      },
      metadata: {
        fetchedAt,
        source: "librarian-agent",
      },
    };
  }

  private getCached<T>(key: string): T | null {
    const hit = this.cache.get(key);
    if (!hit) {
      return null;
    }
    if (Date.now() > hit.expiry) {
      this.cache.delete(key);
      return null;
    }
    return hit.data as T;
  }

  private setCache<T>(key: string, data: T, ttlMs: number): void {
    this.cache.set(key, {
      data,
      expiry: Date.now() + ttlMs,
    });
  }

  private async getOrSetCache<T>(key: string, ttlMs: number, factory: () => Promise<T>): Promise<T> {
    const cached = this.getCached<T>(key);
    if (cached !== null) {
      return cached;
    }

    const data = await factory();
    this.setCache(key, data, ttlMs);
    return data;
  }
}

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_NEWS_LIMIT;
  }
  return Math.max(1, Math.min(20, Math.floor(value)));
}

function buildNewsParams(
  params: LibrarianQueryRequest["params"] | undefined,
  options: { includeDateRange?: boolean } = {},
): { limit?: number; dateRange?: { start: string; end: string } } {
  const out: { limit?: number; dateRange?: { start: string; end: string } } = {};
  if (params?.limit !== undefined) {
    out.limit = params.limit;
  }
  if (options.includeDateRange !== false && params?.dateRange !== undefined) {
    out.dateRange = params.dateRange;
  }
  return out;
}

function toResponseItem(article: NewsArticle): { title?: string; url?: string; date?: string; summary?: string; content?: Record<string, unknown> } {
  const out: { title?: string; url?: string; date?: string; summary?: string; content?: Record<string, unknown> } = {
    title: article.title,
    url: article.url,
    date: article.date,
  };
  if (article.summary !== undefined) {
    out.summary = article.summary;
  }
  return out;
}

function resolveTicker(ticker: string | undefined, query: string | undefined): string | null {
  if (ticker && ticker.trim().length > 0) {
    return normalizeTicker(ticker);
  }
  if (!query) {
    return null;
  }
  const match = query.toUpperCase().match(/\b[A-Z]{2,15}\b/);
  if (!match) {
    return null;
  }
  return normalizeTicker(match[0]);
}

function buildGoogleNewsRssUrl(ticker: string): string {
  const query = encodeURIComponent(`${ticker} stock india`);
  return `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`;
}

function fallbackNewsLinks(ticker: string): NewsArticle[] {
  const now = new Date().toISOString();
  const encodedTicker = encodeURIComponent(ticker);

  return [
    {
      title: `${ticker} latest news - Google News`,
      url: `https://news.google.com/search?q=${encodedTicker}`,
      date: now,
      source: "Google News",
      summary: `Fallback news link for ${ticker}. Live scraping is intentionally stubbed.`,
    },
    {
      title: `${ticker} company news - Moneycontrol`,
      url: `https://www.moneycontrol.com/news/tags/${encodedTicker}.html`,
      date: now,
      source: "Moneycontrol",
      summary: `Moneycontrol tag page for ${ticker}.`,
    },
  ];
}

function parseRssArticles(xml: string, limit: number): NewsArticle[] {
  const itemPattern = /<item>([\s\S]*?)<\/item>/g;
  const out: NewsArticle[] = [];
  let match: RegExpExecArray | null;

  while ((match = itemPattern.exec(xml)) !== null && out.length < limit) {
    const item = match[1] ?? "";
    const title = decodeHtmlEntities(extractTagValue(item, "title") ?? "Untitled");
    const url = decodeHtmlEntities(extractTagValue(item, "link") ?? "");
    const date = new Date(extractTagValue(item, "pubDate") ?? Date.now()).toISOString();
    const source = decodeHtmlEntities(extractTagValue(item, "source") ?? "Google News");
    const summary = summarizeText(stripHtmlToText(decodeHtmlEntities(extractTagValue(item, "description") ?? "")));

    if (!url) {
      continue;
    }

    out.push({ title, url, date, source, summary });
  }

  return out;
}

function extractTagValue(input: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = input.match(regex);
  return match?.[1]?.trim() ?? null;
}

function filterByDateRange(
  articles: NewsArticle[],
  dateRange: { start: string; end: string } | undefined,
): NewsArticle[] {
  if (!dateRange) {
    return articles;
  }

  const startTs = Date.parse(dateRange.start);
  const endTs = Date.parse(dateRange.end);
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) {
    return articles;
  }

  return articles.filter((article) => {
    const ts = Date.parse(article.date);
    return Number.isFinite(ts) && ts >= startTs && ts <= endTs;
  });
}

function collectUrls(query: string | undefined, sources: string[] | undefined): string[] {
  const fromSources = (sources ?? []).filter((value) => /^https?:\/\//i.test(value));
  const fromQuery = query?.match(/https?:\/\/[^\s)]+/g) ?? [];
  return [...new Set([...fromSources, ...fromQuery])];
}

function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) {
    return null;
  }
  return decodeHtmlEntities(match[1]).replace(/\s+/g, " ").trim();
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeText(text: string): string {
  if (!text) {
    return "Summary unavailable";
  }

  const maxLength = 420;
  const sentences = text.split(/(?<=[.!?])\s+/).filter((part) => part.trim().length > 0);
  let summary = "";
  for (const sentence of sentences) {
    if ((summary + sentence).length > maxLength) {
      break;
    }
    summary += `${sentence} `;
    if (summary.length > 220) {
      break;
    }
  }

  const normalized = summary.trim() || text.slice(0, maxLength);
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function buildMoneycontrolUrl(ticker: string): string {
  const symbol = encodeURIComponent(ticker.toUpperCase());
  const name = encodeURIComponent(ticker.toLowerCase());
  const sector = "stocks";
  return `https://www.moneycontrol.com/india/stockpricequote/${sector}/${name}/${symbol}`;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "text/html,application/xml,application/rss+xml,application/json",
      },
      signal: abortController.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

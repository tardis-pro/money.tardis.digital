import type { MitStore } from "../../mit-store.js";
import type { StateStore, Store } from "../../store.js";
import type {
  AgentIntent,
  ManagerQueryRequest,
  ManagerQueryResponse,
  MitState,
} from "../../mit-types.js";

type OutputType = "chart" | "table" | "text" | "links";

interface ExtractedEntities {
  rawQuery: string;
  tickers: string[];
  dateRange: { start: string; end: string } | null;
  metrics: string[];
  outputFormat: OutputType;
  flags: {
    wantsNews: boolean;
    wantsBalanceSheet: boolean;
    wantsFeatureChange: boolean;
  };
}

interface AgentResult {
  agent: "librarian" | "analyst" | "trader" | "coder" | "manager";
  details: string;
  summary: string;
  rows: Record<string, unknown>[];
  links: string[];
  chart: Record<string, unknown> | null;
}

const INTENT_PATTERNS: Array<{ intent: AgentIntent; patterns: RegExp[] }> = [
  {
    intent: "trade_action",
    patterns: [
      /\b(buy|sell|exit|enter|close|square\s*off|book\s*profit|stop\s*loss|sl|target|position|trade)\b/i,
      /\b(place\s+order|execute\s+trade|confirm\s+entry)\b/i,
    ],
  },
  {
    intent: "feature_request",
    patterns: [
      /\b(add|build|create|implement|change|modify|update|improve|feature|enhancement)\b/i,
      /\b(code|api|endpoint|automation|integrate|integration)\b/i,
    ],
  },
  {
    intent: "analysis",
    patterns: [
      /\b(analy[sz]e|analysis|compare|trend|historical|performance|roi|fire\s*number|cagr|volatility)\b/i,
      /\b(technical|fundamental|rsi|macd|dma|sma|score|checklist)\b/i,
    ],
  },
  {
    intent: "data_request",
    patterns: [
      /\b(show|fetch|get|give|list|display|download|export|csv|table|chart|image|links?)\b/i,
      /\b(news|balance\s*sheet|holdings|watchlist|portfolio|daily\s*ideas|hero)\b/i,
    ],
  },
];

const METRIC_PATTERNS: Array<{ metric: string; pattern: RegExp }> = [
  { metric: "roi", pattern: /\broi\b/i },
  { metric: "fire_number", pattern: /\bfire\s*number\b/i },
  { metric: "pe", pattern: /\b(p\/e|pe)\b/i },
  { metric: "peg", pattern: /\bpeg\b/i },
  { metric: "roce", pattern: /\broce\b/i },
  { metric: "roe", pattern: /\broe\b/i },
  { metric: "revenue", pattern: /\brevenue\b/i },
  { metric: "eps", pattern: /\beps\b/i },
  { metric: "rsi", pattern: /\brsi\b/i },
  { metric: "macd", pattern: /\bmacd\b/i },
  { metric: "volume", pattern: /\bvolume\b/i },
  { metric: "price", pattern: /\b(price|ltp|close)\b/i },
  { metric: "pnl", pattern: /\bp\s*&?\s*l\b|\bpnl\b/i },
  { metric: "return", pattern: /\breturn(s)?\b/i },
];

const STOCK_NAME_TO_TICKER: Record<string, string> = {
  "tata steel": "TATASTEEL",
  "tata motors": "TATAMOTORS",
  "reliance": "RELIANCE",
  "hdfc bank": "HDFCBANK",
  "icici bank": "ICICIBANK",
  "infosys": "INFY",
  "tcs": "TCS",
  "sbi": "SBIN",
  "state bank of india": "SBIN",
  "l&t": "LT",
  "larsen and toubro": "LT",
  "itc": "ITC",
};

export class ManagerAgent {
  constructor(private readonly deps: { mitStore: MitStore; store: Store }) {}

  async processQuery(request: ManagerQueryRequest): Promise<ManagerQueryResponse> {
    const query = request.query.trim();
    if (query.length === 0) {
      return {
        intent: "general_query",
        interpretation: "Received an empty query; please provide a stock, metric, or action.",
        outputs: [{ type: "text", content: "Please share what you need (for example: 'analyze TATASTEEL for 2 years as table')." }],
      };
    }

    try {
      const intent = this.classifyIntent(query);
      const entities = this.extractEntities(query);
      const detectedFormat = this.detectOutputFormat(query);
      const outputType = request.outputPreference && request.outputPreference !== "auto"
        ? request.outputPreference
        : detectedFormat;

      entities.outputFormat = outputType;

      const agentResult = await this.routeToAgent(intent, entities);
      const outputs = this.composeOutputs(outputType, agentResult);

      return {
        intent,
        interpretation: this.buildInterpretation(intent, entities),
        outputs,
        actionTaken: {
          agent: agentResult.agent,
          details: agentResult.details,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        intent: "general_query",
        interpretation: "Could not fully process the request; returning a safe fallback response.",
        outputs: [{ type: "text", content: `I hit an error while processing your query: ${message}` }],
        actionTaken: {
          agent: "manager",
          details: "Fallback error handler",
        },
      };
    }
  }

  private classifyIntent(query: string): AgentIntent {
    const scoreByIntent: Record<AgentIntent, number> = {
      trade_action: 0,
      feature_request: 0,
      analysis: 0,
      data_request: 0,
      general_query: 0,
    };

    for (const entry of INTENT_PATTERNS) {
      for (const pattern of entry.patterns) {
        if (pattern.test(query)) {
          scoreByIntent[entry.intent] += 1;
        }
      }
    }

    const ranked = (Object.keys(scoreByIntent) as AgentIntent[])
      .map((intent) => ({ intent, score: scoreByIntent[intent] }))
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best || best.score <= 0) {
      return "general_query";
    }
    return best.intent;
  }

  private extractEntities(query: string): ExtractedEntities {
    const tickers = this.extractTickers(query);
    const metrics = METRIC_PATTERNS
      .filter((entry) => entry.pattern.test(query))
      .map((entry) => entry.metric);

    const dateRange = this.extractDateRange(query);

    return {
      rawQuery: query,
      tickers,
      dateRange,
      metrics,
      outputFormat: this.detectOutputFormat(query),
      flags: {
        wantsNews: /\b(news|headline|article|report)\b/i.test(query),
        wantsBalanceSheet: /\b(balance\s*sheet|financials?)\b/i.test(query),
        wantsFeatureChange: /\b(add|create|build|feature|implement|change|modify|update)\b/i.test(query),
      },
    };
  }

  private detectOutputFormat(query: string): OutputType {
    if (/\b(chart|graph|plot|image|visuali[sz]ation|visualise|visualize)\b/i.test(query)) {
      return "chart";
    }
    if (/\b(table|tabular|spreadsheet|csv|sheet|rows?)\b/i.test(query)) {
      return "table";
    }
    if (/\b(link|links|url|source|sources|article)\b/i.test(query)) {
      return "links";
    }
    return "text";
  }

  private async routeToAgent(intent: AgentIntent, entities: ExtractedEntities): Promise<AgentResult> {
    const [mitState, appState] = await Promise.all([
      this.deps.mitStore.read(),
      this.deps.store.read(),
    ]);

    if (intent === "feature_request" || entities.flags.wantsFeatureChange) {
      return this.routeFeatureRequest(entities);
    }

    if (intent === "trade_action") {
      return this.routeTrader(entities, mitState);
    }

    const needsLibrarian = entities.flags.wantsNews || entities.flags.wantsBalanceSheet || entities.outputFormat === "links";
    const needsAnalyst = intent === "analysis"
      || entities.metrics.length > 0
      || entities.outputFormat === "chart"
      || entities.tickers.length > 0;

    const results: AgentResult[] = [];
    if (needsAnalyst) {
      results.push(this.routeAnalyst(entities, mitState));
    }
    if (needsLibrarian) {
      results.push(this.routeLibrarian(entities, appState, mitState));
    }

    if (results.length === 0) {
      return {
        agent: "manager",
        details: "General query fallback",
        summary: "I can help with stock data, analysis, trade actions, or feature requests.",
        rows: [],
        links: [],
        chart: null,
      };
    }

    if (results.length === 1) {
      const single = results[0];
      if (single) {
        return single;
      }
    }

    return {
      agent: "manager",
      details: `Combined ${results.length} sub-agent results`,
      summary: results.map((row) => row.summary).filter((text) => text.length > 0).join("\n"),
      rows: results.flatMap((row) => row.rows),
      links: unique(results.flatMap((row) => row.links)),
      chart: results.find((row) => row.chart !== null)?.chart ?? null,
    };
  }

  private routeFeatureRequest(entities: ExtractedEntities): AgentResult {
    return {
      agent: "coder",
      details: "Feature request routed to coder workflow",
      summary: "Feature request captured. Suggested action: create a GitHub issue with acceptance criteria and implementation steps.",
      rows: [
        {
          request: entities.rawQuery,
          priority: inferPriority(entities.rawQuery),
          suggestedAction: "Create GitHub issue via coder agent endpoint",
        },
      ],
      links: [],
      chart: null,
    };
  }

  private routeTrader(entities: ExtractedEntities, mitState: MitState): AgentResult {
    const openPositions = mitState.portfolio.positions;
    const filtered = entities.tickers.length > 0
      ? openPositions.filter((pos) => entities.tickers.includes(pos.ticker.toUpperCase()))
      : openPositions;

    return {
      agent: "trader",
      details: entities.tickers.length > 0 ? "Trade action routed with ticker filter" : "Trade action routed for portfolio overview",
      summary: filtered.length > 0
        ? `Found ${filtered.length} matching open position(s).`
        : "No matching open positions found. Use /api/mit/trade/enter to create a position.",
      rows: filtered.map((pos) => ({
        ticker: pos.ticker,
        status: pos.status,
        qty: pos.qty,
        entryPrice: pos.entryPrice,
        currentPrice: pos.currentPrice,
        unrealizedPnl: pos.unrealizedPnl,
        stopLoss: pos.stopLoss,
        firstTarget: pos.firstTarget,
      })),
      links: [],
      chart: null,
    };
  }

  private routeAnalyst(entities: ExtractedEntities, mitState: MitState): AgentResult {
    const sourceTickers = entities.tickers.length > 0
      ? entities.tickers
      : Object.keys(mitState.compositeScores).slice(0, 5);

    const rows = sourceTickers.map((ticker) => {
      const key = ticker.toUpperCase();
      const score = mitState.compositeScores[key];
      const technical = mitState.technicals[key];
      const fundamental = mitState.fundamentals[key];
      const candles = mitState.candles[key] ?? [];

      const historical = entities.dateRange
        ? computeRangeReturn(candles, entities.dateRange.start, entities.dateRange.end)
        : null;

      return {
        ticker: key,
        compositeScore: score?.total ?? null,
        rsi14: technical?.rsi14 ?? null,
        latestClose: technical?.latestClose ?? null,
        pe: fundamental?.pe ?? null,
        roe: fundamental?.roe ?? null,
        revenueCAGR_3y: fundamental?.revenueCAGR_3y ?? null,
        historicalReturnPct: historical?.returnPct ?? null,
        historicalPeriod: historical?.label ?? null,
      };
    });

    const hasRows = rows.some((row) => row.compositeScore !== null || row.latestClose !== null || row.pe !== null);

    return {
      agent: "analyst",
      details: entities.dateRange
        ? `Analysis routed with date range ${entities.dateRange.start} to ${entities.dateRange.end}`
        : "Analysis routed on latest available MIT state",
      summary: hasRows
        ? `Prepared analysis snapshot for ${rows.length} ticker(s).`
        : "No analysis data available yet. Run MIT pipeline/fundamentals refresh first.",
      rows,
      links: [],
      chart: {
        type: "line",
        metric: entities.metrics[0] ?? "latestClose",
        series: rows.map((row) => ({ ticker: row.ticker, value: row.latestClose })),
      },
    };
  }

  private routeLibrarian(entities: ExtractedEntities, appState: StateStore, mitState: MitState): AgentResult {
    const tickers = entities.tickers.length > 0
      ? entities.tickers
      : Object.keys(mitState.fundamentals).slice(0, 3);

    const links: string[] = [];
    for (const ticker of tickers) {
      const upper = ticker.toUpperCase();
      links.push(`https://www.screener.in/company/${encodeURIComponent(upper)}/`);
      links.push(`https://www.moneycontrol.com/india/stockpricequote/search?search_str=${encodeURIComponent(upper)}`);
    }

    const recentSignals = appState.signals
      .slice(0, 10)
      .map((signal) => ({
        title: signal.event.title,
        sourceId: signal.sourceId,
        createdAt: signal.createdAt,
        summary: signal.event.summary,
      }));

    return {
      agent: "librarian",
      details: "Research links and recent news context prepared",
      summary: recentSignals.length > 0
        ? `Prepared ${links.length} reference links and ${recentSignals.length} recent signal(s).`
        : `Prepared ${links.length} reference links; no recent signal records available.`,
      rows: recentSignals,
      links: unique(links),
      chart: null,
    };
  }

  private composeOutputs(outputType: OutputType, agentResult: AgentResult): ManagerQueryResponse["outputs"] {
    if (outputType === "chart") {
      return [{ type: "chart", content: agentResult.chart ?? { type: "line", series: [] } }];
    }

    if (outputType === "table") {
      return [{ type: "table", content: { rows: agentResult.rows } }];
    }

    if (outputType === "links") {
      return [{ type: "links", content: { links: agentResult.links } }];
    }

    const details = [agentResult.summary];
    if (agentResult.rows.length > 0) {
      details.push(`Rows: ${agentResult.rows.length}`);
    }
    if (agentResult.links.length > 0) {
      details.push(`Links: ${agentResult.links.length}`);
    }

    return [{ type: "text", content: details.join("\n") }];
  }

  private buildInterpretation(intent: AgentIntent, entities: ExtractedEntities): string {
    const tickerPart = entities.tickers.length > 0 ? entities.tickers.join(", ") : "no explicit ticker";
    const metricPart = entities.metrics.length > 0 ? entities.metrics.join(", ") : "no explicit metric";
    const datePart = entities.dateRange ? `${entities.dateRange.start} to ${entities.dateRange.end}` : "latest period";
    return `Intent: ${intent}. Tickers: ${tickerPart}. Metrics: ${metricPart}. Period: ${datePart}. Output: ${entities.outputFormat}.`;
  }

  private extractTickers(query: string): string[] {
    const byUppercase = [...new Set((query.match(/\b[A-Z]{2,15}\b/g) ?? []))]
      .filter((token) => !COMMON_UPPERCASE_WORDS.has(token));

    const fromStockNames = Object.entries(STOCK_NAME_TO_TICKER)
      .filter(([name]) => query.toLowerCase().includes(name))
      .map(([, ticker]) => ticker);

    const fromRecent = this.extractFromRecentContext(query);
    return unique([...byUppercase, ...fromStockNames, ...fromRecent]).map((ticker) => ticker.toUpperCase());
  }

  private extractDateRange(query: string): { start: string; end: string } | null {
    const explicit = query.match(/\b(\d{4}-\d{2}-\d{2})\s+(?:to|\-|through|till)\s+(\d{4}-\d{2}-\d{2})\b/i);
    if (explicit) {
      const start = explicit[1];
      const end = explicit[2];
      if (start && end) {
        return normalizeDateRange(start, end);
      }
    }

    const relative = query.match(/\b(last|past)\s+(\d+)\s*(day|days|week|weeks|month|months|year|years)\b/i);
    if (!relative) {
      return null;
    }

    const count = Number.parseInt(relative[2] ?? "0", 10);
    if (!Number.isFinite(count) || count <= 0) {
      return null;
    }

    const unit = (relative[3] ?? "days").toLowerCase();
    const end = new Date();
    const start = new Date(end);
    if (unit.startsWith("day")) {
      start.setDate(start.getDate() - count);
    } else if (unit.startsWith("week")) {
      start.setDate(start.getDate() - count * 7);
    } else if (unit.startsWith("month")) {
      start.setMonth(start.getMonth() - count);
    } else {
      start.setFullYear(start.getFullYear() - count);
    }

    return {
      start: isoDate(start),
      end: isoDate(end),
    };
  }

  private extractFromRecentContext(_query: string): string[] {
    return [];
  }
}

const COMMON_UPPERCASE_WORDS = new Set([
  "AND",
  "FOR",
  "WITH",
  "FROM",
  "SHOW",
  "GET",
  "CSV",
  "ROI",
  "FIRE",
  "PE",
  "ROE",
  "ROCE",
  "RSI",
  "MACD",
  "DMA",
  "SMA",
  "PNL",
  "API",
]);

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function normalizeDateRange(a: string, b: string): { start: string; end: string } {
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

function inferPriority(query: string): "low" | "medium" | "high" {
  if (/\b(urgent|critical|asap|immediately|blocker)\b/i.test(query)) {
    return "high";
  }
  if (/\b(optional|nice\s*to\s*have|later|eventually)\b/i.test(query)) {
    return "low";
  }
  return "medium";
}

function computeRangeReturn(
  candles: Array<{ date: string; close: number }>,
  start: string,
  end: string,
): { returnPct: number; label: string } | null {
  if (candles.length === 0) {
    return null;
  }

  const inRange = candles
    .filter((candle) => candle.date >= start && candle.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (inRange.length < 2) {
    return null;
  }

  const first = inRange[0];
  const last = inRange[inRange.length - 1];
  if (!first || !last || first.close === 0) {
    return null;
  }

  return {
    returnPct: ((last.close - first.close) / first.close) * 100,
    label: `${first.date} to ${last.date}`,
  };
}

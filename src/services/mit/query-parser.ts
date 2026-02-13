export type OutputType = "chart" | "table" | "text" | "links" | "csv";

export type AgentIntent = "data_request" | "analysis" | "trade_action" | "feature_request" | "general_query";

export interface MetricFilter {
  field: string;
  operator: "gt" | "lt" | "eq" | "between";
  value: number | [number, number];
}

export interface ParsedQuery {
  original: string;
  tickers: string[];
  metrics: MetricFilter[];
  period: string | null;
  outputFormat: OutputType | null;
  intent: AgentIntent;
}

const NUMBER_PATTERN = "(-?\\d+(?:,\\d{3})*(?:\\.\\d+)?)";

const KNOWN_STOCK_ALIASES: Record<string, string> = {
  "tata steel": "TATASTEEL",
  tatasteel: "TATASTEEL",
  infosys: "INFY",
  infy: "INFY",
  reliance: "RELIANCE",
  "reliance industries": "RELIANCE",
  hdfc: "HDFC",
  "hdfc bank": "HDFCBANK",
  icici: "ICICIBANK",
  "icici bank": "ICICIBANK",
  sbin: "SBIN",
  "state bank": "SBIN",
  tcs: "TCS",
  wipro: "WIPRO",
  itc: "ITC",
  ltim: "LTIM",
  hcl: "HCLTECH",
  "hcl tech": "HCLTECH",
  bajaj: "BAJFINANCE",
  "bajaj finance": "BAJFINANCE",
};

const TICKER_STOPWORDS = new Set<string>([
  "PE",
  "P",
  "E",
  "ROE",
  "ROCE",
  "ROI",
  "RSI",
  "MACD",
  "EPS",
  "CSV",
  "NSE",
  "BSE",
  "AND",
  "OR",
  "THE",
  "FOR",
  "LAST",
  "PAST",
  "SHOW",
  "WITH",
  "BETWEEN",
  "TABLE",
  "CHART",
  "LINKS",
  "TEXT",
  "PRICE",
  "VOLUME",
  "YEAR",
  "YEARS",
  "MONTH",
  "MONTHS",
  "WEEK",
  "WEEKS",
]);

const METRIC_ALIASES: Record<string, string[]> = {
  pe: ["pe", "p/e", "price to earnings", "price/earnings"],
  roce: ["roce", "return on capital employed"],
  roe: ["roe", "return on equity"],
  roi: ["roi", "return on investment"],
  eps: ["eps", "earnings per share"],
  rsi: ["rsi", "relative strength index"],
  price: ["price", "cmp", "current price", "stock price"],
  marketCap: ["market cap", "mcap", "marketcap"],
  debtToEquity: ["debt to equity", "d/e", "de ratio"],
  volume: ["volume"],
};

const METRIC_ALIAS_TO_FIELD = Object.entries(METRIC_ALIASES).reduce<Record<string, string>>((acc, [field, aliases]) => {
  for (const alias of aliases) {
    acc[alias.toLowerCase()] = field;
  }
  return acc;
}, {});

const METRIC_PATTERN = Object.keys(METRIC_ALIAS_TO_FIELD)
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join("|");

const PERIOD_SHORT_PATTERN = /\b(1M|3M|6M|1Y|2Y|5Y)\b/i;

const PERIOD_LONG_PATTERNS: Array<{ regex: RegExp; unit: "M" | "Y" }> = [
  { regex: /\b(?:past|last|previous|for|over)\s+(\d+)\s*(?:month|months|mo|mos)\b/i, unit: "M" },
  { regex: /\b(?:past|last|previous|for|over)\s+(\d+)\s*(?:year|years|yr|yrs)\b/i, unit: "Y" },
  { regex: /\b(\d+)\s*(?:month|months|mo|mos)\b/i, unit: "M" },
  { regex: /\b(\d+)\s*(?:year|years|yr|yrs)\b/i, unit: "Y" },
];

export class QueryParser {
  parse(query: string): ParsedQuery {
    const normalizedQuery = query.trim();
    const tickers = this.extractTickers(normalizedQuery);
    const metrics = this.extractMetrics(normalizedQuery);
    const period = this.extractPeriod(normalizedQuery);
    const outputFormat = this.extractOutputFormat(normalizedQuery);

    return {
      original: query,
      tickers,
      metrics,
      period,
      outputFormat,
      intent: this.detectIntent(normalizedQuery, tickers, metrics),
    };
  }

  extractTickers(query: string): string[] {
    const tickers = new Set<string>();
    const upperQuery = query.toUpperCase();
    const symbolPattern = /\b(?:NSE:)?\$?([A-Z]{2,15})(?:\.NS|\.BO)?\b/g;
    const lowerQuery = query.toLowerCase();

    let match = symbolPattern.exec(upperQuery);
    while (match) {
      const symbol = match[1];
      if (symbol && !TICKER_STOPWORDS.has(symbol) && !/^\d+[MY]$/.test(symbol)) {
        tickers.add(symbol);
      }
      match = symbolPattern.exec(upperQuery);
    }

    for (const [alias, ticker] of Object.entries(KNOWN_STOCK_ALIASES)) {
      const aliasRegex = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i");
      if (aliasRegex.test(lowerQuery)) {
        tickers.add(ticker);
      }
    }

    return [...tickers];
  }

  extractMetrics(query: string): MetricFilter[] {
    const filters: MetricFilter[] = [];
    const seen = new Set<string>();

    const betweenRegex = new RegExp(
      `\\b(${METRIC_PATTERN})\\b\\s*(?:is\\s*)?(?:between|from)\\s*${NUMBER_PATTERN}\\s*(?:%|percent)?\\s*(?:and|to|-)\\s*${NUMBER_PATTERN}\\s*(?:%|percent)?`,
      "gi",
    );

    const comparisonRegex = new RegExp(
      `\\b(${METRIC_PATTERN})\\b\\s*(?:is\\s*)?(>=|<=|>|<|=|==|above|over|more\\s+than|greater\\s+than|less\\s+than|below|under|equal\\s+to|equals|at\\s+least|at\\s+most)\\s*${NUMBER_PATTERN}\\s*(?:%|percent)?`,
      "gi",
    );

    let betweenMatch = betweenRegex.exec(query);
    while (betweenMatch) {
      const fieldRaw = betweenMatch[1] ?? "";
      const firstRaw = betweenMatch[2] ?? "";
      const secondRaw = betweenMatch[3] ?? "";

      if (!fieldRaw || !firstRaw || !secondRaw) {
        betweenMatch = betweenRegex.exec(query);
        continue;
      }

      const field = toMetricField(fieldRaw);
      const first = toNumber(firstRaw);
      const second = toNumber(secondRaw);

      if (field && Number.isFinite(first) && Number.isFinite(second)) {
        const low = Math.min(first, second);
        const high = Math.max(first, second);
        const key = `${field}:between:${low}:${high}`;
        if (!seen.has(key)) {
          seen.add(key);
          filters.push({ field, operator: "between", value: [low, high] });
        }
      }

      betweenMatch = betweenRegex.exec(query);
    }

    let comparisonMatch = comparisonRegex.exec(query);
    while (comparisonMatch) {
      const fieldRaw = comparisonMatch[1] ?? "";
      const operatorRaw = comparisonMatch[2] ?? "";
      const valueRaw = comparisonMatch[3] ?? "";

      if (!fieldRaw || !operatorRaw || !valueRaw) {
        comparisonMatch = comparisonRegex.exec(query);
        continue;
      }

      const field = toMetricField(fieldRaw);
      const operator = toOperator(operatorRaw);
      const value = toNumber(valueRaw);

      if (field && operator && Number.isFinite(value)) {
        const key = `${field}:${operator}:${value}`;
        if (!seen.has(key)) {
          seen.add(key);
          filters.push({ field, operator, value });
        }
      }

      comparisonMatch = comparisonRegex.exec(query);
    }

    return filters;
  }

  extractPeriod(query: string): string | null {
    const shortMatch = query.match(PERIOD_SHORT_PATTERN);
    if (shortMatch?.[1]) {
      return shortMatch[1].toUpperCase();
    }

    for (const { regex, unit } of PERIOD_LONG_PATTERNS) {
      const match = query.match(regex);
      if (!match?.[1]) {
        continue;
      }

      const value = Number.parseInt(match[1], 10);
      if (Number.isFinite(value) && value > 0) {
        return `${value}${unit}`;
      }
    }

    if (/\bytd\b/i.test(query)) {
      return "YTD";
    }

    return null;
  }

  extractOutputFormat(query: string): OutputType | null {
    if (/\b(csv|spreadsheet|excel|xlsx?|as\s+csv)\b/i.test(query)) {
      return "csv";
    }
    if (/\b(chart|graph|plot|visuali[sz]e|visuali[sz]ation)\b/i.test(query)) {
      return "chart";
    }
    if (/\b(table|tabular|in\s+a\s+table|grid)\b/i.test(query)) {
      return "table";
    }
    if (/\b(links?|urls?|sources?)\b/i.test(query)) {
      return "links";
    }
    if (/\b(text|summary|summarize|explain|bullet(?:\s*points?)?)\b/i.test(query)) {
      return "text";
    }

    return null;
  }

  private detectIntent(query: string, tickers: string[], metrics: MetricFilter[]): AgentIntent {
    if (/\b(buy|sell|enter|exit|place\s+order|book\s+profit|stop\s*loss|target)\b/i.test(query)) {
      return "trade_action";
    }

    if (/\b(add\s+feature|new\s+feature|implement|build|create\s+endpoint|change\s+code|update\s+system)\b/i.test(query)) {
      return "feature_request";
    }

    if (/\b(analyze|analysis|compare|trend|outlook|prediction|perform(?:ance)?|how\s+is|how\s+did)\b/i.test(query)) {
      return "analysis";
    }

    if (tickers.length > 0 || metrics.length > 0 || this.extractPeriod(query) !== null || this.extractOutputFormat(query) !== null) {
      return "data_request";
    }

    return "general_query";
  }
}

function toMetricField(input: string): string | null {
  return METRIC_ALIAS_TO_FIELD[input.trim().toLowerCase()] ?? null;
}

function toOperator(input: string): MetricFilter["operator"] | null {
  const operator = input.trim().toLowerCase();
  if ([">", ">=", "above", "over", "more than", "greater than", "at least"].includes(operator)) {
    return "gt";
  }
  if (["<", "<=", "below", "under", "less than", "at most"].includes(operator)) {
    return "lt";
  }
  if (["=", "==", "equal to", "equals"].includes(operator)) {
    return "eq";
  }
  return null;
}

function toNumber(raw: string): number {
  return Number.parseFloat(raw.replace(/,/g, ""));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

import type { FundamentalSnapshot } from "../../mit-types.js";

export interface ScreenerImportOptions {
  source?: "screener-csv" | "manual" | "morningstar";
}

export interface ParseResult {
  success: FundamentalSnapshot[];
  errors: Array<{ row: number; ticker: string; error: string }>;
  warnings: Array<{ ticker: string; message: string }>;
}

const ROCE_KEYS = ["roce %", "roce", "return on capital employed", "roc"];
const ROE_KEYS = ["roe %", "roe", "return on equity"];
const DE_KEYS = ["debt to equity", "d/e", "debt/equity", "debt to eq", "debt to equity ratio"];
const IC_KEYS = ["interest coverage", "interest coverage ratio", "icr"];
const OPM_KEYS = ["opm %", "opm", "operating profit margin", "operating margin"];
const PE_KEYS = ["p/e", "pe", "price to earnings"];
const PEG_KEYS = ["peg", "peg ratio"];
const PROMOTER_KEYS = ["promoter holding %", "promoter holding", "promoters"];
const PLEDGE_KEYS = ["promoter pledged %", "promoter pledged", "pledge %", "pledged %", "pledged"];
const REVENUE_KEYS = ["revenue", "sales"];
const EPS_KEYS = ["eps", "earnings per share"];
const FCF_KEYS = ["fcf", "free cash flow"];
const MCAP_KEYS = ["market cap", "mkt cap"];
const AUDIT_KEYS = ["auditor remarks", "auditor", "audit opinion"];
const NSE_KEYS = ["nse code", "nse", "symbol", "ticker"];
const BSE_KEYS = ["bse code", "bse"];

export function parseScreenerCsv(csvContent: string, options: ScreenerImportOptions = {}): ParseResult {
  const source = options.source ?? "screener-csv";
  const lines = csvContent.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return {
      success: [],
      errors: [{ row: 1, ticker: "", error: "CSV is empty" }],
      warnings: [],
    };
  }

  const first = lines[0];
  if (!first) {
    return {
      success: [],
      errors: [{ row: 1, ticker: "", error: "CSV header is missing" }],
      warnings: [],
    };
  }

  const headersRaw = parseCsvLine(first);
  const headers = headersRaw.map(normalizeHeader);
  const output: ParseResult = { success: [], errors: [], warnings: [] };

  for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
    const raw = lines[rowIndex];
    if (!raw) {
      continue;
    }
    const values = parseCsvLine(raw);
    try {
      const snapshot = parseRow(headers, values, source);
      if (snapshot) {
        output.success.push(snapshot);
      }
    } catch (error) {
      const ticker = valueByHeader(headers, values, NSE_KEYS) ?? valueByHeader(headers, values, BSE_KEYS) ?? "unknown";
      output.errors.push({
        row: rowIndex + 1,
        ticker,
        error: error instanceof Error ? error.message : "Unknown parse error",
      });
    }
  }

  return output;
}

function parseRow(
  headers: string[],
  values: string[],
  source: "screener-csv" | "manual" | "morningstar",
): FundamentalSnapshot | null {
  const ticker = valueByHeader(headers, values, NSE_KEYS) ?? valueByHeader(headers, values, BSE_KEYS);
  if (!ticker || ticker.trim().length === 0) {
    return null;
  }

  const revenueHistory = collectHistory(headers, values, REVENUE_KEYS);
  const epsHistory = collectHistory(headers, values, EPS_KEYS);
  const opmHistory = collectHistory(headers, values, OPM_KEYS);
  const fcfHistory = collectHistory(headers, values, FCF_KEYS);

  return {
    ticker: ticker.trim().toUpperCase(),
    fetchedAt: new Date().toISOString(),
    source,
    revenueHistory,
    epsHistory,
    opmHistory,
    debtToEquity: parseNullableNumber(valueByHeader(headers, values, DE_KEYS)),
    interestCoverage: parseNullableNumber(valueByHeader(headers, values, IC_KEYS)),
    roce: parseNullableNumber(valueByHeader(headers, values, ROCE_KEYS)),
    roe: parseNullableNumber(valueByHeader(headers, values, ROE_KEYS)),
    fcfHistory,
    pe: parseNullableNumber(valueByHeader(headers, values, PE_KEYS)),
    peg: parseNullableNumber(valueByHeader(headers, values, PEG_KEYS)),
    marketCap: parseNullableNumber(valueByHeader(headers, values, MCAP_KEYS)),
    promoterHoldingPct: parseNullableNumber(valueByHeader(headers, values, PROMOTER_KEYS)),
    promoterPledgePct: parseNullableNumber(valueByHeader(headers, values, PLEDGE_KEYS)),
    auditorRemarks: parseAuditorRemarks(valueByHeader(headers, values, AUDIT_KEYS)),
    revenueCAGR_3y: computeCAGR(revenueHistory, 3),
    revenueCAGR_5y: computeCAGR(revenueHistory, 5),
    epsCAGR_3y: computeCAGR(epsHistory, 3),
    epsCAGR_5y: computeCAGR(epsHistory, 5),
  };
}

function collectHistory(headers: string[], values: string[], fieldKeys: string[]): { fy: string; value: number }[] {
  const items: Array<{ year: number; value: number }> = [];

  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    if (!header) {
      continue;
    }
    if (!fieldKeys.some((key) => header.includes(key))) {
      continue;
    }
    const match = header.match(/(19\d{2}|20\d{2})/);
    if (!match) {
      continue;
    }
    const year = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(year)) {
      continue;
    }
    const parsed = parseNullableNumber(values[index] ?? null);
    if (parsed === null) {
      continue;
    }
    items.push({ year, value: parsed });
  }

  items.sort((a, b) => a.year - b.year);
  return items.map((item) => ({ fy: `FY${String(item.year).slice(-2)}`, value: item.value }));
}

function valueByHeader(headers: string[], values: string[], candidates: string[]): string | null {
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    if (!header) {
      continue;
    }
    if (candidates.some((candidate) => header === candidate || header.includes(candidate))) {
      const value = values[index];
      if (value !== undefined && value.trim().length > 0) {
        return value.trim();
      }
    }
  }
  return null;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let token = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = i + 1 < line.length ? line[i + 1] : "";
      if (inQuotes && next === '"') {
        token += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      result.push(token.trim());
      token = "";
      continue;
    }
    token += ch;
  }

  result.push(token.trim());
  return result;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function parseNullableNumber(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/[₹,]/g, "").trim();
  if (normalized.length === 0 || normalized === "-" || normalized === "—") {
    return null;
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAuditorRemarks(value: string | null): "clean" | "qualified" | "adverse" | "unknown" {
  if (!value) {
    return "unknown";
  }
  const v = value.toLowerCase();
  if (v.includes("adverse")) {
    return "adverse";
  }
  if (v.includes("qualif")) {
    return "qualified";
  }
  if (v.includes("clean") || v.includes("unmodified") || v.includes("standard")) {
    return "clean";
  }
  return "unknown";
}

export function computeCAGR(values: { fy: string; value: number }[], years: 3 | 5): number | null {
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

export function computeOpmSlope(values: { fy: string; value: number }[]): number | null {
  if (values.length < 2) {
    return null;
  }
  const n = values.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i += 1) {
    const y = values[i]?.value;
    if (y === undefined) {
      continue;
    }
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumX2 += i * i;
  }
  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) {
    return null;
  }
  const slope = (n * sumXY - sumX * sumY) / denominator;
  return Number.isFinite(slope) ? slope : null;
}

export function countPositiveYears(values: { fy: string; value: number }[]): {
  positive: number;
  total: number;
  avgValue: number;
} {
  const positive = values.filter((entry) => entry.value > 0).length;
  const total = values.length;
  const avgValue = total > 0 ? values.reduce((sum, entry) => sum + entry.value, 0) / total : 0;
  return { positive, total, avgValue };
}

/**
 * MIT Trading System - Type Definitions
 * 
 * Comprehensive types for the NT LITE + Quant trading system.
 * All types are serializable (no Map, Set, Date, Function).
 */

// === Enums & Literals ===

export type MitFeed = "nt-lite" | "quant";

export type MitTradeStatus = "open" | "partial-exit" | "closed" | "stopped-out" | "time-exited";

export type MitSellIndicator = "near-target" | "rsi-rollover" | "time-exit" | "stop-breach" | "momentum-decay";

export type MitMarketTone = "risk-on" | "risk-off" | "neutral";

export type MitPnlLockState = "estimated" | "locked";

export type MitChecklistItem =
  | "rising-revenue-eps"
  | "strong-fcf"
  | "roce-above-15"
  | "manageable-leverage"
  | "improving-opm"
  | "promoter-stable"
  | "clean-audit"
  | "valuation-sane";

// === Fundamental Data ===

export interface FundamentalSnapshot {
  ticker: string;
  fetchedAt: string;
  source: "screener-csv" | "manual" | "morningstar";

  // Income statement (trailing 5 years)
  revenueHistory: { fy: string; value: number }[]; // in Cr
  epsHistory: { fy: string; value: number }[];
  opmHistory: { fy: string; value: number }[]; // operating margin %

  // Balance sheet
  debtToEquity: number | null;
  interestCoverage: number | null;

  // Returns
  roce: number | null; // %
  roe: number | null; // %

  // Cash flow
  fcfHistory: { fy: string; value: number }[]; // in Cr

  // Valuation
  pe: number | null;
  peg: number | null;
  marketCap: number | null; // in Cr

  // Governance
  promoterHoldingPct: number | null;
  promoterPledgePct: number | null;
  auditorRemarks: "clean" | "qualified" | "adverse" | "unknown";

  // Computed by system
  revenueCAGR_3y: number | null;
  revenueCAGR_5y: number | null;
  epsCAGR_3y: number | null;
  epsCAGR_5y: number | null;
}

// === NT LITE Checklist ===

export interface NTLiteChecklistResult {
  ticker: string;
  evaluatedAt: string;
  items: {
    [K in MitChecklistItem]: {
      pass: boolean;
      value: string; // human-readable, e.g., "ROCE: 22.3%"
      detail: string; // longer explanation
    };
  };
  passCount: number; // 0–8
  totalItems: 8;
  grade: "A" | "B" | "C" | "F"; // A=7-8, B=5-6, C=3-4, F=0-2
}

// === Daily Candle ===

export interface DailyCandle {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// === Technical Snapshot ===

export interface TechnicalSnapshot {
  ticker: string;
  computedAt: string;
  dma20: number | null;
  dma50: number | null;
  dma100: number | null;
  dma200: number | null;
  rsi14: number | null;
  atr14: number | null;
  returnZScore20d: number | null; // 20-day return z-score
  priceVsDma50Pct: number | null; // % above/below 50-DMA
  priceVsDma200Pct: number | null;
  pullback5d: number | null; // max drawdown in last 5 sessions
  latestClose: number;
  latestVolume: number;
}

// === Scoring ===

export interface CompositeScoreBreakdown {
  quality: number; // 0–40
  growth: number; // 0–20
  valuation: number; // 0–15
  momentum: number; // 0–15
  governance: number; // 0–10
}

export interface CompositeScore {
  ticker: string;
  total: number; // 0–100
  breakdown: CompositeScoreBreakdown;
  percentileRank: number; // 0–100 within screened universe
  evaluatedAt: string;
}

// === Entry/Exit Plan ===

export interface EntryExitPlan {
  ticker: string;
  feed: MitFeed;
  buyZoneLow: number;
  buyZoneHigh: number;
  stopLoss: number;
  stopLossPct: number; // e.g., 0.06
  firstTarget: number;
  firstTargetPct: number; // e.g., 0.18 (18% upside)
  rMultiple: number; // target_gain / stop_risk
  trailingActivationPrice: number;
  invalidation: string[]; // conditions that cancel setup
  computedAt: string;
}

// === Watchlist Idea ===

export interface MitWatchlistIdea {
  id: string;
  date: string; // YYYY-MM-DD
  ticker: string;
  feed: MitFeed;
  thesis: string[]; // 2–3 bullets
  compositeScore: CompositeScore;
  entryExitPlan: EntryExitPlan;
  technicals: TechnicalSnapshot;
  fundamentals: FundamentalSnapshot;
  momentumLabel: string; // e.g., "Above 50/200-DMA | RSI: Neutral (52)"
  risks: string[];
  isAvoid: boolean; // true = "avoid this stock"
  avoidReason: string | null;
}

// === Position (Mit-specific) ===

export interface MitPosition {
  id: string;
  ticker: string;
  feed: MitFeed;
  entryPrice: number;
  entryDate: string; // YYYY-MM-DD
  qty: number;
  allocatedAmount: number; // capital × alloc_pct
  stopLoss: number;
  firstTarget: number;
  status: MitTradeStatus;

  // Trailing stop state
  trailingActive: boolean;
  trailingStop: number | null;
  maxPriceSinceEntry: number;
  minPriceSinceEntry: number;

  // P&L
  currentPrice: number; // last known CMP
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  pnlLockState: MitPnlLockState;
  pnlLockedAt: string | null;

  // Sell indicators
  activeSellIndicators: MitSellIndicator[];
  dismissedIndicators: { type: MitSellIndicator; dismissedAt: string; expiresAt: string }[];

  // Metadata
  confirmedEntry: boolean; // user confirmed the fill
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// === Closed Trade ===

export interface MitClosedTrade {
  id: string;
  positionId: string;
  ticker: string;
  feed: MitFeed;
  entryPrice: number;
  entryDate: string;
  exitPrice: number;
  exitDate: string;
  qty: number;
  realizedPnl: number;
  realizedPnlPct: number;
  realizedRMultiple: number;
  holdDays: number;
  exitReason: MitSellIndicator | "manual" | "partial";
  fees: number;
}

// === Portfolio State ===

export interface MitSettings {
  capital: number; // default 200000
  allocPct: number; // default 0.05
  stopPct: number; // default 0.06
  pauseCashPct: number; // default 0.03
  maxDeployedPct: number; // default 0.95
  maxHorizonDays: number; // default 90
  trailingActivationPct: number; // default 0.75 (activate at 75% of target)
}

export interface MitEquityPoint {
  date: string;
  equity: number; // cash + market value of positions
  cash: number;
  deployed: number;
  unrealizedPnl: number;
  realizedPnlCumulative: number;
}

export interface MitPortfolioState {
  settings: MitSettings;
  cash: number;
  positions: MitPosition[];
  closedTrades: MitClosedTrade[];
  equityCurve: MitEquityPoint[];
  peakEquity: number;
  maxDrawdownPct: number;
  paused: boolean; // true if cash < pause threshold
  lastPipelineRun: string | null;
}

// === Daily Pipeline Run ===

export interface MitDailyRunResult {
  id: string;
  date: string;
  startedAt: string;
  completedAt: string;
  status: "success" | "partial" | "failed";
  ideas: MitWatchlistIdea[]; // 2 buys + 1-2 avoids
  universeSize: number;
  screenedCount: number;
  marketTone: MitMarketTone;
  anomalies: MitAnomaly[];
  errors: string[];
}

export interface MitAnomaly {
  ticker: string;
  date: string;
  type: "price-shock" | "volume-spike" | "volatility-spike";
  score: number;
  detail: string;
}

// === Reports ===

export interface MitWeeklyReport {
  id: string;
  weekStartDate: string;
  weekEndDate: string;
  trades: MitWeeklyTradeReport[];
  summary: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgReturnPct: number;
    avgHoldDays: number;
    avgRMultiple: number;
    totalRealizedPnl: number;
  };
  generatedAt: string;
}

export interface MitWeeklyTradeReport {
  ticker: string;
  feed: MitFeed;
  entryDate: string;
  exitDate: string | null;
  entryPrice: number;
  exitPrice: number | null;
  status: MitTradeStatus;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  realizedRMultiple: number | null;
  holdDays: number | null;
  keyFactor: "fundamental" | "momentum" | "policy" | "blended";
  tweak: string; // suggested improvement
  checklist: {
    entryWithinBuyZone: boolean;
    stopSetCorrectly: boolean;
    positionSizeWithinLimits: boolean;
    thesisIntact: boolean;
    noGovernanceFlags: boolean;
  };
}

export interface MitMonthlyReport {
  id: string;
  month: string; // YYYY-MM
  ntLiteStats: {
    trades: number;
    winRate: number;
    avgReturnPct: number;
    avgHoldDays: number;
    avgRMultiple: number;
    totalPnl: number;
  };
  quantStats: {
    trades: number;
    winRate: number;
    avgReturnPct: number;
    avgHoldDays: number;
    avgRMultiple: number;
    totalPnl: number;
  };
  combinedStats: {
    totalTrades: number;
    winRate: number;
    avgReturnPct: number;
    avgHoldDays: number;
    totalRealizedPnl: number;
    totalUnrealizedPnl: number;
  };
  generatedAt: string;
}

// === Full Mit State ===

export interface MitState {
  portfolio: MitPortfolioState;
  fundamentals: Record<string, FundamentalSnapshot>; // keyed by ticker
  technicals: Record<string, TechnicalSnapshot>;
  candles: Record<string, DailyCandle[]>; // keyed by ticker
  checklistResults: Record<string, NTLiteChecklistResult>;
  compositeScores: Record<string, CompositeScore>;
  peerMedianPE: Record<string, number>; // keyed by sector
  dailyRuns: MitDailyRunResult[];
  weeklyReports: MitWeeklyReport[];
  monthlyReports: MitMonthlyReport[];
  marketTone: MitMarketTone;
  governanceFlags: Record<string, string[]>; // ticker → flags
}

// === Stock Universe ===

export interface MitUniverseEntry {
  ticker: string;
  name: string;
  exchange: "NSE" | "BSE";
  sector: string;
  subSector: string;
  marketCapTier: "large" | "mid" | "small";
  nifty50: boolean;
  nifty500: boolean;
}

// === Guard & Sizing ===

export interface GuardStatus {
  canTrade: boolean;
  paused: boolean;
  cashPct: number;
  deployedPct: number;
  reasons: string[];
  warnings: string[];
  suggestedSells: string[];
}

export interface SizingResult {
  approved: boolean;
  rejectionReason: string | null;
  allocatedAmount: number;
  units: number;
  entryPrice: number;
  stopLoss: number;
  projectedRiskAmount: number;
}

// === Trade Entry/Exit Requests ===

export interface TradeEnterRequest {
  ticker: string;
  feed: MitFeed;
  entryPrice: number;
  qty: number;
  stopLoss: number;
  firstTarget: number;
  notes?: string;
  entryDate?: string; // defaults to today
  customAllocPct?: number;
}

export interface TradeExitRequest {
  positionId: string;
  qty: number; // partial or full
  exitPrice: number;
  exitDate?: string; // defaults to today
  reason: MitSellIndicator | "manual";
}

export interface TradeConfirmRequest {
  positionId: string;
  entryPrice: number;
  entryDate?: string;
}

// === API Response Types ===

export interface MitPortfolioResponse {
  settings: MitSettings;
  cash: number;
  equity: number;
  deployed: number;
  deployedPct: number;
  unrealizedPnl: number;
  realizedPnlCumulative: number;
  maxDrawdownPct: number;
  winRate: number | null;
  avgRMultiple: number | null;
  positions: MitPosition[];
  closedTrades: MitClosedTrade[];
  paused: boolean;
  lastPipelineRun: string | null;
}

export interface PnlRefreshResult {
  positions: MitPosition[];
  equityPoint: MitEquityPoint;
  guardStatus: GuardStatus;
  sellIndicators: Array<{
    position: MitPosition;
    indicators: MitSellIndicator[];
  }>;
}

// === Utility Types ===

export type Nullable<T> = T | null;

export type NumericDate = string; // YYYY-MM-DD format

export type IsoTimestamp = string; // ISO 8601 format

export type AgentIntent = "data_request" | "analysis" | "trade_action" | "feature_request" | "general_query"

export type AgentName = "manager" | "librarian" | "analyst" | "trader" | "coder"

export interface AgentIntentClassification {
  intent: AgentIntent
  confidence: number
  agents: AgentName[]
}

export interface ManagerQueryRequest {
  query: string
  context?: {
    recentStocks?: string[]
    lastOutputFormat?: string
  }
  outputPreference?: "chart" | "table" | "text" | "links" | "auto"
}

export interface ManagerQueryResponse {
  intent: string
  interpretation: string
  outputs: {
    type: "chart" | "table" | "text" | "links"
    content: string | Record<string, unknown>
  }[]
  actionTaken?: {
    agent: string
    details: string
  }
}

export interface LibrarianQueryRequest {
  action: "news" | "balance_sheet" | "articles" | "search"
  ticker?: string
  params?: {
    dateRange?: { start: string; end: string }
    limit?: number
    sources?: string[]
    query?: string
  }
}

export interface LibrarianQueryResponse {
  action: string
  results: {
    type: "news" | "balance_sheet" | "article"
    items: {
      title?: string
      url?: string
      date?: string
      summary?: string
      content?: Record<string, unknown>
    }[]
  }
  metadata: {
    fetchedAt: string
    source: string
  }
}

export interface AnalystQueryRequest {
  ticker: string
  analysisType: "fundamental" | "technical" | "historical" | "full" | "custom"
  params?: {
    period?: "1M" | "3M" | "6M" | "1Y" | "2Y" | "5Y" | "custom"
    customMetrics?: string[]
    peerGroup?: string[]
  }
}

export type PeerComparison = Record<string, unknown>

export interface AnalystQueryResponse {
  ticker: string
  analysisType: string
  fundamentals?: {
    score: CompositeScore
    checklist?: NTLiteChecklistResult
    peers?: PeerComparison[]
  }
  technicals?: TechnicalSnapshot
  historical?: {
    returns: { period: string; value: number }[]
    volatility: number
    cagr: number
  }
  customMetrics?: Record<string, number>
}

export interface FlexibleQueryRequest {
  query: string
  filters?: {
    ticker?: string[]
    metrics?: {
      field: string
      operator: "gt" | "lt" | "eq" | "between"
      value: number | [number, number]
    }[]
    period?: string
  }
  outputFormat?: "table" | "chart" | "text"
}

export interface FlexibleQueryResponse {
  query: string
  interpretation: string
  results: Record<string, unknown>[]
  outputFormat: "table" | "chart" | "text"
  summary?: string
}

export interface CoderFeatureRequest {
  description: string
  priority?: "low" | "medium" | "high"
  context?: {
    relatedFeatures?: string[]
    userStory?: string
  }
}

export interface CoderFeatureResponse {
  issueCreated: boolean
  issueNumber?: number
  issueUrl?: string
  title: string
  body: string
  suggestion: string
}

export interface NewsArticle {
  title: string
  url: string
  date: string
  source: string
  summary?: string
}

export interface StockLinksResponse {
  ticker: string
  links: {
    balanceSheet: string
    fundamentals: string
    news: string[]
    technicals: string
    promoterHoldings: string
  }
  recentNews: NewsArticle[]
}

export interface ExtendedHeroScore {
  symbol: string
  totalScore: number
  narrative: string
  metrics: {
    atrPct: number
    beta: number
    r2: number
    sectorTrend: "Up" | "Down"
  }
  candidate: MitWatchlistIdea
}

export interface ExtendedHeroResponse {
  primaryHero: ExtendedHeroScore
  secondaryHero: ExtendedHeroScore
  extendedList: ExtendedHeroScore[]
  rankingBasis: string
  generatedAt: string
}

export interface HistoricalAnalysisResponse {
  ticker: string
  period: {
    start: string
    end: string
    label: string
  }
  performance: {
    absoluteReturnPct: number
    cagrPct: number
    volatility: number
  }
  returns: { period: string; value: number }[]
  insights: string[]
  recentNews?: NewsArticle[]
  probableFuture?: string
  generatedAt: string
}

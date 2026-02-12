# Mit Trading System — Exhaustive Implementation Plan

**Generated:** 2026-02-12
**Codebase:** india-policy-signal-terminal (money.tardis.digital)
**Stack:** Fastify 5 + React 19 + TypeScript 5.7 + Vite 7 + Recharts + Framer Motion + htm
**Store:** JsonStore (file) / PostgresStore (TimescaleDB) — dual backend
**Blueprint:** Mit_Trading_System_Blueprint.md (Sections 1–14)

---

## Table of Contents

1. [Architecture Decisions & Gotchas](#architecture-decisions--gotchas)
2. [Sprint 1: Data Foundation & Fundamental Screening](#sprint-1-data-foundation--fundamental-screening)
3. [Sprint 2: Quant Feed & Composite Scoring](#sprint-2-quant-feed--composite-scoring)
4. [Sprint 3: Portfolio Engine & Trade Lifecycle](#sprint-3-portfolio-engine--trade-lifecycle)
5. [Sprint 4: Dashboard UI & Mobile Experience](#sprint-4-dashboard-ui--mobile-experience)
6. [Sprint 5: Reporting, Export & Hardening](#sprint-5-reporting-export--hardening)
7. [Cross-Cutting Concerns](#cross-cutting-concerns)
8. [Risk Register](#risk-register)

---

## Architecture Decisions & Gotchas

### Decision 1: Extend StateStore vs. Separate Mit State

The existing `StateStore` in `src/store.ts` has 28 top-level collections. Adding 15+ more Mit-specific
collections will bloat the single `state.json` file and the `StateStore` interface.

**Decision:** Add a separate `MitStateStore` interface in a new `src/mit-store.ts` that manages its own
`data/mit-state.json` file. This avoids:
- Breaking existing `Store.read()` / `Store.write()` performance (currently serializes everything)
- Merge conflicts when both policy-signal and Mit code touch `state.json`
- The `StateStore` interface growing to 40+ fields

**Gotcha:** The `JsonStore.transaction()` locks on a single file — if we use one file, concurrent reads
from the terminal UI + Mit pipeline will serialize. Two files = two lock domains.

**Gotcha:** The `PostgresStore` upserts JSONB rows per table. For postgres mode, Mit tables should follow
the same pattern: `policy_signal.mit_*` tables with `(id text, ts timestamptz, payload jsonb)`.

### Decision 2: Market Data — No Real Exchange Feed

The existing `MarketSnapshotService` (src/services/market-snapshot.ts:24-80) **does not fetch real
prices**. It derives synthetic prices from signal outcomes:
```typescript
const latestPrice = Number((100 * (1 + avgReturn)).toFixed(2)); // line 58
```

**This is critical.** The Mit system needs REAL prices for:
- DMA calculations (50/100/200-day)
- RSI, ATR computation
- P&L tracking
- Buy zone / stop-loss evaluation

**Decision:** Create a `MarketDataService` that fetches from a free provider (NSE India unofficial API,
or Yahoo Finance via URL scraping). Cache daily OHLCV locally in `data/mit-candles/` as per-ticker JSON
files (e.g., `data/mit-candles/SBIN.json`).

**Gotcha:** NSE India blocks non-browser user agents. Need to set headers:
```
User-Agent: Mozilla/5.0 ...
Accept: application/json
```
And use cookie-based session (hit nse website homepage first, get cookies, then hit API).

**Gotcha:** Yahoo Finance `chart` endpoint is free but may have 15-min delay for Indian stocks. Fine for
EOD swing trading (Blueprint says morning run at 08:45 IST, after market data settles).

**Gotcha:** Rate limiting — NSE will block aggressive scraping. Implement 500ms delay between requests.
For 80+ tickers at 200 candles each, initial backfill = ~40 seconds sequential. Cache aggressively.

### Decision 3: Screener.in Data — Web Scraping vs. Manual

Screener.in has no public API. Options:
1. **Web scrape** — fragile, breaks on layout changes, may violate ToS
2. **Manual CSV upload** — user exports from Screener.in, uploads to system
3. **Hybrid** — manual for initial load, light scrape for refresh

**Decision:** Manual CSV upload as primary path. Create a standard import format. For automated refresh,
use Screener.in's export URL pattern (`/company/{TICKER}/export/`).

**Gotcha:** Screener.in uses cookie-based auth for CSV export. User must provide session cookie.
**Gotcha:** Screener.in column names change. Need a mapping layer, not hardcoded column indices.
**Gotcha:** Indian financial years run April-March. When calculating "3-5 year trends," align to FY, not
calendar year. Revenue in "Mar 2024" is FY2023-24.

### Decision 4: Existing Portfolio Service — Extend vs. Replace

The existing `PortfolioService` (`src/services/portfolio.ts`) has:
- `createPortfolio()` — creates with static positions
- `exposure()` — sector-level breakdown
- `attribution()` — P&L linked to policy signals
- `saveScenario()` / `listScenarios()` — stress tests

It **lacks**: cash tracking, trade ledger, stop-loss state, trailing stops, position sizing, P&L locks.
The `PortfolioPosition` type only has `{ ticker, quantity, avgPrice, marketPrice }` — no entry date,
feed, stop, target, or status.

**Decision:** Do NOT modify `PortfolioService`. Create a new `MitPortfolioService` that manages Mit
positions independently. Cross-reference by ticker if needed for policy-signal attribution.

**Gotcha:** The existing `PortfolioRecord.positions` uses `marketPrice` as a static field set at
creation time — it doesn't update. The Mit system needs live `CMP` from `MarketDataService`.

### Decision 5: UI Architecture — New Tab vs. New Route

The existing `App.tsx` uses a tab system: `overview | signals | heatmap | alerts | supply-chain | watchlists`.
Each tab renders inline. The `TerminalRoute` type is used for RBAC.

**Decision:** Add a `"mit"` tab to the `TABS` array and `TerminalRoute` union type. The Mit dashboard
renders as a full replacement view (not nested in terminal chrome) with its own card-based layout.

**Gotcha:** The `TerminalRoute` type is used in `UserProfile.routeEntitlements`. Adding `"mit"` means
existing user profiles won't have it in their entitlements. Must update `defaultUserProfiles()` in
`store.ts` AND handle migration for existing `state.json` files.

**Gotcha:** The App.tsx uses `htm` (tagged template literals) not JSX. All new components must use
`html\`...\`` syntax. Example:
```typescript
html`<div className="...">${value}</div>`  // correct
<div className="...">{value}</div>         // WRONG — no JSX transform in this file
```

### Decision 6: INR Formatting

The Blueprint operates in INR (₹200,000 capital). All monetary values must display with:
- ₹ prefix
- Indian number formatting (lakhs/crores): 1,00,000 not 100,000
- Two decimal places for per-share prices

**Gotcha:** `Intl.NumberFormat('en-IN')` uses the Indian grouping system automatically. But the Blueprint
shows ₹200,000 (western), not ₹2,00,000 (Indian). **Clarify with user** — or support both.

---

## Sprint 1: Data Foundation & Fundamental Screening

### 1.1 — Mit State Store & Type Definitions

**File: `src/mit-types.ts`** (new)

```typescript
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
  revenueHistory: { fy: string; value: number }[];    // in Cr
  epsHistory: { fy: string; value: number }[];
  opmHistory: { fy: string; value: number }[];         // operating margin %

  // Balance sheet
  debtToEquity: number | null;
  interestCoverage: number | null;

  // Returns
  roce: number | null;                                  // %
  roe: number | null;                                   // %

  // Cash flow
  fcfHistory: { fy: string; value: number }[];          // in Cr

  // Valuation
  pe: number | null;
  peg: number | null;
  marketCap: number | null;                             // in Cr

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
```

**Gotcha:** `revenueHistory` must be sorted chronologically (oldest first) for CAGR calculation.
If Screener.in CSV has columns in reverse order (newest first), flip during import.

**Gotcha:** `roce` and `roe` are percentages (e.g., 18.5 means 18.5%). The checklist checks `> 15`.
Do NOT store as decimals (0.185) — the Blueprint consistently uses percentage notation.

**Gotcha:** `peg` can be negative (negative earnings growth). Treat negative PEG as failing the
checklist — it means earnings are declining.

**Gotcha:** `fcfHistory` values can be negative. "Strong & consistent FCF" means positive in at least
4 of last 5 years AND no massive single-year drop.

```typescript
// === NT LITE Checklist ===
export interface NTLiteChecklistResult {
  ticker: string;
  evaluatedAt: string;
  items: {
    [K in MitChecklistItem]: {
      pass: boolean;
      value: string;        // human-readable, e.g., "ROCE: 22.3%"
      detail: string;       // longer explanation
    };
  };
  passCount: number;         // 0–8
  totalItems: 8;
  grade: "A" | "B" | "C" | "F";  // A=7-8, B=5-6, C=3-4, F=0-2
}
```

**Gotcha:** The peer comparison for item #8 ("P/E below peer median") requires knowing peers.
The existing `entity-map.json` has `sector` per ticker but only 10 tickers across 5 sectors.
For a real peer comparison, you need 5+ companies per sector. **Must expand entity-map.json.**

```typescript
// === Daily Candle ===
export interface DailyCandle {
  date: string;              // YYYY-MM-DD
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
  returnZScore20d: number | null;    // 20-day return z-score
  priceVsDma50Pct: number | null;    // % above/below 50-DMA
  priceVsDma200Pct: number | null;
  pullback5d: number | null;         // max drawdown in last 5 sessions
  latestClose: number;
  latestVolume: number;
}

// === Scoring ===
export interface CompositeScoreBreakdown {
  quality: number;          // 0–40
  growth: number;           // 0–20
  valuation: number;        // 0–15
  momentum: number;         // 0–15
  governance: number;       // 0–10
}

export interface CompositeScore {
  ticker: string;
  total: number;            // 0–100
  breakdown: CompositeScoreBreakdown;
  percentileRank: number;   // 0–100 within screened universe
  evaluatedAt: string;
}

// === Entry/Exit Plan ===
export interface EntryExitPlan {
  ticker: string;
  feed: MitFeed;
  buyZoneLow: number;
  buyZoneHigh: number;
  stopLoss: number;
  stopLossPct: number;          // e.g., 0.06
  firstTarget: number;
  firstTargetPct: number;       // e.g., 0.18 (18% upside)
  rMultiple: number;            // target_gain / stop_risk
  trailingActivationPrice: number;
  invalidation: string[];       // conditions that cancel setup
  computedAt: string;
}
```

**Gotcha:** `rMultiple` must be calculated as:
```
rMultiple = (firstTarget - midBuyZone) / (midBuyZone - stopLoss)
```
NOT `(target / entry)`. The Blueprint uses R:R where R = risk amount.

```typescript
// === Watchlist Idea ===
export interface MitWatchlistIdea {
  id: string;
  date: string;                 // YYYY-MM-DD
  ticker: string;
  feed: MitFeed;
  thesis: string[];             // 2–3 bullets
  compositeScore: CompositeScore;
  entryExitPlan: EntryExitPlan;
  technicals: TechnicalSnapshot;
  fundamentals: FundamentalSnapshot;
  momentumLabel: string;        // e.g., "Above 50/200-DMA | RSI: Neutral (52)"
  risks: string[];
  isAvoid: boolean;             // true = "avoid this stock"
  avoidReason: string | null;
}

// === Position (Mit-specific) ===
export interface MitPosition {
  id: string;
  ticker: string;
  feed: MitFeed;
  entryPrice: number;
  entryDate: string;            // YYYY-MM-DD
  qty: number;
  allocatedAmount: number;      // capital × alloc_pct
  stopLoss: number;
  firstTarget: number;
  status: MitTradeStatus;

  // Trailing stop state
  trailingActive: boolean;
  trailingStop: number | null;
  maxPriceSinceEntry: number;
  minPriceSinceEntry: number;

  // P&L
  currentPrice: number;         // last known CMP
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  pnlLockState: MitPnlLockState;
  pnlLockedAt: string | null;

  // Sell indicators
  activeSellIndicators: MitSellIndicator[];

  // Metadata
  confirmedEntry: boolean;      // user confirmed the fill
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
export interface MitPortfolioState {
  settings: MitSettings;
  cash: number;
  positions: MitPosition[];
  closedTrades: MitClosedTrade[];
  equityCurve: MitEquityPoint[];
  peakEquity: number;
  maxDrawdownPct: number;
  paused: boolean;              // true if cash < pause threshold
  lastPipelineRun: string | null;
}

export interface MitSettings {
  capital: number;              // default 200000
  allocPct: number;             // default 0.05
  stopPct: number;              // default 0.06
  pauseCashPct: number;         // default 0.03
  maxDeployedPct: number;       // default 0.95
  maxHorizonDays: number;       // default 90
  trailingActivationPct: number; // default 0.75 (activate at 75% of target)
}

export interface MitEquityPoint {
  date: string;
  equity: number;               // cash + market value of positions
  cash: number;
  deployed: number;
  unrealizedPnl: number;
  realizedPnlCumulative: number;
}

// === Daily Pipeline Run ===
export interface MitDailyRunResult {
  id: string;
  date: string;
  startedAt: string;
  completedAt: string;
  status: "success" | "partial" | "failed";
  ideas: MitWatchlistIdea[];    // 2 buys + 1-2 avoids
  universeSize: number;
  screenedCount: number;
  marketTone: MitMarketTone;
  errors: string[];
}

// === Full Mit State ===
export interface MitState {
  portfolio: MitPortfolioState;
  fundamentals: Record<string, FundamentalSnapshot>;   // keyed by ticker
  technicals: Record<string, TechnicalSnapshot>;
  candles: Record<string, DailyCandle[]>;              // keyed by ticker
  checklistResults: Record<string, NTLiteChecklistResult>;
  compositeScores: Record<string, CompositeScore>;
  peerMedianPE: Record<string, number>;                // keyed by sector
  dailyRuns: MitDailyRunResult[];
  weeklyReports: MitWeeklyReport[];
  monthlyReports: MitMonthlyReport[];
  marketTone: MitMarketTone;
  governanceFlags: Record<string, string[]>;            // ticker → flags
}
```

**Gotcha:** `MitState.candles` will grow large over time. At 252 trading days/year × 80 tickers ×
~50 bytes/candle = ~1MB/year. Fine for JSON store. But **must cap** at 300 candles per ticker and
rotate. The 200-DMA only needs 200 candles; keep 300 for buffer.

**Gotcha:** `MitState.dailyRuns` will grow at 1/day. Cap at 365 entries (1 year) and rotate.

---

**File: `src/mit-store.ts`** (new)

```typescript
// Follows same pattern as src/store.ts JsonStore
// - Reads/writes data/mit-state.json
// - Has transaction() with read-modify-write
// - makeDefaultMitState() initializes empty state with default settings
```

**Gotcha:** Must call `mitStore.init()` in `server.ts` alongside `store.init()`. If the user switches
to `STORE_BACKEND=postgres`, the Mit store must also support postgres via `mit_*` tables.

**Gotcha:** The `transaction()` in `JsonStore` is NOT truly atomic — it reads, applies fn, writes.
If two concurrent requests hit `transaction()`, last-write-wins. This is acceptable for single-user
trading but **must** be documented. The existing codebase has the same limitation.

---

### 1.2 — Screener.in CSV Import Adapter

**File: `src/services/mit/screener-adapter.ts`** (new)

Purpose: Parse Screener.in bulk CSV export into `FundamentalSnapshot[]`.

**Screener.in CSV format (from company export):**
```
Name,BSE Code,NSE Code,ROCE %,ROE %,Debt to Equity,Interest Coverage,OPM %,P/E,PEG,
Promoter Holding %,Pledged %,FCF (Cr),Revenue (Cr),EPS,Market Cap (Cr)
```

**Implementation steps:**
1. Accept CSV string or file path
2. Parse headers — **normalize column names** (Screener sometimes uses "Debt to equity" vs "D/E")
3. For each row, extract ticker from NSE Code column (fallback to BSE Code)
4. Map financial history columns: Screener exports "Revenue 2024", "Revenue 2023", etc.
5. Compute CAGR: `((endValue / startValue)^(1/years) - 1) × 100`
6. Return `FundamentalSnapshot[]`

**Gotcha: Column name variations.**
Screener.in has changed column names across versions. Known variations:
- "ROCE %" vs "ROCE" vs "Return on Capital Employed"
- "Debt to equity" vs "D/E" vs "Debt/Equity"
- "OPM %" vs "Operating Profit Margin"
Use fuzzy matching or a mapping dict, not exact string match.

**Gotcha: Multi-year columns.**
The financial history (Revenue 2024, Revenue 2023...) uses the **calendar year of the March filing**.
"Revenue 2024" = FY 2023-24 (April 2023 – March 2024).

**Gotcha: Consolidated vs. Standalone.**
Screener.in shows consolidated by default. Ensure the export is consolidated. Standalone numbers
will differ significantly for companies with subsidiaries (e.g., SBIN, LT, HDFCBANK).

**Gotcha: Data freshness.**
Screener.in data updates after quarterly results. Between result dates, data is stale. The system
should track `fetchedAt` and warn if data is >45 days old (one quarter gap).

**Gotcha: CAGR with negative start value.**
If EPS was negative 5 years ago and positive now, CAGR formula breaks (negative base). Handle:
- If start < 0 and end > 0: mark as "turnaround" with special scoring
- If start > 0 and end < 0: mark as "declining" with penalty
- If both negative: mark as "persistent loss" with F grade

```typescript
export function computeCAGR(values: { fy: string; value: number }[], years: 3 | 5): number | null {
  if (values.length < years + 1) return null;
  const sorted = [...values].sort((a, b) => a.fy.localeCompare(b.fy));
  const start = sorted[sorted.length - 1 - years].value;
  const end = sorted[sorted.length - 1].value;
  if (start <= 0) return null; // Cannot compute CAGR from negative/zero base
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}
```

---

### 1.3 — NT LITE Checklist Engine

**File: `src/services/mit/nt-lite-checklist.ts`** (new)

Implements the 8-point checklist from Blueprint Section 2.

**Item 1: Rising Revenue & EPS over 3-5 years**
```
PASS if: revenueCAGR_3y > 5% AND epsCAGR_3y > 5%
   OR: revenueCAGR_5y > 5% AND epsCAGR_5y > 5%
FAIL if: both CAGRs < 5% or negative
EDGE: if 3y is bad but 5y is good → PASS with note "recent slowdown"
```

**Gotcha:** A company might have high 5y CAGR but declining last 2 years. The checklist says
"rising" which implies recent trajectory, not just historical. Add a secondary check:
`latest_year_revenue > previous_year_revenue` (year-over-year positive).

**Item 2: Strong & Consistent FCF**
```
PASS if: FCF positive in >= 4 of last 5 years AND average FCF > 0
FAIL if: FCF negative in >= 2 of last 5 years OR average FCF < 0
```

**Gotcha:** Companies with large capex cycles (infra, power) may have lumpy FCF. The Blueprint
says "consistent" so we enforce the 4/5 rule strictly. But add a note for capex-heavy sectors.

**Item 3: ROCE > 15% (or ROE > 15%)**
```
PASS if: ROCE > 15 OR (ROCE unavailable AND ROE > 15)
FAIL if: ROCE <= 15 AND ROE <= 15
```

**Gotcha:** Banking/NBFC companies don't report ROCE (capital structure is fundamentally different).
For BFSI sector tickers, always use ROE. The entity-map.json has `sector: "bfsi"` for SBIN, HDFCBANK.

**Item 4: Manageable Leverage**
```
PASS if: D/E < 0.5 OR Interest Coverage > 3
FAIL if: D/E >= 0.5 AND Interest Coverage <= 3
EDGE: D/E null (zero debt) → PASS
EDGE: Interest Coverage null (no interest expense) → PASS
```

**Gotcha:** Financial companies (banks, NBFCs) have high D/E by nature (deposits = debt). For
BFSI sector: skip D/E check, use only Interest Coverage or NPA metrics. Blueprint doesn't address
this — **must handle as sector exception**.

**Item 5: Improving OPM**
```
PASS if: OPM trend is rising (latest 3 years OPM slope > 0)
FAIL if: OPM declining
EDGE: Flat OPM (slope ~ 0) → PASS with "stable" note
```

**Gotcha:** OPM calculation: `(Revenue - COGS - Operating Expenses) / Revenue × 100`. Screener.in
provides this directly. But some quarters have one-off charges that distort margins. Use annual data,
not quarterly, for the trend.

**Gotcha:** Service companies (IT, consulting) naturally have higher OPM than manufacturing. The
checklist checks for *improvement*, not absolute level. A company with 8% → 10% OPM passes even
though 10% seems low.

**Item 6: Promoter Holding**
```
PASS if: promoterHoldingPct stable or rising (vs. 1 year ago) AND promoterPledgePct < 5%
FAIL if: promoter selling down OR pledge > 10%
WARN if: pledge between 5-10%
```

**Gotcha:** We only store current snapshot, not historical. Need at least 2 data points (current
and 1-year-ago) to assess trend. **Sprint 1 limitation:** may only have current value. Mark as
"insufficient data" if historical unavailable.

**Gotcha:** Some promoters are government (PSUs like NTPC, SBIN, HAL). Government promoter holdings
are generally stable but won't increase. Treat PSU promoter stability as PASS.

**Item 7: Clean Auditor Remarks**
```
PASS if: auditorRemarks === "clean"
FAIL if: auditorRemarks === "qualified" or "adverse"
UNKNOWN if: data not available → default PASS with warning
```

**Gotcha:** Screener.in doesn't directly expose auditor remarks. This data must come from BSE/NSE
annual report filings or Moneycontrol. **Sprint 1:** accept as manual input field. Later: automate
from filing scraping.

**Item 8: Valuation Sanity**
```
PASS if: PEG <= 1.2 OR P/E < peerMedianPE
FAIL if: PEG > 1.2 AND P/E >= peerMedianPE
EDGE: PEG negative (negative growth) → FAIL
EDGE: No PEG data → fallback to P/E only
```

**Gotcha:** PEG = P/E ÷ EPS Growth Rate. Which growth rate? The Blueprint doesn't specify. Use
forward 1-year EPS growth estimate if available, otherwise trailing 3-year EPS CAGR.

**Gotcha:** Peer median P/E requires sector grouping with 5+ companies. The current entity-map has
only 2 per sector. **Must expand the universe** (see 1.7).

---

### 1.4 — Peer Comparison Service

**File: `src/services/mit/peer-comparison.ts`** (new)

**Data requirement:** For each sector, maintain a list of 5-10 tickers with current P/E ratios.

**Implementation:**
1. Group tickers by sector from expanded entity-map
2. For each sector, collect P/E ratios from fundamentals
3. Compute median: sort P/Es, take middle value
4. Store as `peerMedianPE: Record<string, number>` in MitState

**Gotcha:** Median is better than mean for peer comparison (outliers don't skew). But if sector
has < 5 tickers, median is unreliable. **Minimum 5 peers per sector** or skip peer comparison.

**Gotcha:** Negative P/E (loss-making companies) should be excluded from median calculation.
A sector with mostly loss-making companies (e.g., early-stage biotech) will have unreliable peer
median. Flag this.

**Gotcha:** Sector definitions matter. "BFSI" lumps banks + insurance + NBFCs + AMCs. Banks have
P/E ~12, insurance ~30, AMCs ~25. Sub-sector grouping is better but increases data requirement.

---

### 1.5 — Sentiment & News Overlay

**File: `src/services/mit/sentiment-overlay.ts`** (new)

Leverages the existing signal pipeline (`src/services/pipeline.ts`) which already classifies events
and detects policy signals.

**Market Tone Detection:**
```
risk-off if: > 60% of recent signals are negative direction
risk-on if: > 60% of recent signals are positive direction
neutral otherwise
```

"Recent" = last 24 hours of signals.

**Gotcha:** The existing pipeline processes government sources (PIB, RBI, NSE, CPPP, BusinessLine).
These are policy-focused, not market-sentiment-focused. A risk-off tone from policy signals (tariff
hike, ban) is different from market-wide risk-off (VIX spike, FII selling).

**Decision:** Use policy signals for sector-level sentiment, not market-wide. Add a simple market
breadth check: if >60% of universe stocks are below 50-DMA, tone = risk-off.

**Governance Red Flags (per ticker):**
```
- auditor resignation → detected from news events containing "auditor resig" keywords
- promoter pledge surge → promoterPledgePct > 20% or increased > 5% in quarter
- SEBI action → detected from signals with "sebi" + "order/penalty/ban" keywords
```

**Gotcha:** Keyword matching is brittle. "SEBI approves new framework" is positive, not a red flag.
Need sentiment + entity linking, not just keyword presence. Leverage the existing `classifier.ts`
which already does event type classification. Filter for `eventType: "compliance"` or `"ban"`.

---

### 1.6 — Expand Stock Universe

**File: `src/config/mit-universe.json`** (new)

The current `entity-map.json` has only 10 tickers. The Blueprint says "NSE/BSE liquid stocks."
For the NT LITE + Quant system to work, we need 50-100 tickers minimum.

**Structure:**
```json
[
  {
    "ticker": "RELIANCE",
    "name": "Reliance Industries Ltd",
    "exchange": "NSE",
    "sector": "energy",
    "subSector": "oil-and-gas",
    "marketCapTier": "large",
    "nifty50": true,
    "nifty500": true
  }
]
```

**Gotcha:** This is a **manual curation task**. Start with Nifty 50 components (blue chips, high
liquidity, good Screener.in coverage). Expand to Nifty 200 in Sprint 5.

**Gotcha:** Ticker symbols between NSE and BSE may differ. Always use NSE ticker as canonical.
BSE codes are numeric (500325 for Reliance). Map both.

**Gotcha:** Some tickers have changed (HDFC merged into HDFCBANK in 2023). Maintain an aliases map.

---

### 1.7 — API Endpoints (Sprint 1)

All endpoints under `/api/mit/` prefix. Register in `server.ts` after existing routes.

**File: `src/services/mit/mit-routes.ts`** (new)

```typescript
// Registers all /api/mit/* routes on the Fastify instance
export function registerMitRoutes(app: FastifyInstance, mitStore: MitStore): void {
  // 1.6.1 GET /api/mit/fundamentals/:ticker
  // 1.6.2 GET /api/mit/checklist/:ticker
  // 1.6.3 POST /api/mit/screen/nt-lite
  // 1.6.4 GET /api/mit/peers/:ticker
  // 1.6.5 GET /api/mit/sentiment/tone
  // 1.6.6 GET /api/mit/sentiment/:ticker/flags
  // 1.6.7 POST /api/mit/import/screener-csv  ← upload CSV
  // 1.6.8 POST /api/mit/import/fundamentals   ← manual JSON input
}
```

**Gotcha:** The existing `server.ts` is 1,845 lines. Do NOT add Mit routes inline.
Extract to a separate file and call `registerMitRoutes(app, mitStore)` from server.ts.

**Gotcha:** File upload for CSV import. Fastify needs `@fastify/multipart` plugin. Currently
not in dependencies. **Must add** `@fastify/multipart` to `package.json`.

**Gotcha:** The existing server uses `x-user-id` header for identity. Mit routes should respect
the same identity system for access control.

---

### Sprint 1 Test Checklist

- [ ] Import a Screener.in CSV → fundamentals stored correctly for 50 tickers
- [ ] Run checklist on SBIN → 8 items evaluated, each with pass/fail/value
- [ ] Run checklist on a company with negative FCF → item 2 fails correctly
- [ ] BFSI sector → ROCE check falls back to ROE automatically
- [ ] Peer median P/E → computed correctly for sectors with 5+ companies
- [ ] Market tone → derived from signal direction distribution
- [ ] CSV with changed column names → parser handles gracefully
- [ ] Empty/missing data → checklist items marked "insufficient data" not crash

---

## Sprint 2: Quant Feed & Composite Scoring

### 2.1 — Market Data Service

**File: `src/services/mit/market-data.ts`** (new)

Fetches real daily OHLCV data for the stock universe.

**Primary source: NSE India API**
```
GET https://www.nseindia.com/api/historical/cm/equity?symbol=SBIN&from=01-01-2025&to=12-02-2026
Headers:
  User-Agent: Mozilla/5.0 (Macintosh; ...)
  Accept: application/json
  Cookie: <nsit=...; bm_sv=...>
```

**Gotcha: NSE India requires a session cookie.**
Must first GET `https://www.nseindia.com` to establish cookies, then use those cookies for API calls.
Cookies expire after ~30 minutes. Implement a cookie refresh mechanism.

**Gotcha: Rate limiting.**
NSE blocks IPs that make too many requests. Implement:
- 500ms delay between requests
- Max 120 requests per minute
- Exponential backoff on 403/429
- Rotate through fallback sources on persistent block

**Fallback source: Yahoo Finance**
```
GET https://query1.finance.yahoo.com/v8/finance/chart/SBIN.NS?range=1y&interval=1d
```
No auth needed. 15-min delayed but fine for EOD data. Indian tickers use `.NS` (NSE) or `.BO` (BSE) suffix.

**Gotcha: Yahoo Finance ticker format.**
- NSE: `SBIN.NS`, `RELIANCE.NS`, `HDFCBANK.NS`
- BSE: `SBIN.BO`, `500112.BO` (numeric BSE codes)
- Some tickers differ: `M&M.NS` (Mahindra), `L&TFH.NS` (special chars in ticker)
- URL-encode special characters: `M%26M.NS`

**Gotcha: Adjusted vs. Unadjusted prices.**
Yahoo returns adjusted close (for splits/dividends). NSE returns unadjusted. For DMA calculations,
use adjusted close. For P&L tracking, use the same basis as entry price (unadjusted if user entered
at market price).

**Decision:** Store unadjusted OHLCV. Apply adjustment factors from `config/corporate-actions.json`
(already exists) when computing indicators. This matches how the existing `MarketSnapshotService` works.

**Storage: `data/mit-candles/{TICKER}.json`** (per-ticker files)

**Gotcha:** Don't store all candles in `mit-state.json`. At 80 tickers × 300 candles × ~80 bytes
= ~1.9MB, which would serialize/deserialize on every state read. Use separate per-ticker files.
Reference them from `MitState.candles` as a lazy-load map.

```typescript
export class MarketDataService {
  private cookieJar: string | null = null;
  private cookieExpiry: number = 0;

  async refreshCookies(): Promise<void> { /* GET nseindia.com, extract cookies */ }

  async fetchCandles(ticker: string, days: number = 300): Promise<DailyCandle[]> {
    // Try NSE first, fallback to Yahoo
    // Merge with existing cached candles (append new, don't re-fetch old)
    // Save to data/mit-candles/{ticker}.json
  }

  async refreshUniverse(tickers: string[]): Promise<Map<string, DailyCandle[]>> {
    // Batch fetch with rate limiting
    // Return map of ticker → candles
  }
}
```

**Gotcha: Weekends and holidays.**
Indian markets are closed on weekends + ~15 holidays/year. Don't count missing days as errors.
Use trading calendar to validate: if last candle is Friday and today is Monday, data is fresh.

**Gotcha: Pre-market vs. post-market.**
The pipeline runs at 08:45 IST. Market opens at 09:15 IST. At 08:45, the latest candle is
yesterday's close. This is correct for the Blueprint's "morning run" logic.

---

### 2.2 — Technical Indicator Engine

**File: `src/services/mit/technical-indicators.ts`** (new)

All indicators computed from `DailyCandle[]` arrays.

**Simple Moving Average (SMA):**
```typescript
function sma(candles: DailyCandle[], period: number): number | null {
  if (candles.length < period) return null;
  const slice = candles.slice(-period);
  return slice.reduce((sum, c) => sum + c.close, 0) / period;
}
```

**Gotcha:** Always use closing prices for DMA calculation, not adjusted close, unless you've
pre-adjusted the candle series. Be consistent.

**RSI (Relative Strength Index, 14-period):**
```
1. Calculate price changes: delta[i] = close[i] - close[i-1]
2. Separate gains and losses
3. First average gain = mean of first 14 gains
4. First average loss = mean of first 14 losses
5. Subsequent: avgGain = (prevAvgGain × 13 + currentGain) / 14
6. RS = avgGain / avgLoss
7. RSI = 100 - (100 / (1 + RS))
```

**Gotcha:** RSI needs at least `period + 1` candles (15 for RSI-14). With only 14 candles,
you can't compute the initial average.

**Gotcha:** When avgLoss = 0 (all gains, no losses), RS = Infinity, RSI = 100. Handle division
by zero: if avgLoss === 0, RSI = 100.

**Gotcha:** RSI regime classification per Blueprint Section 5:
- Oversold: RSI < 30
- Neutral: 30-70
- Overbought: RSI > 70
- Sweet spot for scoring: 45-65 (Section 5 gives 5 pts)

The Blueprint uses TWO different RSI ranges for different purposes. Don't confuse them.

**ATR (Average True Range, 14-period):**
```
TR = max(high - low, abs(high - prevClose), abs(low - prevClose))
ATR = SMA(TR, 14) for initial, then EMA-style smoothing
```

**Gotcha:** ATR is used in two places:
1. Quant feed: "momentum decays if price < 50-DMA with rising ATR" (Section 11)
2. Entry/exit: target calibration by volatility (Section 7)

"Rising ATR" = ATR today > ATR 5 days ago. Need to track ATR series, not just latest value.

**20-Day Return Z-Score:**
```
returns = [close[i]/close[i-1] - 1 for i in last 60 days]  // need history for z-score
mean_return = mean(returns)
std_return = stdev(returns)
current_20d_return = close[today] / close[today-20] - 1
z_score = (current_20d_return - mean_return) / std_return
```

**Gotcha:** Z-score requires sufficient history for meaningful mean/stdev. Use 60 trading days
(~3 months) for the distribution. With only 20 days of data, z-score is unreliable.

**Gotcha:** The Blueprint says "top decile of short-term momentum." This means z-score > ~1.28
(90th percentile of normal distribution). But it's the z-score WITHIN the universe, not within the
stock's own history. Must compute z-score for ALL tickers, then rank and take top 10%.

**Pullback Detection:**
```
recentHigh = max(high[i] for i in last 5 sessions)
pullback = (recentHigh - close[today]) / recentHigh
```

**Gotcha:** "Last 5 sessions" means trading days, not calendar days. Account for holidays.

---

### 2.3 — Quant Signal Generator

**File: `src/services/mit/quant-signal.ts`** (new)

Implements Blueprint Section 11 (Ernest P. Chan simplified 3-month swing).

**Signal generation algorithm:**

```
1. UNIVERSE FILTER:
   - Start with mit-universe tickers
   - Filter to those passing NT LITE checklist (grade A or B, i.e., 5+ items)
   - Filter to those with sufficient candle data (200+ candles)

2. ENTRY RULE (ALL must be true):
   a. Top decile 20-day return z-score across universe
   b. Price > 100-DMA (medium-term trend is up)
   c. Pullback < 5% in last 5 sessions (buying a dip, not a crash)

3. RISK RULE:
   - Stop: 6% below entry (midpoint of buy zone)
   - Target: 1.5–2.5R first target
     - Low volatility (ATR/price < 1.5%): use 2.5R
     - Medium volatility (1.5-3%): use 2.0R
     - High volatility (>3%): use 1.5R

4. TIME EXIT:
   - 3 months from entry (90 calendar days, ~63 trading days)
   - OR momentum decay: price < 50-DMA AND ATR rising (vs. 5 days ago)

5. POSITION SIZE:
   - 3-5% of capital
   - Cap simultaneous positions to keep deployed ≤ 95%
```

**Gotcha: "Top decile" across universe.**
If universe has 50 stocks, top decile = top 5. If 100 stocks, top 10. The number of Quant signals
per day is dynamic and depends on universe size. On most days, only 1-3 stocks will pass ALL three
entry conditions simultaneously.

**Gotcha: 100-DMA vs 200-DMA.**
The Quant feed uses 100-DMA for trend (Section 11: "price > 100-DMA"). The NT LITE scoring uses
50-DMA and 200-DMA (Section 5). Different indicators for different feeds. Don't cross them.

**Gotcha: Pullback < 5% AND top decile momentum are partially contradictory.**
High momentum stocks (top z-score) rarely have a 5% pullback simultaneously. This is by design —
it catches the rare "strong stock pulling back" setup. Expect few signals (0-2 per week).

**Gotcha: Multiple signals for same ticker.**
If a stock qualifies on consecutive days, don't generate duplicate signals. Maintain a
`lastSignalDate` per ticker and enforce a 5-day cooldown between signals for the same stock.

---

### 2.4 — Composite Scoring Model

**File: `src/services/mit/composite-scorer.ts`** (new)

Implements Blueprint Section 5 (0-100 scoring).

**Quality (40 points):**

| Sub-item | Max | Scoring |
|----------|-----|---------|
| ROCE/ROE | 15 | 0 if <10%, linear 10-20% maps to 0-15, cap at 15 for >20% |
| FCF trend | 10 | 0 if negative avg, 5 if 3/5 positive, 10 if 5/5 positive |
| OPM trend | 10 | 0 if declining, 5 if flat, 10 if improving (slope > 0.5%/yr) |
| D/E or IC | 5 | 0 if D/E > 1, 2.5 if 0.5-1, 5 if <0.5 or IC > 5 |

**Growth (20 points):**

| Sub-item | Max | Scoring |
|----------|-----|---------|
| Revenue CAGR | 10 | 0 if <0%, linear 0-20% maps to 0-10, cap at 10 for >20% |
| EPS CAGR | 10 | 0 if <0%, linear 0-25% maps to 0-10, cap at 10 for >25% |

**Valuation (15 points):**

| Sub-item | Max | Scoring |
|----------|-----|---------|
| PEG | 10 | 10 if ≤0.8, 7 if 0.8-1.0, 5 if 1.0-1.2, 0 if >1.2 |
| P/E vs peers | 5 | 5 if <peer median, 2.5 if within 10% of median, 0 if above |

**Momentum (15 points):**

| Sub-item | Max | Scoring |
|----------|-----|---------|
| Price > 50 & 200 DMA | 10 | 5 per DMA if above (0, 5, or 10) |
| RSI 45-65 | 5 | 5 if in range, 2.5 if 30-45 or 65-70, 0 otherwise |

**Governance (10 points):**

| Sub-item | Max | Scoring |
|----------|-----|---------|
| Promoter stable/rising | 5 | 5 if stable/rising, 2.5 if slight decline (<2%), 0 if significant |
| No pledging | 3 | 3 if 0%, 1.5 if <5%, 0 if >5% |
| Clean audit | 2 | 2 if clean, 0 if qualified/adverse |

**Gotcha: Linear scaling precision.**
When mapping a value range to points, use:
```typescript
function linearScale(value: number, min: number, max: number, maxPoints: number): number {
  if (value <= min) return 0;
  if (value >= max) return maxPoints;
  return ((value - min) / (max - min)) * maxPoints;
}
```
Round to 1 decimal place. Don't truncate — 7.49 should round to 7.5, not 7.

**Gotcha: Missing data.**
If ROCE is null (data unavailable), don't score 0 — that penalizes data gaps unfairly.
Instead, use the available data and scale proportionally:
```
adjustedTotal = (rawTotal / maxPossibleWithAvailableData) × 100
```
OR flag as "incomplete score" and show which items had no data.

**Gotcha: Percentile rank.**
`percentileRank` is relative to all scored stocks in the current pipeline run.
```typescript
const sorted = scores.sort((a, b) => a.total - b.total);
const rank = sorted.findIndex(s => s.ticker === ticker);
const percentile = (rank / sorted.length) * 100;
```
This changes every time the universe changes. A stock with score 72 might be 80th percentile
today and 75th percentile tomorrow if new stocks are added.

---

### 2.5 — Buy Zone / Stop / Target Calculator

**File: `src/services/mit/entry-exit-calc.ts`** (new)

Implements Blueprint Section 7.

**Buy Zone Determination:**
```
Case 1: Pullback to rising 50-DMA
  - Condition: price within [-3%, +3%] of 50-DMA AND 50-DMA slope > 0
  - Buy zone: [50-DMA × 0.99, 50-DMA × 1.02]

Case 2: Breakout retest
  - Condition: price broke above a resistance level AND pulled back to retest
  - Buy zone: [resistance × 0.98, resistance × 1.01]
  - NOTE: Requires identifying resistance levels — non-trivial

Case 3: REJECT
  - If price > 15% above 50-DMA → "chasing, do not buy"
  - Mark as avoid with reason "extended above 50-DMA"
```

**Gotcha: Identifying resistance levels (Case 2).**
This requires pivot point detection or prior high identification. Simple approach:
- Look for the highest close in the last 60 days
- If current price broke above it in the last 10 days AND pulled back to within 2%
- That's a breakout-retest

More sophisticated: use fractal pivots (local highs/lows). **Keep simple for Sprint 2.**

**Gotcha: "Rising 50-DMA" definition.**
50-DMA slope > 0 means: `50-DMA today > 50-DMA 5 days ago`. Simple difference check.
Don't use derivative — discrete slope is fine for daily data.

**Stop-Loss Calculation:**
```
stop_from_pct = buyZoneMid × (1 - 0.06)   // 6% rule
stop_from_support = nearestSupportLevel      // structural
stop = max(stop_from_pct, stop_from_support) // tighter = higher price = max
```

**Gotcha: The "tighter" stop means the HIGHER price** (closer to entry).
```
Entry: ₹100
6% stop: ₹94
Support stop: ₹96
Tighter = ₹96 (less risk, higher stop price)
```
This is `Math.max()` not `Math.min()`.

**Gotcha: Structural support identification.**
Simple approach: lowest low in the last 20 trading days. More precise: swing low (a low surrounded
by higher lows on both sides).
```typescript
function findSwingLow(candles: DailyCandle[], lookback: number = 20): number {
  const recent = candles.slice(-lookback);
  return Math.min(...recent.map(c => c.low));
}
```

**Target Calculation:**
```
risk = buyZoneMid - stop
For NT LITE: target = buyZoneMid + risk × 2.5   (conservative R:R of 2.5)
For Quant: target = buyZoneMid + risk × rMultiple (1.5-2.5 based on ATR/volatility)
```

**Gotcha: Target capping.**
Blueprint says "12-25% target." If the R:R calculation produces a target > 25% above entry,
cap it at 25%. If it produces < 12%, bump to 12% minimum (but flag that R:R may be low).

**Trailing Activation:**
```
trailingActivationPrice = buyZoneMid + (target - buyZoneMid) × trailingActivationPct
// Default: 75% of distance to target
// e.g., entry ₹100, target ₹120, activation at ₹100 + 0.75×20 = ₹115
```

---

### 2.6 — Unified Daily Pipeline

**File: `src/services/mit/daily-pipeline.ts`** (new)

Orchestrates the full morning run.

**Pipeline steps:**
```
1. REFRESH DATA
   a. Fetch latest candles for universe (MarketDataService)
   b. Skip if market was closed yesterday (holiday check)

2. COMPUTE INDICATORS
   a. Technical indicators for all universe stocks
   b. Only for stocks with 200+ candles

3. RUN NT LITE CHECKLIST
   a. For all universe stocks with fundamentals data
   b. Filter to grade A/B (5+ items passing)

4. GENERATE QUANT SIGNALS
   a. From checklist-passing universe
   b. Apply entry rules (z-score + DMA + pullback)
   c. Calculate entry/exit plans

5. SCORE ALL CANDIDATES
   a. Composite scorer on all checklist-passing stocks
   b. Rank by total score

6. SELECT DAILY IDEAS
   a. Top NT LITE pick: highest composite score among NT-only candidates
   b. Top Quant pick: highest z-score among Quant-qualifying candidates
   c. 1-2 Avoid names: stocks with governance flags or extreme overvaluation

7. DETECT MARKET TONE
   a. Check breadth: % of universe above 50-DMA
   b. Cross-reference with policy signal direction

8. STORE RESULTS
   a. Save MitDailyRunResult to mit-state
   b. Update technicals and scores in state
   c. Emit stream event for UI refresh
```

**Gotcha: Pipeline partial failure.**
If NSE API is down but Yahoo works, proceed with Yahoo data. If fundamentals are stale, proceed
with stale data but flag. Don't fail the entire pipeline because one source is unavailable.

**Gotcha: Pipeline idempotency.**
Running the pipeline twice on the same day should not generate duplicate ideas. Check
`dailyRuns` for today's date before creating a new run. If re-running, overwrite the existing
run for today.

**Gotcha: Step timing.**
At 80 tickers with 500ms delay between NSE requests: step 1 takes ~40 seconds.
Technical indicator computation is CPU-bound but fast (~100ms for 80 tickers).
Total pipeline: ~45-60 seconds. Show progress to user.

**Gotcha: NT LITE vs Quant idea selection.**
The Blueprint says "2 daily ideas" — one from each feed. But what if:
- No stocks pass NT LITE? → Show only Quant pick (or zero picks)
- No stocks pass Quant? → Show only NT LITE pick
- Same stock qualifies for both? → Show it once with "BOTH FEEDS" label
**Never force a pick if no stock qualifies.** Quality > quantity.

---

### 2.7 — API Endpoints (Sprint 2)

```
GET  /api/mit/technicals/:ticker     → TechnicalSnapshot
GET  /api/mit/quant/signals          → QuantSignal[]
GET  /api/mit/score/:ticker          → CompositeScore
GET  /api/mit/entry-exit/:ticker     → EntryExitPlan
POST /api/mit/pipeline/run           → MitDailyRunResult
GET  /api/mit/pipeline/latest        → MitDailyRunResult
GET  /api/mit/daily-ideas            → MitWatchlistIdea[]
```

**Gotcha: Pipeline run endpoint timing.**
`POST /api/mit/pipeline/run` can take 45-60 seconds. Fastify default timeout is 30 seconds.
Options:
1. Increase timeout for this route: `{ config: { timeout: 120000 } }`
2. Make it async: return `{ runId, status: "started" }` immediately, poll for results
3. Use the existing `StreamBusService` to push completion event

**Decision:** Option 2 (async). Return runId, add `GET /api/mit/pipeline/status/:runId` for polling.

---

### Sprint 2 Test Checklist

- [ ] Fetch 200+ candles for SBIN from NSE/Yahoo → stored correctly
- [ ] 50-DMA computed → matches known value (cross-check with TradingView)
- [ ] RSI-14 computed → matches known value within ±0.5
- [ ] Quant signal generated for stock meeting all 3 entry criteria
- [ ] Quant signal NOT generated for stock failing any criterion
- [ ] Composite score: stock with perfect fundamentals + momentum scores 85+
- [ ] Composite score: stock with poor fundamentals scores <40
- [ ] Buy zone: stock near 50-DMA → zone calculated around DMA level
- [ ] Buy zone: stock 20% above 50-DMA → rejected as "chasing"
- [ ] Full pipeline run → completes in <90 seconds for 50 tickers
- [ ] Pipeline re-run same day → doesn't duplicate ideas

---

## Sprint 3: Portfolio Engine & Trade Lifecycle

### 3.1 — Mit Portfolio Service

**File: `src/services/mit/portfolio-service.ts`** (new)

**Initialization:**
```typescript
function makeDefaultPortfolio(): MitPortfolioState {
  return {
    settings: {
      capital: 200000,
      allocPct: 0.05,
      stopPct: 0.06,
      pauseCashPct: 0.03,
      maxDeployedPct: 0.95,
      maxHorizonDays: 90,
      trailingActivationPct: 0.75,
    },
    cash: 200000,           // starts equal to capital
    positions: [],
    closedTrades: [],
    equityCurve: [],
    peakEquity: 200000,
    maxDrawdownPct: 0,
    paused: false,
    lastPipelineRun: null,
  };
}
```

**Gotcha: Cash initialization.**
`cash` starts equal to `capital`. When user changes `capital` setting, what happens to `cash`?
Options:
1. Cash stays as-is (only new capital affects future sizing)
2. Cash adjusts: `cash += (newCapital - oldCapital)`
**Decision:** Option 2 — capital change acts like a deposit/withdrawal.

**Gotcha: Capital ≠ equity.**
`capital` is the initial/configured amount. `equity` is the current portfolio value
(`cash + Σ(position.qty × CMP)`). Over time, equity diverges from capital based on P&L.
Position sizing uses `capital` (Blueprint says "3-5% of capital"), NOT current equity.

**Wait — re-read Blueprint Section 6:** "Default size: 3-5% of **capital** per position."
This means a ₹200k capital always sizes ₹10k per trade, regardless of whether equity grew to
₹250k or dropped to ₹180k. This is a **fixed-fraction sizing on initial capital**, not on equity.

**Gotcha:** If capital is fixed but equity drops significantly, the system could have outsized
risk (10k position on 150k equity = 6.7% vs intended 5%). The Blueprint addresses this with the
"pause rule" (cash < 3%) rather than dynamic resizing.

---

### 3.2 — Position Sizing Engine

**File: `src/services/mit/position-sizer.ts`** (new)

```typescript
interface SizingResult {
  approved: boolean;
  rejectionReason: string | null;
  allocatedAmount: number;
  units: number;
  entryPrice: number;
  stopLoss: number;
  projectedRiskAmount: number;  // units × (entry - stop)
}

function sizePosition(
  settings: MitSettings,
  portfolio: MitPortfolioState,
  entryPrice: number,
  stopLoss: number,
  customAllocPct?: number
): SizingResult {
  const allocPct = customAllocPct ?? settings.allocPct;
  const allocatedAmount = settings.capital * allocPct;
  const units = Math.floor(allocatedAmount / entryPrice);
  const cost = units * entryPrice;
  const deployed = portfolio.positions.reduce(
    (sum, p) => sum + p.qty * p.currentPrice, 0
  );

  // Guard checks
  if (portfolio.cash < cost) {
    return { approved: false, rejectionReason: "Insufficient cash", ... };
  }
  if (portfolio.cash - cost < settings.capital * settings.pauseCashPct) {
    return { approved: false, rejectionReason: "Would breach pause threshold", ... };
  }
  if ((deployed + cost) / settings.capital > settings.maxDeployedPct) {
    return { approved: false, rejectionReason: "Would exceed max deployed (95%)", ... };
  }

  return {
    approved: true,
    rejectionReason: null,
    allocatedAmount,
    units,
    entryPrice,
    stopLoss,
    projectedRiskAmount: units * (entryPrice - stopLoss),
  };
}
```

**Gotcha: `Math.floor(allocatedAmount / entryPrice)` can produce 0 units.**
If entry_price > allocatedAmount (stock price > ₹10,000 per share), you can't buy even 1 share.
Handle: reject with "Entry price exceeds allocation. Increase allocation % or use a lower-priced
entry point."

**Gotcha: Brokerage fees.**
The Blueprint mentions fees in the realized P&L formula (Section 8). Indian brokerage:
- Zerodha: ₹20/order or 0.03% (whichever is lower)
- STT: 0.1% on sell side (delivery)
- GST: 18% on brokerage
- Stamp duty: 0.015%
- Total: ~0.15-0.2% per round trip

Estimate fees at 0.2% of trade value for P&L calculation. Make configurable.

**Gotcha: Cash rounding.**
After buying 10 units at ₹987.50, cost = ₹9,875. Remaining allocated amount (₹125) stays as cash.
Don't lose it — the `cash` field must be precise to 2 decimal places.

---

### 3.3 — Trade Entry & Exit

**File: `src/services/mit/trade-manager.ts`** (new)

**Entry flow:**
```
1. User selects a watchlist idea → "Enter Trade"
2. System pre-fills: ticker, entry price (buy zone mid), stop, target
3. User may adjust entry price (actual fill) and quantity
4. Position sizer validates
5. Create MitPosition with status: "open"
6. Deduct cost from cash
7. Log trade entry
8. Update equity curve
```

**Gotcha: Entry price vs. buy zone.**
The watchlist idea has a buy zone [low, high]. The user enters at an actual price which may be
outside the zone (market moved). Allow entry at any price but warn if outside buy zone.

**Gotcha: `confirmedEntry` flag.**
Blueprint Section 12 distinguishes between:
- Auto-estimated entry (system assumes midpoint of buy zone)
- Confirmed entry (user enters actual fill price and date)

The position is created as `confirmedEntry: false` initially. User confirms later → updates
entry price and date. **P&L changes retroactively** when entry price changes.

**Exit flow:**
```
1. Sell indicator fires (or user initiates manual sell)
2. System shows: ticker, qty, CMP, P&L, suggested exit price
3. User enters: actual sell price, quantity (partial or full), date
4. Calculate realized P&L: (sell_price - entry_price) × qty - fees
5. If partial: reduce position qty, keep position open
6. If full: move to closedTrades, free cash
7. Update cash, deployed, equity curve
8. Check if cash > pause threshold → resume suggestions if was paused
```

**Gotcha: Partial exits.**
If position has 10 units and user sells 4:
- Keep position open with 6 remaining units
- Realized P&L for the 4 units goes to `closedTrades` as a `partial` exit
- Entry price and stop remain the same for remaining 6 units
- Cash increases by `4 × sell_price - fees`

**Gotcha: Average exit price on multiple partial exits.**
If user sells 4 at ₹110 and later 6 at ₹105, the closed trade should record:
- Two separate `MitClosedTrade` entries (not one merged)
- Each with its own realized P&L

**Gotcha: Stop-loss is NOT automatic.**
Blueprint Section 8: "SELL indicator when price within 2-3% of target... **ask for confirmation**."
The system generates indicators, it does NOT auto-execute. User must confirm every sell.

---

### 3.4 — Trailing Stop Engine

**File: `src/services/mit/trailing-stop.ts`** (new)

Called during the daily P&L refresh cycle.

```typescript
function updateTrailingStop(position: MitPosition, currentPrice: number, technicals: TechnicalSnapshot): void {
  // Update max/min tracking
  position.maxPriceSinceEntry = Math.max(position.maxPriceSinceEntry, currentPrice);
  position.minPriceSinceEntry = Math.min(position.minPriceSinceEntry, currentPrice);

  // Check activation
  const progressToTarget = (currentPrice - position.entryPrice) / (position.firstTarget - position.entryPrice);
  const rsiOverbought = technicals.rsi14 !== null && technicals.rsi14 > 70;

  if (!position.trailingActive && (progressToTarget >= 0.75 || rsiOverbought)) {
    position.trailingActive = true;
  }

  if (position.trailingActive) {
    // Tightening trail: as price approaches target, trail gets tighter
    const basePct = 0.06; // start at 6%
    const minPct = 0.03;  // tighten to 3% near target
    const tightening = Math.min(1, progressToTarget);
    const trailPct = basePct - (basePct - minPct) * tightening;

    position.trailingStop = position.maxPriceSinceEntry * (1 - trailPct);

    // The trailing stop should never be below the initial stop
    position.trailingStop = Math.max(position.trailingStop, position.stopLoss);
  }
}
```

**Gotcha: Trailing stop can only go UP, never down.**
Once `trailingStop` is set, it should never decrease:
```typescript
const newTrail = maxPrice * (1 - trailPct);
position.trailingStop = Math.max(position.trailingStop ?? 0, newTrail);
```

**Gotcha: Intraday vs. EOD trailing.**
The Blueprint says "trailing stops near target" but doesn't specify intraday vs EOD evaluation.
Since this is a swing system with EOD data, evaluate trailing at EOD close. Don't trigger on
intraday wicks.

**Gotcha: Gap down through trailing stop.**
If stock closes at ₹115 with trail at ₹112, then opens next day at ₹108, the stop was breached
through a gap. The exit price is the open (₹108), not the trail (₹112). Use the open price for
P&L calculation, not the stop price.

---

### 3.5 — P&L Ledger

**File: `src/services/mit/pnl-ledger.ts`** (new)

**Daily refresh cycle (called after market close or on-demand):**

```
For each open position:
  1. Get currentPrice from MarketDataService
  2. unrealizedPnl = qty × (currentPrice - entryPrice)
  3. unrealizedPnlPct = (currentPrice - entryPrice) / entryPrice × 100
  4. Update maxPriceSinceEntry, minPriceSinceEntry
  5. Run trailing stop engine
  6. Check sell indicators:
     - near-target: currentPrice >= firstTarget × 0.97 (within 3%)
     - rsi-rollover: RSI was >70 and now <50
     - time-exit: daysSinceEntry >= maxHorizonDays × 0.9 (approaching 90 days)
     - stop-breach: currentPrice <= stopLoss (or trailingStop if active)
     - momentum-decay: price < 50-DMA AND ATR rising (Quant only)
  7. Set pnlLockState = "estimated"

After user confirms:
  - pnlLockState = "locked"
  - pnlLockedAt = now
```

**Gotcha: Equity curve assembly.**
```
daily_equity = cash + Σ(position.qty × position.currentPrice)
```
This requires ALL positions to have a current price. If market data is stale for one ticker,
use last known price but flag the equity point as "partial."

**Gotcha: Max drawdown calculation.**
```
peakEquity = max of all daily equity values
currentDrawdown = (peakEquity - currentEquity) / peakEquity
maxDrawdownPct = max of all currentDrawdown values
```
Must be computed incrementally: update `peakEquity` and `maxDrawdownPct` on each equity curve
point. Don't recompute from scratch (expensive with long history).

**Gotcha: Win rate edge cases.**
- 0 closed trades → win rate = N/A, not 0%
- All trades open → win rate = N/A
- 1 closed trade that won → win rate = 100% (technically correct but misleading)
Display "N/A" if < 5 closed trades, with note "Insufficient sample."

**Gotcha: R:R calculation for a closed trade.**
```
initialRisk = entryPrice - initialStopLoss  // NOT trailing stop
realized = exitPrice - entryPrice
rMultiple = realized / initialRisk
```
A negative rMultiple means the stop was breached (or closed at a loss for another reason).
R:R is NOT always positive.

---

### 3.6 — Exposure Guard

**File: `src/services/mit/exposure-guard.ts`** (new)

Centralized guard that's checked before any new trade entry.

```typescript
interface GuardStatus {
  canTrade: boolean;
  paused: boolean;
  cashPct: number;
  deployedPct: number;
  reasons: string[];           // why trading is blocked
  warnings: string[];          // non-blocking warnings
  suggestedSells: string[];    // tickers nearest target, for freeing cash
}

function checkGuard(portfolio: MitPortfolioState): GuardStatus {
  const equity = portfolio.cash + portfolio.positions.reduce(
    (sum, p) => sum + p.qty * p.currentPrice, 0
  );
  const deployed = equity - portfolio.cash;
  const cashPct = portfolio.cash / portfolio.settings.capital;
  const deployedPct = deployed / portfolio.settings.capital;

  const reasons: string[] = [];
  const warnings: string[] = [];

  if (cashPct < portfolio.settings.pauseCashPct) {
    reasons.push(`Cash ${(cashPct*100).toFixed(1)}% below pause threshold ${(portfolio.settings.pauseCashPct*100)}%`);
  }
  if (deployedPct > portfolio.settings.maxDeployedPct) {
    reasons.push(`Deployed ${(deployedPct*100).toFixed(1)}% exceeds max ${(portfolio.settings.maxDeployedPct*100)}%`);
  }
  if (deployedPct > 0.85) {
    warnings.push("Deployed > 85% — consider reducing exposure");
  }

  // Find positions nearest target for suggested sells
  const suggestedSells = portfolio.positions
    .filter(p => p.status === 'open')
    .map(p => ({
      ticker: p.ticker,
      pctToTarget: (p.firstTarget - p.currentPrice) / p.firstTarget,
    }))
    .filter(p => p.pctToTarget < 0.10) // within 10% of target
    .sort((a, b) => a.pctToTarget - b.pctToTarget)
    .map(p => p.ticker);

  return {
    canTrade: reasons.length === 0,
    paused: cashPct < portfolio.settings.pauseCashPct,
    cashPct,
    deployedPct,
    reasons,
    warnings,
    suggestedSells,
  };
}
```

**Gotcha: Deployed % can exceed capital.**
If equity grows (positions appreciated), deployed could be > 100% of initial capital while still
being < 95% of current equity. The Blueprint uses **capital** as the denominator, not equity.
So deployed ₹210k on ₹200k capital = 105%. This would block trading even though in absolute
terms there's cash available.

**Decision:** Use `capital` as denominator per Blueprint. But when equity is significantly >
capital (>120%), surface a suggestion to update capital setting.

---

### 3.7 — API Endpoints (Sprint 3)

```
GET    /api/mit/portfolio              → MitPortfolioState (positions, cash, equity, metrics)
POST   /api/mit/portfolio/settings     → Update MitSettings
POST   /api/mit/trade/enter            → Enter new position
POST   /api/mit/trade/exit             → Exit position (partial or full)
POST   /api/mit/trade/confirm          → Confirm fills / lock P&L
GET    /api/mit/pnl                    → Current P&L breakdown
GET    /api/mit/pnl/history            → Equity curve points
GET    /api/mit/indicators             → Active sell indicators
GET    /api/mit/guard                  → Exposure guard status
POST   /api/mit/stop/override          → Override stop-loss
GET    /api/mit/trades                 → Full trade ledger
POST   /api/mit/pnl/refresh            → Force P&L refresh with latest prices
```

**Gotcha: `/api/mit/trade/enter` request body:**
```json
{
  "ticker": "SBIN",
  "feed": "nt-lite",
  "entryPrice": 845.50,
  "qty": 11,
  "stopLoss": 794.77,
  "firstTarget": 1014.60,
  "notes": "Strong ROCE at 18%, entering on 50-DMA pullback"
}
```
Optional fields: `entryDate` (defaults to today), `customAllocPct`.

**Gotcha: Date handling.**
All dates should be IST (Asia/Kolkata). The existing codebase uses `new Date().toISOString()`
which produces UTC. For trading dates, use:
```typescript
const istDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
// returns YYYY-MM-DD in IST
```

---

### Sprint 3 Test Checklist

- [ ] Enter trade → cash decreases, position appears, equity unchanged (entry price = market)
- [ ] Enter trade when cash < pause threshold → rejected
- [ ] Enter trade when deployed > 95% → rejected
- [ ] Exit partial → position qty decreases, cash increases, closedTrade created
- [ ] Exit full → position removed, all cash freed, closedTrade created
- [ ] Stop breach → sell indicator fires, position NOT auto-closed
- [ ] Trailing stop activates at 75% of target → trailingActive = true
- [ ] Trailing stop only moves up → verified with price sequence up-up-down
- [ ] P&L refresh → all positions have fresh currentPrice and unrealizedPnl
- [ ] Equity curve → new point added each day with correct values
- [ ] Max drawdown → correctly tracks worst peak-to-trough
- [ ] Win rate → calculated correctly with 5+ closed trades
- [ ] Fee deduction → realized P&L includes 0.2% round-trip fees
- [ ] Capital change → cash adjusts by delta
- [ ] Pause → resume cycle when cash crosses threshold

---

## Sprint 4: Dashboard UI & Mobile Experience

### 4.1 — Architecture: New Tab in App.tsx

Add `"mit"` to the `TABS` array in `App.tsx` (line 88-95):
```typescript
const TABS = [
  { id: "overview", label: "OVW", full: "Overview" },
  { id: "signals", label: "SIG", full: "Signals" },
  // ... existing tabs ...
  { id: "mit", label: "MIT", full: "Mit Trading" },  // NEW
] as const;
```

**Gotcha: `TerminalRoute` type extension.**
Must add `"mit"` to the `TerminalRoute` union in `src/types.ts`:
```typescript
export type TerminalRoute = "overview" | "signals" | ... | "mit";
```
This affects:
- `UserProfile.routeEntitlements` — existing profiles won't have "mit"
- `TerminalService` command routing — add "mit" commands
- `IdentityService` access checks

**Gotcha: htm templating.**
All UI in App.tsx uses htm tagged templates, NOT JSX. The pattern is:
```typescript
const html = htm.bind(React.createElement);
// Then:
html`<div className="foo">${bar}</div>`
```
React component usage:
```typescript
html`<${MotionDiv} initial=${{ opacity: 0 }}>${children}</${MotionDiv}>`
```
NOT `<MotionDiv initial={{ opacity: 0 }}>{children}</MotionDiv>`

**Gotcha: framer-motion with htm.**
The existing code imports `motion` from framer-motion. In htm, animated elements are:
```typescript
html`<${motion.div} initial=${{ opacity: 0 }} animate=${{ opacity: 1 }}>content</${motion.div}>`
```

---

### 4.2 — Component Breakdown

Due to App.tsx being a single-file application (existing pattern), all Mit components will be
defined as functions in the same file or in a new `src/MitDashboard.tsx` file.

**Decision:** Create `src/MitDashboard.tsx` as a separate component file. Import into App.tsx.
This keeps the Mit code isolated and prevents App.tsx from growing further.

**Gotcha: `htm` usage in separate file.**
The new file must also import and bind htm:
```typescript
import htm from "htm/dist/htm.mjs";
const html = htm.bind(React.createElement);
```

**Component tree:**
```
MitDashboard
├── MitTopBar           (Cash%, Deployed%, Equity, P&L, DD, Win-rate, R:R)
├── MitSentimentBanner  (market tone: risk-on/risk-off/neutral)
├── MitPipelineStatus   (last run, next run, health)
├── MitWatchlist         (2 daily ideas + avoids)
│   ├── MitIdeaCard     (per idea)
│   └── MitAvoidCard    (per avoid)
├── MitHoldings         (all open positions)
│   └── MitHoldingCard  (per position)
├── MitSellIndicators   (positions with active indicators)
│   └── MitSellCard     (per indicator)
├── MitAllocationDonut  (sector/position allocation)
├── MitEquityCurve      (equity over time)
└── MitSettings         (editable parameters)
```

---

### 4.3 — Top Bar Metrics

**Data source:** `GET /api/mit/portfolio`

```
┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
│ CASH     │ DEPLOYED │ EQUITY   │ CUM P&L  │ MAX DD   │ WIN RATE │ AVG R:R  │
│ 42.0%    │ 58.0%    │ ₹2,12K   │ +₹12,400 │ -3.2%    │ 66.7%    │ 2.1:1    │
│ ₹84,000  │ ₹1,16K   │          │ +6.2%    │          │ 4/6      │          │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘
```

**Color coding:**
- Cash%: green if >30%, amber if 10-30%, red if <10%
- P&L: green if positive, red if negative
- Max DD: green if <5%, amber if 5-10%, red if >10%
- Win rate: green if >60%, amber if 40-60%, red if <40%

**Gotcha: INR formatting for compact display.**
₹2,12,000 is too long. Use compact notation:
- < ₹1,000: show full (₹943)
- ₹1,000 - ₹99,999: show with K (₹12.4K)
- ₹1,00,000 - ₹99,99,999: show with L (₹2.1L for lakhs)
- ₹1,00,00,000+: show with Cr (₹1.2Cr)

```typescript
function formatINR(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs < 1000) return `${sign}₹${abs.toFixed(0)}`;
  if (abs < 100000) return `${sign}₹${(abs/1000).toFixed(1)}K`;
  if (abs < 10000000) return `${sign}₹${(abs/100000).toFixed(1)}L`;
  return `${sign}₹${(abs/10000000).toFixed(1)}Cr`;
}
```

**Gotcha: Sparkline in top bar.**
The equity curve sparkline needs the Recharts `<AreaChart>` with minimal chrome (no axes,
no grid, no tooltip). Set height to ~30px, width to ~100px. Use a gradient fill.

---

### 4.4 — Watchlist Idea Cards

**Data source:** `GET /api/mit/daily-ideas`

Each card is a self-contained unit showing everything the user needs to decide on a trade.

**Card layout:**
```
┌─────────────────────────────────────────────┐
│ [NT LITE]  SBIN — State Bank of India  [78] │  ← feed chip, ticker, score badge
│                                              │
│ • ROCE 18.3% — consistent above 15% for 5y │  ← thesis bullets
│ • FCF trend positive, OPM improving          │
│ • Pullback to 50-DMA after breakout          │
│                                              │
│ ₹840 ──[████████░░]── ₹920                  │  ← buy zone bar, current price marker
│  BUY ZONE    CMP: ₹852    STOP: ₹794        │
│                                              │
│ TARGET: ₹1,015 (+19.1%)   R:R 3.2:1         │  ← target and R:R
│                                              │
│ Above 50/200-DMA | RSI: 52 (Neutral)         │  ← momentum label
│                                              │
│ ROCE 18% | EPS CAGR 22% | P/E 8.2           │  ← key metrics
│                                              │
│ [ENTER TRADE]            [EXPAND DETAILS]    │  ← action buttons
└─────────────────────────────────────────────┘
```

**Avoid cards have red border:**
```
┌─────────────────────────────────────────────┐
│ [AVOID]  YESBANK — Yes Bank Ltd              │
│                                              │
│ ⚠ Promoter pledge at 23% — governance risk  │
│ ⚠ NPA concerns, auditor qualified remarks    │
│                                              │
│ AVOID REASON: Governance red flags            │
└─────────────────────────────────────────────┘
```

**Gotcha: Buy zone visualization.**
The bar showing buy zone needs to scale correctly:
```
bar_start = buyZoneLow
bar_end = buyZoneHigh
marker = currentPrice (clamped to bar range if outside)
```
If currentPrice < buyZoneLow, show marker at left edge with "Below zone" label.
If currentPrice > buyZoneHigh, show marker at right edge with "Above zone" label.

**Gotcha: "Enter Trade" button.**
Tapping this should:
1. Pre-fill the trade entry form with the idea's parameters
2. Allow user to adjust (entry price, qty, stop, target)
3. Run through position sizer for validation
4. Show confirmation with projected P&L scenarios

This requires a **modal or slide-up panel**, not a page navigation. Use framer-motion
`AnimatePresence` for the slide-up animation.

---

### 4.5 — Holdings Cards

**Data source:** `GET /api/mit/portfolio`

**Card layout:**
```
┌─────────────────────────────────────────────┐
│ SBIN  [NT LITE]        ⏳ 23 days           │  ← ticker, feed, days held
│ BFSI                                         │
│                                              │
│ Entry: ₹845   CMP: ₹892   P&L: +₹517       │
│ ──[████████████░░░░░]──                      │  ← progress bar stop→target
│ STOP ₹794    CURRENT    TARGET ₹1,015        │
│                                              │
│ +5.6%                              ⚡ TRAIL  │  ← P&L %, trailing status
└─────────────────────────────────────────────┘
```

**Progress bar:**
```
Start = stopLoss price
End = firstTarget price
Current = currentPrice
Fill % = (currentPrice - stopLoss) / (firstTarget - stopLoss) × 100
```

**Gotcha: Progress bar when price below stop.**
If currentPrice < stopLoss, fill is negative. Show a red "STOP BREACH" indicator, not a
negative-width bar.

**Gotcha: Progress bar when price above target.**
If currentPrice > firstTarget, fill is >100%. Cap at 100% and show "TARGET HIT" label.

**Status indicators:**
- `⏳ Open` — amber, position running normally
- `⚡ Trailing` — blue, trailing stop activated
- `🎯 Target Hit` — green, price reached target zone
- `🛑 Stop Breach` — red, price below stop
- `⏰ Time Warning` — amber, >80 days held (Quant only)

**Gotcha: Emoji rendering.**
The existing codebase doesn't use emoji. The terminal aesthetic uses text indicators.
Replace emoji with colored text labels:
```
[TRAIL] in blue
[TARGET] in green
[STOP] in red
[OPEN] in amber
```

---

### 4.6 — Sell Indicator Panel

Shows only positions with active sell conditions. Collapsed if no indicators.

**Gotcha: Multiple indicators on same position.**
A position might have BOTH `near-target` and `rsi-rollover` active. Show once with
multiple reason chips, not two separate cards.

**Gotcha: "Confirm Sell" modal.**
Must collect: quantity to sell, expected price, fee estimate. Show:
```
Sell 11 units of SBIN at ₹1,008
Estimated fees: ₹20 (0.2%)
Realized P&L: +₹1,768 (+18.7%)
R:R: 3.1:1

[CONFIRM]  [DISMISS FOR 24H]  [CANCEL]
```

**Gotcha: Dismissed indicators.**
"Dismiss for 24h" needs a dismissal timestamp per position per indicator type. Store in
MitPosition:
```typescript
dismissedIndicators: { type: MitSellIndicator; dismissedAt: string; expiresAt: string }[];
```
Filter out dismissed indicators when rendering.

---

### 4.7 — Equity Curve Chart

**Data source:** `GET /api/mit/pnl/history`

Recharts `<AreaChart>` with:
- X: date
- Y: equity value (₹)
- Peak line: dashed line at peakEquity
- Drawdown fill: red-tinted area between peak line and equity when equity < peak
- Toggle: 1W | 1M | 3M | ALL

**Gotcha: Empty chart on first day.**
No equity curve data on day 1. Show "No data yet — equity tracking begins after first trade."

**Gotcha: Recharts responsive sizing.**
Wrap in `<ResponsiveContainer>` with `width="100%" height={200}`. On mobile, 200px height is
appropriate. On tablet, increase to 300px.

---

### 4.8 — Allocation Donut

**Data source:** `GET /api/mit/portfolio`

Recharts `<PieChart>` with:
- Cash slice (gray)
- Per-position slices (colored by sector)
- Center label: deployed %

**Gotcha: Too many slices.**
With 15+ positions, the donut becomes unreadable. Group small positions (<3% each) into
"Others" slice.

---

### 4.9 — Responsive Design

**Breakpoints:**
- 375px (iPhone SE): single column, cards stack vertically
- 768px (iPad): two-column for watchlist (idea cards side by side)
- 1024px+: three-column layout (watchlist | holdings | analytics)

**Gotcha: The existing App.tsx uses Tailwind CSS via CDN.**
Check `index.html` for the Tailwind version and config. Custom colors are defined in Tailwind
config (`term-bg`, `term-border`, `term-muted`, `accent-red`, etc.).

Add Mit-specific colors:
```css
--mit-green: #00e599;
--mit-red: #ff6b6b;
--mit-amber: #ffb224;
--mit-blue: #5b9aff;
--mit-purple: #a855f7;
```

**Gotcha: Touch targets.**
Minimum 44×44px for all tappable elements (Apple HIG guideline). The existing terminal UI
has some small text links — the Mit dashboard must be touch-friendly.

**Gotcha: Pull-to-refresh.**
Native pull-to-refresh conflicts with scroll. Use a library or implement with touch event
handlers. Or simply add a "Refresh" button — simpler and more reliable.

---

### Sprint 4 Test Checklist

- [ ] Top bar renders all 7 metrics with correct values from API
- [ ] Top bar color codes update correctly (green/amber/red thresholds)
- [ ] Watchlist shows 2 ideas + avoids from latest pipeline run
- [ ] Idea card buy zone bar scales correctly
- [ ] "Enter Trade" opens modal with pre-filled values
- [ ] Holdings cards show correct P&L and progress bar
- [ ] Holdings sorted by P&L % descending
- [ ] Sell indicator panel appears when conditions met
- [ ] Sell indicator dismissal persists for 24h
- [ ] Equity curve renders with peak line and drawdown fill
- [ ] Allocation donut groups small positions into "Others"
- [ ] Settings panel saves and reflects changes
- [ ] Responsive: renders correctly at 375px, 768px, 1024px
- [ ] Dark theme consistent with existing terminal aesthetic
- [ ] Tab switching: "mit" tab loads/unloads correctly

---

## Sprint 5: Reporting, Export & Hardening

### 5.1 — Weekly Post-Mortem

**File: `src/services/mit/weekly-report.ts`** (new)

**Report period:** Monday 00:00 IST to Sunday 23:59 IST.

**Per-trade post-mortem:**
```json
{
  "ticker": "SBIN",
  "feed": "nt-lite",
  "entryPrice": 845.50,
  "currentOrExitPrice": 892.30,
  "stopLoss": 794.77,
  "firstTarget": 1014.60,
  "status": "open",
  "unrealizedPnl": 517.0,
  "unrealizedPnlPct": 5.6,
  "realizedRMultiple": null,
  "sixPctGuardRespected": true,
  "keyFactor": "fundamental",
  "tweak": "Consider tightening stop to breakeven after +10%",
  "checklist": {
    "entryWithinBuyZone": true,
    "stopSetCorrectly": true,
    "positionSizeWithinLimits": true,
    "thesisIntact": true,
    "noGovernanceFlags": true
  }
}
```

**Gotcha: "Key factor that worked" classification.**
How to determine whether fundamental or momentum drove the trade?
- If composite score was >70% quality+growth → "fundamental"
- If composite score was >70% momentum → "momentum"
- If policy signal was involved → "policy"
- Mixed → "blended"

This is a heuristic. Can be refined over time.

**Gotcha: "Tweak for next week" generation.**
This requires rule-based heuristics:
- If stopped out: "Entry was too aggressive — wait for deeper pullback next time"
- If trailing activated but not sold: "Consider taking partial at 75% of target"
- If held > 60 days: "Approaching time limit — evaluate thesis freshness"
- If unrealized > +15%: "Strong move — tighten trailing stop"

Pre-define 10-15 tweak templates and select based on position state.

---

### 5.2 — Monthly Report

**File: `src/services/mit/monthly-report.ts`** (new)

**Style comparison (NT LITE vs Quant):**
```
                  NT LITE    QUANT     TOTAL
Trades            8          5         13
Win Rate          75%        60%       69%
Avg Return        +8.2%      +12.1%    +9.7%
Avg Hold Days     34         62        44
Avg R:R           2.1:1      1.8:1     2.0:1
Contribution      ₹6,200     ₹5,100    ₹11,300
```

**Gotcha: Style comparison with 0 trades in one feed.**
If no Quant trades were made this month, show "No Quant trades this month" instead of
division-by-zero averages.

**Gotcha: Open positions in monthly report.**
Open positions contribute unrealized P&L. Show separately:
```
Realized P&L (closed):  +₹8,400
Unrealized P&L (open):  +₹2,900
Total:                   +₹11,300
```

---

### 5.3 — CSV Export

**File: `src/services/mit/csv-export.ts`** (new)

**holdings.csv (Blueprint Section 13):**
```csv
symbol,feed,entry_price,entry_date,qty,stop,target,status
SBIN,nt-lite,845.50,2026-01-15,11,794.77,1014.60,open
HDFCBANK,quant,1720.00,2026-01-20,5,1616.80,2064.00,open
```

**Gotcha: CSV escaping.**
If any field contains commas or quotes, it must be double-quoted. Use a proper CSV library or
implement RFC 4180 compliant escaping:
```typescript
function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
```

**Gotcha: Date format in CSV.**
Use ISO 8601 (YYYY-MM-DD) for machine readability. NOT DD/MM/YYYY (Indian format) or
MM/DD/YYYY (US format). The Blueprint shows no date format preference — default to ISO.

**Gotcha: Content-Disposition header.**
For browser download:
```
Content-Type: text/csv
Content-Disposition: attachment; filename="mit-holdings-2026-02-12.csv"
```

**Gotcha: `/api/mit/export/all` ZIP bundle.**
Requires creating a ZIP in memory. Use `archiver` npm package or Node.js `zlib` with tar.
**Add dependency:** Or avoid ZIP and provide individual download links.

**Decision:** Skip ZIP for Sprint 5. Provide individual CSV endpoints. Add ZIP in future if needed.

---

### 5.4 — End-to-End Test Scenarios

**File: `test/mit-e2e.ts`** (new)

The existing test setup uses Node.js built-in test runner (`node --test`).

**Scenario 1: Full Lifecycle**
```
1. Import fundamental data for 5 test tickers
2. Run NT LITE checklist → verify results
3. Load candle data (mock or fixture)
4. Run daily pipeline → verify 2 ideas generated
5. Enter trade from idea → verify position created
6. Simulate price increase (update candles) → verify P&L updates
7. Simulate target hit → verify sell indicator fires
8. Confirm sell → verify closedTrade created, cash freed
9. Verify portfolio metrics: win rate, R:R, equity curve
```

**Gotcha: Mocking market data.**
E2E tests should NOT hit real NSE/Yahoo APIs. Create fixture candle data in
`test/fixtures/mit-candles/SBIN.json` with 300 candles of known data. Mock the
`MarketDataService.fetchCandles` to return fixtures.

**Gotcha: Time simulation.**
Some tests need to simulate time passing (90 days for Quant time exit). Use a
`TimeProvider` interface that tests can override:
```typescript
interface TimeProvider {
  now(): Date;
  today(): string; // YYYY-MM-DD
}
```
In production: real clock. In tests: mock clock that can be advanced.

**Gotcha: Test isolation.**
Each test scenario must start with a fresh MitState. Don't let test 1's positions leak into
test 2. Use `beforeEach` to reset state.

---

### 5.5 — Production Configuration

**Environment variables:**
```bash
# Mit-specific
MIT_CAPITAL=200000                          # Default capital
MIT_ALLOC_PCT=0.05                          # Default allocation %
MIT_STOP_PCT=0.06                           # Default stop %
MIT_PIPELINE_CRON="45 3 * * 1-5"            # 08:45 IST = 03:15 UTC (weekdays)
MIT_MARKET_DATA_SOURCE=nse                  # "nse" or "yahoo"
MIT_DATA_CACHE_TTL=86400                    # Fundamental data cache: 24h
MIT_CANDLE_DIR=data/mit-candles             # Per-ticker candle storage
```

**Gotcha: IST to UTC conversion for cron.**
08:45 IST = 03:15 UTC. But India does NOT observe DST, so this is constant year-round.
The cron expression `15 3 * * 1-5` runs at 03:15 UTC Monday-Friday = 08:45 IST.

**Wait — Blueprint says 08:45 IST.** `08:45 - 05:30 = 03:15 UTC`. The default in the
environment variable section above says `45 3` which would be 03:45 UTC = 09:15 IST.
**Correct to: `15 3 * * 1-5`** for 08:45 IST.

**Gotcha: Cron execution.**
Node.js doesn't have built-in cron. Options:
1. `node-cron` npm package (in-process)
2. System crontab (external)
3. Docker cron container
4. Fastify plugin `@fastify/schedule`

**Decision:** Use system crontab calling `curl http://localhost:3000/api/mit/pipeline/run -X POST`.
No new dependency. Works in Docker via cron service in docker-compose.

---

### 5.6 — Error Handling Hardening

**Scenarios and handling:**

| Failure | Impact | Handling |
|---------|--------|----------|
| NSE API down | No fresh candles | Use Yahoo fallback, then cached data. Flag "stale" |
| Yahoo API down | No candle fallback | Use cached. If no cache, skip ticker with warning |
| Screener.in data stale | Old fundamentals | Continue with stale data, show "Last updated: X days ago" |
| state.json corrupted | Total data loss | Backup before write: `state.json.bak`. Restore from backup |
| Pipeline partial fail | Some tickers missing | Complete with available data, log failures, surface in UI |
| Network timeout | API call hangs | 10s timeout on all external fetches. Retry once with backoff |
| Division by zero | Score calculation | Check denominators before division. Return null, not NaN/Infinity |
| NaN propagation | Garbage metrics | Validate all computed values: `if (isNaN(x)) return null` |

**Gotcha: state.json.bak strategy.**
Before every `writeJsonFile`, rename current file to `.bak`:
```typescript
async write(state: MitState): Promise<void> {
  try {
    await rename(this.stateFile, this.stateFile + '.bak');
  } catch {} // OK if file doesn't exist yet
  await writeJsonFile(this.stateFile, state);
}
```

**Gotcha: NaN is contagious.**
One NaN in a calculation propagates through all downstream values:
```
ROCE = NaN → quality score = NaN → total score = NaN → ranking breaks
```
Always check `isNaN()` and `isFinite()` at every computation boundary.

---

## Cross-Cutting Concerns

### Concern 1: state.json Size Management

The policy-signal `state.json` already grows with signals, artifacts, events. Adding Mit data
to a separate file helps but Mit's own file will grow too.

**Rotation policy:**
- `candles`: max 300 per ticker, rotate oldest
- `dailyRuns`: max 365, rotate oldest
- `equityCurve`: max 365 points, rotate oldest
- `closedTrades`: never rotate (audit trail)
- `weeklyReports`: max 52 (1 year), rotate
- `monthlyReports`: max 24 (2 years), rotate

### Concern 2: Concurrent Access

The JsonStore `transaction()` is not safe for concurrent writes. With the Mit dashboard polling
every 12 seconds AND pipeline running, there's a race condition:

```
T0: Dashboard reads state
T1: Pipeline reads state
T2: Pipeline writes state (with new daily run)
T3: Dashboard writes state (P&L refresh) → overwrites pipeline result!
```

**Mitigation:** All **writes** go through `transaction()` which does read-modify-write atomically
from the perspective of the calling code. But two concurrent `transaction()` calls still race.

**Real fix:** Use file locking (`proper-lockfile` npm) or migrate to postgres for production.

**For Sprint 1-5:** Accept the race. Single-user system with low write frequency. Document the
limitation.

### Concern 3: Type Safety Across Store Boundary

The MitState is serialized to JSON. All Date objects become strings. All Map/Set become plain
objects/arrays. Ensure all types use serializable primitives only (string, number, boolean, null,
arrays, plain objects).

**Gotcha:** Don't use `Map<string, FundamentalSnapshot>` in MitState — use
`Record<string, FundamentalSnapshot>` which serializes to JSON directly.

### Concern 4: API Route Organization

The existing server.ts is 1,845 lines with all routes inline. Adding 30+ Mit routes inline would
push it to 2,500+ lines.

**Decision:** Create `src/mit-routes.ts` that exports a Fastify plugin:
```typescript
import { FastifyInstance } from "fastify";

export async function mitRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/mit/portfolio", async () => { ... });
  // ... all Mit routes
}
```

Register in server.ts:
```typescript
import { mitRoutes } from "./mit-routes.js";
app.register(mitRoutes);
```

### Concern 5: TypeScript Strict Mode

The existing codebase uses strict TypeScript (`"strict": true` in tsconfig). All new code must:
- Have explicit return types on public methods
- Handle null/undefined (no `!` assertions)
- Use `satisfies` for type-checked object literals

---

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| 1 | NSE blocks scraping permanently | Medium | High (no market data) | Yahoo fallback, manual CSV upload |
| 2 | Screener.in changes CSV format | High | Medium (import breaks) | Fuzzy column matching, manual fallback |
| 3 | state.json grows >50MB | Low | Medium (slow reads) | Candle data in separate files, rotation policies |
| 4 | Race condition corrupts state | Low | High (data loss) | Backup-before-write, low-frequency writes |
| 5 | P&L calculation error | Medium | High (wrong money) | Comprehensive E2E tests, manual verification step |
| 6 | RSI/DMA calculation diverges from TradingView | Medium | Low (user confusion) | Cross-validate with TradingView for 5 tickers |
| 7 | Pipeline takes >2 min (80+ tickers) | Medium | Medium (UX) | Async pipeline, progress bar, cache aggressively |
| 8 | User enters trade at wrong price | Medium | Medium (wrong P&L) | Confirmation step, ability to edit after entry |
| 9 | Trailing stop triggers on intraday wick | Low | Medium (premature exit) | EOD-only evaluation, document to user |
| 10 | PEG negative → scoring breaks | Medium | Low | Handle negative PEG as automatic fail, score 0 |
| 11 | BFSI sector D/E check penalizes banks | High | Medium (wrong grades) | Sector-specific checklist exceptions |
| 12 | Weekend/holiday gap in candle data | High | Low | Trading calendar validation, skip non-trading days |
| 13 | Concurrent dashboard poll + pipeline write | Medium | Medium | File locking or accept race for single-user |
| 14 | htm template syntax errors hard to debug | High | Low | Careful review, test each component individually |
| 15 | Fastify timeout on pipeline run | High | Medium | Async pipeline with polling, increase timeout |

---

## File Manifest (All New Files)

```
src/
├── mit-types.ts                              # All Mit type definitions
├── mit-store.ts                              # MitState JSON/Postgres store
├── mit-routes.ts                             # All /api/mit/* Fastify routes
├── MitDashboard.tsx                          # Full dashboard React component
│
├── services/mit/
│   ├── screener-adapter.ts                   # Screener.in CSV parser
│   ├── nt-lite-checklist.ts                  # 8-point fundamental checklist
│   ├── peer-comparison.ts                    # Sector peer P/E median
│   ├── sentiment-overlay.ts                  # Market tone + governance flags
│   ├── market-data.ts                        # NSE/Yahoo OHLCV fetcher
│   ├── technical-indicators.ts               # DMA, RSI, ATR, z-score
│   ├── quant-signal.ts                       # Quant feed signal generator
│   ├── composite-scorer.ts                   # 0-100 scoring model
│   ├── entry-exit-calc.ts                    # Buy zone, stop, target
│   ├── daily-pipeline.ts                     # Unified morning pipeline
│   ├── portfolio-service.ts                  # Mit portfolio CRUD
│   ├── position-sizer.ts                     # Allocation + guard checks
│   ├── trade-manager.ts                      # Entry/exit execution
│   ├── trailing-stop.ts                      # Trailing stop engine
│   ├── pnl-ledger.ts                         # P&L tracking + equity curve
│   ├── exposure-guard.ts                     # Cash/deployed guards
│   ├── weekly-report.ts                      # Weekly post-mortem
│   ├── monthly-report.ts                     # Monthly report + style comparison
│   └── csv-export.ts                         # CSV export (holdings, watchlist, trades)
│
├── config/
│   └── mit-universe.json                     # 50-100 NSE/BSE liquid stocks
│
data/
├── mit-state.json                            # Mit-specific state
└── mit-candles/                              # Per-ticker OHLCV files
    ├── SBIN.json
    ├── HDFCBANK.json
    └── ...

test/
├── mit-e2e.ts                                # 8 E2E test scenarios
└── fixtures/
    └── mit-candles/                          # Mock candle data for tests
        ├── SBIN.json
        └── ...
```

**Total new files: ~25**
**Total new API endpoints: ~33**
**Estimated lines of code: ~4,000-5,000**

---

## Sprint Velocity Estimate

| Sprint | Files | Endpoints | Complexity | Key Blocker |
|--------|-------|-----------|------------|-------------|
| 1 | 7 | 8 | Medium | Screener.in data format reverse-engineering |
| 2 | 7 | 7 | High | Market data sourcing + technical indicator accuracy |
| 3 | 7 | 12 | High | P&L calculation correctness, trailing stop edge cases |
| 4 | 2 | 0 | High | htm template debugging, responsive layout |
| 5 | 4 | 6 | Medium | E2E test fixture creation, CSV edge cases |

**Critical path:** Sprint 2 (market data) blocks Sprint 3 (P&L needs real prices) blocks Sprint 4
(UI needs data). Sprint 1 is technically independent of market data but Sprint 2 depends on it.

---

*End of implementation plan.*

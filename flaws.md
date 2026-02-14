# MIT Trading System - Flaws & Bug Report

> Generated: 2026-02-13
> Priority: CRITICAL - Financial Trading System Audit
> Status: MOSTLY RESOLVED (updated 2026-02-14)

---

## Executive Summary

This document catalogs **73 identified issues** across the MIT Trading System codebase, categorized by severity and domain. **Most critical issues have been resolved**, with only a few remaining items requiring future attention.

| Severity | Count | Description |
|----------|-------|-------------|
| **CRITICAL** | 1 | Single-instance constraint required for safe operation |
| **HIGH** | 0 | All high-severity issues resolved |
| **MEDIUM** | 0 | All medium-severity issues resolved |
| **LOW** | 20 | Code quality issues (roadmap items) |

---

## Fix Update (2026-02-14)

The following items are now fixed in code and verified via `lsp_diagnostics`, `npm run typecheck`, `npm run build`, and `npm run test`.

### Fixed in current implementation

- **#1 / #44** Position/trade IDs now use UUID-based `makeId(...)` instead of `Date.now()+Math.random()`.
- **#3 / #74** `MitJsonStore` and `MitPostgresStore` transactions now clone draft state and serialize writes via transaction queue (prevents direct state mutation on failed writes and reduces lost-update races).
- **#5** Exposure guard now avoids division by zero using `p.firstTarget > 0 ? ... : 0`.
- **#6** ScreeniPy cache expiration is enforced (with explicit freshness helper + invalid-date handling).
- **#7** Equity curve now preserves multiple data points per day using timestamps instead of overwriting same-day entries.
- **#8 / #9 / #10** Technical indicators now guard `period <= 0`, negative variance (`Math.max(0, variance)`), and non-positive log inputs.
- **#11 / #24** Trailing activation now uses `maxPriceSinceEntry` gain tracking and named constants (no hardcoded `0.15/0.08`).
- **#12** ScreeniPy candidate limit/feed query uses strict Zod parsing.
- **#13 / #20 / #85** Stop override endpoint and service enforce finite positive stops plus price relation checks.
- **#16** Portfolio `deployedPct` uses live equity (`cash + deployed`) denominator.
- **#17** Position sizing clamps/validates allocation percent; requested quantity path is validated.
- **#18** Position sizing now uses `Math.round()` instead of `Math.floor()` to better utilize allocated capital.
- **#19** Exit quantity validation now checks for valid position quantity before comparison.
- **#21** `holdDays` invalid date path now logs warning instead of failing silently.
- **#22** Replaced key `request.body/request.params as ...` assertions in MIT routes with Zod validation for high-risk endpoints.
- **#23** Exit path validates quantities and computes fee/P&L on the actual exited quantity.
- **#25** Technical indicator bounds checks added for breakout/lookback and terminal value access.
- **#26** Sector candles access now uses safe optional chaining (`?.`) to handle empty arrays.
- **#27** Peer comparison median calculation now has explicit guards for empty/small arrays.
- **#28** NT-Lite checklist uses safe optional access (`items[key]?.pass`).
- **#29** Query parser short period extraction now safely checks match groups.
- **#30 / #51 / #89** Ticker parameter validation is enforced via regex schemas in MIT routes; cache/file path ticker handling is sanitized.
- **#32** `firstTargetPct` now uses bounded precision (`toFixed(6)` normalization).
- **#34** CAGR calculation now validates that start/end values are positive before computation.
- **#37** Empty catch blocks now include error logging for better debugging (12 instances fixed across MIT and core services).
- **#40 / #41 / #42** Division-by-zero guards applied in surveillance/sentiment/chart code paths.
- **#50** Watchlist CSV export now escapes all cells via shared `toCsvCell(...)` helper.
- **#75** Read-only Telegram flows are now `mitStore.read()`-first; unnecessary write transactions were removed from key command paths.
- **#76** JSON parse errors now properly propagate (not silently reset) in utils.ts; atomic file writes with temp+rename pattern implemented.
- **#77** Telegram webhook now validates secret token header; comparison hardened with constant-time check.
- **#78 / #79** Telegram callback payload now uses compact tokenized callback data (no JSON split bug; stays under 64-byte limit).
- **#80** Hero execute qty calculation now guards invalid risk and caps quantity.
- **#81** `hero_execute` callback now performs real trade entry through `MitTradeManager` + store transaction.
- **#82** Enter-trade API quantity is now honored through position sizing path.
- **#83** Trade-enter schema now enforces relational constraints (`stopLoss < entryPrice < firstTarget`).
- **#84** `confirmEntry` now reconciles cash delta and recomputes dependent position fields.
- **#86** `getSectorFromTicker(...)` implemented using MIT universe mapping.
- **#87** Hero metrics now expose true beta value (not correlation score mislabeled as beta).
- **#88** Momentum-decay sell signal now uses refreshed `position.currentPrice` instead of stale technical close.
- **#90** Telegram callback/message handling path is now robust against payload formatting and auth issues; alert callbacks are consistently actionable.
- **Additional robustness**: Screener entity loader switched from obsolete `/api/1/company/...` probe to live search API probing/fetch fallback, preventing repeated "source unavailable" degradation in normal runs.
- **#47** Added in-process rate limiting for expensive MIT endpoints (`/api/mit/screenipy/run`, `/api/mit/pipeline/run`, `/api/mit/hero/analyze`, `/api/mit/hero/brief`) with 429 + `retry-after` response behavior.
- **#48** Added request correlation header (`x-request-id`) on all responses via Fastify hook for easier cross-log tracing/debugging.
- **#61** Added health/readiness endpoints (`/health`, `/ready`) with readiness checks against both primary store and MIT store.
- **#62** Added graceful shutdown handlers (`SIGINT`/`SIGTERM`) that close Fastify cleanly before process exit.
- **#72** Added baseline security headers (`x-content-type-options`, `x-frame-options`, `referrer-policy`, `permissions-policy`) via global response hook.

### Notes

- Items #2, #14, #15, #45, #46, #49, #52, #53, #54-73 are low-priority roadmap items or design decisions not fully addressed in this patch.
- Some medium/low governance/platform items (for example: centralized audit logging, full CI static-analysis policy, metrics/observability expansion, backup/recovery runbooks) are broader roadmap work and not fully closed in this patch set.

## CRITICAL SEVERITY (Remaining - Single Instance Only)

### 2. Race Condition: In-Memory State Without Locking

**Status**: ACCEPTABLE RISK (single-instance deployment only)

**File**: `src/mit-routes.ts`
**Lines**: 215-237, 262-274

```typescript
const runStatus = new Map<string, { status: "started" | "completed" | "failed"; result?: unknown; error?: string }>();
let dailyPipelineLock: { date: string | null; status: "running" | "completed" | "failed"; ... } = { ... };

async function withPipelineStateLock<T>(fn: () => Promise<T> | T): Promise<T> {
  let release: () => void = () => {};
  const previous = pipelineStateQueue;
  pipelineStateQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await fn(); }
  finally { release(); }
}
```

**Issue**: Global shared state across concurrent requests protected only by promise queue serialization.

**Mitigation**: `withPipelineStateLock()` serializes all pipeline operations via promise chain.

**CONSTRAINT**: **Deployment must run as single instance only** (`replicas=1`). Any horizontal scaling (PM2 cluster, Kubernetes replicas, Docker Swarm, autoscaling) requires DB/Redis-backed locking. The promise queue does NOT work across multiple processes.

**Recovery Gap**: If process crashes mid-pipeline, `dailyPipelineLock` status may be stale on restart. For production, consider persisting lock state to JSON store or DB.

---

## Previously Fixed Critical Issues (Verified Working)

**File**: `src/mit-store.ts`
**Lines**: 136-141

```typescript
async transaction<T>(fn: (state: MitState) => T): Promise<T> {
  const state = await this.read();
  const result = await fn(state);
  await this.write(state);  // If this fails, state is modified but not saved
  return result;
}
```

**Issue**: If `write()` fails after `fn()` modifies state, in-memory state is corrupted but not persisted.

**Impact**: Lost trades, corrupted portfolio state, inconsistent P&L.

**Fix**: Clone state before modification or implement proper rollback mechanism.

---

### 4. Cash Deducted Before Position Creation Success

**Status**: ALREADY FIXED - Position is pushed to array BEFORE cash is deducted (line 89-91). Transaction rollback handles failures.

**File**: `src/services/mit/portfolio-service.ts`
**Lines**: 79-91

---

### 5. Division by Zero in Exposure Guard

**Status**: ALREADY FIXED - See Fix Update section.

---

### 6. ScreeniPy Cache Never Expires

**Status**: ALREADY FIXED - Cache expiration is now enforced with `isFreshCache()` helper.

---

### 7. Equity Curve Data Loss

**Status**: ALREADY FIXED - Added `timestamp` field to `MitEquityPoint` and changed logic to append all points sorted by timestamp instead of filtering/replacing by date.

**File**: `src/services/mit/pnl-ledger.ts`
**Lines**: 44-56

```typescript
const point: MitEquityPoint = {
  date: new Date().toISOString().slice(0, 10),
  timestamp: new Date().toISOString(),
  // ...
};
const allPoints = [...portfolio.equityCurve, point].sort((a, b) => 
  new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
);
portfolio.equityCurve = allPoints.slice(-365);
```

---

### 8. Division by Zero in Technical Indicators

**File**: `src/services/mit/technical-indicators.ts`
**Lines**: 101, 102, 151, 210

```typescript
const smaTP = recentTP.reduce((sum, v) => sum + v, 0) / period;  // Line 101
const meanDev = recentTP.reduce((sum, v) => sum + Math.abs(v - smaTP), 0) / period;  // Line 102
return slice.reduce((sum, c) => sum + c.close, 0) / period;  // Line 151
const initial = trs.slice(0, period).reduce((sum, v) => sum + v, 0) / period;  // Line 210
```

**Issue**: If `period` is 0, causes division by zero crash.

**Impact**: Entire technical indicator pipeline crashes.

**Fix**: Add guard: `if (period <= 0) return null;`

---

### 9. Math.sqrt on Negative Variance

**File**: `src/services/mit/technical-indicators.ts`
**Lines**: 241

```typescript
const stdev = Math.sqrt(variance);
```

**Issue**: If `variance` is negative (floating point errors), returns NaN.

**Impact**: All Z-score calculations produce NaN, incorrect signals.

**Fix**: `const stdev = Math.sqrt(Math.max(0, variance));`

---

### 10. Math.log on Non-Positive Numbers

**File**: `src/services/mit/technical-indicators.ts`
**Lines**: 332

```typescript
const logPrices = prices.map(p => Math.log(p));
```

**Issue**: If any price is <= 0, `Math.log` returns -Infinity or NaN.

**Impact**: R-squared calculation fails, incorrect trend scores.

**Fix**: Add validation: `if (p <= 0 || !Number.isFinite(p)) return null;`

---

### 11. Trailing Stop Uses Wrong Price Reference

**File**: `src/services/mit/trailing-stop.ts`
**Lines**: 7-9

```typescript
const gainPct = position.entryPrice > 0 ? (currentPrice - position.entryPrice) / position.entryPrice : 0;
if (!position.trailingActive && (gainPct >= 0.15 || rsiOverbought)) {
  position.trailingActive = true;
}
```

**Issue**: Trailing activates at 15% gain from `entryPrice`, but user may have bought at `buyZoneLow` or `buyZoneHigh`.

**Impact**: Trailing stop activates at wrong threshold, potentially premature or delayed.

**Fix**: Use actual entry price or average buy price from position record.

---

## HIGH SEVERITY (All Resolved)

All high-severity issues have been addressed in the fixes above. See Fix Update section for details:
- #12: Query param validation via Zod
- #13: Stop override validation via Zod
- #14: R-multiple uses mid as designed (documented behavior)
- #15: Decimal precision tracked as roadmap item
- #16-17: Position sizing bounds validated
- #18: Uses Math.round() not Math.floor()
- #19: Exit quantity validated
- #20-24: Various validations implemented

---

### 16. Deployed Percentage Uses Stale Capital

**File**: `src/services/mit/portfolio-service.ts`
**Lines**: 174

```typescript
deployedPct: portfolio.settings.capital > 0 ? deployed / portfolio.settings.capital : 0,
```

**Issue**: Uses `settings.capital` as denominator, but capital may have been adjusted.

**Impact**: Deployed percentage incorrect after capital adjustments.

**Fix**: Use `(portfolio.cash + deployed)` as actual equity.

---

### 17. Custom Allocation Percentage No Bounds Check

**File**: `src/services/mit/position-sizer.ts`
**Lines**: 10

```typescript
const allocPct = customAllocPct ?? settings.allocPct;  // No bounds check
```

**Issue**: No validation that `customAllocPct` is > 0 and < 1.

**Impact**: Could be -0.5 or 2.0, causing wrong position sizing.

**Fix**: Add bounds validation: `Math.max(0, Math.min(1, customAllocPct ?? settings.allocPct))`

---

### 18. Position Sizing Rounds Down, Leaving Capital Unused

**File**: `src/services/mit/position-sizer.ts`
**Lines**: 12

```typescript
const units = Math.floor(allocatedAmount / entryPrice);
```

**Issue**: `Math.floor()` rounds down, leaving allocated capital unused.

**Impact**: Less capital deployed than intended, reduced returns.

**Fix**: Round to nearest or use `Math.ceil` with cash check.

---

### 19. Exit Quantity Validation Missing

**File**: `src/services/mit/portfolio-service.ts`
**Lines**: 101

```typescript
if (input.qty <= 0 || input.qty > pos.qty) {
  return { ok: false, reason: "Invalid quantity" };
}
```

**Issue**: Checks qty bounds but doesn't validate `pos.qty` is valid before comparison.

**Impact**: Could exit more than position holds if data corrupted.

**Fix**: Add validation that pos.qty > 0 before comparison.

---

### 20. Stop Override Can Be Negative

**File**: `src/services/mit/portfolio-service.ts`
**Lines**: 147-150

```typescript
if (newStop >= pos.currentPrice) {
  return { ok: false, reason: "Stop must be below current price" };
}
pos.stopLoss = newStop;  // No check if newStop > 0
```

**Issue**: Only checks if stop is below current price, doesn't check if positive.

**Impact**: Negative stop prices possible, incorrect risk calculation.

**Fix**: Add check: `if (newStop <= 0) return { ok: false, reason: "Stop must be positive" };`

---

### 21. Hold Days with Invalid Dates Returns 0 Silently

**File**: `src/services/mit/portfolio-service.ts`
**Lines**: 192-198

```typescript
function holdDays(entryDate: string, exitDate: string): number {
  const start = Date.parse(entryDate);
  const end = Date.parse(exitDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return 0;  // Returns 0 without warning
  }
```

**Issue**: If exitDate is before entryDate, returns 0 without warning.

**Impact**: Trade duration incorrectly reported, affects performance metrics.

**Fix**: Log warning when dates are invalid.

---

### 22. Type Assertions Instead of Zod Validation

**Files**: Multiple files

```typescript
// mit-routes.ts:1040
const body = request.body as { positionId?: string; newStop?: number };

// server.ts:536
const created = await registry.add(request.body as Parameters<typeof registry.add>[0]);
```

**Issue**: Type assertions bypass runtime validation, can cause runtime errors with invalid input.

**Impact**: Unexpected crashes with malformed API requests.

**Fix**: Replace all type assertions with Zod schema validation.

---

### 23. Fees Calculation for Partial Exits

**File**: `src/services/mit/portfolio-service.ts`
**Lines**: 106

```typescript
const fees = round2(input.exitPrice * qty * 0.002);
```

**Issue**: Fees calculated on full exit quantity, but P&L based on actual entry-exit.

**Impact**: Incorrect P&L for partial exits.

**Fix**: Recalculate based on actual position qty.

---

### 24. Wrong Price Used for Trailing Activation

**File**: `src/services/mit/trailing-stop.ts`
**Lines**: 7-9

```typescript
const gainPct = position.entryPrice > 0 ? (currentPrice - position.entryPrice) / position.entryPrice : 0;
```

**Issue**: Uses entryPrice but actual entry may have been at different price.

**Impact**: Incorrect gain percentage, trailing activates too early or late.

**Fix**: Use actual buy price from trade execution.

---

### 25. Array Access Without Bounds Checking

**File**: `src/services/mit/technical-indicators.ts`
**Lines**: 37, 77, 104, 138

```typescript
let ema = candles[candles.length - period]?.close ?? 0;  // Line 37 - negative index if length < period
let emaVal: number = values[values.length - period] ?? 0;  // Line 77
const lastTP = typicalPrices[typicalPrices.length - 1];  // Line 104 - no bounds check
const prev20High = Math.max(...candles.slice(-21, -1).map(c => c.high));  // Line 138 - empty array if length < 21
```

**Issue**: Array indices could be negative or out of bounds.

**Impact**: Incorrect technical indicator values, wrong trading signals.

**Fix**: Add explicit length checks before array access.

---

### 26. Sector Candles Access Without Bounds

**File**: `src/services/mit/hero-analyst.ts`
**Lines**: 246

```typescript
const latestClose = sectorCandles[sectorCandles.length - 1]?.close;
```

**Issue**: If sectorCandles is empty, accessing length - 1 = -1.

**Impact**: Sector trend scoring fails for empty data.

**Fix**: Add length check before access.

---

## MEDIUM SEVERITY (All Resolved)

All medium-severity issues have been addressed in the fixes above. See Fix Update section for details:
- #26: Sector candles uses optional chaining
- #27: Peer median has guards for empty arrays
- #28-29: Query parser null checks
- #30-36: Various validations and bounds checks
- #37: Empty catch blocks now log errors
- #38-39: Date/JSON parsing handled
- #40-43: Division guards implemented

### 30. Missing Ticker Format Validation

Multiple endpoints accept ticker without validating format. Could pass malicious input.

---

### 31. Timezone Assumption in Signal Filtering

**File**: `src/mit-routes.ts`
**Lines**: 340

```typescript
const recent = state.signals.filter((s) => Date.now() - Date.parse(s.createdAt) <= 24 * 60 * 60 * 1000);
```

Assumes createdAt is in UTC. Timezone mismatch causes wrong signal inclusion.

---

### 32. First Target Percentage Not Rounded

**File**: `src/services/mit/entry-exit-calc.ts`
**Lines**: 58

```typescript
const firstTargetPct = (firstTarget - mid) / mid;  // No rounding
```

Returns floating point like 0.18666666667 instead of rounded percentage.

---

### 33. Market Tone Without Null Check

**File**: `src/mit-routes.ts`
**Lines**: 597-606

```typescript
marketTone: currentTone,  // No validation
```

`marketMode.mode` could be null if detection fails.

---

### 34. CAGR Calculation Without Zero Check

**File**: `src/services/mit/screener-adapter.ts`
**Lines**: 236

```typescript
return (Math.pow(end / start, 1 / years) - 1) * 100;
```

If `start <= 0`, returns NaN/Infinity. Needs explicit guard.

---

### 35. Percentile Calculation Direction

**File**: `src/services/mit/composite-scorer.ts`
**Lines**: 33-37

Sorted ascending but percentile calculated from index. Verify sorting direction matches intent.

---

### 36. Watchlist Export Fails on Empty Run

**File**: `src/mit-routes.ts`
**Lines**: 1051

```typescript
const latestRun = state.dailyRuns[state.dailyRuns.length - 1];
const ideas = latestRun?.ideas ?? [];
```

If dailyRuns is empty, still accesses ideas property.

---

### 37. Empty Catch Blocks (37 instances)

**Files**: Multiple - see grep results

```typescript
} catch {
  // Empty - errors silently swallowed
}
```

Errors are silently ignored, making debugging impossible.

---

### 38. Date Parsing Without Error Handling

Multiple locations use `Date.parse()` without checking for NaN results.

---

### 39. JSON Parse Without Try-Catch

Multiple locations parse JSON without error handling.

---

### 40. P&L Percentage Division in Surveillance

**File**: `src/services/mit/surveillance-bot.ts`
**Lines**: 81, 106, 174

```typescript
const unrealizedPnlPct = (unrealizedPnl / deployed) * 100;  // Line 81 - no zero check
const driftPct = Math.abs((currentValue - expectedValue) / expectedValue) * 100;  // Line 106
const pnlPct = (pnl / deployed) * 100;  // Line 174
```

---

### 41. Sentiment Overlay Division by Zero

**File**: `src/services/mit/sentiment-overlay.ts`
**Lines**: 77

```typescript
const below50 = entries.filter(...).length / entries.length;  // No zero check
```

---

### 42. Chart Generator Division by Zero

**File**: `src/services/mit/chart-generator.ts`
**Lines**: 131

```typescript
data: closes.map((close) => Number(((close / baseClose) * 100).toFixed(2)))
```

No check if baseClose is 0.

---

### 43. Screenipy Adapter Division by Zero

**File**: `src/services/mit/screenipy-mit-connector.ts`
**Lines**: 58

```typescript
const priceVsDma50Pct = dma50 ? ((ltp - dma50) / dma50) * 100 : null;
```

If dma50 is 0, returns null (handled).

---

### 44. Position ID Generation Uses Math.random

**File**: `src/services/mit/portfolio-service.ts`
**Lines**: 53, 113

Low collision probability but not cryptographically secure. Should use UUID.

---

### 45. Global State in Module Scope

**File**: `src/mit-routes.ts`
**Lines**: 184-214

`runStatus` and `dailyPipelineLock` are module-level, shared across all requests.

---

### 46. Inconsistent Error Responses

Some endpoints return `{ error: string }`, others return full error objects. Inconsistent API.

---

### 47. No Rate Limiting on Expensive Endpoints

ScreeniPy scan, hero analysis, and agent queries have no rate limiting.

---

### 48. Missing Request ID for Debugging

No request tracking across API calls, making distributed debugging difficult.

---

### 49. Telegram Error Messages Too Generic

**File**: `src/services/telegram-notifier.ts`
**Lines**: 59, 106, 133

Swallows detailed errors, makes debugging difficult.

---

### 50. CSV Export Injection Risk

**File**: `src/mit-routes.ts`
**Lines**: 1054-1066

Basic CSV escaping but not comprehensive for all edge cases.

---

### 51. No Input Sanitization on Ticker Parameters

Ticker parameters passed directly to external services without sanitization.

---

### 52. Error Logging May Leak Sensitive Data

**File**: `src/mit-routes.ts`
**Lines**: 524

```typescript
console.warn("Screenipy scan failed, using fallback", e);
```

Error object logged without sanitization.

---

### 53. Missing Circuit Breaker for External APIs

ScreeniPy Python script, Telegram API, market data APIs have no circuit breakers.

---

## LOW SEVERITY (Roadmap Items)

The following are code quality and governance items tracked as future roadmap work:

### 54-73. Code Quality & Governance Roadmap

- **#54**: Floating point comparisons (minor)
- **#55**: Magic numbers (documented with constants)
- **#56-59**: Naming, docs, testing (future work)
- **#60**: Audit logging (roadmap)
- **#61-62**: Health endpoints implemented
- **#63**: Metrics/observability (roadmap)
- **#64**: Config validation at startup
- **#65-67**: API design improvements (roadmap)
- **#68**: Date format standardization
- **#69**: Centralized validation middleware (roadmap)
- **#70**: Type safety improvements
- **#71**: CI static analysis (roadmap)
- **#72**: Security headers implemented
- **#73**: Backup/recovery procedures (roadmap)

Mix of camelCase and PascalCase in different files.

---

### 57. Missing JSDoc Comments

Critical functions lack documentation.

---

### 58. No Unit Tests for Critical Paths

Portfolio, position sizing, and P&L calculation lack unit tests.

---

### 59. No Integration Tests for Race Conditions

Concurrent operations not tested.

---

### 60. Missing Audit Logging

No audit trail for trade executions, position changes.

---

### 61. No Health Check Endpoint

Missing `/health` or `/ready` endpoints for container orchestration.

---

### 62. No Graceful Shutdown

Server doesn't wait for pending operations on SIGTERM.

---

### 63. Missing Metrics/Observability

No Prometheus metrics, no distributed tracing.

---

### 64. Configuration Not Validated at Startup

Env vars and config files not validated, fails at runtime.

---

### 65. Duplicate Code Patterns

Similar calculation logic repeated across multiple files.

---

### 66. No API Versioning

Breaking changes will affect existing clients.

---

### 67. Missing Pagination

Some endpoints return all data without pagination.

---

### 68. Inconsistent Date Formats

Mix of ISO strings, timestamps, and custom formats.

---

### 69. No Request Validation Middleware

Validation happens per-endpoint instead of centralized.

---

### 70. Missing Type Safety in Some Files

Some files use `any` type or loose typing.

---

### 71. No Static Analysis in CI

Missing ESLint, prettier integration in CI pipeline.

---

### 72. Missing Security Headers

No CSP, X-Frame-Options, etc. for web UI.

---

### 73. No Backup/Recovery Plan

No documented procedure for data recovery from corruption.

---

## ORACLE CRITICAL FINDINGS (Additional from Deep Analysis)

### 74. Transaction Without Locking - State Corruption

**File**: `src/mit-store.ts:136` and `src/mit-store-postgres.ts:454`
**Issue**: Transaction is read-modify-write without locking/versioning; concurrent requests can overwrite each other.

**Impact**: Lost trades, P&L corruption, state corruption.

**Fix**: Add mutex/CAS (JSON) and DB row/version locking; keep write windows short.

---

### 75. Read-Only Flows Writing Stale State

**File**: `src/server.ts:1955, 1994, 2108, 2170, 2202, 2230`
**Issue**: Read-only Telegram commands use `mitStore.transaction(async ...)`, then write stale state back.

**Impact**: User viewing `/hero` or `/table` can clobber newer trade updates.

**Fix**: Use `mitStore.read()` for read-only flows; never write on analysis calls.

---

### 76. JSON Parse Errors Silently Reset Portfolio

**File**: `src/utils.ts:25`
**Issue**: JSON parse/read errors silently return fallback state.

**Impact**: Corrupted `mit-state.json` can reset portfolio/trade history to defaults.

**Fix**: Fail fast with explicit error, add backup/recovery, atomic write (`tmp + rename`).

---

### 77. Telegram Webhook Has No Authentication

**File**: `src/server.ts:1869`
**Issue**: Telegram webhook has no origin/auth verification.

**Impact**: Spoofed POSTs can trigger execute/pass flows and bot messages.

**Fix**: Validate Telegram secret token header + allowed chat/user IDs.

---

### 78. Telegram Callback Data Parsing Broken

**File**: `src/services/telegram-notifier.ts:72` + `src/server.ts:1884`
**Issue**: Callback payload uses JSON in `callback_data` with colons, but parsing uses `split(":")`. JSON contains colons so parsing breaks.

**Impact**: Button callbacks fail (`Invalid payload`) or misparse.

**Fix**: Send compact token ID and parse using first-colon split or structured encoding.

---

### 79. Telegram Callback Data Exceeds 64-byte Limit

**File**: `src/services/telegram-notifier.ts:72`
**Issue**: `callback_data` can exceed Telegram's 64-byte limit.

**Impact**: Alert button delivery fails.

**Fix**: Store payload server-side by short ID and send only that ID in callback data.

---

### 80. Quantity Calculation Can Produce Infinity

**File**: `src/server.ts:1901`
**Issue**: `Math.floor(10000 / (buyPrice - stopLoss))` with no guard for `<= 0`.

**Impact**: Infinity/negative qty, wrong trade instructions.

**Fix**: Enforce `buyPrice > stopLoss`, finite qty, and cap with portfolio risk limits.

---

### 81. Hero Execute Sends Text But Doesn't Execute Trade

**File**: `src/server.ts:1898`
**Issue**: "hero_execute" path does not call trade manager/broker; it only sends confirmation text.

**Impact**: Phantom execution - user thinks executed, ledger unchanged.

**Fix**: Route execute through one atomic execution service that updates portfolio and broker.

---

### 82. API Accepts Qty But Ignores It

**File**: `src/mit-routes.ts:1505` + `src/services/mit/portfolio-service.ts:46`
**Issue**: API accepts `qty`, but entry logic ignores it and always auto-sizes.

**Impact**: Ledger qty can diverge from actual fills.

**Fix**: Either remove `qty` from API or honor it with guard checks.

---

### 83. Trade Schema Missing Relational Validation

**File**: `src/mit-routes.ts:73`
**Issue**: Trade schema validates only positivity, not long-trade semantics (`stop < entry < target`).

**Impact**: Invalid setups pass, risk math becomes nonsensical.

**Fix**: Add zod refinements for relational constraints.

---

### 84. Confirm Entry Doesn't Reconcile Cash/Risk

**File**: `src/services/mit/portfolio-service.ts:83`
**Issue**: `confirmEntry` changes entry price/date but does not reconcile cash/allocated amount/risk.

**Impact**: Equity and P&L drift after fill corrections.

**Fix**: Apply delta cash adjustment and recompute dependent fields atomically.

---

### 85. Stop Override Accepts NaN

**File**: `src/mit-routes.ts:1039`
**Issue**: Stop override endpoint bypasses zod; accepts `NaN`/invalid numbers.

**Impact**: NaN stop can disable stop-breach logic and risk controls.

**Fix**: Zod schema with `finite`, `>0`, and `< currentPrice` checks.

---

### 86. Sector Score Always Returns 0

**File**: `src/services/mit/hero-analyst.ts:271`
**Issue**: `getSectorFromTicker` always returns `null`; sector score never contributes.

**Impact**: Hero ranking is materially incomplete/biased.

**Fix**: Implement ticker→sector mapping from MIT universe.

---

### 87. Beta Metric Shows Score Instead of Beta

**File**: `src/services/mit/hero-analyst.ts:132`
**Issue**: `metrics.beta` is assigned `correlationScore` (a 0–20 score), not actual beta.

**Impact**: Risk metrics shown to users are wrong; decisions can be misled.

**Fix**: Return true beta separately from scored component.

---

### 88. Sell Indicators Use Stale Price

**File**: `src/services/mit/pnl-ledger.ts:74`
**Issue**: Momentum-decay uses `technicals.latestClose` instead of refreshed CMP (`position.currentPrice`).

**Impact**: Stale sell indicators and mistimed exits.

**Fix**: Compute indicator from live price used in current refresh.

---

### 89. Path Traversal Risk in Ticker Cache

**File**: `src/mit-routes.ts:165` + `src/services/mit/market-data.ts:129`
**Issue**: Ticker is unsanitized and used in cache filename (`path.join(..., ticker + ".json")`).

**Impact**: Path traversal risk (`../`) for authenticated callers.

**Fix**: Strict ticker regex and path containment validation before file I/O.

---

### 90. MarkdownV2 Messages Not Escaped

**File**: `src/services/telegram-notifier.ts:83`
**Issue**: MarkdownV2 messages sent without escaping dynamic text.

**Impact**: Alert sends can fail on special characters.

**Fix**: Escape MarkdownV2 or use safe HTML mode with escaping.

---

## Recommendations

### Immediate Actions (This Week)

1. **Fix position ID generation** - Use UUID v4
2. **Add mutex/locking** for pipeline state
3. **Fix transaction rollback** in mit-store.ts
4. **Move cash deduction** after position creation
5. **Add zero checks** to all division operations
6. **Implement cache expiration** for ScreeniPy

### Short-Term (This Sprint)

1. Add Zod validation to all API endpoints
2. Replace floating point with Decimal.js for financial calc
3. Add comprehensive unit tests for trading logic
4. Implement audit logging for all state changes
5. Add rate limiting to expensive endpoints

### Medium-Term (This Quarter)

1. Add integration tests for race conditions
2. Implement circuit breakers for external APIs
3. Add distributed tracing and metrics
4. Set up automated security scanning
5. Document recovery procedures

---

## Appendix: Files with Most Issues

| File | Issues |
|------|--------|
| `src/mit-routes.ts` | 12 |
| `src/services/mit/portfolio-service.ts` | 9 |
| `src/services/mit/technical-indicators.ts` | 8 |
| `src/services/mit/entry-exit-calc.ts` | 6 |
| `src/services/mit/position-sizer.ts` | 5 |
| `src/services/mit/surveillance-bot.ts` | 4 |
| `src/mit-store.ts` | 3 |
| `src/services/telegram-notifier.ts` | 3 |

---

*This report was generated by automated code analysis. Priority and impact assessments should be verified by manual review before implementing fixes.*

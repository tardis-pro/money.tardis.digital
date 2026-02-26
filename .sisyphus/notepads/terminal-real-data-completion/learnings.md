# Learnings — terminal-real-data-completion

## Architecture conventions
- App.tsx uses `html\`...\`` from `htm` (NOT JSX)
- All MIT routes in `src/mit-routes.ts`; policy routes in `src/server.ts`
- Store: JsonStore (default) or PostgresStore (STORE_BACKEND=postgres)
- `makeId('prefix')` and `nowIso()` in `src/utils.ts`
- PostgresStore uses TRUNCATE+reinsert on `write()` — watchlist mutations use targeted SQL
- All demo users have full route entitlements (`system` included)
- `npm run typecheck` must exit 0 at all times
- No Windmill — scheduling via Docker alpine crond container

## Current data state
- 52 tickers in src/config/mit-universe.json
- data/mit-candles/ has 52 files, 13+ years of OHLCV per ticker
- data/mit-state.json EMPTY (pipeline never run in this env)
- data/state.json has 9 signals, 8 alerts

## Terminal endpoint gaps (confirmed by audit)
- /api/screener → real: GET /api/mit/screenipy/candidates
- /api/screener/run → real: GET /api/mit/screenipy/run (GET not POST)
- /api/mit/pipeline/status → real: GET /api/mit/pipeline/latest
- /api/mit/hero → real: GET /api/mit/hero/analyze
- /api/trades → real: GET /api/mit/trades

## Key source files
- src/services/supply-chain-graph.ts — lines 216-228 are the synthetic formula to replace
- src/services/market-snapshot.ts — lines 53-58 synthetic price derivation to replace
- src/services/config/entity-loader.ts — line 71 knownTickers hardcoded 10 to expand
- src/services/mit/screener-fundamentals-fetcher.ts — arbitrary ticker Screener fetch
- src/services/mit/market-data.ts — Yahoo Finance fetch pattern (no key needed)
- src/config/mit-universe.json — 52 tickers, source of truth for universe

## Yahoo Finance quote endpoint (no key)
- URL: https://query1.finance.yahoo.com/v7/finance/quote?symbols=RELIANCE.NS,TCS.NS
- Returns: regularMarketPrice, regularMarketChangePercent, regularMarketTime, exchangeTimezoneName
- Already used in market-data.ts for candles — same domain, same no-key pattern

## Task: GET /api/mit/data/sources endpoint

- `path` and `fs` (node:fs/promises) were NOT already imported in `mit-routes.ts` — needed to add both
- Used named imports `{ readdir, readFile }` from `node:fs/promises` to avoid fs namespace collision
- `registerMitRoutes` function ends at line 1640 (was line 1640 pre-edit) — all routes inside that block
- Helper functions (compactEnter, compactExit, etc.) live AFTER the closing `}` of registerMitRoutes
- `noUncheckedIndexedAccess` strict mode requires checking array[0] !== undefined before accessing
- Terminal App.svelte welcome message is in lines 407-413 (the `<div class="text-xs text-[#555] space-y-1">` block)

## Task: T6 — Supply-chain real economics integration

### Changes made
- Updated `SupplyChainNode` type in `types.ts` to add `dataSource` and `asOf` fields
- Updated `SupplyChainGraph.dataSource` to include `'cached'` option (was just `'live' | 'fallback'`)
- Replaced synthetic formula in `supply-chain-graph.ts` with fundamentals-based calculations:
  - `production` → latest annual revenue from `revenueHistory`
  - `demand` → revenue * (1 + revenueGrowth) for forward estimate
  - `surplus` → latest FCF from `fcfHistory`
  - `imports/exports` → derived from surplus sign (negative = imports, positive = exports)

### Data source tracking
- `dataSource: 'live'` — fetched within last hour from Screener.in
- `dataSource: 'cached'` — fetched more than an hour ago
- `dataSource: 'fallback'` — no fundamentals available (zeros/nulls)

### Key implementation notes
- `ScreenerFundamentalsFetcher.fetchTickers()` returns both `success` and `failed` arrays
- Rate limiting: 500ms delay between fetches (handled by fetcher)
- `noUncheckedIndexedAccess` requires checking `array[0]` before accessing (use `?? 0` for revenue/fcf defaults)
- Graph-level `dataSource` is derived from node-level sources (all live → live, some → cached, none → fallback)

### Cleanup
- Removed unused `incoming`/`outgoingScore` maps (were only used by synthetic formula)
- Removed unused `source` from entity loader destructuring

## T11 — Policy ingestion scheduling + freshness metadata (2026-02-26)

### Pattern: Extending StateStore with scalar metadata
When adding lightweight metadata (timestamps, counters) to the store:
1. Add field with explicit `null` type to `StateStore` interface — `exactOptionalPropertyTypes` requires `string | null`, not `string?`
2. Add to `makeDefaultState()` with null default
3. Add to `JsonStore.read()` return with `?? null` fallback
4. For `PostgresStore`: the `stream_state` singleton table stores arbitrary scalar state alongside `streamSequence` — extend its payload type and both read/write paths
5. In routes, use `store.transaction()` to atomically update the new fields

### Pattern: Docker cron IST times
- IST = UTC+5:30 → subtract 5h30m for UTC cron time
- 6:00 AM IST = 00:30 UTC → `30 0 * * *`
- 3:00 AM IST = 21:30 UTC (previous day) but existing MIT uses `0 3 * * 1-5` (3am IST directly because TZ=Asia/Kolkata is set in env)
- The scheduler container sets `TZ: Asia/Kolkata` via `cp /usr/share/zoneinfo/$$TZ /etc/localtime`, so cron times ARE in IST

### Pattern: Freshness status enum
Use `'fresh' | 'stale' | 'never'` with 24h threshold and null guard:
- `never`: lastSuccess === null
- `fresh`: Date.now() - new Date(lastSuccess).getTime() <= 24 * 3600 * 1000
- `stale`: otherwise

## T13: Historical Data UX/Docs Integration

**App.svelte welcome panel structure:**
- Help text is in a `<div class="text-xs text-[#555] space-y-1">` block
- Lines 408-414 after the edit
- Each command is a `<p>` with `<span class="text-orange-500">>` prefix

**README section ordering:**
- "Historical Data" section added after "What It Does" (before "Architecture")
- Structure: description, code block with curl command, explanation, repeat

**Key endpoints for users:**
- `GET /api/mit/data/sources` — comprehensive source info including cache paths and howToFetchHistoricalData steps
- `POST /api/mit/pipeline/run` — full historical fetch for all 52 tickers
- Data cached in `data/mit-candles/{TICKER}.json` (13+ years)

**HTML structure gotcha:**
- Previous edit left a `<p>` tag outside the closing `</div>` — fixed by including the full block
- Svelte doesn't error on malformed HTML, but it breaks the visual layout

## T14: Failure-path resilience tests

**Node.js native test runner pattern:**
- Use `import test from "node:test"` and `import assert from "node:assert/strict"`
- Tests are just functions: `test("description", async () => { ... })`
- No Jest/Mocha — tests compile from `test/*.ts` to `dist/test/*.test.js`
- Run via: `npm run build --silent && node --test dist/test/*.test.js`

**Type imports with dynamic imports:**
- `const { fetchQuotes, type QuoteBatchResult } = await import(...)` is INVALID
- Use top-level `import type { QuoteBatchResult } from "..."` for types
- Then dynamic import just for values: `const { fetchQuotes } = await import(...)`

**Singleton reset in tests:**
- Resetting singletons via `module.entityLoaderInstance = null` doesn't work reliably due to module caching
- Better to just use the existing singleton and test its behavior
- Services like `getEntityLoader()` and `getScreenerFetcher()` are designed to return existing instances

**Degraded response pattern for resilience:**
1. Services never throw on provider outage — return valid structure with degraded data
2. Include metadata: `quoteSource: "yahoo-finance" | "unavailable"`, `dataSource: "live" | "cached" | "fallback"`
3. Include timestamps: `asOf`, `fetchedAt`, `updatedAt` — always ISO strings
4. Partial success for batch ops: `{ success: [...], failed: [{ ticker, error }] }`
5. Null values for unavailable data: `latestPrice: null` when quotes fail

**Key services tested for resilience:**
- `yahoo-quote-client.ts` — returns `{ quotes: Map, failedTickers: [], fetchedAt }` even on network error
- `market-snapshot.ts` — returns entries with `quoteSource: "unavailable"` when Yahoo fails
- `supply-chain-graph.ts` — returns nodes with `dataSource: "fallback"` when Screener fails, economics = 0
- `entity-loader.ts` — returns `FALLBACK_ENTITIES` when Screener API unavailable
- `screener-fundamentals-fetcher.ts` — returns `null` for invalid tickers, `failed` array in batch
- Svelte doesn't error on malformed HTML, but it breaks the visual layout

## T12: E2E Terminal Data Integrity Tests (2026-02-26)

### Test file location and pattern
- Test file: `test/terminal-integrity.test.ts` → compiled to `dist/test/terminal-integrity.test.js`
- Uses Node.js native test runner: `import test, { before, after, describe } from "node:test"`
- Uses `node:assert/strict` for assertions
- Tests run via `npm run test` = `npm run build && node --test dist/test/*.test.js`

### Building a test server for E2E tests
- Use dynamic imports for all server modules (compiled to `../src/...` paths in dist)
- Create temp directory with `mkdtemp(path.join(os.tmpdir(), "prefix-"))`
- Instantiate `JsonStore` and `MitJsonStore` with temp paths
- Create Fastify app with `logger: false` to reduce noise
- Use ephemeral port: `await app.listen({ port: 0, host: "127.0.0.1" })`
- Extract port from returned address: `address.replace(/.*:/, "")`

### MIT routes authentication
- MIT routes require `x-user-id` header for identity service
- Default user is `demo-analyst` which has full route entitlements
- Add hook to inject default user: `request.headers["x-user-id"] = "demo-analyst"`

### Data-dependent route handling
- Some routes return 404 when no data exists (e.g., `/api/mit/pipeline/latest`, `/api/mit/hero/analyze`)
- 404 with `{ error: "..." }` body is valid behavior, NOT a route regression
- Test should check for either 200 or 404 with proper error shape

### Terminal panel endpoints (9 panels)
1. Chat — uses `/api/mit/manager/query` (POST)
2. Signals — `GET /api/signals?limit=20`
3. Alerts — `GET /api/alerts`
4. Portfolio — `GET /api/mit/portfolio`
5. Heatmap — `GET /api/heatmap`
6. Screener — `GET /api/mit/screenipy/candidates`
7. Pipeline — `GET /api/mit/pipeline/latest`
8. Hero — `GET /api/mit/hero/analyze`
9. Trades — `GET /api/mit/trades`

### Additional data endpoints
- `GET /api/market/snapshots?limit=10` — Yahoo quotes
- `GET /api/mit/data/sources` — historical data coverage
- `GET /api/ingest/status` — policy ingestion freshness
- `GET /api/chart/templates` — charting templates (NOT `/api/templates`)

### Test cleanup gotcha
- Node.js test runner may timeout on async cleanup (`app.close()` is slow)
- Combine all tests into one describe block to avoid multiple server lifecycles
- Use `after` hook with proper async/await for cleanup

### Route regression detection pattern
```typescript
const requiredRoutes: Array<{ method: string; path: string; description: string; allow404?: boolean }> = [
  { method: "GET", path: "/api/signals", description: "Signals panel" },
  { method: "GET", path: "/api/mit/pipeline/latest", description: "Pipeline panel", allow404: true },
  // ...
];

for (const route of requiredRoutes) {
  test(`${route.method} ${route.path} is registered`, async () => {
    const res = await fetch(`${baseUrl}${route.path}`);
    if (route.allow404 && res.status === 404) {
      const data = await res.json();
      assert.ok("error" in data, "404 should have error body");
    } else {
      assert.notEqual(res.status, 404, "Route regression detected");
    }
  });
}
```

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

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

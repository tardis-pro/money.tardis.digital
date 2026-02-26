# Learnings — fix-5-features

## [2026-02-26] Session ses_364674d60ffeAej09QfXNHnl60

### Architecture
- App.tsx uses `htm` tagged template literals (`html\`...\``) — NOT JSX. All UI must use `html\`...\`` from htm package.
- Store pattern: `store.transaction(fn)` for JsonStore mutations. PostgresStore uses targeted SQL (TRUNCATE+reinsert for full writes).
- All routes use `ensureRouteAccess(request, reply, 'entitlement')` pattern.
- Services are instantiated in server.ts `buildServer()` and passed to route handlers.
- `makeId('prefix')` and `nowIso()` in `src/utils.ts` for IDs/timestamps.
- Zod schemas defined at top of server.ts, validated with `.safeParse()`.
- Auth via `x-user-id` header. `demo-analyst` is default. `demo-admin` has system entitlement.

### Store Interface (src/store.ts ~line 40)
- Store interface defines all methods that both JsonStore and PostgresStore must implement.
- Adding new methods: must add to Store interface AND both implementations.

### Supply Chain
- Entity loader has FALLBACK_ENTITIES for 10 tickers (HAL, BEL, IRCTC, IRFC, NTPC, PFC, SBIN, HDFCBANK, LT, RVNL).
- buildGraph() already has fallback to all entities when signals are empty (line 86).
- If Screener.in API fails, need to ensure fallback is properly triggered.

### Strategy AI
- StrategyStore is Postgres-only (no JSON fallback).
- routes.ts imports BacktestRun from ./store.js — type MISSING from store.ts.
- 8 methods missing from StrategyStore class.
- DB tables already exist per STRATEGY_MIGRATIONS (sim_runs, game_experiments, etc.).
- Must guard route registration with STORE_BACKEND=postgres check.

### Watchlist
- Watchlist type: `{ id: string, name: string, tickers: string[], createdAt: string }`
- PostgresStore: watchlists table at `policy_signal.watchlists (id text PRIMARY KEY, payload jsonb)`
- Existing INSERT pattern: `INSERT INTO policy_signal.watchlists (id, payload) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`

## Watchlist CRUD — Task 1

### Pattern: Store interface + dual implementation
- Added `upsertWatchlist(wl: Watchlist)` and `deleteWatchlistById(id: string)` to `Store` interface
- `JsonStore`: transaction-based (read-mutate-write JSON file)
- `PostgresStore`: targeted SQL — INSERT...ON CONFLICT DO UPDATE + DELETE — avoids full TRUNCATE+reinsert

### Pattern: TerminalService wraps store methods
- Service reads state for update (findById), builds updated object, calls `store.upsertWatchlist()`
- Delete delegates directly to `store.deleteWatchlistById()`
- `makeId('wl')` + `nowIso()` from `../utils.js` for ID and timestamp generation
- Ticker dedup: `[...new Set(tickers.map(t => t.trim().toUpperCase()))]`

### Pattern: Fastify routes
- Schema definitions near line 130 in server.ts
- Routes added after GET /api/watchlists (line 1339)
- `ensureRouteAccess(request, reply, 'watchlists')` for auth guard
- POST returns 201, PUT returns 200, DELETE returns 204
- watchlistUpdateSchema = watchlistCreateSchema (same shape)

### Pre-existing errors
- 14 type errors in `src/services/strategy-ai/` (StrategyStore incomplete interface)
- These cannot be fixed without modifying out-of-scope files
- All 4 modified files have zero LSP errors
## Supply Chain Graph — Task 3

### Changes Made
1. `src/types.ts`: Added `dataSource: 'live' | 'fallback'` to `SupplyChainGraph` interface
2. `src/services/config/entity-loader.ts`: Added `getAllEntitiesWithSource()` method that returns `{ entities, source }` where source is derived from `result.sourceId === 'fallback' ? 'fallback' : 'live'`
3. `src/services/supply-chain-graph.ts`: Modified `buildGraph()` to use `getAllEntitiesWithSource()` and return `dataSource` in the result

### Key Insight: Fallback Detection
- `BaseConfigurationLoader.load()` returns `LoadResult<T>` with `sourceId: string`
- When Screener.in API fails and fallback is used, `sourceId === 'fallback'`
- When API succeeds (or cached), `sourceId === 'screener-api'`
- The new method detects this and normalizes to `'live' | 'fallback'`

### Entity Loader Flow
1. `ScreenerEntitySource.fetch()` iterates over `knownTickers`
2. For each ticker, tries `fetchEntityFromSearch()` with 10s timeout
3. On failure, falls back to `FALLBACK_ENTITIES.get(ticker)`
4. `loadFallback()` at class level returns full `FALLBACK_ENTITIES` map
5. `getAllEntities()` extracts array from `result.data`
6. `getAllEntitiesWithSource()` extracts array + detects source type

### Graph Population Guarantee
- `FALLBACK_ENTITIES` contains all 10 tickers used in `supply-chain.json`
- When `tickers.size === 0` (no signals), code falls back to all entities
- Result: graph will ALWAYS have nodes if entity loader works


## Task 4: strategy-ai TypeScript fixes (BacktestRun + 8 store methods)

### Pattern: BacktestRun stored in sim_runs table
- BacktestRun reuses `sim_runs` table (no new table needed)
- Distinguished from SimRun via jsonb query: `payload ? 'backtestType'`
- `ticker` and `backtestType` filtered via `payload->>'field' = $N`

### Pattern: game_experiments uses StoredGameExperiment wrapper
- The object passed to `upsertGameExperiment` has its own `payload: Record<string,unknown>` field
- The `payload` field (not the whole object) is stored in the DB `payload` column
- Other fields (id, type, status, created_at) go into dedicated columns

### StoredXxx interfaces (not exported from game-theory/index.ts)
- Created 5 new interfaces in store.ts: BacktestRun, StoredGameExperiment, StoredPayoffMatrix, StoredEvolutionHistory, StoredNashEquilibrium
- All exported so routes.ts can import BacktestRun

### Error count
- 8 errors in routes.ts (1 missing type + 7 missing method calls)
- 6 errors in game-theory/index.ts (missing store methods)
- Total: 14 errors → 0 after fix



## Task 5: Daily Ideas 404 Remediation

### Pattern: Informative error responses
- 404 responses should include `remediation` field when applicable
- Format: `{ error: "...", remediation: "ACTION to take" }`
- Example: `{ error: "No pipeline run found", remediation: "POST /api/mit/pipeline/run to generate daily ideas" }`

### Location
- `src/mit-routes.ts` line 964: `GET /api/mit/daily-ideas` 404 response
- Pipeline run endpoint confirmed at `POST /api/mit/pipeline/run` (line 608)


## Task 6: Strategy AI Routes Registration

### Pattern: PostgreSQL-guarded route registration
- `registerStrategyAiRoutes(app)` takes only `FastifyInstance` as parameter
- Function creates its own `StrategyStore` and `TimescaleTechnicalStore` internally
- Must guard registration with `STORE_BACKEND=postgres` check

### Implementation
- Import added at line 58: `import { registerStrategyAiRoutes } from "./services/strategy-ai/routes.js"`
- Routes registered after MIT routes scoped plugin (line ~1961)
- JSON mode: stub routes return 501 with `{ error: "strategy-ai requires PostgreSQL; set STORE_BACKEND=postgres" }`
- PostgreSQL mode: full `registerStrategyAiRoutes(app)` called

### Stub endpoints in JSON mode
- `GET /api/strategies` → 501
- `POST /api/strategies` → 501

### Pre-existing fixes (App.tsx)
- Removed corrupted line marker text (`126#WV|`, `162#JN|`) from lines 127 and 163
- Fixed syntax error: `t > t.trim()` → `t => t.trim()` on line 165
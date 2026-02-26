# Fix 5 Outstanding Features — money.tardis.digital

## TL;DR

> **Quick Summary**: Fix 5 known bugs/missing features: watchlist CRUD, stale-signal wipe, supply-chain graph, MIT daily ideas availability, and full-stack strategy/backtesting UI.
>
> **Deliverables**:
> - `POST/PUT/DELETE /api/watchlists` endpoints + `TerminalService` write methods + App.tsx edit UI
> - `DELETE /api/signals` (system-only) with async auto-reingest + `clearSignals()` on both stores
> - Supply-chain graph populated via entity-loader fallback; response includes `dataSource` metadata
> - MIT daily ideas returns data (not 404) after pipeline run; endpoint verified working
> - 14 TS errors fixed in strategy-ai, 8 missing StrategyStore methods added, routes registered in server.ts, basic Strategy panel in App.tsx
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: Task 4 (StrategyStore methods) → Task 7 (register routes) → Task 8 (Strategy UI)

---

## Context

### Original Request
User asked to "plan this" for 5 outstanding bugs identified in the previous session.

### Interview Summary
**Key Discussions**:
- Strategy UI: **Full stack** — TS errors + route registration + basic App.tsx panel
- Signal cleanup: **Admin endpoint + auto-reingest** — DELETE /api/signals wipes, immediately fires background re-ingest

**Research Findings**:
- Entity loader has hardcoded `FALLBACK_ENTITIES` for all 10 tickers in supply-chain.json — graph will populate even without Screener.in API
- `StrategyStore` is Postgres-only; must guard startup so server stays healthy in JSON mode
- App.tsx uses `htm` tagged template literals — all UI additions must use `html\`...\`` syntax, NOT JSX
- PostgresStore uses full TRUNCATE+reinsert in `write()` — watchlist writes need targeted SQL upsert, not full state write

### Metis Review
**Identified Gaps** (addressed):
- Signal wipe: scope = signals only (not alerts/audits/outcomes) — prevents dangling refs without cascading complexity
- Auth model for destructive routes: `ensureRouteAccess(request, reply, "system")` — matches codebase pattern
- Watchlist IDs: server-generated via `makeId("wl")` — safer than client-provided
- Ticker normalization: uppercase, trim, dedupe — applied silently in service layer
- Strategy in JSON mode: 501 with `{ error: "strategy-ai requires PostgreSQL; set STORE_BACKEND=postgres" }` — graceful degradation
- Signal re-ingest: async (fire-and-forget) — response returns `{ clearedSignals: N, reingestTriggered: true }` immediately

---

## Work Objectives

### Core Objective
Make all 5 features fully functional: watchlist editing, signal refresh, supply-chain visibility, daily ideas, and strategy backtesting.

### Concrete Deliverables
- `POST /api/watchlists` — create watchlist
- `PUT /api/watchlists/:id` — update name/tickers
- `DELETE /api/watchlists/:id` — delete watchlist (204)
- `DELETE /api/signals` — wipe signals (system-only), trigger async re-ingest
- `GET /api/supply-chain-graph` — returns populated graph (not empty) with `dataSource` field
- `GET /api/mit/daily-ideas` — returns array (not 404) after at least one pipeline run
- `GET /api/strategies`, `POST /api/strategies`, `POST /api/strategies/:id/simulate`, etc. — all working
- App.tsx: watchlist create/edit/delete UI
- App.tsx: Strategy panel — list strategies, create from prompt, trigger sim, view results

### Definition of Done
- [ ] `npm run typecheck` exits 0 (zero TS errors)
- [ ] All 5 feature smoke tests pass (curl assertions in QA Scenarios below)
- [ ] Server starts cleanly with `STORE_BACKEND=json` (strategy routes degrade gracefully to 501)
- [ ] `GET /api/supply-chain-graph` returns `nodes.length > 0`

### Must Have
- Both `JsonStore` and `PostgresStore` support watchlist create/update/delete
- `StrategyStore` has all 8 missing methods before routes are registered
- TypeScript strict mode passes — no `as any`, no `@ts-ignore`

### Must NOT Have (Guardrails)
- NO cascading deletes from signal wipe (alerts, outcomes, audits stay)
- NO full-state rewrite for Postgres watchlist mutations — targeted SQL only
- NO JSX in App.tsx — only `html\`...\`` from `htm`
- NO expansion of supply-chain.json beyond bug-fix scope (don't add new sectors)
- NO changes to MIT pipeline logic while fixing daily-ideas availability
- NO client-provided watchlist IDs — always server-generated
- NO re-architecting store layer — follow existing `transaction()` pattern

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (Node.js native test runner, `npm run test`)
- **Automated tests**: No new test files — existing `npm run test` must still pass
- **Agent-Executed QA**: YES (curl for all API routes)

### QA Policy
Every task includes agent-executed QA scenarios using `curl` + JSON assertions.
Evidence saved to `.sisyphus/evidence/`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — 5 independent tracks):
├── Task 1: Watchlist CRUD backend (server.ts + terminal.ts + both stores)
├── Task 2: Signal wipe endpoint + clearSignals() on both stores
├── Task 3: Supply-chain graph — verify fallback, add dataSource metadata
├── Task 4: StrategyStore — add BacktestRun type + 8 missing methods
└── Task 5: MIT daily ideas — verify pipeline trigger, fix 404 contract

Wave 2 (After Wave 1 — UI + registration):
├── Task 6: Watchlist UI in App.tsx (depends: Task 1)
├── Task 7: Register strategy-ai routes in server.ts + startup guard (depends: Task 4)
└── Task 8: Strategy panel in App.tsx (depends: Task 7)

Wave 3 (Final Verification — parallel):
├── Task F1: API smoke test + plan compliance audit
├── Task F2: TypeScript typecheck (npm run typecheck exits 0)
└── Task F3: Full QA — run all curl scenarios, capture evidence
```

---

## TODOs

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **TypeScript Typecheck** — `quick`
  Run `npm run typecheck`. Assert exit code 0. If failures: read error output, fix, re-run until clean.
  Output: `Typecheck [PASS/FAIL] | Errors [N] | VERDICT`

- [x] F3. **Full QA** — `unspecified-high`
  Start dev server (`npm run dev`). Execute ALL curl scenarios from ALL tasks. Save responses to `.sisyphus/evidence/final-qa/`. Assert status codes and JSON fields.
  Output: `Scenarios [N/N pass] | VERDICT`

- [x] 1. Watchlist CRUD — Backend (server.ts + terminal.ts + both stores)

  **What to do**:
  - In `src/services/terminal.ts`: add three new methods to `TerminalService`:
    - `createWatchlist(name: string, tickers: string[]): Promise<Watchlist>` — generates id via `makeId('wl')`, normalizes tickers (uppercase, trim, dedupe), sets `createdAt: nowIso()`, calls `store.transaction()` to push to `state.watchlists`, returns the new watchlist
    - `updateWatchlist(id: string, name: string, tickers: string[]): Promise<Watchlist | null>` — finds by id, normalizes tickers, mutates in-place via `store.transaction()`, returns updated or null if not found
    - `deleteWatchlist(id: string): Promise<boolean>` — filters out from `state.watchlists` via `store.transaction()`, returns true if removed
  - In `src/server.ts` — add three routes after the existing `GET /api/watchlists` (around line 1339):
    - `POST /api/watchlists` — body: `{ name: string, tickers: string[] }` validated by Zod schema; ensureRouteAccess 'watchlists'; calls `terminal.createWatchlist()`; returns 201 with new watchlist
    - `PUT /api/watchlists/:watchlistId` — body: `{ name: string, tickers: string[] }`; ensureRouteAccess 'watchlists'; calls `terminal.updateWatchlist()`; 404 if null returned
    - `DELETE /api/watchlists/:watchlistId` — ensureRouteAccess 'watchlists'; calls `terminal.deleteWatchlist()`; 204 no-body if deleted, 404 if not found
  - Add Zod schemas near line 130: `watchlistCreateSchema` (name: string min 2 max 80, tickers: string array max 50) and `watchlistUpdateSchema` (same shape)
  - **PostgresStore targeted write**: for postgres, do NOT call full `store.write()`. Instead, add `upsertWatchlist(wl: Watchlist)` and `deleteWatchlistById(id: string)` methods to `PostgresStore` that run targeted SQL: `INSERT ... ON CONFLICT (id) DO UPDATE SET payload = $2` and `DELETE FROM policy_signal.watchlists WHERE id = $1`
  - Use these postgres methods when `store instanceof PostgresStore`; JsonStore uses `store.transaction()` as normal

  **Must NOT do**:
  - Do NOT call `store.write(fullState)` in postgres mode for watchlist mutations — targeted SQL only
  - Do NOT accept client-provided IDs — always generate with `makeId('wl')`
  - Do NOT allow duplicate tickers — dedupe before saving

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multi-file backend change touching store abstraction boundary, requires careful postgres vs json branching
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4, 5)
  - **Blocks**: Task 6 (Watchlist UI)
  - **Blocked By**: None

  **References**:
  - `src/services/terminal.ts:80-97` — existing read-only watchlist methods to extend
  - `src/store.ts:251-256` — `transaction()` pattern for JsonStore mutations
  - `src/store-postgres.ts:256-261` — existing watchlist INSERT pattern in postgres
  - `src/server.ts:1333-1339` — existing `GET /api/watchlists` route to extend after
  - `src/server.ts:858-868` — `POST /api/portfolios` route as pattern: Zod parse → ensureRouteAccess → service call → 201
  - `src/utils.ts` — `makeId()`, `nowIso()` utilities
  - `src/types.ts:266-271` — `Watchlist` interface

  **Acceptance Criteria**:
  ```
  Scenario: Create watchlist (happy path)
    Tool: Bash (curl)
    Steps:
      1. POST /api/watchlists body={name:'Infra Core',tickers:['lt','SBIN','LT']} with x-user-id: demo-analyst
      2. Assert: 201, .id starts with 'wl-', .name='Infra Core', .tickers=['LT','SBIN'] (deduped, uppercased)
    Evidence: .sisyphus/evidence/task-1-create.json

  Scenario: Update watchlist
    Tool: Bash (curl)
    Steps:
      1. PUT /api/watchlists/{id} body={name:'Infra Core v2',tickers:['HAL','BEL']}
      2. Assert: 200, .name='Infra Core v2', .tickers=['HAL','BEL']
    Evidence: .sisyphus/evidence/task-1-update.json

  Scenario: Delete watchlist
    Tool: Bash (curl)
    Steps:
      1. DELETE /api/watchlists/{id}
      2. Assert: 204 no body
      3. GET /api/watchlists — assert deleted id is absent
    Evidence: .sisyphus/evidence/task-1-delete.txt

  Scenario: Auth guard
    Tool: Bash (curl)
    Steps:
      1. POST /api/watchlists with no x-user-id header
      2. Assert: 401
    Evidence: .sisyphus/evidence/task-1-auth.txt
  ```

  **Commit**: YES — `feat(store): watchlist CRUD endpoints and service methods`

- [x] 2. Signal Wipe Endpoint + clearSignals() on both stores

  **What to do**:
  - In `src/store.ts` (Store interface, ~line 40): add `clearSignals(): Promise<number>` to the interface
  - In `src/store.ts` (`JsonStore` class): implement `clearSignals()` using `transaction()` — saves old length, sets `state.signals = []`, returns cleared count
  - In `src/store-postgres.ts` (`PostgresStore`): implement `clearSignals()` — runs `SELECT count(*) FROM policy_signal.signals` then `DELETE FROM policy_signal.signals`, returns count
  - In `src/server.ts`: add `DELETE /api/signals` route:
    - `ensureRouteAccess(request, reply, 'system')` (system-only)
    - Calls `await store.clearSignals()` for `clearedCount`
    - Fires background re-ingest: look at how `POST /api/ingest/run` internally calls the pipeline service (around line 646); replicate that call wrapped in `void` (fire-and-forget)
    - Returns `{ clearedSignals: clearedCount, reingestTriggered: true, message: 'Signals cleared. Re-ingest running in background.' }`

  **Must NOT do**:
  - Do NOT delete alerts, audits, outcomes, or feedback — signals ONLY
  - Do NOT await the re-ingest — must return immediately
  - Do NOT allow non-system roles to call this endpoint

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small, well-scoped: one interface method, two store impls, one route
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4, 5)
  - **Blocks**: Nothing
  - **Blocked By**: None

  **References**:
  - `src/server.ts:646` — how `POST /api/ingest/run` triggers pipeline internally (replicate this pattern)
  - `src/store.ts:40-50` — Store interface definition where `clearSignals()` must be added
  - `src/store.ts:251-256` — `transaction()` pattern for JsonStore mutations
  - `src/store-postgres.ts:380-415` — how postgres handles signal writes (to understand delete table structure)

  **Acceptance Criteria**:
  ```
  Scenario: Wipe signals (system user)
    Tool: Bash (curl)
    Steps:
      1. DELETE /api/signals with x-user-id: demo-admin
      2. Assert: 200, body.clearedSignals is a number >=0, body.reingestTriggered === true
    Evidence: .sisyphus/evidence/task-2-wipe.json

  Scenario: Auth rejection
    Tool: Bash (curl)
    Steps:
      1. DELETE /api/signals with x-user-id: demo-analyst
      2. Assert: 403
    Evidence: .sisyphus/evidence/task-2-auth.txt

  Scenario: Signals cleared verification
    Tool: Bash (curl)
    Steps:
      1. GET /api/signals immediately after wipe
      2. Assert: response is empty array []
    Evidence: .sisyphus/evidence/task-2-verify.json
  ```

  **Commit**: YES — `feat(store): signal wipe endpoint with async reingest trigger`


- [x] 3. Supply-Chain Graph — Fix entity-loader fallback + add dataSource metadata

  **What to do**:
  - In `src/services/config/entity-loader.ts`: find `getAllEntities()` method. Verify that when `ScreenerEntitySource.isAvailable()` returns false (network error), it falls through to `FALLBACK_ENTITIES`. If the fallback isn't returned correctly, fix the fallback path to always return the hardcoded entities.
  - In `src/services/supply-chain-graph.ts`: modify `buildGraph()` to return a `dataSource` field: `'live'` when entities came from Screener.in API, `'fallback'` when hardcoded FALLBACK_ENTITIES were used. The entity loader likely exposes a `loadedFromSource` field (see `EntityBatchResult` interface) — use that.
  - Update the return type `SupplyChainGraph` in `src/types.ts` to include `dataSource: 'live' | 'fallback'`
  - Verify the graph API response contains `nodes.length > 0` by reading the entity-loader's `getEntityLoader()` singleton and tracing `getAllEntities()` all the way through to confirm fallback is reachable

  **Must NOT do**:
  - Do NOT expand `supply-chain.json` with new edges — bug-fix only
  - Do NOT change the graph algorithm
  - Do NOT change the `watchlistId` filtering logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Primarily a read + verify + small tweak task
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4, 5)
  - **Blocks**: Nothing
  - **Blocked By**: None

  **References**:
  - `src/services/config/entity-loader.ts:406` — `getAllEntities()` method (trace fallback path from here)
  - `src/services/config/entity-loader.ts:225` — `FALLBACK_ENTITIES` hardcoded map
  - `src/services/config/entity-loader.ts:23-28` — `EntityBatchResult` with `loadedFromSource` field
  - `src/services/supply-chain-graph.ts:67-92` — `buildGraph()` node population logic
  - `src/types.ts:299-303` — `SupplyChainGraph` interface to add `dataSource` field

  **Acceptance Criteria**:
  ```
  Scenario: Graph has nodes (fallback path)
    Tool: Bash (curl)
    Steps:
      1. GET /api/supply-chain-graph
      2. Assert: response.nodes.length > 0
      3. Assert: response.edges.length > 0
      4. Assert: response.dataSource is 'live' or 'fallback'
    Evidence: .sisyphus/evidence/task-3-graph.json

  Scenario: Graph not empty without signals
    Tool: Bash (curl)
    Steps:
      1. (After signal wipe if available) GET /api/supply-chain-graph
      2. Assert: nodes.length > 0 (fallback entities used)
    Evidence: .sisyphus/evidence/task-3-no-signals.json
  ```

  **Commit**: YES — `fix(supply-chain): ensure graph populates via entity fallback, add dataSource field`

- [x] 4. StrategyStore — Add BacktestRun type + 8 missing methods

  **What to do**:
  - In `src/services/strategy-ai/store.ts`: add `BacktestRun` interface (exported) with fields:
    ```typescript
    export interface BacktestRun {
      id: string;
      strategyId: string;
      config: BacktestConfig;  // import from historical-backtest.ts
      result?: BacktestResult; // import from historical-backtest.ts
      monteCarlo?: MonteCarloResult;
      status: 'pending' | 'running' | 'completed' | 'failed';
      createdAt: string;
      completedAt?: string;
      errorMessage?: string;
    }
    ```
  - Add these 8 methods to the `StrategyStore` class using existing postgres patterns (JSONB payload column):
    1. `createBacktestRun(run: BacktestRun): Promise<BacktestRun>` — INSERT into `strategy_ai.sim_runs` (reuse existing sim_runs table with `type='backtest'` discriminator in payload)
    2. `listBacktestRuns(strategyId?: string): Promise<BacktestRun[]>` — SELECT from `strategy_ai.sim_runs` WHERE payload->>'type' = 'backtest'
    3. `getBacktestRun(id: string): Promise<BacktestRun | null>` — SELECT by id from sim_runs
    4. `getBacktestMetrics(strategyId: string): Promise<Ranking[]>` — SELECT from rankings by strategy_id ORDER BY ranking_date DESC
    5. `upsertGameExperiment(exp: GameExperiment): Promise<GameExperiment>` — INSERT ... ON CONFLICT DO UPDATE into `strategy_ai.game_experiments`; need `GameExperiment` type from game-theory/index.ts or define inline
    6. `createPayoffMatrix(matrix: PayoffMatrix): Promise<PayoffMatrix>` — INSERT into `strategy_ai.payoff_matrices`; need `PayoffMatrix` type
    7. `createEvolutionHistory(entry: EvolutionHistory): Promise<EvolutionHistory>` — INSERT into `strategy_ai.evolution_history`; need `EvolutionHistory` type
    8. `createNashEquilibrium(eq: NashEquilibrium): Promise<NashEquilibrium>` — INSERT into `strategy_ai.nash_equilibria`; need `NashEquilibrium` type
  - Read `src/services/strategy-ai/game-theory/index.ts` first to find the actual type names exported there — use those types directly (do not redefine)
  - Read `src/services/strategy-ai/historical-backtest.ts` to import `BacktestConfig`, `BacktestResult`, `MonteCarloResult`
  - After all methods added, run `npm run typecheck` scoped to strategy-ai files to verify 0 errors

  **Must NOT do**:
  - Do NOT create new DB tables — reuse existing ones (sim_runs, game_experiments, etc. already exist per STRATEGY_MIGRATIONS)
  - Do NOT change strategy-ai's postgres connection pattern
  - Do NOT use `as any` or `@ts-ignore`

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Requires reading multiple existing type files and matching postgres table schemas precisely
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 5)
  - **Blocks**: Task 7 (route registration), Task 8 (Strategy UI)
  - **Blocked By**: None

  **References**:
  - `src/services/strategy-ai/store.ts:198-530` — full StrategyStore class; follow existing method patterns exactly (pool.query, rowPayload, nowIso)
  - `src/services/strategy-ai/store.ts:6-19` — TABLES constant (sim_runs, game_experiments, payoff_matrices, evolution_history, nash_equilibria all exist)
  - `src/services/strategy-ai/game-theory/index.ts` — READ FIRST to find GameExperiment, PayoffMatrix, EvolutionHistory, NashEquilibrium types
  - `src/services/strategy-ai/historical-backtest.ts` — BacktestConfig, BacktestResult, MonteCarloResult types to import
  - `src/services/strategy-ai/routes.ts:11` — the exact import that currently fails (`BacktestRun` from `./store.js`)
  - `src/services/strategy-ai/routes.ts:435-600` — all usages of missing methods (read to understand expected signatures)

  **Acceptance Criteria**:
  ```
  Scenario: TypeScript compiles cleanly
    Tool: Bash
    Steps:
      1. npx tsc --noEmit --project tsconfig.json 2>&1 | grep strategy-ai
      2. Assert: zero lines of output (no errors in strategy-ai files)
    Evidence: .sisyphus/evidence/task-4-typecheck.txt
  ```

  **Commit**: YES — `feat(strategy-ai): add BacktestRun type and 8 missing StrategyStore methods`

- [x] 5. MIT Daily Ideas — Verify pipeline trigger, fix empty-state contract

  **What to do**:
  - Read `src/mit-routes.ts` around line 960 to understand the exact 404 logic for `GET /api/mit/daily-ideas`
  - Read `src/mit-routes.ts` around line 608 to understand `POST /api/mit/pipeline/run`
  - Verify the pipeline run endpoint works: trace from request → MIT store write → daily ideas populated
  - Fix `GET /api/mit/daily-ideas`: change the 404 response to include a machine-readable `remediation` field:
    ```json
    { "error": "No pipeline run found", "remediation": "POST /api/mit/pipeline/run to generate daily ideas" }
    ```
  - If the pipeline run endpoint has any broken dependencies (e.g. screenipy path, missing config), fix them so `POST /api/mit/pipeline/run` can complete successfully
  - Do NOT change the pipeline logic itself — only fix the error response and verify the trigger works

  **Must NOT do**:
  - Do NOT change MIT pipeline business logic
  - Do NOT seed fake/mock daily ideas
  - Do NOT change the response schema when ideas DO exist

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Primarily verification + small error response improvement
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 4)
  - **Blocks**: Nothing
  - **Blocked By**: None

  **References**:
  - `src/mit-routes.ts:960` — `GET /api/mit/daily-ideas` endpoint (exact 404 condition)
  - `src/mit-routes.ts:608` — `POST /api/mit/pipeline/run` trigger
  - `src/mit-store.ts` — MIT store interface for dailyRuns

  **Acceptance Criteria**:
  ```
  Scenario: Informative 404 when no run exists
    Tool: Bash (curl)
    Steps:
      1. GET /api/mit/daily-ideas (cold state, no runs)
      2. Assert: 404, body.remediation contains 'POST /api/mit/pipeline/run'
    Evidence: .sisyphus/evidence/task-5-no-ideas.json

  Scenario: Pipeline trigger returns a runId
    Tool: Bash (curl)
    Steps:
      1. POST /api/mit/pipeline/run
      2. Assert: 200 or 202, response has .runId field
    Evidence: .sisyphus/evidence/task-5-trigger.json
  ```

  **Commit**: YES — `fix(mit): improve daily-ideas empty state error response`

- [x] 6. Watchlist UI — App.tsx editor (depends on Task 1)

  **What to do**:
  - In `src/App.tsx`: find the watchlist section (around line 633) that renders read-only watchlist cards
  - Add a **'New Watchlist' form**: an inline form with text input for name and a comma-separated tickers input, a Submit button that `POST`s to `/api/watchlists`
  - Add **Edit mode** per watchlist card: a pencil icon button that toggles the card into edit mode (name + tickers fields pre-populated), with Save (PUT) and Cancel buttons
  - Add **Delete button** per watchlist card: a trash icon that calls `DELETE /api/watchlists/:id` with a `confirm()` guard, then refreshes the list
  - Use `htm` tagged template literals throughout — `html\`...\`` syntax, NOT JSX
  - After any mutation (create/update/delete), re-fetch `GET /api/watchlists` and update local state
  - Keep styling consistent with existing watchlist card styles

  **Must NOT do**:
  - Do NOT use JSX syntax — App.tsx uses `htm` only
  - Do NOT add new npm packages
  - Do NOT redesign the watchlist section layout — minimal additions only

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI work in a React app with htm tagged templates, needs careful attention to existing patterns
  - **Skills**: [`frontend-design-system`]
    - `frontend-design-system`: Ensures new form/button elements match the existing Tailwind + component style

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 7, 8)
  - **Parallel Group**: Wave 2
  - **Blocks**: Nothing
  - **Blocked By**: Task 1 (Watchlist CRUD backend must exist first)

  **References**:
  - `src/App.tsx:633` — existing watchlist card rendering (extend this, don't replace)
  - `src/App.tsx:101` — `htm` import pattern (`html` tagged template)
  - Any existing form/input in App.tsx — follow the same styling pattern for new inputs

  **Acceptance Criteria**:
  ```
  Scenario: Create watchlist via UI
    Tool: Playwright
    Steps:
      1. Navigate to http://localhost:5173 (or :3000)
      2. Find the 'New Watchlist' form in the watchlist section
      3. Fill name='UI Test', tickers='HAL,BEL'
      4. Click Submit
      5. Assert: new card 'UI Test' appears in the watchlist list
    Evidence: .sisyphus/evidence/task-6-create.png

  Scenario: Delete watchlist via UI
    Tool: Playwright
    Steps:
      1. Click delete button on 'UI Test' card
      2. Confirm the dialog
      3. Assert: 'UI Test' card is gone from the list
    Evidence: .sisyphus/evidence/task-6-delete.png
  ```

  **Commit**: YES — `feat(ui): watchlist create/edit/delete in App.tsx`

- [x] 7. Register Strategy-AI Routes in server.ts + startup guard (depends on Task 4)

  **What to do**:
  - In `src/server.ts` imports section (around line 50): add `import { registerStrategyAiRoutes } from './services/strategy-ai/routes.js'`
  - In the `buildServer()` function body, register routes with a guard:
    ```typescript
    const storeBackend = process.env.STORE_BACKEND ?? 'json';
    if (storeBackend === 'postgres') {
      await registerStrategyAiRoutes(app);
    } else {
      app.get('/api/strategies', async (_req, reply) => {
        return reply.code(501).send({ error: 'strategy-ai requires PostgreSQL; set STORE_BACKEND=postgres' });
      });
      // Similarly register 501 stubs for other strategy routes if needed
    }
    ```
  - Verify the server still starts cleanly in JSON mode: `npm run dev` must not crash

  **Must NOT do**:
  - Do NOT initialize `StrategyStore` outside the postgres guard
  - Do NOT let startup fail when `STORE_BACKEND=json`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small wiring task, mostly one function call + guard
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 6, 8)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 8 (Strategy UI needs working endpoints)
  - **Blocked By**: Task 4 (StrategyStore methods must be fixed first)

  **References**:
  - `src/server.ts:57` — `import { registerMitRoutes }` as pattern to follow
  - `src/server.ts:410-415` — where MIT routes are registered inside `buildServer()` (add strategy routes nearby)
  - `src/services/strategy-ai/routes.ts:32` — `registerStrategyAiRoutes(app)` function signature

  **Acceptance Criteria**:
  ```
  Scenario: Server starts in JSON mode without crashing
    Tool: Bash
    Steps:
      1. STORE_BACKEND=json npm run dev (wait 3s)
      2. Assert: no crash, process is running
      3. curl http://localhost:3000/api/strategies
      4. Assert: 501, body.error contains 'requires PostgreSQL'
    Evidence: .sisyphus/evidence/task-7-json-mode.txt

  Scenario: Strategy routes available in postgres mode
    Tool: Bash
    Steps:
      1. (with STORE_BACKEND=postgres) curl http://localhost:3000/api/strategies
      2. Assert: 200, body has 'strategies' array field
    Evidence: .sisyphus/evidence/task-7-postgres.json
  ```

  **Commit**: YES — `feat(server): register strategy-ai routes with postgres guard`

- [x] 8. Strategy Panel in App.tsx (depends on Task 7)

  **What to do**:
  - In `src/App.tsx`: add a new **Strategy** tab/panel. The app likely has a tab navigation system — add 'strategy' as a new tab alongside existing ones
  - The panel must include (MVP only):
    - **Strategy List**: `GET /api/strategies` — show a table/list of strategies with id, name, status, sector, tags
    - **Create Strategy**: a text prompt input + Submit button that `POST`s to `/api/strategies` with `{ prompt }` body
    - **Trigger Simulation**: a 'Simulate' button per strategy row that `POST`s to `/api/strategies/:id/simulate`
    - **Results / Rankings**: show the most recent simulation result from `GET /api/strategies/:id/rankings` if available
  - Show a graceful message ('Strategy AI requires PostgreSQL mode') when the API returns 501
  - Use `htm` tagged template literals throughout

  **Must NOT do**:
  - Do NOT add game-theory or Monte Carlo UI in this MVP
  - Do NOT use JSX
  - Do NOT add new npm packages

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: React UI in htm template syntax, multi-section panel with data fetching
  - **Skills**: [`frontend-design-system`]
    - `frontend-design-system`: Consistent styling with existing panels

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 6)
  - **Parallel Group**: Wave 2
  - **Blocks**: Nothing
  - **Blocked By**: Task 7 (routes must be registered before UI can call them)

  **References**:
  - `src/App.tsx:101` — htm import, tab navigation pattern (find how existing tabs are rendered)
  - `src/MitDashboard.tsx` — a full dashboard panel example to follow for layout structure
  - `src/App.tsx` — how other panels (signals, watchlists) fetch data and manage state
  - Strategy API shape: POST /api/strategies body `{prompt}`, GET /api/strategies returns `{strategies: Strategy[], count}`, see `src/services/strategy-ai/routes.ts:56-98` for exact request/response shapes

  **Acceptance Criteria**:
  ```
  Scenario: Strategy panel renders
    Tool: Playwright
    Steps:
      1. Navigate to app, click 'Strategy' tab
      2. Assert: panel is visible, shows strategy list or empty state
    Evidence: .sisyphus/evidence/task-8-panel.png

  Scenario: Create strategy from prompt
    Tool: Playwright
    Steps:
      1. Type 'Momentum strategy for defense stocks' in prompt input
      2. Click Create
      3. Assert: new strategy appears in the list
    Evidence: .sisyphus/evidence/task-8-create.png

  Scenario: Graceful 501 message in JSON mode
    Tool: Playwright
    Steps:
      1. With server in JSON mode, navigate to Strategy panel
      2. Assert: 'requires PostgreSQL' message is visible, no crash
    Evidence: .sisyphus/evidence/task-8-degraded.png
  ```

  **Commit**: YES — `feat(ui): strategy panel in App.tsx with list/create/simulate`


---

## Commit Strategy

- Task 1+2: `feat(store): watchlist CRUD + signal wipe endpoints`
- Task 3: `fix(supply-chain): ensure graph populates via entity fallback`
- Task 4+7: `feat(strategy-ai): add missing store methods and register routes`
- Task 5: `fix(mit): verify daily-ideas pipeline trigger`
- Task 6+8: `feat(ui): watchlist editor + strategy panel in App.tsx`

## Success Criteria

```bash
# Watchlist create
curl -s -X POST -H 'x-user-id: demo-analyst' -H 'content-type: application/json' \
  -d '{"name":"Test","tickers":["HAL","BEL"]}' http://localhost:3000/api/watchlists | jq -r '.id'
# Expected: wl-xxxxx

# Signal wipe (system-only)
curl -s -X DELETE -H 'x-user-id: demo-admin' http://localhost:3000/api/signals | jq
# Expected: { clearedSignals: N, reingestTriggered: true }

# Supply chain graph
curl -s http://localhost:3000/api/supply-chain-graph | jq '.nodes | length'
# Expected: > 0

# Typecheck
npm run typecheck; echo "Exit: $?"
# Expected: Exit: 0

# Strategy routes
curl -s http://localhost:3000/api/strategies | jq -r 'type'
# Expected: object (with strategies array)
```

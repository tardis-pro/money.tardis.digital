# Terminal Real Data Completion Plan

## TL;DR

> **Quick Summary**: Complete terminal feature wiring, replace derived economics/price fields with real sources, make Screener coverage resilient for full universe, and seed sample strategies.
>
> **Deliverables**:
> - Fully wired Svelte terminal panels with working backend contracts
> - Real-data supply-chain economics and live (delayed) Yahoo snapshot pricing
> - Screener coverage across 52 MIT universe tickers with health and refresh paths
> - Historical data discovery path and seeded sample strategies
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: 1 -> 5 -> 6 -> 12 -> F1-F4

---

## Context

### Original Request
- "Terminal should have all the things"
- "Where do I fetch all historical data?"
- "Add sample strategies"
- "Replace derived supply-chain economics with real economic data"
- "Ensure Screener availability (avoid 10-ticker fallback dependence)"
- "Replace derived breadth-based snapshot prices with live, lowest-cost source"

### Interview Summary
**Key Discussions**:
- Terminal has endpoint mismatches (`/api/screener`, `/api/trades`, `/api/mit/hero`, pipeline status path) causing broken panels.
- Supply-chain node economics are currently synthetic math in `src/services/supply-chain-graph.ts`.
- Market snapshots are currently synthetic in `src/services/market-snapshot.ts`.
- User selected Yahoo Finance as preferred low-cost live source.
- User approved expanding Screener coverage to all 52 MIT universe tickers.

**Research Findings**:
- `src/config/mit-universe.json` has 52 tickers.
- `src/services/mit/screener-fundamentals-fetcher.ts` supports arbitrary ticker fetch.
- `src/services/mit/market-data.ts` already uses Yahoo/NSE for real market candles.
- Strategy AI has builtin and advanced templates but advanced samples are not fully exposed/seeded.

### Metis Review
**Identified Gaps** (addressed in this plan):
- Define explicit stale/failure behavior for quote/fundamental fetch failures.
- Prevent scope creep into paid/real-time broker integrations.
- Add hard acceptance criteria for 52-ticker coverage and removal of synthetic formulas.

---

## Work Objectives

### Core Objective
Make the terminal operationally complete with real backing data for economics and prices, while preserving low operating cost and adding immediately usable strategy samples.

### Concrete Deliverables
- Working terminal panels for chat/signals/alerts/portfolio/heatmap/screener/pipeline/hero/trades.
- Real-data powered `market-snapshot` output (Yahoo quote based).
- Real-data powered supply-chain economics fields with explicit fallback metadata.
- Screener-backed entity/fundamentals coverage for all 52 universe tickers.
- Historical data fetch map surfaced via API/docs.
- Seeded sample strategies available via strategy endpoints.

### Definition of Done
- [ ] Terminal panel fetches return non-error payloads for all nine panels.
- [ ] Snapshot prices are no longer derived from breadth math.
- [ ] Supply-chain economics are sourced from fetched fundamentals (or explicit stale fallback).
- [ ] Screener refresh attempts 52/52 universe symbols with reportable success/failure counts.
- [ ] Sample strategies are listed and executable in simulation endpoint.

### Must Have
- Yahoo Finance as default no-key live quote source.
- Screener reliability controls (retry/backoff/cache/health status).
- Historical data source path visible through endpoint and docs.

### Must NOT Have (Guardrails)
- No paid provider rollout in this change.
- No Windmill/orchestrator migration.
- No schema-breaking API contract changes unless additive and documented.
- No synthetic fallback silently labeled as live.

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — all verification agent-executed.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: Tests-after
- **Framework**: `node --test` via `npm run test`, plus `npm run typecheck`

### QA Policy
- Every task contains executable QA scenarios (happy + failure/edge).
- Evidence path format: `.sisyphus/evidence/task-{N}-{scenario}.{ext}`.
- UI/API verification uses Playwright + curl + terminal logs.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation + contracts):
├── Task 1: Terminal API contract normalization [quick]
├── Task 2: Historical data source map + endpoint [unspecified-high]
├── Task 3: Strategy sample catalog design + seed schema [quick]
├── Task 4: Screener reliability envelope (health/retry/cache policy) [unspecified-high]
└── Task 5: Yahoo quote client for snapshot pricing [quick]

Wave 2 (Core implementation):
├── Task 6: Supply-chain real economics integration [deep]
├── Task 7: Entity loader universe expansion to 52 [unspecified-high]
├── Task 8: Terminal panel endpoint rewiring [visual-engineering]
├── Task 9: Strategy sample seeding + template exposure [unspecified-high]
└── Task 10: Snapshot service migration to live quotes [quick]

Wave 3 (Integration + scheduling):
├── Task 11: Policy ingestion scheduling + freshness metadata [unspecified-high]
├── Task 12: End-to-end terminal data integrity tests [deep]
└── Task 13: Historical fetch UX/docs integration in terminal/app [writing]

Wave 4 (Stability):
├── Task 14: Failure-path resilience tests (provider down/partial data) [deep]
├── Task 15: Performance/rate-limit hardening pass [unspecified-high]
└── Task 16: Release readiness + migration notes [writing]

Wave FINAL (Parallel review):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA execution (unspecified-high)
└── Task F4: Scope fidelity check (deep)
```

### Dependency Matrix
- **1**: none -> 8, 12
- **2**: none -> 13
- **3**: none -> 9
- **4**: none -> 7, 15
- **5**: none -> 10
- **6**: 5,7 -> 12,14
- **7**: 4 -> 6,12,14
- **8**: 1 -> 12
- **9**: 3 -> 12
- **10**: 5 -> 12,14
- **11**: 2 -> 12,16
- **12**: 6,7,8,9,10,11 -> 14,16
- **13**: 2,8 -> 16
- **14**: 6,7,10,12 -> 16
- **15**: 4,7,10 -> 16
- **16**: 11,12,13,14,15 -> FINAL

### Agent Dispatch Summary
- **Wave 1**: T1 quick, T2 unspecified-high, T3 quick, T4 unspecified-high, T5 quick
- **Wave 2**: T6 deep, T7 unspecified-high, T8 visual-engineering, T9 unspecified-high, T10 quick
- **Wave 3**: T11 unspecified-high, T12 deep, T13 writing
- **Wave 4**: T14 deep, T15 unspecified-high, T16 writing
- **Final**: F1 oracle, F2 unspecified-high, F3 unspecified-high (+playwright), F4 deep

---

## TODOs

---

- [ ] 1. Terminal API contract normalization

  **What to do**:
  - Build a terminal endpoint contract map in code and align fetch helpers with backend route signatures.
  - Normalize method mismatches (`GET` vs `POST`) and missing path aliases where needed.

  **Must NOT do**:
  - Do not change business logic payload shapes.

  **Recommended Agent Profile**:
  - **Category**: `quick` (route mapping and adapter-level fixes)
  - **Skills**: [`typescript-best-practices`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 8, 12
  - **Blocked By**: None

  **References**:
  - `src/terminal/App.svelte` - current terminal fetch calls.
  - `src/mit-routes.ts` - canonical MIT endpoint paths.
  - `src/server.ts` - non-MIT endpoint registrations.

  **Acceptance Criteria**:
  - [ ] No terminal fetch path points to non-existent API route.
  - [ ] `npm run typecheck` passes after mapping changes.

  **QA Scenarios**:
  ```
  Scenario: Path contract check (happy)
    Tool: Bash
    Steps:
      1. Grep terminal fetch URLs.
      2. Verify each URL exists in server/mit routes.
    Expected Result: 0 unresolved paths.
    Evidence: .sisyphus/evidence/task-1-contract-map.txt

  Scenario: Missing route guard (failure)
    Tool: Bash
    Steps:
      1. Run endpoint smoke curl script.
      2. Assert no 404 for mapped endpoints.
    Expected Result: 404 count is 0.
    Evidence: .sisyphus/evidence/task-1-endpoint-smoke.txt
  ```

  **Commit**: YES

- [ ] 2. Historical data source map + discovery endpoint

  **What to do**:
  - Add endpoint returning where historical data comes from (NSE, Yahoo, Screener, cache paths, range coverage).
  - Include source freshness timestamps and coverage counts.

  **Must NOT do**:
  - Do not expose secrets or internal tokens.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`typescript-best-practices`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 13
  - **Blocked By**: None

  **References**:
  - `src/services/mit/market-data.ts` - candle data providers and cache path.
  - `data/mit-candles/` - historical candle store.
  - `src/services/mit/fundamentals-provider.ts` - fundamentals sources.

  **Acceptance Criteria**:
  - [ ] Endpoint returns source list, coverage range, and cache path references.
  - [ ] Endpoint clearly marks delayed/live status.

  **QA Scenarios**:
  ```
  Scenario: Historical map response (happy)
    Tool: Bash (curl)
    Steps:
      1. GET historical-source endpoint.
      2. Assert keys: providers, coverage, cachePath.
    Expected Result: JSON includes all required keys.
    Evidence: .sisyphus/evidence/task-2-historical-map.json

  Scenario: Empty cache edge case (failure)
    Tool: Bash
    Steps:
      1. Simulate missing cache path in test env.
      2. Call endpoint and assert graceful degraded response.
    Expected Result: 200 with `status: degraded`, not crash.
    Evidence: .sisyphus/evidence/task-2-historical-degraded.txt
  ```

  **Commit**: YES

- [ ] 3. Strategy sample catalog + seed schema

  **What to do**:
  - Define sample strategy seed payloads for builtin + advanced templates.
  - Add idempotent seed mechanism (safe re-run).

  **Must NOT do**:
  - Do not overwrite user-created strategies.

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`typescript-best-practices`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 9
  - **Blocked By**: None

  **References**:
  - `src/services/strategy-ai/generator.ts` - builtin templates.
  - `src/services/strategy-ai/templates.ts` - advanced templates.
  - `src/services/strategy-ai/store.ts` - strategy persistence API.

  **Acceptance Criteria**:
  - [ ] Seed includes at least 8 sample strategies.
  - [ ] Re-running seed does not duplicate records.

  **QA Scenarios**:
  ```
  Scenario: Seed run idempotency (happy)
    Tool: Bash
    Steps:
      1. Run seed command twice.
      2. Compare sample count before/after second run.
    Expected Result: count unchanged on second run.
    Evidence: .sisyphus/evidence/task-3-seed-idempotent.txt

  Scenario: Invalid template reference (failure)
    Tool: Bash
    Steps:
      1. Seed with one invalid template id in test fixture.
      2. Assert partial success and explicit error reporting.
    Expected Result: invalid entry rejected, valid entries created.
    Evidence: .sisyphus/evidence/task-3-invalid-template.txt
  ```

  **Commit**: YES

- [ ] 4. Screener reliability envelope

  **What to do**:
  - Add health endpoint/status exposing Screener availability, last success, fail count.
  - Implement bounded retry/backoff and cache-age policy for Screener fetchers.

  **Must NOT do**:
  - Do not block request thread indefinitely waiting on Screener.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`typescript-best-practices`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 7, 15
  - **Blocked By**: None

  **References**:
  - `src/services/config/entity-loader.ts` - current source + fallback behavior.
  - `src/services/config/base-loader.ts` - source selection and fallback pattern.
  - `src/services/mit/screener-fundamentals-fetcher.ts` - existing fetch throttling.

  **Acceptance Criteria**:
  - [ ] Health endpoint includes `available`, `lastCheckedAt`, `lastSuccessAt`, `errorRate`.
  - [ ] Retry policy capped and observable in logs/metrics.

  **QA Scenarios**:
  ```
  Scenario: Screener up check (happy)
    Tool: Bash (curl)
    Steps:
      1. GET screener health endpoint.
      2. Assert `available=true` and timestamp fields present.
    Expected Result: healthy response with freshness metadata.
    Evidence: .sisyphus/evidence/task-4-health-up.json

  Scenario: Screener timeout (failure)
    Tool: Bash
    Steps:
      1. Inject timeout in test mode.
      2. Call health endpoint and fetch route.
    Expected Result: degraded status + cached fallback path, no crash.
    Evidence: .sisyphus/evidence/task-4-health-timeout.txt
  ```

  **Commit**: YES

- [ ] 5. Yahoo quote client for snapshot pricing

  **What to do**:
  - Add quote fetch client using Yahoo quote endpoint for `.NS` symbols.
  - Return `latestPrice`, `dayChangePct`, `quoteTime`, `isDelayed`.

  **Must NOT do**:
  - Do not require API key or paid plan.

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`typescript-best-practices`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: 10, 6
  - **Blocked By**: None

  **References**:
  - `src/services/mit/market-data.ts` - existing Yahoo conventions.
  - `src/services/market-snapshot.ts` - consumer of price fields.

  **Acceptance Criteria**:
  - [ ] Quote client handles batched ticker fetch.
  - [ ] Client returns explicit stale/degraded metadata on failure.

  **QA Scenarios**:
  ```
  Scenario: Yahoo quote fetch (happy)
    Tool: Bash
    Steps:
      1. Request quotes for 5 known NSE tickers.
      2. Assert positive numeric prices and non-empty timestamp.
    Expected Result: all requested symbols resolved.
    Evidence: .sisyphus/evidence/task-5-yahoo-happy.json

  Scenario: Invalid ticker handling (failure)
    Tool: Bash
    Steps:
      1. Include invalid ticker in quote batch.
      2. Assert partial success with per-symbol error metadata.
    Expected Result: valid symbols resolved, invalid flagged.
    Evidence: .sisyphus/evidence/task-5-yahoo-invalid.txt
  ```

  **Commit**: YES

- [ ] 6. Supply-chain real economics integration

  **What to do**:
  - Replace formula-derived node `production/demand/imports/exports/surplus` with values derived from fetched fundamentals.
  - Attach source metadata per node (`live|cached|fallback`, `asOf`).

  **Must NOT do**:
  - Do not leave synthetic formula path active as default.

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`typescript-best-practices`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: 12, 14
  - **Blocked By**: 5, 7

  **References**:
  - `src/services/supply-chain-graph.ts` - current economics derivation lines.
  - `src/services/mit/screener-fundamentals-fetcher.ts` - real financial fields.
  - `src/types.ts` - supply-chain node schema.

  **Acceptance Criteria**:
  - [ ] Node economics can be traced to fetched fundamentals.
  - [ ] Response contains source provenance and timestamp.

  **QA Scenarios**:
  ```
  Scenario: Real-economics node output (happy)
    Tool: Bash (curl)
    Steps:
      1. Build supply-chain graph.
      2. Assert node economics present with `source=live|cached`.
    Expected Result: no default synthetic-only values.
    Evidence: .sisyphus/evidence/task-6-supplychain-live.json

  Scenario: Fundamentals unavailable (failure)
    Tool: Bash
    Steps:
      1. Force fundamentals fetch fail in test mode.
      2. Request graph and verify explicit fallback marker.
    Expected Result: graph returns with `source=fallback`, no crash.
    Evidence: .sisyphus/evidence/task-6-supplychain-fallback.txt
  ```

  **Commit**: YES

- [ ] 7. Entity loader expansion to full 52 universe

  **What to do**:
  - Replace static 10-ticker list with dynamic load from `mit-universe.json`.
  - Add refresh command/path to hydrate and cache all universe entities.

  **Must NOT do**:
  - Do not silently drop tickers from coverage reports.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`typescript-best-practices`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: 6, 12, 14
  - **Blocked By**: 4

  **References**:
  - `src/services/config/entity-loader.ts` - knownTickers + fallback map.
  - `src/config/mit-universe.json` - source-of-truth ticker list.

  **Acceptance Criteria**:
  - [ ] Refresh attempts exactly 52 tickers.
  - [ ] Response reports `requested`, `succeeded`, `failed`, and missing critical fields.

  **QA Scenarios**:
  ```
  Scenario: Full universe refresh (happy)
    Tool: Bash (curl)
    Steps:
      1. Trigger entity refresh.
      2. Assert `requested=52` and coverage report returned.
    Expected Result: coverage report generated for all symbols.
    Evidence: .sisyphus/evidence/task-7-entity-refresh.json

  Scenario: Partial provider outage (failure)
    Tool: Bash
    Steps:
      1. Simulate timeouts for subset.
      2. Assert failed subset explicitly listed.
    Expected Result: partial success with explicit failures.
    Evidence: .sisyphus/evidence/task-7-entity-partial.txt
  ```

  **Commit**: YES

- [ ] 8. Terminal panel endpoint rewiring

  **What to do**:
  - Update Svelte terminal fetches to real route paths/methods.
  - Ensure all nine panels load/refresh with non-error responses.

  **Must NOT do**:
  - Do not add mock panel placeholders.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: [`frontend-design-system`, `typescript-best-practices`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: 12, 13
  - **Blocked By**: 1

  **References**:
  - `src/terminal/App.svelte` - panel fetch + run actions.
  - `src/mit-routes.ts` - route signatures.

  **Acceptance Criteria**:
  - [ ] Panels `screener/pipeline/hero/trades` no longer hit invalid routes.
  - [ ] Run buttons trigger valid methods and show response state.

  **QA Scenarios**:
  ```
  Scenario: Panel sweep (happy)
    Tool: Playwright
    Steps:
      1. Open terminal UI.
      2. Navigate panels 1-8 and trigger refresh.
      3. Assert no error banners and data rows render.
    Expected Result: all panels operational.
    Evidence: .sisyphus/evidence/task-8-panel-sweep.png

  Scenario: Backend 500 propagation (failure)
    Tool: Playwright
    Steps:
      1. Mock one endpoint to return 500.
      2. Refresh corresponding panel.
    Expected Result: graceful error state shown, app remains usable.
    Evidence: .sisyphus/evidence/task-8-panel-error.png
  ```

  **Commit**: YES

- [ ] 9. Strategy sample seeding + template exposure

  **What to do**:
  - Expose advanced templates in list endpoint (or dedicated endpoint).
  - Seed builtin + advanced sample strategies into strategy store (idempotent).

  **Must NOT do**:
  - Do not require LLM provider for seed creation.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: [`typescript-best-practices`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: 12
  - **Blocked By**: 3

  **References**:
  - `src/services/strategy-ai/routes.ts` - template and strategy routes.
  - `src/services/strategy-ai/templates.ts` - advanced template objects.
  - `src/services/strategy-ai/store.ts` - persistence methods.

  **Acceptance Criteria**:
  - [ ] `GET /api/templates` (or equivalent) includes advanced samples.
  - [ ] Seeded strategies are runnable by simulate endpoint.

  **QA Scenarios**:
  ```
  Scenario: Template list includes seeded samples (happy)
    Tool: Bash (curl)
    Steps:
      1. Call template list endpoint.
      2. Assert builtin + advanced ids present.
    Expected Result: >= 8 templates/samples discoverable.
    Evidence: .sisyphus/evidence/task-9-template-list.json

  Scenario: Simulate seeded strategy with missing data (failure)
    Tool: Bash
    Steps:
      1. Simulate seeded strategy on ticker without candles.
      2. Assert informative failure with remediation.
    Expected Result: graceful error, no unhandled exception.
    Evidence: .sisyphus/evidence/task-9-sim-failure.txt
  ```

  **Commit**: YES

- [ ] 10. Market snapshot migration to live Yahoo quotes

  **What to do**:
  - Replace breadth-derived `latestPrice/dayChangePct` in snapshot service with quote-client output.
  - Keep `breadthSignalScore` as separate analytical field only.

  **Must NOT do**:
  - Do not compute price as function of signal score/outcomes.

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`typescript-best-practices`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: 12, 14
  - **Blocked By**: 5

  **References**:
  - `src/services/market-snapshot.ts` - current derived formula block.
  - `src/types.ts` - `MarketSnapshotEntry` contract.

  **Acceptance Criteria**:
  - [ ] Derived formula lines removed.
  - [ ] Snapshot response includes quote timestamp/staleness metadata.

  **QA Scenarios**:
  ```
  Scenario: Live quote snapshot (happy)
    Tool: Bash (curl)
    Steps:
      1. Request snapshots for 10 symbols.
      2. Assert all prices > 0 and updatedAt near quote time.
    Expected Result: response driven by quote feed.
    Evidence: .sisyphus/evidence/task-10-snapshot-live.json

  Scenario: Quote provider down (failure)
    Tool: Bash
    Steps:
      1. Force quote client failure.
      2. Request snapshots.
    Expected Result: degraded marker + stale cached values or omitted symbols per policy.
    Evidence: .sisyphus/evidence/task-10-snapshot-degraded.txt
  ```

  **Commit**: YES

- [ ] 11. Policy ingestion scheduling + freshness metadata

  **What to do**:
  - Add scheduler entry for policy ingest run in compose scheduler.
  - Surface last ingestion run and freshness in status endpoint.

  **Must NOT do**:
  - Do not introduce Windmill or extra orchestrator.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: 12, 16
  - **Blocked By**: 2

  **References**:
  - `docker-compose.yml` - scheduler container cron definitions.
  - `src/server.ts` - `POST /api/ingest/run`.

  **Acceptance Criteria**:
  - [ ] Policy ingest schedule entry exists and logs execution.
  - [ ] Status endpoint exposes last successful run timestamp.

  **QA Scenarios**:
  ```
  Scenario: Scheduled trigger visible (happy)
    Tool: Bash
    Steps:
      1. Start scheduler + app.
      2. Check cron log and status endpoint.
    Expected Result: ingest run recorded with timestamp.
    Evidence: .sisyphus/evidence/task-11-scheduler-log.txt

  Scenario: Endpoint unavailable during schedule (failure)
    Tool: Bash
    Steps:
      1. Stop app briefly during scheduled call.
      2. Assert scheduler logs failure and retries next cycle.
    Expected Result: failure visible, no scheduler crash.
    Evidence: .sisyphus/evidence/task-11-scheduler-failure.txt
  ```

  **Commit**: YES

- [ ] 12. End-to-end terminal data integrity tests

  **What to do**:
  - Add integration tests validating full terminal data path with real endpoints.
  - Validate cross-panel consistency (portfolio/trades/hero/pipeline).

  **Must NOT do**:
  - Do not rely on mock API fixtures as default path.

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`playwright`, `typescript-best-practices`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: 14, 16
  - **Blocked By**: 1,6,7,8,9,10,11

  **References**:
  - `src/terminal/App.svelte` - all panel state bindings.
  - `src/mit-routes.ts` and `src/server.ts` - API behavior.

  **Acceptance Criteria**:
  - [ ] One automated sweep test passes across all terminal panels.
  - [ ] API contract assertions detect route regressions.

  **QA Scenarios**:
  ```
  Scenario: Full panel E2E sweep (happy)
    Tool: Playwright
    Steps:
      1. Open terminal.
      2. Visit each panel and trigger action.
      3. Assert non-empty data or explicit empty-state text.
    Expected Result: no panel returns uncaught errors.
    Evidence: .sisyphus/evidence/task-12-e2e-sweep.mp4

  Scenario: Route regression catch (failure)
    Tool: Playwright + Bash
    Steps:
      1. Run test with one intentionally wrong route fixture.
      2. Assert test fails with explicit contract mismatch.
    Expected Result: failure is deterministic and descriptive.
    Evidence: .sisyphus/evidence/task-12-regression.txt
  ```

  **Commit**: YES

- [ ] 13. Historical fetch UX/docs integration

  **What to do**:
  - Surface "where historical data comes from" in terminal/help panel and API docs.
  - Add direct commands/links for cache location and refresh operations.

  **Must NOT do**:
  - Do not include stale instructions or wrong endpoints.

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: 16
  - **Blocked By**: 2,8

  **References**:
  - `README.md` - existing run/data commands.
  - `src/terminal/App.svelte` - command help and panel hints.

  **Acceptance Criteria**:
  - [ ] Users can discover historical source path from terminal/help.
  - [ ] Docs include command sequence for full historical fetch.

  **QA Scenarios**:
  ```
  Scenario: Help discoverability (happy)
    Tool: Playwright
    Steps:
      1. Open terminal help/command panel.
      2. Search for historical data guidance text.
    Expected Result: guidance visible and actionable.
    Evidence: .sisyphus/evidence/task-13-help.png

  Scenario: Broken doc command (failure)
    Tool: Bash
    Steps:
      1. Execute documented historical command sequence in CI shell.
      2. Assert non-zero fails test.
    Expected Result: docs commands are validated executable.
    Evidence: .sisyphus/evidence/task-13-doc-command.txt
  ```

  **Commit**: YES

- [ ] 14. Failure-path resilience tests

  **What to do**:
  - Add tests for provider outage, partial symbol failures, stale cache fallback.
  - Validate service returns degraded status instead of exceptions.

  **Must NOT do**:
  - Do not swallow errors without observability metadata.

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`typescript-best-practices`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: 16
  - **Blocked By**: 6,7,10,12

  **References**:
  - `src/services/market-snapshot.ts` - quote fallback behavior.
  - `src/services/config/entity-loader.ts` - source fallback.
  - `src/services/supply-chain-graph.ts` - economics source tags.

  **Acceptance Criteria**:
  - [ ] Failure path tests cover quote, screener, and graph dependencies.
  - [ ] Degraded responses include reason + timestamp.

  **QA Scenarios**:
  ```
  Scenario: Quote outage resilience (happy failure-path)
    Tool: Bash
    Steps:
      1. Disable quote upstream in test harness.
      2. Call snapshot endpoint.
    Expected Result: 200 degraded response, no process crash.
    Evidence: .sisyphus/evidence/task-14-quote-outage.json

  Scenario: Screener outage resilience (failure)
    Tool: Bash
    Steps:
      1. Simulate Screener timeout.
      2. Trigger entity + supply-chain fetch.
    Expected Result: explicit fallback markers and failure counters.
    Evidence: .sisyphus/evidence/task-14-screener-outage.txt
  ```

  **Commit**: YES

- [ ] 15. Performance and rate-limit hardening

  **What to do**:
  - Add concurrency caps and jittered delays for 52-symbol refresh flows.
  - Ensure endpoints stay responsive under partial upstream slowness.

  **Must NOT do**:
  - Do not remove throttling protections.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: 16
  - **Blocked By**: 4,7,10

  **References**:
  - `src/services/mit/screener-fundamentals-fetcher.ts` - current sleep/throttle.
  - `src/services/config/entity-loader.ts` - fetch loop behavior.

  **Acceptance Criteria**:
  - [ ] 52-symbol refresh completes within defined bound in normal network conditions.
  - [ ] Rate-limit errors are retried with backoff then surfaced.

  **QA Scenarios**:
  ```
  Scenario: Universe refresh runtime (happy)
    Tool: Bash
    Steps:
      1. Trigger 52 ticker refresh.
      2. Measure completion duration.
    Expected Result: completes within agreed budget (e.g., <= 3 min).
    Evidence: .sisyphus/evidence/task-15-runtime.txt

  Scenario: HTTP 429 handling (failure)
    Tool: Bash
    Steps:
      1. Inject mocked 429 responses.
      2. Verify retries then explicit failure report.
    Expected Result: controlled retry then clear partial-failure output.
    Evidence: .sisyphus/evidence/task-15-rate-limit.txt
  ```

  **Commit**: YES

- [ ] 16. Release readiness and operator notes

  **What to do**:
  - Finalize operational notes for live-data mode, delayed quote caveat, and troubleshooting.
  - Document exact commands to run pipeline, historical refresh, and strategy seed.

  **Must NOT do**:
  - Do not leave undocumented feature flags or hidden dependencies.

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4
  - **Blocks**: FINAL
  - **Blocked By**: 11,12,13,14,15

  **References**:
  - `README.md` - operational command section.
  - `docker-compose.yml` - scheduler configuration.

  **Acceptance Criteria**:
  - [ ] Operator notes include all added endpoints and expected response examples.
  - [ ] Runbook covers outage modes and fallback behavior.

  **QA Scenarios**:
  ```
  Scenario: Runbook execution (happy)
    Tool: Bash
    Steps:
      1. Execute documented runbook commands in order.
      2. Confirm each command exits 0.
    Expected Result: runbook is executable as written.
    Evidence: .sisyphus/evidence/task-16-runbook.txt

  Scenario: Missing env handling (failure)
    Tool: Bash
    Steps:
      1. Run with one required env missing in test env.
      2. Verify docs and app message provide remediation.
    Expected Result: clear error guidance, no silent failure.
    Evidence: .sisyphus/evidence/task-16-env-missing.txt
  ```

  **Commit**: YES


## Final Verification Wave (MANDATORY)

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N/N] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright`)
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N] | VERDICT`

---

## Commit Strategy

- **1**: `fix(terminal): align panel endpoints with mit routes`
- **2**: `feat(data): use yahoo live quotes for market snapshots`
- **3**: `feat(supply-chain): source node economics from fundamentals`
- **4**: `feat(strategy-ai): seed sample strategies and expose templates`
- **5**: `chore(reliability): expand screener universe coverage and health checks`

---

## Success Criteria

### Verification Commands
```bash
npm run typecheck
npm run test
curl -s http://localhost:3000/api/heatmap
curl -s http://localhost:3000/api/mit/trades
curl -s http://localhost:3000/api/mit/pipeline/latest
curl -s http://localhost:3000/api/market/snapshots?limit=10
curl -s http://localhost:3000/api/mit/fundamentals/refresh
curl -s http://localhost:3000/api/templates
```

### Final Checklist
- [ ] All terminal panels have working endpoint mappings
- [ ] Snapshot values sourced from real quote feed
- [ ] Supply-chain economics sourced from fetched fundamentals
- [ ] Screener attempts full 52 ticker universe with visibility into failures
- [ ] Historical data fetch route/documentation present
- [ ] Sample strategies are seeded and usable

# Production Backfill Playbook

This playbook captures practical patterns for hardening multi-year backfills in the India Policy Signal Terminal.

## Objectives

- Make backfills resumable and idempotent.
- Keep a clear audit trail for each run.
- Add deterministic event attribution for anomaly windows.

## Run Control Pattern

1. Start each run with a persisted run record (`running` status).
2. Process deterministic slices (`offset`, `batchSize`) over the filtered event universe.
3. End run with terminal status (`completed` or `failed`) and immutable counters.
4. Resume by passing the latest `nextOffset` from `/api/backfill/runs`.

## Idempotency and Dedupe

- Use deterministic content hash: `sha256(seedId + publishedAt + canonicalBody)`.
- Skip ingestion if existing artifact for same source has identical hash.
- Never mutate previous artifacts in-place.

## Observability Requirements

- Track `loadedSeeds`, `seededSignals`, `createdAlerts`, and `skippedDuplicates`.
- Track `startedAt`, `completedAt`, and terminal error text for failed runs.
- Keep governance log entries for each run.

## Reference Sources for Historical India Backfill

- RBI DBIE: `https://data.rbi.org.in/`
- RBI historical archives: `https://www.rbi.org.in/scripts/bs_viewcontent.aspx?Id=3864`
- PIB archives: `https://www.pib.gov.in/content/100_2_Archives.aspx`
- NSE historical reports: `https://www.nseindia.com/resources/historical-reports-capital-market-daily-monthly-archives`
- NSE price and volume history: `https://www.nseindia.com/historical/price-and-volume-data-per-security`

## Reliability Checklist

- Run in bounded batches (`batchSize <= 500`).
- Validate date ranges before execution.
- Validate anomaly observations for monotonic, unique timestamps.
- Winsorize extreme returns for numerical stability before z-score computation.

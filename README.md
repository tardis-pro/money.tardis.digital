# India Policy Signal Terminal (MVP)

Real-time intelligence platform for tracking and analyzing India policy signals across financial markets.

## Quick Start

```bash
# 1) Install dependencies
npm install

# 2) Configure environment
cp .env.example .env

# 3) Start API + UI dev servers
npm run dev

# 4) In another terminal, run end-to-end backfill smoke test
npm run e2e:backfill
```

- API + SSR UI: `http://localhost:3000`
- Vite UI (HMR): `http://localhost:5173`

## Run End-to-End

The end-to-end backfill script (`npm run e2e:backfill`) calls these API flows in order:

1. `POST /api/backfill/notable/preview`
2. `POST /api/backfill/notable`
3. `GET /api/backfill/runs`
4. `POST /api/anomalies/correlate`

If your server is not on port `3000`, set:

```bash
E2E_BASE_URL=http://localhost:<port> npm run e2e:backfill
```

For a larger historical load (not just smoke test):

```bash
npm run data:load
```

## Optional PostgreSQL / Timescale Setup

```bash
docker compose up -d timescaledb
cp .env.example .env
# then set STORE_BACKEND=postgres in .env
npm run migrate
npm run dev
```

## What It Does

| Capability | Description |
|------------|-------------|
| **Signal Ingestion** | RSS, XML, HTML, PDF, and Screeni-py parsing with deduplication |
| **Event Intelligence** | Classification, entity linking, impact scoring, and probabilistic predictions |
| **Market Integration** | Supply-chain graphs, market snapshots, and portfolio risk tracking |
| **Alert System** | Threshold-based alerts with cooldown, routing, and quality metrics |
| **Backfill Engine** | Historical data replay with checkpointing and reconciliation |

## Historical Data

The MIT trading system caches 13+ years of OHLCV candle data locally.

**Check data sources and coverage:**

```bash
curl http://localhost:3000/api/mit/data/sources
```

Returns all data sources (Yahoo Finance, NSE India, Screener.in), cache paths, and date ranges.

**Fetch historical data for all 52 universe tickers:**

```bash
curl -X POST http://localhost:3000/api/mit/pipeline/run
```

Candles are cached in `data/mit-candles/{TICKER}.json`.

**Refresh fundamentals:**

```bash
curl http://localhost:3000/api/mit/fundamentals/refresh
```

**Check screener health:**

```bash
curl http://localhost:3000/api/mit/screener/health
```

## Architecture

```
Sources → Ingestion → Processing → Signals → Alerts → UI
                      ↓
               Event Stream Bus
```

- **Default Storage**: File-backed JSON (`data/`)
- **Optional**: PostgreSQL/Timescale (`STORE_BACKEND=postgres`)
- **UI**: React + Tailwind + Recharts (browser-loaded)

## Documentation

- [Product Requirements](docs/india-policy-signal-terminal-prd.md)
- [Production Backfill Playbook](docs/production-backfill-playbook.md)
- [Strategy Roadmap](STRATEGY.md)


## Operator Runbook

This section covers operational commands, health checks, and troubleshooting for production deployments.

### Live Data Mode

The system distinguishes between live and cached data using the `dataSource` field in API responses.

**Verify data freshness:**

```bash
# Check policy signal ingestion status
curl http://localhost:3000/api/ingest/status
```

Response fields:
- `lastRun`: Timestamp of most recent ingest attempt
- `lastSuccess`: Timestamp of most recent successful ingest
- `freshness`: One of `"fresh"` (within 24h), `"stale"`, or `"never"`
- `signalCount`: Total signals in store
- `alertCount`: Total alerts in store

**Check data source coverage:**

```bash
curl http://localhost:3000/api/mit/data/sources
```

Returns cache paths, date ranges, and ticker coverage for all historical data sources.

### Delayed Quote Caveat

Yahoo Finance quotes for NSE stocks are delayed by approximately 15 minutes. This affects:

- `/api/mit/technicals/:ticker` — `latestClose` may be up to 15 minutes stale
- `/api/mit/entry-exit/:ticker` — Entry/exit zones computed from delayed prices
- `/api/mit/pnl/refresh` — Portfolio P&L uses most recent available close

For intraday trading decisions, always verify current prices on NSE or your broker terminal before execution. The system includes an `MIT_INTRADAY_REFRESH_SLOTS` environment variable (default: `10:00,12:30,14:45` IST) that triggers portfolio price refreshes during market hours.

### Pipeline Commands

**Run the full MIT trading pipeline:**

```bash
curl -X POST http://localhost:3000/api/mit/pipeline/run
```

This fetches OHLCV candles and fundamentals for all 52 universe tickers, computes technical indicators, generates composite scores, and produces daily trade ideas.

The pipeline is idempotent per calendar day. Running it multiple times on the same day returns:

```json
{ "status": "already_completed", "runId": "mit-run-2026-02-26", "message": "Pipeline already completed for today." }
```

**Run policy signal ingestion:**

```bash
curl -X POST http://localhost:3000/api/ingest/run
```

Optional query param: `?sourceId=xyz` to limit ingestion to a specific source.

**Refresh fundamentals from Screener.in and Yahoo:**

```bash
curl -X POST http://localhost:3000/api/mit/fundamentals/refresh
```

With body to limit scope:

```bash
curl -X POST -H "Content-Type: application/json" -d '{"limit": 20}' http://localhost:3000/api/mit/fundamentals/refresh
```

**Seed strategy templates:**

```bash
npm run seed:strategies
```

Optional base URL for remote seeding:

```bash
node scripts/seed-strategies.mjs --base-url https://your-server.com
```

### Health Checks

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Basic liveness check |
| `GET /ready` | Readiness check (verifies store connection) |
| `GET /api/mit/screener/health` | Screener.in entity loader health and cache coverage |
| `GET /api/ingest/status` | Policy ingestion freshness and signal/alert counts |
| `GET /api/mit/data/sources` | Historical data sources, cache paths, date ranges |

**Example health check chain:**

```bash
# Liveness
curl -f http://localhost:3000/health || echo "Server not responding"

# Readiness (store connection)
curl -f http://localhost:3000/ready || echo "Store not ready"

# Screener health
curl http://localhost:3000/api/mit/screener/health
```

### Outage Modes and Fallback Behavior

The system degrades gracefully when external data sources are unavailable:

| Failure Mode | System Behavior |
|--------------|-----------------|
| **Yahoo Finance down** | Market snapshot returns `latestPrice: null`, `dataSource: "fallback"`. Technical indicators computed from cached candles. Pipeline continues with available data. |
| **Screener.in down** | Entity loader returns minimal fallback entities for all 52 tickers with zero-valued economics. Fundamentals refresh reports failures in `failed` array. |
| **NSE API down** | System falls back to Yahoo Finance for OHLCV data. If both fail, candles remain unchanged from previous run. |
| **Fundamentals unavailable** | Supply-chain nodes return `dataSource: "fallback"` with zero economics. Composite scoring skips fundamental components. |
| **Redis unavailable** | Pipeline locking falls back to in-memory mutex. Works for single-instance deployments. |

**Degraded mode indicators:**

- `dataSource: "fallback"` in any response indicates the primary source failed
- `/api/mit/fundamentals/refresh` returns non-empty `failed` array
- `/api/mit/screener/health` returns `available: false`

### Automated Scheduler (Docker Compose)

The scheduler container runs these cron jobs with `TZ=Asia/Kolkata`:

| Schedule (IST) | Command | Description |
|----------------|---------|-------------|
| `03:00 Mon-Fri` | `POST /api/mit/pipeline/run` | Full MIT pipeline (candles, fundamentals, scoring) |
| `04:30 Mon-Fri` | `POST /api/mit/pnl/refresh` | Refresh portfolio P&L with latest prices |
| `02:00 Sunday` | `POST /api/mit/fundamentals/refresh` (limit 50) | Weekly fundamentals deep refresh |
| `00:30 Daily` | `POST /api/ingest/run` | Policy signal ingestion |

Scheduler logs are written to `/var/log/cron.log` inside the container. View with:

```bash
docker exec mit-scheduler cat /var/log/cron.log
```

### Strategy Templates

Nine strategy templates are available (4 builtin + 5 advanced):

```bash
curl http://localhost:3000/api/templates
```

Individual template:

```bash
curl http://localhost:3000/api/templates/nt-lite-quality
```

### Troubleshooting

**Pipeline stuck in "running" state:**

The pipeline uses date-based locking. If a run crashes mid-execution, restart the server to reset the in-memory lock. For Redis-backed deployments, the lock auto-expires after 60 seconds.

**Empty ideas after pipeline run:**

Check:
1. `/api/mit/screener/health` — Screener must be reachable for fundamentals
2. `/api/mit/data/sources` — Verify cached candles exist
3. Server logs for `Screenipy scan failed` warnings

**Stale signals in terminal:**

```bash
# Clear all signals and trigger reingest
curl -X DELETE http://localhost:3000/api/signals
```

**Fundamentals not refreshing:**

Screener.in rate-limits requests. The system batches with 500ms-1.5s delays. For large refreshes, expect 2-5 minutes. Check `/api/mit/fundamentals/refresh` response for `failed` tickers.

**Redis connection errors:**

The system operates without Redis using in-memory locking. Ensure `REDIS_URL` is unset or the Redis container is healthy:

```bash
docker compose ps redis
docker compose logs redis --tail 20
```
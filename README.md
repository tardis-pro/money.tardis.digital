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

# India Policy Signal Terminal (MVP)

Real-time intelligence platform for tracking and analyzing India policy signals across financial markets.

## Quick Start

```bash
npm install
npm run dev
npm run e2e:backfill
# Open http://localhost:3000
```

## What It Does

| Capability | Description |
|------------|-------------|
| **Signal Ingestion** | RSS, XML, HTML, PDF, and Screeni-py parsing with deduplication |
| **Event Intelligence** | Classification, entity linking, impact scoring, and probabilistic predictions |
| **Market Integration** | Supply-chain graphs, market snapshots, and portfolio risk tracking |
| **Alert System** | Threshold-based alerts with cooldown, routing, and quality metrics |
| **Backfill Engine** | Historical data replay with checkpointing and reconciliation |

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

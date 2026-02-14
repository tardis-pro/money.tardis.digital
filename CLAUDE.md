# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

India Policy Signal Terminal + MIT Trading System — a real-time intelligence platform for tracking India policy signals and an NSE stock swing trading system. Built with Fastify 5, React 19, TypeScript 5.7, Vite 7, and optional TimescaleDB/PostgreSQL.

## Common Commands

```bash
# Development (starts Fastify server + Vite HMR concurrently)
npm run dev                # API at :3000, Vite HMR at :5173

# Build
npm run build              # tsc + vite client + vite SSR
npm run typecheck          # tsc --noEmit only

# Tests (builds first, then runs via Node.js native test runner)
npm run test               # npm run build --silent && node --test dist/test/*.test.js

# E2E smoke test (requires dev server running)
npm run e2e:backfill       # Runs backfill API flow against localhost:3000
E2E_BASE_URL=http://localhost:4000 npm run e2e:backfill  # custom port

# Database (only if STORE_BACKEND=postgres)
docker compose up -d timescaledb
npm run migrate            # tsx scripts/migrate.mjs

# Terminal UI (Svelte-based alternative)
npm run dev:terminal       # Vite dev at :5174
```

## Architecture

**Dual system in one codebase:**

1. **Policy Signal Terminal** — ingests RSS/XML/HTML/PDF sources, deduplicates, classifies events, scores impact, generates alerts
2. **MIT Trading System** — NSE stock screening, composite scoring (Quality/Growth/Value/Momentum), entry/exit calculation, portfolio management, P&L tracking, Telegram integration

**Key data flow:**
```
Policy: Sources → Ingestion → Dedup → Entity Linking → Classification → Impact Scoring → Alerts
MIT:    Screenipy → Technical Indicators → Composite Score → NT-LITE Checklist → Entry/Exit → Hero Pick → Telegram
```

### Source Layout

- `src/server.ts` — Fastify server entry, registers all policy signal routes
- `src/mit-routes.ts` — All MIT trading API routes (~38 endpoints under `/api/mit/`)
- `src/store.ts` / `src/store-postgres.ts` — Dual-backend store (`JsonStore` or `PostgresStore`, selected by `STORE_BACKEND` env var)
- `src/mit-store.ts` / `src/mit-store-postgres.ts` — Separate MIT state store (same dual-backend pattern)
- `src/types.ts` — Policy signal types
- `src/mit-types.ts` — MIT trading types (all serializable, no Map/Set/Date/Function)
- `src/services/` — ~45 service modules for policy signal processing
- `src/services/mit/` — ~38 service modules for MIT trading subsystem
- `src/config/` — JSON config files (sources, entity-map, sectors, strategy, universe)
- `src/App.tsx` — Main React app (uses `htm` tagged template literals, not JSX)
- `src/MitDashboard.tsx` — MIT trading dashboard UI
- `src/terminal/` — Svelte 5 alternative terminal UI
- `src/strategy-ai/dsl/` — Strategy DSL with Zod schemas (planned feature)

### Store Pattern

Both policy and MIT systems use an abstract `Store`/`MitStore` interface with two implementations:
- **JSON** (default): File-backed at `data/state.json` and `data/mit-state.json`
- **PostgreSQL**: TimescaleDB with JSONB columns, selected via `STORE_BACKEND=postgres`

The store is initialized once in `server.ts` and injected into all services/route handlers.

### MIT Agent System

Natural language agents under `src/services/mit/`:
- `manager-agent.ts` — Orchestrates queries across other agents
- `librarian-agent.ts` — Research and news lookup
- `analyst-agent.ts` — Technical/fundamental analysis
- `coder-agent.ts` — Feature request code generation
- `query-parser.ts` — NL query parsing

### Telegram Integration

Hero Pick alerts delivered via Telegram with interactive Execute/Pass buttons. Key files:
- `src/services/telegram-notifier.ts` — Bot API integration
- `src/services/telegram-feature-service.ts` — Telegram command handling
- `src/services/mit/hero-analyst.ts` — Hero pick scoring engine

## TypeScript Configuration

- Strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- Target: ES2022, Module: NodeNext
- Path alias: `@` → `src/` (Vite only, not in tsconfig paths)
- ESM-only (`"type": "module"` in package.json)
- JSON imports use `with { type: "json" }` assertion syntax

## Environment

Key env vars (see `.env.example`):
- `STORE_BACKEND` — `json` (default) or `postgres`
- `DATABASE_URL` — PostgreSQL connection string
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` — Telegram bot integration
- `SCREENIPY_PYTHON` / `SCREENIPY_SCRIPT_PATH` — pkscreener Python integration

## Docker

`docker compose up -d` runs the full stack: app (port 3000), TimescaleDB (port 5432), and a cron scheduler (daily pipeline at 3 AM IST, P&L refresh at 4:30 AM IST, fundamentals weekly at 2 AM IST).

## Conventions

- All API input validation uses Zod schemas
- Services are class-based, instantiated in `server.ts` and passed the store
- React UI uses `htm` (hyperscript tagged markup) template literals in `App.tsx` — not JSX
- The MIT subsystem enforces idempotent pipeline runs via date-based locking
- Market data sourced from Yahoo/NSE via web scraping with rate limiting (500ms-1.5s delays)

# MIT Trading System - Technical Summary

**Last Updated:** 2026-02-13
**Status:** Production Ready - QVM-Hybrid v3.2 Complete

---

## Executive Summary

The **India Policy Signal Terminal + MIT Trading System** is a dual-system platform combining:
1. **Policy Signal Terminal** - Real-time intelligence for tracking India policy signals
2. **MIT Trading System** - NSE stock swing trading with QVM-Hybrid architecture

### Key Metrics (ACTUAL)
| Metric | Documented | Actual |
|--------|------------|--------|
| API Endpoints | 42 | **181** |
| Service Classes | 30 | **100+** |
| MIT Services | 30 | **36** |
| Strategy-AI Services | - | **27** |
| Policy Signal Services | - | **30+** |
| Database Tables | 15 | **15+** |
| Technical Indicators | 11+ | **14+** |
| Telegram Commands | 9 | **9** |
| Agent Systems | 2 | **4** |

---

## MIT Natural Language Agent System

The MIT system includes a **4-agent NLP architecture** for natural language interaction:

### Agent 1: Manager Agent (`manager-agent.ts`)
**Purpose**: Orchestrates queries across other agents, intent detection

| Feature | Implementation |
|---------|---------------|
| Intent Detection | `trade_action`, `feature_request`, `analysis`, `data_request`, `general_query` |
| Entity Extraction | Tickers, date ranges, metrics from natural language |
| Alias Resolution | 40+ known stock aliases (TATA STEEL → TATASTEEL, etc.) |
| Query Parser | `query-parser.ts` - Converts NL to structured queries |

### Agent 2: Librarian Agent (`librarian-agent.ts`)
**Purpose**: Research and news lookup

| Feature | Implementation |
|---------|---------------|
| News Fetch | Scrapes Yahoo Finance, MoneyControl, Screener.in |
| Article Summarization | LLM-powered summarization |
| Source Filtering | Filter by domain, language |
| Related News | Finds related articles by ticker |

### Agent 3: Analyst Agent (`analyst-agent.ts`)
**Purpose**: Technical and fundamental analysis

| Feature | Implementation |
|---------|---------------|
| Technical Analysis | RSI, MACD, Bollinger Bands, Moving Averages |
| Fundamental Analysis | PE vs peers, sector comparison |
| Peer Comparison | Sector-relative valuation |
| Period Returns | 1W, 1M, 3M, 6M, 1Y calculations |

### Agent 4: Coder Agent (`coder-agent.ts`)
**Purpose**: Feature request code generation

| Feature | Implementation |
|---------|---------------|
| Feature Parsing | Extract requirements from natural language |
| Code Generation | Generates TypeScript code for new features |
| Acceptance Criteria | Parses and formats user requirements |
| Related Features | Suggests related functionality |

### Query Flexibility (`query-parser.ts`)

| Feature | Example |
|---------|---------|
| Ticker Aliases | "tata steel", "infy", "hdfc bank" |
| Metric Filters | "PE > 20", "RSI gt 70" |
| Date Ranges | "last 3 months", "2024-01-01 to 2024-03-31" |
| Output Formats | chart, table, text, links, csv |

---

## Strategy-AI Algorithmic Trading System

A **complete algorithmic trading system** separate from MIT with strategy generation, simulation, and optimization:

### Core Components

| Service | File | Purpose |
|---------|------|---------|
| **StrategyStore** | `store.ts` | CRUD operations for strategies |
| **StrategyGenerator** | `generator.ts` | Generate strategies from templates |
| **Simulator** | `simulator.ts` | Backtest strategies on historical data |
| **BatchSimulator** | `batch-simulator.ts` | Parallel batch simulation |
| **WalkForward** | `walkforward.ts` | Walk-forward analysis with fold validation |
| **Ranker** | `ranker.ts` | Multi-factor strategy ranking |
| **RulebookEngine** | `rulebook.ts` | Rule-based allocation system |
| **GameTheoryEngine** | `game-theory/index.ts` | Nash equilibrium, evolutionary strategies |

### Strategy DSL (`dsl/`)

| File | Purpose |
|------|---------|
| `signal-definitions.ts` | Signal type definitions (RSI, MACD, SMA, etc.) |
| `risk-definitions.ts` | Risk parameter definitions |
| `filter-definitions.ts` | Stock screening filters |
| `validation-rules.ts` | Zod validation for strategies |
| `strategy-schema.ts` | Complete strategy schema |

### Strategy Execution (`execution.ts`)

| Feature | Implementation |
|---------|---------------|
| Paper Trading | Simulated order execution |
| Position Management | Entry/exit with fees |
| Risk Controls | Max positions, max notional |
| Order Types | Market, Limit, Stop-loss |

### LLM Integration (`llm-provider.ts`)

| Provider | Status |
|----------|--------|
| OpenAI | ✅ Configured |
| Anthropic | ✅ Configured |
| Google Gemini | ✅ Configured |
| Azure OpenAI | ✅ Configured |

### API Endpoints (Strategy-AI)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/strategies` | POST/GET | Create/list strategies |
| `/api/strategies/:id` | GET/PUT/DELETE | CRUD operations |
| `/api/strategies/:id/generate` | POST | Generate from template |
| `/api/strategies/:id/simulate` | POST | Run simulation |
| `/api/sim-runs` | GET | List simulation runs |
| `/api/sim-runs/batch` | POST | Batch simulation |
| `/api/rankings` | GET | Global strategy rankings |
| `/api/rankings/sector/:sector` | GET | Sector rankings |
| `/api/rulebook` | GET/POST | Rulebook operations |
| `/api/rulebook/recommend` | GET | Get allocations |
| `/api/game-experiments` | POST/GET | Game theory experiments |

---

## Policy Signal Terminal (Original System)

The **Policy Signal System** runs alongside MIT for tracking India policy signals:

### Signal Pipeline Services

| Service | File | Purpose |
|---------|------|---------|
| **IngestionService** | `ingestion.ts` | RSS/XML/HTML/PDF source ingestion |
| **ParserService** | `parser.ts` | Multi-format content parsing |
| **ClassifierService** | `classifier.ts` | Policy classification |
| **EntityLinkerService** | `entity-linker.ts` | Link entities to tickers |
| **ImpactScorerService** | `impact-scorer.ts` | Score policy impact |
| **PredictionService** | `prediction.ts` | Outcome prediction |
| **AlertService** | `alerts.ts` | Alert creation and routing |
| **ScreeningService** | `screening.ts` | Signal screening |

### Data Quality Services

| Service | File | Purpose |
|---------|------|---------|
| **DeduplicationService** | `deduplication.ts` | Remove duplicate signals |
| **SourceRegistryService** | `source-registry.ts` | Source management |
| **SourceDriftService** | `source-drift.ts` | Detect source quality drift |
| **SourceReliabilityLoop** | `source-reliability-loop.ts` | Automated reliability scoring |

### Analytics Services

| Service | File | Purpose |
|---------|------|---------|
| **AnomalyDetector** | `anomaly-correlation.ts` | Correlate anomalies with signals |
| **OutcomesService** | `outcomes.ts` | Track signal outcomes |
| **LearningLoop** | `learning-loop.ts` | Feedback loop for signal quality |

### Governance & SRE

| Service | File | Purpose |
|---------|------|---------|
| **GovernanceHardening** | `governance-hardening.ts` | Policy checks, release gates |
| **SREService** | `sre.ts` | SLO budgets, chaos drills |
| **PilotService** | `pilot.ts` | Feature rollout tracking |

### Backfill System

| Service | File | Purpose |
|---------|------|---------|
| **HistoricalBackfill** | `historical-backfill.ts` | Historical data replay |
| **BackfillControl** | `backfill-control.ts` | Backfill orchestration |
| **RealNewsBackfill** | `real-news-backfill.ts` | News data backfill |

---

## QVM-Hybrid v3.2 - Hero Pick System

### Architecture: The 5-Layer Stack

| Layer | Component | Role |
|-------|-----------|------|
| L1 | **The Boss** | User (Telegram Client) |
| L2 | **The Manager** | Orchestrator (`alert-orchestrator.ts`) |
| L3 | **The Analyst** | Comparative Analysis (`hero-analyst.ts`) *(NEW)* |
| L4 | **The Gatekeeper** | Compliance & Risk (`governance-filter.ts`) |
| L5 | **The Engine** | Signal Generation (`screenipy-mit-connector.ts`) |

### Hero Pick Scoring (0-100)

| Factor | Weight | Metric | Logic |
|--------|--------|--------|-------|
| **Volatility** | 30% | ATR% | Lower is better (smooth movers) |
| **Market Correlation** | 20% | Beta vs NIFTY 50 | 0.8-1.2 = High Score |
| **Trend Consistency** | 30% | R² (90-day log-linear regression) | Higher = smoother uptrend |
| **Sector Tailwind** | 20% | Sector Index vs SMAs | If SMA50>SMA200 = +20 pts |

### Telegram Integration

| Feature | Implementation |
|---------|----------------|
| **Inline Buttons** | ✅ Execute / Pass |
| **Webhook Handler** | `POST /api/telegram/webhook` |
| **Callback Processing** | Parses `hero_execute:*` / `hero_pass:*` |
| **Confirmation Messages** | ✅ Hero Executed / Hero Rejected |

**Telegram Commands:**
| Command | Description |
|---------|-------------|
| `/hero` | Get current hero pick with Execute/Pass buttons |
| `/why` | See why this stock was selected (brainstorming logic) |
| `/extended [n]` | Show nth ranked stock (default: 6), `/extended 10` for top 10 |
| `/viz [sym1] [sym2]` | Generate price charts (default: last 2 analyzed) |
| `/export` | Export candidates as table with CSV link |
| `/table` | View ranking table |
| `/links SYMBOL` | Get balance sheet & news links (Screener, Yahoo, NSE, Moneycontrol) |
| `/status` | Portfolio surveillance status (kill switch, blacklist, drift) |
| `/help` | Show all available commands |

**Environment Variables:**
```
TELEGRAM_BOT_TOKEN=    # Get from @BotFather
TELEGRAM_CHAT_ID=      # Get from @userinfobot
```

### New API Endpoints (v3.2)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mit/hero/analyze` | GET | Analyze candidates, return Hero picks |
| `/api/mit/hero/brief` | GET | Get formatted Telegram message |
| `/api/telegram/webhook` | POST | Handle button callbacks |

### New Technical Indicators

| Indicator | Status | Purpose |
|-----------|--------|---------|
| **Beta** | ✅ | Stock vs NIFTY 50 correlation |
| **R²** | ✅ | Trend consistency (log-linear regression) |
| **ATR%** | ✅ | ATR / Price for volatility scoring |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MIT Trading System Architecture                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐│
│  │   Yahoo     │    │   Screener  │    │   NSE/      │    │   Market    ││
│  │   Finance   │    │   .in CSV   │    │   Moneycontrol│   │   Sentiment ││
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘│
│         │                   │                   │                   │       │
│         └───────────────────┴───────────────────┴───────────────────┘       │
│                                    │                                         │
│                                    ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    Python Screeni-py Wrapper                           │  │
│  │  • Real data fetch (stdlib urllib - NO external dependencies)         │  │
│  │  • Rate limiting (1.5s delays to avoid 429)                          │  │
│  │  • Retry logic with exponential backoff                                │  │
│  │  • Technical indicators: RSI, EMA, SMA, MACD, CCI, ATR              │  │
│  │  • Pattern detection: Bullish Engulfing, Hammer, Doji, Breakout     │  │
│  │  • Trend classification: Strong Up, Up, Sideways, Weak, Down        │  │
│  └──────────────────────────────────┬───────────────────────────────────┘  │
│                                     │                                        │
│                                     ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    TypeScript / Node.js Backend                        │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐│  │
│  │  │  MIT Routes      │  │  Scoring Engine   │  │  Portfolio Service   ││  │
│  │  │  (38 endpoints) │  │  NT-LITE + QUANT │  │  Entry/Exit/Trailing ││  │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────────┘│  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐│  │
│  │  │  Entry/Exit Calc  │  │  Guard Service   │  │  P&L Ledger          ││  │
│  │  │  Buy Zone/Stop    │  │  Exposure Check  │  │  Realized/Unrealized ││  │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────────┘│  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐│  │
│  │  │  QVM Hardening   │  │  Anomaly Detect  │  │  Market Mode        ││  │
│  │  │  Idempotency     │  │  Price/Vol Spike │  │  Risk-on/off        ││  │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────────┘│  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     │                                        │
│                                     ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         Frontend (React)                              │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐│  │
│  │  │  MIT Dashboard    │  │  Main App        │  │  Mobile Dashboard   ││  │
│  │  │  Portfolio + Ideas│  │  Tab Navigation  │  │  (Spec) One-Click ││  │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────────┘│  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Persistence Layer                              │  │
│  │  ┌──────────────────────┐  ┌─────────────────────────────────────────┐│  │
│  │  │  JSON Store (Default) │  │  PostgreSQL + TimescaleDB (Production)  ││  │
│  │  │  • data/state.json    │  │  • TimescaleDB hypertable for candles   ││  │
│  │  │  • data/mit-state.json│  │  • JSONB for flexible schemas          ││  │
│  │  │                       │  │  • Full transaction support             ││  │
│  │  └──────────────────────┘  └─────────────────────────────────────────┘│  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Scheduler Layer                                │  │
│  │  ┌──────────────────────┐  ┌─────────────────────────────────────────┐│  │
│  │  │  Docker Cron (Primary) │  │  Windmill (Available)                   ││  │
│  │  │  • Pipeline: 3 AM     │  │  • Shadow mode ready                  ││  │
│  │  │  • P&L: 4:30 AM      │  │  • Future workflow migration          ││  │
│  │  │  • Fundamentals: 2 AM │  │  • Retry policies configured          ││  │
│  │  └──────────────────────┘  └─────────────────────────────────────────┘│  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## QVM Hardening Features

### 1. Idempotent Pipeline Operations

| Feature | Implementation |
|---------|---------------|
| **Date-Based Lock** | `dailyPipelineLock` prevents concurrent runs for same date |
| **Run Deduplication** | `mit-run-{YYYY-MM-DD}` ID pattern with status tracking |
| **Already Completed Detection** | Returns `status: "already_completed"` for same-day runs |
| **Atomic Transactions** | All database writes in single transaction |

**Pipeline Lock Logic:**
```typescript
if (dailyPipelineLock.status === "running" && dailyPipelineLock.date === today) {
  return reply.code(423).send({ error: "Pipeline already running", runId, startedAt });
}
if (dailyPipelineLock.status === "completed" && dailyPipelineLock.date === today) {
  return reply.code(200).send({ status: "already_completed", runId, completedAt });
}
```

### 2. No-Mock Policy Enforcement

| Component | Status |
|-----------|--------|
| **Production Guard** | ✅ Blocks `source: "manual"` imports |
| **Error Code** | `NO_MOCK_POLICY` (HTTP 403) |
| **Source Tracking** | All records have `source: "morningstar"` |
| **Provenance Fields** | `fetchedAt`, `source` always populated |

**Enforcement:**
```typescript
if (process.env.NODE_ENV === "production" && payload.snapshot.source === "manual") {
  return reply.code(403).send({ 
    error: "Manual source imports are not allowed in production",
    code: "NO_MOCK_POLICY"
  });
}
```

### 3. Timeout & Retry Hardening

| Operation | Timeout | Retries | Backoff |
|-----------|---------|---------|---------|
| Fundamentals Fetch | 15s | 2 | Exponential (1s, 2s) |
| Rate Limiting | 220ms | N/A | Fixed delay |
| Screeni-py | 1.5s/request | Auto | Exponential |
| Database Queries | Configurable | 0 | N/A |

### 4. Policy Checks & Governance

| Check Type | Implementation |
|------------|----------------|
| **Release Gates** | Tracks entitlement exceptions, data quality issues |
| **Runbooks** | Stores incident response procedures |
| **Access Audits** | Logs unauthorized access attempts |
| **Governance Filters** | Hard filters on ROCE/ROE, D/E, IC, pledge, audit |

---

## API Endpoints

### Screeni-py Integration (3 endpoints)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mit/screenipy/run` | GET | Run Screeni-py scan (params: tickerOption, executeOption) |
| `/api/mit/screenipy/latest` | GET | Get cached scan results (5-min TTL) |
| `/api/mit/screenipy/candidates` | GET | Filter by feed (nt-lite/quant), limit results |

### Fundamentals & Analysis (9 endpoints)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mit/fundamentals/:ticker` | GET | Get fundamental snapshot |
| `/api/mit/checklist/:ticker` | GET | Run NT-LITE checklist evaluation |
| `/api/mit/screen/nt-lite` | POST | Batch NT-LITE screening |
| `/api/mit/peers/:ticker` | GET | Get peer median PE by sector |
| `/api/mit/sentiment/tone` | GET | Get market tone (risk-on/risk-off/neutral) |
| `/api/mit/sentiment/:ticker/flags` | GET | Get governance flags for ticker |
| `/api/mit/import/screener-csv` | POST | Import Screener.in CSV data |
| `/api/mit/import/fundamentals` | POST | Import manual fundamentals (production-blocked) |
| `/api/mit/fundamentals/refresh` | POST | Refresh fundamentals (with QVM hardening) |

### Technical Analysis & Scoring (3 endpoints)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mit/technicals/:ticker` | GET | Get technical snapshot (DMA, RSI, ATR, Z-score) |
| `/api/mit/score/:ticker` | GET | Get composite score (Quality+Growth+Valuation+Momentum+Governance) |
| `/api/mit/entry-exit/:ticker` | GET | Compute entry/exit plan (buy zone, stop, target, trailing) |

### Pipeline Operations (4 endpoints)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mit/pipeline/run` | POST | Run full daily pipeline (idempotent) |
| `/api/mit/pipeline/status/:runId` | GET | Check pipeline run status |
| `/api/mit/pipeline/latest` | GET | Get latest daily run results |
| `/api/mit/daily-ideas` | GET | Get today's trading ideas |

### Portfolio Management (6 endpoints)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mit/portfolio` | GET | Get portfolio state |
| `/api/mit/portfolio/settings` | POST | Update settings (capital, allocPct, stopPct, etc.) |
| `/api/mit/trade/enter` | POST | Enter new position |
| `/api/mit/trade/exit` | POST | Exit position (partial/full) |
| `/api/mit/trade/confirm` | POST | Confirm entry price/date |
| `/api/mit/stop/override` | POST | Override stop loss |

### P&L & Reporting (9 endpoints)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mit/pnl/refresh` | POST | Refresh P&L from market |
| `/api/mit/pnl` | GET | Get P&L summary |
| `/api/mit/pnl/history` | GET | Get equity curve |
| `/api/mit/indicators` | GET | Get active sell indicators |
| `/api/mit/guard` | GET | Check trading guard status |
| `/api/mit/anomalies` | GET | Get market anomalies |
| `/api/mit/trades` | GET | Get closed trades |
| `/api/mit/quant/signals` | GET | Get QUANT feed signals |
| `/api/mit/reports/weekly` | POST | Generate weekly report |
| `/api/mit/reports/monthly` | POST | Generate monthly report |

### Data Export (3 endpoints)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mit/export/holdings.csv` | GET | Export holdings CSV |
| `/api/mit/export/trades.csv` | GET | Export trades CSV |
| `/api/mit/export/watchlist.csv` | GET | Export watchlist CSV |

---

## Service Architecture (30 Services)

### Core Data Services

| Service | File | Purpose |
|---------|------|---------|
| **FundamentalsProviderService** | `fundamentals-provider.ts` | Yahoo Finance fetch with QVM hardening (15s timeout, 2 retries, rate limiting) |
| **MarketDataService** | `market-data.ts` | NSE/Yahoo candle fetching with cookie management |
| **MITScreeniPyService** | `screenipy-mit-connector.ts` | Screeni-py integration, MIT score enrichment |
| **ScreenerAdapter** | `screener-adapter.ts` | Screener.in CSV parsing with flexible key matching |
| **ScreenerFundamentalsFetcher** | `screener-fundamentals-fetcher.ts` | Screener.in API integration |

### Scoring & Analysis

| Service | File | Purpose |
|---------|------|---------|
| **CompositeScorer** | `composite-scorer.ts` | 100-point scoring (Quality:40, Growth:20, Valuation:15, Momentum:15, Governance:10) |
| **TechnicalIndicators** | `technical-indicators.ts` | SMA/EMA, RSI, ATR, MACD, CCI, pattern detection, Z-score, **beta**, **rSquared** (NEW) |
| **NtLiteChecklist** | `nt-lite-checklist.ts` | 8-item checklist (A/B/C/F grading) |
| **EntryExitCalc** | `entry-exit-calc.ts` | Buy/stop/target computation with market tone awareness |
| **PeerComparison** | `peer-comparison.ts` | Sector peer median PE calculation |
| **HeroAnalyst** | `hero-analyst.ts` | **NEW** - Risk Rundown scoring for Hero Pick selection |

### Risk & Guard Services

| Service | File | Purpose |
|---------|------|---------|
| **ExposureGuard** | `exposure-guard.ts` | Cash pause, max deployed limits, suggested sells |
| **PositionSizer** | `position-sizer.ts` | Allocation calculation, guard enforcement |
| **TrailingStop** | `trailing-stop.ts` | Trailing stop activation (15% gain or RSI > 70, 8% trail) |
| **PnlLedger** | `pnl-ledger.ts` | P&L refresh, equity curve, peak equity, max drawdown |
| **AnomalyDetector** | `anomaly-detector.ts` | Price shock, volume spike, volatility spike detection |
| **MarketMode** | `market-mode.ts` | Market mode detection (risk-on/off), RSI ranges, DMA alignment |
| **GovernanceFilter** | `governance-filter.ts` | Hard filters + liquidity check + penny stock filter (UPDATED) |

### Notifications (NEW v3.2)

| Service | File | Purpose |
|---------|------|---------|
| **TelegramNotificationService** | `telegram-notifier.ts` | Telegram bot with inline buttons for Execute/Pass |
| **TelegramFeatureService** | `telegram-feature-service.ts` | Charts, exports, links, extended rankings |
| **SurveillanceBot** | `surveillance-bot.ts` | Post-trade monitoring, kill switch, blacklist, drift detection |

### Portfolio & Trading

| Service | File | Purpose |
|---------|------|---------|
| **MitPortfolioService** | `portfolio-service.ts` | Portfolio CRUD, settings, P&L, trade lifecycle |
| **MitTradeManager** | `trade-manager.ts` | Facade for enter/exit/confirm operations |

### Pipeline & Intelligence

| Service | File | Purpose |
|---------|------|---------|
| **DailyPipeline** | `daily-pipeline.ts` | Orchestrates daily run, aggregates ideas |
| **SentimentOverlay** | `sentiment-overlay.ts` | Market tone, governance flags (auditor, pledge, SEBI) |
| **QuantSignal** | `quant-signal.ts` | Momentum Z-score focused QUANT signals |

### Reporting

| Service | File | Purpose |
|---------|------|---------|
| **WeeklyReport** | `weekly-report.ts` | Weekly trade analysis with key factors |
| **MonthlyReport** | `monthly-report.ts` | Monthly NT-LITE vs QUANT stats |
| **CsvExport** | `csv-export.ts` | Holdings and trades CSV export |

### Utilities

| Service | File | Purpose |
|---------|------|---------|
| **Logger** | `logger.ts` | Logging utilities |
| **GovernanceHardening** | `governance-hardening.ts` | QVM policy checks, release gates, runbooks |

---

## Data Persistence

### PostgreSQL + TimescaleDB Schema (mit schema)

| Table | Type | Purpose |
|-------|------|---------|
| **portfolio** | Singleton JSONB | Settings, cash, peak equity, max drawdown, paused, last run |
| **positions** | JSONB | Open trades with ticker index |
| **closed_trades** | JSONB | Historical trades with exit_date |
| **equity_curve** | JSONB | Daily equity curve (date PK) |
| **daily_runs** | JSONB | Pipeline run results with ideas, anomalies, errors |
| **weekly_reports** | JSONB | Weekly performance reports |
| **monthly_reports** | JSONB | Monthly NT-LITE vs QUANT stats |
| **fundamentals** | JSONB | Per-ticker fundamentals (ticker PK) |
| **technicals** | JSONB | Per-ticker technicals (ticker PK) |
| **composite_scores** | JSONB | Per-ticker scores (ticker PK) |
| **checklist_results** | JSONB | Per-ticker checklist grades (ticker PK) |
| **peer_median_pe** | Numeric | Sector PE medians (sector PK) |
| **governance_flags** | JSONB Array | Per-ticker flags (ticker PK) |
| **global_state** | Singleton | Market tone (risk-on/off/neutral) |
| **candles** | Hypertable | OHLCV time-series (TimescaleDB, ticker+date PK) |

### Current Data Statistics

| Table | Records |
|-------|---------|
| fundamentals | 52 |
| technicals | 51 |
| candles | 15,300 (300 per ticker) |
| composite_scores | 51 |
| daily_runs | 1 |
| positions | 0 |
| closed_trades | 0 |
| governance_flags | 0 |

---

## Technical Indicators

| Indicator | Status | Implementation |
|-----------|--------|----------------|
| **RSI** | ✅ | 14-period Relative Strength Index |
| **EMA** | ✅ | 20-day, 50-day Exponential Moving Average |
| **SMA** | ✅ | 20-day, 50-day Simple Moving Average |
| **MACD** | ✅ | MACD line + Signal line + Histogram |
| **CCI** | ✅ | 20-period Commodity Channel Index |
| **ATR** | ✅ | 14-period Average True Range |
| **ATR%** | ✅ | ATR / Price (NEW - for volatility scoring) |
| **DMA** | ✅ | 20/50/100/200-day Moving Averages |
| **Pattern Detection** | ✅ | Bullish Engulfing, Hammer, Doji, Breakout |
| **Trend Classification** | ✅ | Strong Up, Up, Sideways, Weak, Down |
| **Return Z-Score** | ✅ | Price return percentile ranking |
| **Pullback %** | ✅ | Price pullback from highs |
| **Beta** | ✅ | Stock vs NIFTY 50 correlation (NEW) |
| **R²** | ✅ | Trend consistency (log-linear regression, NEW) |

---

## Two-Feed Trading System

### NT-LITE Feed (Quality + Fundamentals)

| Criteria | Threshold |
|----------|-----------|
| Total Score | ≥ 70 |
| DMA50 | Price > DMA50 |
| DMA200 | Price > DMA200 |
| RSI | Market mode band (40-70) |
| Governance | Pass all hard filters |
| Checklist | ≥ 5 items pass |

**Checklist Items (8 total):**
1. Rising Revenue/EPS (3-5 yr CAGR)
2. Strong Free Cash Flow
3. ROCE > 15%
4. Manageable Leverage (D/E < 0.5)
5. Improving OPM
6. Stable Promoter Holding
7. Clean Audit
8. Sane Valuation (PEG < 1.2)

### QUANT Feed (Momentum)

| Criteria | Threshold |
|----------|-----------|
| Return Z-Score | ≥ 1.28 (top decile) |
| DMA100 | Price > DMA100 |
| Pullback | < 5% |
| Governance | Pass all hard filters |
| Momentum Score | ≥ 8 |

---

## Portfolio Settings

| Parameter | Value | Description |
|-----------|-------|-------------|
| capital | ₹200,000 | Base capital |
| allocPct | 5% | Default position allocation |
| stopPct | 6% | Hard stop percentage |
| pauseCashPct | 3% | Pause threshold (3% cash) |
| maxDeployedPct | 95% | Maximum deployed capital |
| maxHorizonDays | 90 | Maximum holding period |
| trailingActivationPct | 75% | Trailing stop activation |

---

## Scheduler Configuration

### Docker Cron (Primary Scheduler)

| Job | Schedule | Command |
|-----|----------|---------|
| **Pipeline** | `0 3 * * 1-5` | `curl -X POST $PIPELINE_URL` |
| **P&L Refresh** | `30 4 * * 1-5` | `curl -X POST $PNL_REFRESH_URL` |
| **Fundamentals** | `0 2 * * 0` | `curl -X POST -H "Content-Type: application/json" -d "{\"limit\": 50}" $FUNDAMENTALS_URL` |

### Intraday Price Scheduler

| Configuration | Value |
|---------------|-------|
| **Timezone** | IST (Asia/Kolkata) |
| **Default Slots** | 10:00, 12:30, 14:45 |
| **Environment** | `MIT_INTRADAY_REFRESH_SLOTS` |
| **Frequency** | 60-second checks |
| **Weekends** | Automatically skipped |

---

## Operational Features

### Anomaly Detection

| Type | Detection Method | Threshold |
|------|------------------|-----------|
| **Price Shock** | Daily return Z-score | ≥ 2.5 |
| **Volume Spike** | Volume vs 20-day average | > 2x |
| **Volatility Spike** | ATR vs 25-day median | > 1.8x |

### Guard System

| Check | Condition | Action |
|-------|-----------|--------|
| **Cash Pause** | Cash < 3% of capital | Block new trades |
| **Max Deployed** | Deployed > 95% | Block new trades |
| **High Deployment Warning** | Deployed > 85% | Warning |
| **Suggested Sells** | Within 10% of target | Suggest exit |

### Sell Indicators

| Indicator | Condition |
|-----------|-----------|
| **Near Target** | Within 3% of target |
| **Time Exit** | 90% of max horizon |
| **Stop Breach** | Below stop/trailing stop |
| **Momentum Decay** | Below DMA50 with ATR context |

### Market Mode

| Mode | Allocation | RSI Range | NIFTY vs DMA |
|------|------------|-----------|--------------|
| **Risk-On** | 5% | 45-70 | Above 200DMA |
| **Risk-Off** | 3% | 40-55 | Below 200DMA |
| **Neutral** | 5% | 45-65 | Mixed |

### Surveillance Bot (v3.2)

| Feature | Implementation |
|---------|----------------|
| **Kill Switch** | Triggers at >2% daily loss → Liquidate All |
| **Blacklist** | Failed Hero stocks added for 30-day cooldown |
| **Drift Monitor** | Detects position drift vs expected values |
| **Why Explanation** | Generates detailed reasoning for Hero pick |

### Disaster Recovery

| Scenario | Protocol |
|----------|----------|
| **Hero Stock Crashes** | Hard stop always sent with entry → Blacklist 30 days → Re-evaluate Runner Up |
| **Data Feed Failure** | Sleep mode with 60s retry → SMS alert if down > 10 mins |

---

## Scoring System (100 Points)

| Component | Weight | Factors |
|-----------|--------|---------|
| **Quality** | 40 | ROCE/ROE (15), FCF (10), OPM (10), D/E (5) |
| **Growth** | 20 | 3-5 yr Revenue/EPS CAGR |
| **Valuation** | 15 | PEG ≤ 1.2 (10), P/E vs peers (5) |
| **Momentum** | 15 | Price > 50/200 DMA (10), RSI 45-65 (5) |
| **Governance** | 10 | Promoter stability, pledge, audit |

---

## Docker Infrastructure

| Service | Status | Port | Health |
|---------|--------|------|--------|
| **mit-trading-app** | ✅ Running | 3000 | Healthy |
| **mit-timescaledb** | ✅ Running | 5432 | Healthy |
| **mit-scheduler** | ✅ Running | N/A | Healthy |
| **policy-signal-windmill** | ✅ Available | 8000 | Running |

---

## Verification Commands

### Container Health
```bash
docker ps --filter "name=mit" --format "table {{.Names}}\t{{.Status}}"
```

### API Tests
```bash
# Test no-mock policy (should reject with 403)
curl -X POST http://localhost:3000/api/mit/import/fundamentals \
  -H "Content-Type: application/json" \
  -d '{"ticker":"TEST","snapshot":{"source":"manual"}}'

# Test idempotency
curl -X POST http://localhost:3000/api/mit/pipeline/run
```

### Database Verification
```bash
docker exec mit-timescaledb psql -U postgres -d policy_signal -c "
SELECT 'fundamentals' as tbl, COUNT(*) FROM mit.fundamentals
UNION ALL SELECT 'technicals', COUNT(*) FROM mit.technicals
UNION ALL SELECT 'candles', COUNT(*) FROM mit.candles
UNION ALL SELECT 'daily_runs', COUNT(*) FROM mit.daily_runs;"
```

---

## Evidence & Compliance

### Evidence Files
| File | Purpose |
|------|---------|
| `.sisyphus/evidence/task-1-scheduler-log.txt` | Scheduler hardening |
| `.sisyphus/evidence/task-2-concurrency-check.txt` | Idempotency verification |
| `.sisyphus/evidence/task-3-provenance.txt` | No-mock policy enforcement |
| `.sisyphus/evidence/task-4-fundamentals-harden.txt` | Timeout/retry hardening |
| `.sisyphus/evidence/task-5-timescale-tech.txt` | Timescale persistence |
| `.sisyphus/evidence/task-6-validation.txt` | Pipeline validation |
| `.sisyphus/evidence/task-7-audit-logs.txt` | Operational audit |
| `.sisyphus/evidence/task-8-windmill-shadow.txt` | Shadow mode |
| `.sisyphus/PROOF_OF_WORK.md` | Complete verification pack |

### Compliance Checklist
- [x] No mocks in production data path
- [x] Idempotent pipeline operations
- [x] Timeout and retry hardening
- [x] Full data provenance (source, fetchedAt)
- [x] TimescaleDB persistence
- [x] Complete audit trail
- [x] Governance filters enforced
- [x] Scheduler idempotency
- [x] Policy checks configured

---

## File Reference

| File | Purpose |
|------|---------|
| `src/mit-routes.ts` | All 42 API endpoints |
| `src/mit-store.ts` | JSON persistence |
| `src/mit-store-postgres.ts` | PostgreSQL/TimescaleDB persistence |
| `src/mit-types.ts` | Type definitions (30+ interfaces) |
| `src/services/mit/hero-analyst.ts` | **NEW** - Hero Pick scoring |
| `src/services/mit/surveillance-bot.ts` | **NEW** - Kill switch, blacklist, drift monitoring |
| `src/services/telegram-notifier.ts` | **NEW** - Telegram integration |
| `src/services/mit/governance-filter.ts` | **UPDATED** - Liquidity + penny stock |
| `src/services/mit/technical-indicators.ts` | **UPDATED** - beta + rSquared |
| `src/services/telegram-feature-service.ts` | **NEW** - Charts, exports, links, extended rankings |
| `src/config/mit-strategy.json` | **NEW** - Strategy config |
| `src/services/mit/` | All 28 service implementations |
| `docker-compose.yml` | Infrastructure |
| `docs/specs/QVM-Hybrid-v3.2-Spec.md` | Technical specification |

---

## Quick Start

```bash
# 1. Start Docker
docker compose up -d

# 2. Configure Telegram (add to .env)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# 3. Verify containers
docker ps --filter "name=mit"

# 4. Run pipeline
curl -X POST http://localhost:3000/api/mit/pipeline/run

# 5. Get ideas
curl http://localhost:3000/api/mit/daily-ideas

# 6. Get hero analysis
curl http://localhost:3000/api/mit/hero/analyze

# 7. Get Telegram brief
curl http://localhost:3000/api/mit/hero/brief

# 8. View portfolio
curl http://localhost:3000/api/mit/portfolio
```

---

**Generated:** 2026-02-13
**Plan:** `.sisyphus/plans/mit-qvm-hardening-and-proof.md`
**Evidence:** `.sisyphus/evidence/`

---

## Known Issues & Technical Debt

> See `flaws.md` for complete bug catalog (90 issues identified)

### Critical Issues Requiring Attention

| Issue | Severity | Impact |
|-------|----------|--------|
| Position ID collision risk (Date.now() + random) | CRITICAL | Data corruption on concurrent trades |
| Non-atomic transactions | CRITICAL | Lost updates, state corruption |
| Telegram webhook no auth | CRITICAL | Spoofed trade execution possible |
| Hero execute doesn't execute trade | CRITICAL | Phantom execution - no actual trade |
| Division by zero in technical indicators | CRITICAL | System crash potential |
| JSON parse errors silently reset portfolio | CRITICAL | Data loss |

### High Priority Issues

| Issue | Impact |
|-------|--------|
| Read-only flows writing stale state | Trade updates overwritten |
| Cash deducted before position success | Money lost on errors |
| Stop override accepts NaN | Risk controls disabled |
| Sector scoring always returns null | Biased hero picks |
| Beta shows score not actual beta | Wrong risk metrics shown |

---

*For complete bug details and fix recommendations, see `flaws.md`*

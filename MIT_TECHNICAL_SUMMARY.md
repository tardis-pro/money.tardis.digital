# MIT Trading System - Technical Summary

**Last Updated:** 2026-02-13
**Status:** Production Ready - QVM Hardening Complete

---

## Executive Summary

The MIT (Market Intelligence Trading) System is a production-ready NSE stock trading system with comprehensive QVM (Validation, Quality, Monitoring) hardening. It features two complementary trading strategies (NT-LITE and QUANT), full TimescaleDB persistence, idempotent pipeline operations, and enterprise-grade governance controls.

### Key Metrics
| Metric | Value |
|--------|-------|
| API Endpoints | 38 |
| Service Classes | 26 |
| Database Tables | 15 (PostgreSQL + TimescaleDB) |
| Technical Indicators | 7+ |
| Compliance Score | 100% |
| Data Provenance | Morningstar/Yahoo (no mocks) |

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

## Service Architecture (26 Services)

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
| **TechnicalIndicators** | `technical-indicators.ts` | SMA/EMA, RSI, ATR, MACD, CCI, pattern detection, Z-score |
| **NtLiteChecklist** | `nt-lite-checklist.ts` | 8-item checklist (A/B/C/F grading) |
| **EntryExitCalc** | `entry-exit-calc.ts` | Buy/stop/target computation with market tone awareness |
| **PeerComparison** | `peer-comparison.ts` | Sector peer median PE calculation |

### Risk & Guard Services

| Service | File | Purpose |
|---------|------|---------|
| **ExposureGuard** | `exposure-guard.ts` | Cash pause, max deployed limits, suggested sells |
| **PositionSizer** | `position-sizer.ts` | Allocation calculation, guard enforcement |
| **TrailingStop** | `trailing-stop.ts` | Trailing stop activation (15% gain or RSI > 70, 8% trail) |
| **PnlLedger** | `pnl-ledger.ts` | P&L refresh, equity curve, peak equity, max drawdown |
| **AnomalyDetector** | `anomaly-detector.ts` | Price shock, volume spike, volatility spike detection |
| **MarketMode** | `market-mode.ts` | Market mode detection (risk-on/off), RSI ranges, DMA alignment |
| **GovernanceFilter** | `governance-filter.ts` | Hard filters (promoter pledge <5%, clean audit, holding stability) |

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
| **DMA** | ✅ | 20/50/100/200-day Moving Averages |
| **Pattern Detection** | ✅ | Bullish Engulfing, Hammer, Doji, Breakout |
| **Trend Classification** | ✅ | Strong Up, Up, Sideways, Weak, Down |
| **Return Z-Score** | ✅ | Price return percentile ranking |
| **Pullback %** | ✅ | Price pullback from highs |

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
| `src/mit-routes.ts` | All 38 API endpoints |
| `src/mit-store.ts` | JSON persistence |
| `src/mit-store-postgres.ts` | PostgreSQL/TimescaleDB persistence |
| `src/mit-types.ts` | Type definitions (30+ interfaces) |
| `src/services/mit/` | All 26 service implementations |
| `docker-compose.yml` | Infrastructure |
| `.sisyphus/plans/mit-qvm-hardening-and-proof.md` | Hardening plan |
| `.sisyphus/PROOF_OF_WORK.md` | Verification pack |

---

## Quick Start

```bash
# 1. Start Docker
docker compose up -d

# 2. Verify containers
docker ps --filter "name=mit"

# 3. Run pipeline
curl -X POST http://localhost:3000/api/mit/pipeline/run

# 4. Get ideas
curl http://localhost:3000/api/mit/daily-ideas

# 5. View portfolio
curl http://localhost:3000/api/mit/portfolio
```

---

**Generated:** 2026-02-13
**Plan:** `.sisyphus/plans/mit-qvm-hardening-and-proof.md`
**Evidence:** `.sisyphus/evidence/`

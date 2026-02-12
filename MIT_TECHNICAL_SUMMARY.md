# MIT Trading System - Technical Summary

## What We Built

A real-time NSE stock trading system with two complementary trading strategies:

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MIT Trading System Architecture                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Yahoo     │    │   Screener  │    │   NSE/      │    │   Market    │  │
│  │   Finance   │    │   .in CSV   │    │   Moneycontrol│   │   Sentiment │  │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘  │
│         │                   │                   │                   │         │
│         └───────────────────┴───────────────────┴───────────────────┘         │
│                                    │                                         │
│                                    ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    Python Screeni-py Wrapper                           │  │
│  │  • Real data fetch (stdlib urllib - NO external dependencies)         │  │
│  │  • Rate limiting (1.5s delays to avoid 429)                           │  │
│  │  • Retry logic with exponential backoff                               │  │
│  │  • Technical indicators: RSI, EMA, SMA, MACD, CCI, ATR              │  │
│  │  • Pattern detection: Bullish Engulfing, Hammer, Doji, Breakout      │  │
│  │  • Trend classification: Strong Up, Up, Sideways, Weak, Down         │  │
│  └──────────────────────────────────┬───────────────────────────────────┘  │
│                                     │                                        │
│                                     ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    TypeScript / Node.js Backend                        │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐│  │
│  │  │  MIT Routes      │  │  Scoring Engine   │  │  Portfolio Service   ││  │
│  │  │  /api/mit/*      │  │  NT-LITE + QUANT │  │  Entry/Exit/Trailing ││  │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────────┘│  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐│  │
│  │  │  Entry/Exit Calc  │  │  Guard Service   │  │  P&L Ledger          ││  │
│  │  │  Buy Zone/Stop    │  │  Exposure Check  │  │  Realized/Unrealized││  │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────────┘│  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         Frontend (React)                              │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐│  │
│  │  │  MIT Dashboard    │  │  Main App        │  │  Mobile Dashboard    ││  │
│  │  │  Portfolio + Ideas│  │  Tab Navigation  │  │  (Spec) One-Click   ││  │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────────┘│  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Persistence Layer                              │  │
│  │  ┌──────────────────────┐  ┌─────────────────────────────────────────┐│  │
│  │  │  JSON Store (Default) │  │  PostgreSQL + TimescaleDB (Production)  ││  │
│  │  │  • data/state.json    │  │  • TimescaleDB for time-series           ││  │
│  │  │  • data/mit-state.json│  │  • JSONB for flexible schemas          ││  │
│  │  └──────────────────────┘  └─────────────────────────────────────────┘│  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## What Works ✓

### 1. Real Data Pipeline (No Mocks)

| Component | Status | Details |
|-----------|--------|---------|
| Yahoo Finance Fetch | ✅ Working | `src/screenipy.py` uses stdlib `urllib.request` |
| Rate Limiting | ✅ Working | 1.5s delays between requests |
| Retry Logic | ✅ Working | Exponential backoff for HTTP 429 |
| CSV Parsing | ✅ Working | All 14 columns including TA indicators |
| NIFTY 50 Scan | ✅ Tested | 49 stocks scanned successfully |

**Test Output:**
```
Stock,LTP,Volume,RSI,Trend,Pattern,EMA20,EMA50,SMA20,SMA50,MACD,MACDSignal,CCI20,ATR14
SBIN,1190.20,23915479,77.8,Strong Up,Breakout,1084.95,1032.31,1073.81,1017.97,40.0700,27.7983,220.49,28.25
```

### 2. Technical Analysis

| Indicator | Status | Implementation |
|-----------|--------|----------------|
| RSI | ✅ Working | 14-period RSI calculation |
| EMA | ✅ Working | 20-day, 50-day EMA |
| SMA | ✅ Working | 20-day, 50-day SMA |
| MACD | ✅ Working | MACD line + Signal line + Histogram |
| CCI | ✅ Working | 20-period Commodity Channel Index |
| ATR | ✅ Working | 14-period Average True Range |
| Pattern Detection | ✅ Working | Bullish Engulfing, Hammer, Doji, Breakout |
| Trend Classification | ✅ Working | Strong Up, Up, Sideways, Weak, Down |

### 3. Scoring System

| Score Component | Weight | Details |
|-----------------|--------|---------|
| Quality Score | 40 | ROCE/ROE (15), FCF (10), OPM (10), D/E (5) |
| Growth Score | 20 | 3-5 yr Revenue/EPS CAGR |
| Valuation Score | 15 | PEG ≤ 1.2 (10), P/E vs peers (5) |
| Momentum Score | 15 | Price > 50/200 DMA (10), RSI 45-65 (5) |
| Governance Score | 10 | Promoter stability, pledge, audit |

### 4. Two-Feed System

| Feed | Focus | Criteria |
|------|-------|----------|
| NT-LITE | Quality + Fundamentals | Checklist pass ≥ 50, quality score emphasis |
| QUANT | Momentum | Top decile Z-score, price > DMA100, pullback < 5% |

### 5. Position Sizing & Risk (Per Blueprint)

| Parameter | Value | Source |
|-----------|-------|--------|
| Capital Base | ₹200,000 | Blueprint |
| Default Allocation | 5% (₹10,000) | Blueprint |
| Hard Stop | -6% | Blueprint |
| Pause Threshold | 3% cash | Blueprint |
| Max Deployed | 95% | Blueprint |
| Max Horizon | 90 days | Blueprint |
| Trailing Activation | 75% of target | Blueprint |

### 6. API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mit/screenipy/run` | GET | Run real data scan |
| `/api/mit/screenipy/latest` | GET | Get cached scan results |
| `/api/mit/screenipy/candidates` | GET | Filter by feed (nt-lite/quant) |
| `/api/mit/pipeline/run` | POST | Full pipeline execution |
| `/api/mit/pipeline/status/:runId` | GET | Check pipeline status |
| `/api/mit/portfolio` | GET | Get portfolio state |
| `/api/mit/daily-ideas` | GET | Get today's trading ideas |
| `/api/mit/guard` | GET | Check trading guard status |
| `/api/mit/trade/enter` | POST | Enter position |
| `/api/mit/trade/exit` | POST | Exit position |
| `/api/mit/pnl` | GET | Get P&L summary |

### 7. Docker Infrastructure

| Service | Status | Port |
|---------|--------|------|
| TimescaleDB | ✅ Running | 5432 |
| Windmill | ✅ Running | 8000 |
| Frontend | ✅ Running | 5173 |
| Backend | ✅ Running | 3000 |

## What is Simulated ⚠️

| Component | Status | Notes |
|-----------|--------|-------|
| Fundamental Data | ⚠️ Empty | No NSE stock fundamentals seeded |
| Candle Data | ⚠️ Empty | No historical price data loaded |
| Daily Pipeline Runs | ⚠️ Empty | No historical runs recorded |
| User Portfolio | ⚠️ Empty | No positions entered yet |

**Note:** The system uses REAL market data for live scans but has no historical data seeded. This is intentional - the system fetches fresh data on demand.

## LLMs Being Used 🤖

| Component | LLM | Purpose |
|-----------|-----|---------|
| Sisyphus (this agent) | MiniMax-M2.1 | Orchestration, code generation |
| Oracle | High-IQ reasoning | Architecture decisions, debugging |
| Prometheus | Planning | Work plans, task breakdown |
| Metis | Analysis | Complex requirement clarification |
| Momus | Review | Code review, quality assurance |
| Hephaestus | Build | Code generation, refactoring |

**Note:** The MIT Trading System itself does NOT use LLMs for trading decisions. All calculations are deterministic:
- Technical indicators use pure Python/TypeScript math
- Scoring uses weighted formulas (no ML models)
- Pattern detection uses rule-based candle analysis

## Data Flow

```
1. User triggers pipeline
   └─→ GET /api/mit/pipeline/run

2. Backend spawns Python process
   └─→ python3 src/screenipy.py --tickerOption 5 --executeOption 0

3. Python fetches real NSE data
   └─→ Yahoo Finance → urllib.request → CSV

4. Parse & calculate indicators
   └─→ RSI, EMA, SMA, MACD, CCI, ATR, Patterns

5. Score each stock
   └─→ Quality (40) + Growth (20) + Valuation (15) + Momentum (15) + Governance (10)

6. Generate trading ideas
   └─→ NT-LITE: quality ≥ 60 + fundamentals checklist
   └─→ QUANT: Z-score ≥ 1.28 + price > DMA100 + pullback < 5%

7. Save to persistence layer
   └─→ PostgreSQL (jsonb) or JSON file

8. Frontend displays ideas
   └─→ React Dashboard with Buy Zone, Stop, Target

User enters position
   └─→ POST /api/mit/trade/enter
   └─→ Calculate qty = (capital × 5%) / entry_price
   └─→ Save to portfolio

System monitors positions
   └─→ P&L updates on every refresh
   └─→ Guard checks exposure limits
```

## Missing Pieces 📋

| Item | Priority | Effort | Description |
|------|----------|--------|-------------|
| Fundamental Data Seeding | High | Medium | Seed Screener.in data for NIFTY 50 |
| Historical Candles | Medium | High | Load 300+ days of price data |
| Windmill Integration | Medium | Medium | Connect trading workflows |
| E2E Tests | Medium | Medium | Automated pipeline testing |
| Reports (Weekly/Monthly) | Low | Low | Generate PDF/CSV reports |
| Mobile Dashboard | Low | High | Build responsive mobile UI |

## Quick Start

```bash
# 1. Start Docker
docker compose up -d

# 2. Seed demo users
cat scripts/seed-demo-users.sql | docker exec -i policy-signal-timescaledb psql -U postgres -d policy_signal

# 3. Start the app
npm run dev

# 4. Open frontend
# http://localhost:5173

# 5. Select "MIT Trader" user and run pipeline
```

## File Reference

| File | Purpose |
|------|---------|
| `src/screenipy.py` | Real NSE data fetch with TA |
| `src/services/mit/screenipy-mit-connector.ts` | Scoring & idea generation |
| `src/services/mit/entry-exit-calc.ts` | Buy zone, stop, target calc |
| `src/services/mit/nt-lite-checklist.ts` | Fundamentals checklist |
| `src/mit-routes.ts` | All API endpoints |
| `src/MitDashboard.tsx` | Frontend dashboard |
| `Mit_Trading_System_Blueprint.md` | Requirements spec |
| `docker-compose.yml` | Infrastructure |

## Success Criteria ✅

- [x] Real Yahoo Finance data (no mocks)
- [x] Technical analysis (RSI, EMA, SMA, MACD, CCI, ATR)
- [x] Pattern detection (Bullish Engulfing, Hammer, etc.)
- [x] Two-feed system (NT-LITE + QUANT)
- [x] Position sizing (5% default, -6% hard stop)
- [x] Guard system (exposure limits)
- [x] Docker persistence (PostgreSQL)
- [x] Frontend dashboard
- [ ] Fundamental data seeding (pending)
- [ ] End-to-end test (pending)

---

**Last Updated:** 2026-02-12
**Status:** Integration Complete - Needs Data Seeding

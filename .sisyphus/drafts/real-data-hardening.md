# Draft: Real Data Hardening

## Requirements (confirmed)
- Replace supply-chain `production/demand/imports/exports/surplus` from derived signal formulas with real economic/company financial data.
- Ensure Screener-backed entity metadata is available across full MIT universe (remove effective dependence on 10-ticker fallback set).
- Replace market snapshot prices currently derived from breadth scores with live market prices.
- Keep cost low: user selected Yahoo Finance as default live source (free, delayed).
- Terminal should have full feature completeness (all panels wired to working endpoints, no dead panels).
- Provide clear answer and implementation path for "where to fetch all historical data".
- Add sample strategies (seeded, usable templates/examples).

## Technical Decisions
- Live price provider default: Yahoo Finance quote API (`query1.finance.yahoo.com/v7/finance/quote`) with no API key.
- Entity coverage target: all 52 tickers from `src/config/mit-universe.json`.
- Supply-chain economic inputs source: Screener fundamentals fetcher (`revenueHistory`, `opmHistory`, shareholding metrics) plus explicit fallback behavior when source unavailable.

## Research Findings
- `src/services/supply-chain-graph.ts` currently derives node economics from `importance` and propagation scores.
- `src/services/market-snapshot.ts` currently computes `latestPrice/dayChangePct` from outcomes + breadth score.
- `src/services/config/entity-loader.ts` currently hardcodes known tickers to 10 and uses fallback entities.
- `src/services/mit/screener-fundamentals-fetcher.ts` can fetch rich real fundamentals for arbitrary ticker via Screener.
- `src/services/mit/market-data.ts` already integrates Yahoo Finance for candles; no key required.

## Scope Boundaries
- INCLUDE: service-level data source hardening, terminal endpoint completeness, historical data source catalog/surface, strategy sample seeding, provider fallback policy, endpoint output correctness, verification commands and QA scenarios.
- EXCLUDE: paid broker integration (Angel/Upstox/Kite) and real-time websocket feed implementation.

## Open Questions
- None blocking. Plan will default to Yahoo Finance (free, delayed) and provide optional extension hooks for paid/real-time later.

# India Policy Signal Terminal (MVP)

This repository now contains a working MVP implementation of the PRD in `docs/india-policy-signal-terminal-prd.md`.

## Run

```bash
npm install
npm run dev
npm run e2e:backfill
```

Open `http://localhost:3000`.

## What is implemented

- Source registry with metadata, reliability tier, license tag, and enable/disable kill switch.
- Ingestion pipeline (RSS/XML/HTML/PDF-ocr/Screeni-py parser types) with content-hash dedupe and raw artifact archival.
- Parsing and normalization with language hinting (`en`, `hi`, `mixed`, `unknown`) and evidence snippets.
- Event classification, entity linking, impact scoring, and probabilistic prediction.
- Ranked terminal feed, sector heatmap, source drill-down API, and explainability rationale.
- Command-driven terminal routing with keyboard shortcuts (`Ctrl/Cmd + K`), parser dispatch, and telemetry logs.
- Identity and entitlement baseline with per-user route/source access controls and access audit logs (`x-user-id` header).
- Stream event bus baseline with durable event sequence, replay API, and stream health metrics.
- Backfill run-control dashboard and reconciliation APIs for duplicate visibility and reliability tracking.
- Source drift detection API with freshness/fallback/confidence signals for reliability operations.
- Market snapshot API with adjustment-aware price and breadth metrics.
- Entity-link diagnostics API with confidence coverage and explainable link-reason trails.
- Charting workspace APIs for saved templates and event annotations by ticker.
- Screening/discovery APIs for saved screens, reruns, change feed, and diagnostics.
- Alert orchestration APIs for composite rule config, routing, and quality metrics.
- Portfolio workspace APIs for positions, exposure, attribution, and scenario bookmarks.
- Risk terminal APIs for policy controls and portfolio risk snapshots.
- Anomaly v3 APIs for analyst attribution overrides and calibration reports.
- Research workflow APIs for notebooks, query templates, comments, and evidence packs.
- Governance hardening APIs for release-gate evidence, runbooks, and policy checks.
- React + Framer Motion + Tailwind terminal UI with live Recharts dashboards.
- Supply-chain graph view (direct + indirect links) with node-level production/demand/import/export/surplus metrics.
- Alert generation with thresholding, dedupe behavior, and cooldown suppression.
- Feedback capture (`useful`, `noise`, `wrong-mapping`, `wrong-direction`) and reviewer states.
- Learning loop recalibration endpoint, source reliability review loop, and audit-trail records per signal.
- Outcome loop for realized-return evaluation and governance change log endpoints.
- Store abstraction with JSON backend and optional PostgreSQL/Timescale backend (`STORE_BACKEND=postgres`).
- Training pipeline endpoint for `train.csv` / `test.csv` workflows using temporal split, MAD winsorization, and missing-value handling.

## API overview

- `GET /api/sources`
- `POST /api/sources`
- `POST /api/sources/:sourceId/reliability`
- `POST /api/sources/:sourceId/enabled`
- `GET /api/sources/drift`
- `POST /api/ingest/run?sourceId=<id>`
- `GET /api/signals?limit=20`
- `GET /api/heatmap`
- `GET /api/market/snapshots?limit=50`
- `GET /api/entity-links/diagnostics?limit=10`
- `POST /api/chart/templates`
- `GET /api/chart/templates`
- `GET /api/chart/annotations?ticker=SBIN&limit=25`
- `POST /api/screens`
- `GET /api/screens`
- `POST /api/screens/:screenId/run`
- `GET /api/discovery/feed?limit=50`
- `GET /api/screens/:screenId/diagnostics`
- `POST /api/alert-rules`
- `GET /api/alert-rules`
- `POST /api/alerts/route?limit=100`
- `GET /api/alerts/quality`
- `POST /api/portfolios`
- `GET /api/portfolios`
- `GET /api/portfolios/:portfolioId/exposure`
- `GET /api/portfolios/:portfolioId/attribution`
- `POST /api/portfolios/:portfolioId/scenarios`
- `GET /api/portfolios/:portfolioId/scenarios`
- `POST /api/portfolios/:portfolioId/risk-policy`
- `POST /api/portfolios/:portfolioId/risk-snapshot`
- `GET /api/portfolios/:portfolioId/risk-snapshots?limit=50`
- `POST /api/anomalies/overrides`
- `GET /api/anomalies/overrides?limit=100`
- `GET /api/anomalies/calibration`
- `POST /api/research/notebooks`
- `GET /api/research/notebooks`
- `POST /api/research/query-templates`
- `GET /api/research/query-templates`
- `POST /api/research/comments`
- `POST /api/research/evidence-pack/:signalId`
- `POST /api/governance/release-gates`
- `GET /api/governance/release-gates`
- `POST /api/governance/runbooks`
- `GET /api/governance/runbooks`
- `GET /api/governance/policy-checks`
- `GET /api/supply-chain-graph`
- `GET /api/alerts`
- `POST /api/feedback`
- `GET /api/feedback`
- `POST /api/feedback/:feedbackId/review`
- `POST /api/learning/recalibrate`
- `GET /api/audit/:signalId`
- `POST /api/reliability/review`
- `GET /api/data-quality`
- `POST /api/data-quality/:issueId/resolve`
- `POST /api/outcomes`
- `GET /api/outcomes/summary`
- `GET /api/governance`
- `POST /api/governance`
- `POST /api/terminal/command`
- `GET /api/terminal/commands`
- `GET /api/identity/me`
- `GET /api/identity/users`
- `POST /api/identity/users/:userId/role`
- `GET /api/access-audits`
- `GET /api/stream/events?fromSequence=0&limit=200`
- `GET /api/stream/health`
- `POST /api/screenipy/run`
- `POST /api/model/train`
- `POST /api/backfill/notable`
- `POST /api/backfill/notable/preview`
- `GET /api/backfill/runs`
- `GET /api/backfill/runs?status=completed&limit=20`
- `GET /api/backfill/dashboard`
- `GET /api/backfill/reconcile?limit=100`
- `GET /api/backfill/sources`
- `POST /api/anomalies/correlate`
- `GET /api/system/status`

## Backfill and Anomaly Examples

```bash
curl -X POST http://localhost:3000/api/backfill/notable/preview \
  -H "content-type: application/json" \
  -d '{"from":"2022-01-01T00:00:00.000Z","to":"2025-12-31T23:59:59.000Z","tickers":["SBIN"],"batchSize":2}'

curl -X POST http://localhost:3000/api/backfill/notable \
  -H "content-type: application/json" \
  -d '{"from":"2022-01-01T00:00:00.000Z","to":"2025-12-31T23:59:59.000Z","tickers":["SBIN"],"batchSize":2}'

curl -X POST http://localhost:3000/api/backfill/notable \
  -H "content-type: application/json" \
  -d '{"from":"2022-01-01T00:00:00.000Z","to":"2025-12-31T23:59:59.000Z","tickers":["SBIN"],"batchSize":2,"persist":false}'

curl "http://localhost:3000/api/backfill/runs?status=completed&limit=10"

curl -X POST http://localhost:3000/api/anomalies/correlate \
  -H "content-type: application/json" \
  -d '{"ticker":"SBIN","windowSize":6,"zThreshold":2,"lookbackHours":240,"minEventScore":0.4,"requireEvents":true,"observations":[{"at":"2024-12-05T10:00:00.000Z","close":100},{"at":"2024-12-06T10:00:00.000Z","close":99.7},{"at":"2024-12-07T10:00:00.000Z","close":99.8},{"at":"2024-12-08T10:00:00.000Z","close":99.6},{"at":"2024-12-09T10:00:00.000Z","close":99.7},{"at":"2024-12-10T10:00:00.000Z","close":99.6},{"at":"2024-12-11T10:00:00.000Z","close":99.5},{"at":"2024-12-12T10:00:00.000Z","close":106.8}]}'
```

## Notes

- Default storage is file-backed JSON under `data/`; set `STORE_BACKEND=postgres` and `DATABASE_URL` to use Timescale-backed Postgres.
- Backfill hardening and source strategy are documented in `docs/production-backfill-playbook.md`.
- When remote fetch fails, ingestion uses controlled fallback payloads so the end-to-end loop remains testable.
- OCR in this MVP is parser-mode aware (`pdf-ocr`) but intentionally lightweight; production OCR stack guidance is expected to evolve per PRD phasing.
- UI is served from `public/terminal.html` and uses browser-loaded React/Framer Motion/Tailwind/Recharts modules.
- Timescale quick start: `docker compose up -d timescaledb`.
- Training script path is `scripts/train_model.py` (invoked by `POST /api/model/train`).

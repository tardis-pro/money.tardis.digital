# India Policy Signal Terminal (MVP)

This repository now contains a working MVP implementation of the PRD in `docs/india-policy-signal-terminal-prd.md`.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## What is implemented

- Source registry with metadata, reliability tier, license tag, and enable/disable kill switch.
- Ingestion pipeline (RSS/XML/HTML/PDF-ocr/Screeni-py parser types) with content-hash dedupe and raw artifact archival.
- Parsing and normalization with language hinting (`en`, `hi`, `mixed`, `unknown`) and evidence snippets.
- Event classification, entity linking, impact scoring, and probabilistic prediction.
- Ranked terminal feed, sector heatmap, source drill-down API, and explainability rationale.
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
- `POST /api/ingest/run?sourceId=<id>`
- `GET /api/signals?limit=20`
- `GET /api/heatmap`
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
- `POST /api/screenipy/run`
- `POST /api/model/train`

## Notes

- Default storage is file-backed JSON under `data/`; set `STORE_BACKEND=postgres` and `DATABASE_URL` to use Timescale-backed Postgres.
- When remote fetch fails, ingestion uses controlled fallback payloads so the end-to-end loop remains testable.
- OCR in this MVP is parser-mode aware (`pdf-ocr`) but intentionally lightweight; production OCR stack guidance is expected to evolve per PRD phasing.
- UI is served from `public/terminal.html` and uses browser-loaded React/Framer Motion/Tailwind/Recharts modules.
- Timescale quick start: `docker compose up -d timescaledb`.
- Training script path is `scripts/train_model.py` (invoked by `POST /api/model/train`).

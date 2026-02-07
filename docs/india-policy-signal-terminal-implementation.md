# India Policy Signal Terminal - Implementation Traceability

This document maps PRD functional requirements (FR-01..FR-12) to implemented components.

## FR Mapping

- **FR-01 Source Registry**
  - `src/services/source-registry.ts`
  - `src/config/sources.json`
  - API: `GET/POST /api/sources`, `POST /api/sources/:sourceId/reliability`, `POST /api/sources/:sourceId/enabled`

- **FR-02 Ingestion + dedupe + archival**
  - `src/services/ingestion.ts`
  - `src/store.ts` (`data/artifacts` persistence)
  - `src/services/screenipy.ts` (external Screeni-py runner)
  - Content hash dedupe by `sha256`

- **FR-03 Parsing + OCR mode + normalization**
  - `src/services/parser.ts`
  - Parser mode support (`rss`, `xml`, `html`, `pdf-ocr`, `screenipy`), language hinting (`en`, `hi`, `mixed`)

- **FR-04 Event Classification**
  - `src/services/classifier.ts`
  - Event type taxonomy and keyword-driven classification

- **FR-05 Entity Linking**
  - `src/services/entity-linker.ts`
  - `src/config/entity-map.json`

- **FR-06 Impact Scoring**
  - `src/services/impact-scorer.ts`
  - Direction, horizon, magnitude, confidence, rationale, feature snapshot

- **FR-07 Prediction Layer**
  - `src/services/prediction.ts`
  - `src/services/model-training.ts`
  - `scripts/train_model.py`
  - Probabilistic up/down outputs with calibrated confidence
  - API: `POST /api/model/train`

- **FR-08 Terminal Experience**
  - `public/terminal.html` (React + Framer Motion + Tailwind + Recharts UI at `/`)
  - `src/server.ts` (serves terminal shell)
  - `src/services/terminal.ts` (`/api/signals`, `/api/heatmap`)
  - `src/services/supply-chain-graph.ts` + `src/config/supply-chain.json` (`/api/supply-chain-graph` for direct/indirect links)

- **FR-09 Alerts**
  - `src/services/alerts.ts`
  - Cooldown and threshold logic
  - API: `GET /api/alerts`

- **FR-10 Feedback Capture**
  - `src/services/feedback.ts`
  - API: `POST /api/feedback`, `GET /api/feedback`, `POST /api/feedback/:feedbackId/review`

- **FR-11 Learning Loop**
  - `src/services/learning-loop.ts`
  - `src/services/source-reliability-loop.ts`
  - `src/services/outcomes.ts`
  - API: `POST /api/learning/recalibrate`
  - API: `POST /api/reliability/review`, `POST /api/outcomes`, `GET /api/outcomes/summary`

- **FR-12 Audit Trail**
  - `src/services/pipeline.ts` (audit record creation per signal)
  - `src/services/governance.ts` (configuration/model/pipeline change log)
  - `src/services/data-quality.ts` (data-quality issue registry)
  - API: `GET /api/audit/:signalId`
  - API: `GET /api/governance`, `POST /api/governance`, `GET /api/data-quality`, `POST /api/data-quality/:issueId/resolve`

## Non-functional trustability coverage

- Explainability: evidence snippet + rationale attached to every signal.
- Provenance: source URL/hash, parser/model version, feature snapshots recorded.
- Human override: per-source enable/disable kill switch via API.
- Reproducibility: file-backed immutable records in `data/state.json` and artifact files.

## Infrastructure extensions

- `src/store-postgres.ts`: Postgres + Timescale-backed store implementation (hypertables for signals/events/alerts/outcomes).
- `docker-compose.yml`: local TimescaleDB bootstrap (`timescale/timescaledb:latest-pg16`).
- `.env.example`: backend toggle (`STORE_BACKEND=json|postgres`) and training/screenipy runtime settings.

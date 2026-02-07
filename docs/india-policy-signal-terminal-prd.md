# PRD: India Policy + Tender + News Signal Terminal (Personal, Workable, Trustable)

Version: v1.0

Goal: Build a personal Bloomberg-style intelligence terminal that converts Indian government and market information into explainable, testable prediction signals with strong feedback loops.

## 1) Product Objective

- Indian market-moving information is fragmented across policies, tenders, circulars, and media; decision quality suffers from latency and noise.
- Build an end-to-end signal system that ingests public sources, maps events to listed entities/sectors, predicts directional impact, and continuously improves via feedback.
- v1 outcome: decision-support engine with paper-trading and confidence-ranked alerts, not fully automated execution.

## 2) Users and Jobs-to-be-Done

- Primary user: active investor/trader tracking policy-driven moves in Indian equities.
- Secondary user: sector analyst monitoring infra, defense, rail, power, BFSI, and commodities.
- JTBD: "Tell me what changed, who it impacts, expected direction and confidence, with source evidence I can trust."

## 3) Scope

- In scope: ingestion, normalization, event extraction, entity mapping, prediction scoring, terminal UI, feedback loops, auditability.
- Out of scope (v1): live auto-trading, options strategy automation, unlicensed premium data ingestion, social rumor firehose.

## 4) Data Universe (Signal Coverage)

- Government policies/circulars: eGazette, PIB, RBI, SEBI, IRDAI, PFRDA, TRAI, DGFT, CBIC/GST, major ministry portals.
- Tenders/procurement: CPPP (`eprocure.gov.in`), GeM notices, major PSU tender pages.
- Market disclosures: NSE/BSE announcements, board outcomes, order wins, compliance filings.
- News: high-quality RSS/licensed feeds from Indian financial publishers and agencies.
- Macro/public docs: budget documents, parliamentary/bill trackers, key regulator consultations.

## 5) Functional Requirements

- FR-01 Source Registry: source metadata, polling interval, parser type, reliability tier, license tag.
- FR-02 Ingestion: fetch RSS/HTML/PDF/XML, content hash dedupe, raw artifact archival.
- FR-03 Parsing: OCR for scans, English/Hindi normalization, structured extraction from unstructured docs.
- FR-04 Event Classification: classify as policy/tax/tender/circular/compliance/capex/ban/incentive/etc.
- FR-05 Entity Linking: map events to tickers, sectors, ministries, and supply-chain peers with confidence.
- FR-06 Impact Scoring: direction (+/-/neutral), horizon (intraday/1D/1W), magnitude, and confidence.
- FR-07 Prediction Layer: probabilistic model using event + market regime features.
- FR-08 Terminal Experience: watchlists, ranked signal feed, sector heatmap, source drill-down, "why this signal".
- FR-09 Alerts: threshold-based push alerts, dedupe, cooldown, severity.
- FR-10 Feedback Capture: useful/noise/wrong-mapping/wrong-direction labels + notes.
- FR-11 Learning Loop: scheduled recalibration/retraining from validated feedback + realized outcomes.
- FR-12 Audit Trail: source URL/hash, parser version, model version, feature snapshot per signal.

## 6) Feedback Loop Architecture (Core Trust Engine)

| Loop | Trigger | Action | Owner | SLA |
|---|---|---|---|---|
| Data Quality Loop | Parser fail, fetch miss, schema drift | Auto-retry, fallback parser, queue for review | Data Eng | detect <5 min |
| Source Reliability Loop | Repeated noisy/late source behavior | Dynamic source weight downgrade, source quarantine | Research Ops | weekly |
| Label Quality Loop | User flags wrong mapping/direction | Human validation -> gold label store | Analyst | triage <1 day |
| Outcome Loop | Prediction horizon completes | Compare predicted vs realized return regime-aware | Quant | daily batch |
| Model Performance Loop | Precision/calibration drops | Champion-challenger retrain + gated release | ML Eng | weekly/on drift |
| Governance Loop | Model/source config change | Approval checklist, rollback readiness, change log | Product + Risk | pre-deploy |

## 7) Trustability Requirements (Non-Functional)

- Explainability-by-default: no signal without evidence snippet + source link + rationale.
- Provenance and reproducibility: immutable IDs, timestamped artifacts, model/feature versioning.
- Reliability: 99.5% service uptime target; P95 alert latency <3 minutes for live feeds.
- Quality gates: entity-link precision >=92%, duplicate event rate <=2%, top-ranked alert precision target >=60% after stabilization.
- Security/compliance: encryption in transit/at rest, role-based access, secret vault, source licensing registry.
- Human override and kill switches: per-source and per-model immediate disable.

## 8) Modeling Strategy (Workable First, Then Advanced)

- Phase 1: hybrid engine (rules + gradient boosting) for robust baseline.
- Key features: event type intensity, tender size, source quality, novelty, sector sensitivity, momentum/volatility/regime.
- Validation: strict time-split walk-forward, leakage checks, calibration (isotonic/Platt), per-sector scorecards.
- Deployment: shadow mode -> paper trading -> controlled live decision support.

## 9) Delivery Plan (16 Weeks)

- Weeks 1-2: source inventory, legal/licensing matrix, schema + ingestion skeleton.
- Weeks 3-6: ingestion, OCR/parsing, dedupe, raw event timeline in terminal.
- Weeks 7-10: classification + entity linking + impact scoring + explainability cards.
- Weeks 11-13: prediction model + backtest harness + calibration dashboard.
- Weeks 14-16: full feedback loops, hardening, paper-trading, go-live checklist.

## 10) Success Metrics

- Coverage: >=120 priority Indian sources onboarded.
- Freshness: median ingest-to-alert <120s.
- Model value: directional hit-rate uplift >=15% vs baseline heuristics.
- User trust: >=65% "useful" feedback on top-ranked alerts by month 3.
- Auditability: 100% production signals have full evidence trail.

## 11) Risk Register

- Unstructured docs/OCR errors -> confidence thresholds + manual fallback queue.
- Wrong entity mapping -> ambiguity flags + human-in-the-loop correction.
- Regime shifts/drift -> drift detectors + retrain gates + challenger model.
- News licensing constraints -> source whitelist with legal flags and auto-block.
- Overfitting to text noise -> combine event features with market regime + strict out-of-time validation.

## 12) Implementation Notes (Workable + Trustable Defaults)

- Start with high-signal sectors first: defense, railways, power, BFSI, infra.
- Keep every model output paired with source citations and confidence explanations.
- Treat feedback as first-class data with reviewer states: pending, validated, rejected.
- Ship in shadow mode first; graduate only after calibration and precision thresholds are met.

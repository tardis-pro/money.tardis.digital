# Bloomberg-Style Terminal Program Plan (20 Big Sprints)

Version: v1.0
Owner: Product + Engineering + Design Council
Scope: Build a Bloomberg-like policy and market intelligence terminal for India-focused workflows.

## Program Intent

- Build a keyboard-first, multi-workspace terminal with real-time market and policy intelligence.
- Preserve explainability and auditability as first-class requirements.
- Scale from individual decision support to desk-level operations with governance controls.

## Non-Negotiables

- Every signal must be explainable, reproducible, and attributable to evidence.
- Every major workflow must be operable by keyboard without mouse dependence.
- Every release must pass data quality, reliability, and governance gates.
- Every sprint must deliver production-usable capability, not isolated prototypes.

## Current Baseline

- Existing MVP supports source ingestion, signal scoring, anomaly-event linkage, and basic terminal UI.
- Existing APIs cover ingestion, feedback, outcomes, backfill preview/run tracking, anomaly correlation, and system status.
- Existing storage supports JSON and Postgres/Timescale.
- Gap to Bloomberg-like target remains significant in workspace ergonomics, breadth/depth of analytics, risk tooling, and enterprise controls.

## Implementation Progress Log

- Sprint 1/2 in-progress implementation:
  - Command grammar baseline and route dispatch shipped in API and terminal surface (`/api/terminal/command`, `/api/terminal/commands`).
  - Keyboard command entry (`Ctrl/Cmd + K`) and route-focused panel navigation shipped.
  - Command telemetry persistence shipped across JSON and Postgres stores.
- Sprint 3/4 foundation in-progress implementation:
  - Identity baseline added with user profiles, role model, route/source entitlement checks, and access audit records.
  - Stream backbone baseline added with durable sequence events, replay endpoint, and stream health metrics.
  - Remaining work for full Sprint 3/4 exits: endpoint-wide entitlement enforcement coverage, websocket fanout with backpressure/replay consumers, and latency SLO instrumentation.
- Sprint 5 baseline implementation:
  - Backfill run-control dashboard API added with run status, throughput, duplicate-skip, and duration rollups.
  - Backfill reconciliation API added with duplicate-content hash grouping and by-source duplicate metrics.
  - Remaining work for full Sprint 5 exits: partitioned storage strategy and checkpoint orchestration UI.
- Sprint 6 baseline implementation:
  - Source drift detection API added with freshness, low-confidence, and fallback-payload scoring.
  - Drift output ranked by risk score to support source reliability review loops.
  - Remaining work for full Sprint 6 exits: expanded RBI/PIB archive connectors and automated license-policy enforcement.
- Sprint 7 baseline implementation:
  - Market snapshot API added with adjustment-aware prices and breadth-driven ranking.
  - Corporate-action adjustment factors introduced for key instruments in snapshot output.
  - Remaining work for full Sprint 7 exits: real exchange-integrated streaming prices and deeper integrity checks.
- Sprint 8 baseline implementation:
  - Entity-link diagnostics API added with coverage, confidence metrics, and top-link reason trails.
  - Explainable "why linked" traces are now queryable as structured diagnostics data.
  - Remaining work for full Sprint 8 exits: expanded entity graph coverage and threshold-governed precision benchmarks.
- Sprint 9 baseline implementation:
  - Chart template APIs added for saving and retrieving multi-timeframe chart setups.
  - Chart annotation API added to expose signal-event markers for ticker-focused chart overlays.
  - Remaining work for full Sprint 9 exits: synchronized crosshair linked panes and advanced study rendering controls.
- Sprint 10 baseline implementation:
  - Screening engine APIs added for saved screens with policy/factor/liquidity filters.
  - Screen run orchestration added with ranked top-ticker outputs and rerunnable execution.
  - Discovery feed and screen diagnostics APIs added for explainable "what changed" monitoring.
  - Remaining work for full Sprint 10 exits: scheduled runner daemon and SLA instrumentation.
- Sprint 11 baseline implementation:
  - Alert rule orchestration APIs added with dedupe/cooldown/escalation parameters.
  - Alert routing execution API added for per-rule multi-channel dispatching.
  - Alert quality metrics API added for duplicate/suppression/escalation visibility.
  - Remaining work for full Sprint 11 exits: user/watchlist-targeted routing matrix and richer anomaly-policy composites.
- Sprint 12 baseline implementation:
  - Portfolio workspace APIs added for position book creation and retrieval.
  - Exposure and attribution APIs added for sector weights, market value, and event-linked PnL rows.
  - Scenario bookmark APIs added for recurring desk stress templates.
  - Remaining work for full Sprint 12 exits: near-real-time refresh transport and external reconciliation adapters.
- Sprint 13 baseline implementation:
  - Risk policy API added with enforceable concentration/drawdown/liquidity constraints per portfolio.
  - Risk snapshot API added for repeatable portfolio risk-state captures with breach reasons.
  - Snapshot history API added for desk-level monitoring of risk evolution.
  - Remaining work for full Sprint 13 exits: approval workflow and stress-template lineage.
- Sprint 14 baseline implementation:
  - Attribution override API added for analyst dispute/override capture.
  - Calibration report API added with bucketed predicted-vs-observed quality points.
  - Override history API added to feed retraining and governance evidence.
  - Remaining work for full Sprint 14 exits: multi-model blending and benchmark harness automation.
- Sprint 15 baseline implementation:
  - Research notebook APIs added for saving and listing desk analysis notes by terminal page.
  - Query template APIs added for command-driven reusable research execution.
  - Evidence pack and comment APIs added for review-ready traceability artifacts.
  - Remaining work for full Sprint 15 exits: richer permissioning and notebook collaboration UX layer.
- Sprint 16 baseline implementation:
  - Governance release-gate API added with policy-check evidence snapshots.
  - Incident runbook API added for formalized security/operational response procedures.
  - Runtime policy-check API added for entitlement/data-quality/governance status.
  - Remaining work for full Sprint 16 exits: CI/CD enforcement wiring and retention-policy automation.
- Sprint 17 baseline implementation:
  - SLO budget APIs added for subsystem-level reliability targets.
  - Chaos drill APIs added with pass/fail and MTTR capture.
  - SRE status API added for reliability budget and drill-compliance summary.
  - Remaining work for full Sprint 17 exits: automated failover execution and cost-control telemetry.
- Sprint 18 baseline implementation:
  - Workspace macro APIs added for safe, reversible command automation.
  - Role-based workspace preset APIs added for one-action desk setup.
  - Onboarding/adoption APIs added for completion and workflow optimization metrics.
  - Remaining work for full Sprint 18 exits: in-terminal guided UX and behavior-driven recommendation loop.
- Sprint 19 baseline implementation:
  - Pilot scorecard APIs added for latency/trust/utility desk validation records.
  - Defect tracking APIs added for critical-path triage before launch.
  - Launch readiness API added with scorecard and critical-defect gate logic.
  - Remaining work for full Sprint 19 exits: production pilot workflow instrumentation and sign-off automation.
- Sprint 20 baseline implementation:
  - Launch checklist APIs added for Gate E itemization with rollback-readiness tracking.
  - Operating cadence APIs added for weekly steady-state model/risk/governance reviews.
  - Launch status API added to expose Gate E readiness from checklist/cadence state.
  - Remaining work for post-program scale mode: external integrations, UI deepening, and operational automation at enterprise load.

## Delivery Structure

- Sprint cadence: 2 weeks.
- Program duration: 20 sprints (about 40 weeks).
- Release model: each 4-sprint block ends in a formal gate review.
- Gate names:
  - Gate A: Platform Foundation (after Sprint 4)
  - Gate B: Intelligence Core (after Sprint 8)
  - Gate C: Trading Workflows (after Sprint 12)
  - Gate D: Institutional Controls (after Sprint 16)
  - Gate E: Launch Readiness (after Sprint 20)

## Decision Gate Artifacts

- Gate A (S1-S4):
  - Command grammar spec, workspace interaction spec, event contract v1, stream backbone readiness report.
- Gate B (S5-S8):
  - Source onboarding matrix, historical backfill reliability report, entity-link quality scorecard, licensing compliance report.
- Gate C (S9-S12):
  - Charting and screening UX validation, alert precision report, portfolio/exposure reconciliation report.
- Gate D (S13-S16):
  - Risk model validation, anomaly/attribution calibration report, governance and security control verification.
- Gate E (S17-S20):
  - SLO evidence pack, failover and DR test results, pilot KPI report, launch and rollback runbook signoff.

## Acceptance Criteria Format

Use this format for every sprint-level deliverable:

```
AC-ID: [Sprint]-[Domain]-[Index]
Given [context]
When [action]
Then [observable outcome with metric]
Verification: [automated | manual | user validation | benchmark]
Owner: [team]
Dependencies: [required upstream work]
```

Rules:
- No acceptance criterion without measurable metric.
- No gate pass if any gate-critical AC remains unverified.
- No model or signal feature exits sprint without explainability and auditability checks.

## Sprint-by-Sprint Plan

### Sprint 1 - Terminal Command Language and Navigation Core

Major epics:
- Define command grammar and route mapping (`<symbol>`, `<function>`, `<GO>` style interaction pattern).
- Build command palette with fuzzy matching and keyboard dispatch.
- Define page identity and deep-linking model.
- Define workspace/session state model.

Exit criteria:
- Users can navigate all core pages without mouse input.
- Commands are logged with latency and error telemetry.
- Command grammar and naming standards are documented.

### Sprint 2 - Multi-Workspace Shell and Panel Framework

Major epics:
- Implement dockable panel system with saved layouts.
- Add split-view modes for chart, feed, and detail panes.
- Add hotkey map and context-sensitive command hints.
- Implement session restore on reconnect.

Exit criteria:
- Layout save/load works across restarts.
- Keyboard workflow handles layout changes and focus movement.
- P95 panel interaction latency meets target.

### Sprint 3 - Data Entitlements and Identity Layer

Major epics:
- Implement RBAC for feature-level and source-level access.
- Add entitlement checks at API and workspace layers.
- Add audit trail for privileged actions.
- Add user profile with workspace preferences.

Exit criteria:
- Unauthorized routes are blocked with auditable records.
- Entitlements can be changed without redeploy.
- Access policy tests pass for all protected APIs.

### Sprint 4 - Streaming Backbone and Event Bus

Major epics:
- Build low-latency pub/sub pipeline for market and policy events.
- Add websocket fanout and backpressure handling.
- Add stream health dashboard and lag alarms.
- Add replay support for stream consumers.

Exit criteria:
- Real-time updates propagate to workspace panels in target SLA.
- Stream recoverability and replay are tested.
- Gate A approval completed.

### Sprint 5 - Historical Lakehouse and Partitioned Backfill Engine

Major epics:
- Implement partitioned historical storage strategy.
- Upgrade backfill to support large historical windows with resume checkpoints.
- Add dedupe ledger and reconciliation tooling.
- Add backfill runbook and run-control dashboard.

Exit criteria:
- Multi-year backfill can resume from checkpoints.
- Duplicate ingestion rate stays below target threshold.
- Backfill reliability report is generated per run.

### Sprint 6 - Policy and Macro Corpus Expansion

Major epics:
- Add robust adapters for RBI, PIB, and other policy archives.
- Add normalized policy taxonomy and event tagging.
- Add source reliability scoring and drift alerts.
- Add legal/license metadata enforcement per source.

Exit criteria:
- Historical policy corpus covers target agencies and date range.
- Source reliability scores feed ranking and confidence logic.
- License policy violations are automatically blocked.

### Sprint 7 - Market Data Backbone Expansion

Major epics:
- Add historical and streaming market data integration for key instruments.
- Add corporate actions handling and adjusted-price logic.
- Add sector and breadth snapshots for terminal views.
- Add market data integrity checks.

Exit criteria:
- Instrument history can be queried with adjustment-aware consistency.
- Market snapshots are available in terminal pages and APIs.
- Data integrity checks are green in production.

### Sprint 8 - News Intelligence and Entity Linking V2

Major epics:
- Build news ingest layer with dedupe and relevance ranking.
- Upgrade entity resolution graph for company, sector, ministry, and peer links.
- Add confidence decomposition for entity mapping.
- Add explainable "why linked" trails in UI.

Exit criteria:
- Entity-link precision and coverage hit agreed thresholds.
- Evidence trails are present for all ranked items.
- Gate B approval completed.

### Sprint 9 - Charting Terminal and Multi-Timeframe Analytics

Major epics:
- Build advanced chart workspace with overlays and studies.
- Add synchronized crosshair and linked panels.
- Add saved chart templates and hotkeys.
- Add event annotations on charts.

Exit criteria:
- Charting workflows are fully keyboard-operable.
- Event overlays are accurate and user-toggleable.
- Chart template persistence is reliable.

### Sprint 10 - Screening and Discovery Engine

Major epics:
- Build universe screening with policy, factor, and liquidity filters.
- Add saved screens and scheduled reruns.
- Add ranked "what changed" explorer.
- Add explainable filter diagnostics.

Exit criteria:
- Saved screens run automatically with stable output.
- Discovery feed explains ranking reasons.
- Screen execution performance meets target SLA.

### Sprint 11 - Alerting and Notification Orchestrator

Major epics:
- Implement policy/news/price/anomaly composite alert rules.
- Add dedupe, cooldown, escalation, and suppression windows.
- Add per-user and per-watchlist routing.
- Add alert quality metrics and feedback loop.

Exit criteria:
- False-positive and duplicate rates are within thresholds.
- Alert routing is testable and auditable.
- Alert quality dashboard is operational.

### Sprint 12 - Portfolio and Exposure Workspace

Major epics:
- Implement portfolio positions and watchbook management.
- Add exposure summaries by sector/theme/policy sensitivity.
- Add PnL attribution with event context.
- Add scenario bookmarks for recurring desk workflows.

Exit criteria:
- Portfolio views update in near real time.
- Exposure and attribution views reconcile with source data.
- Gate C approval completed.

### Sprint 13 - Risk Terminal Core

Major epics:
- Build risk dashboard for concentration, drawdown, and liquidity proxies.
- Add event-driven stress templates.
- Add portfolio-level alert thresholds for risk constraints.
- Add risk audit trail and approvals.

Exit criteria:
- Risk snapshots are generated per portfolio and watchbook.
- Stress outputs are reproducible and versioned.
- Risk policy controls are enforceable.

### Sprint 14 - Anomaly and Attribution Engine V3

Major epics:
- Add multi-model anomaly detection (robust z-score + change-point layer).
- Add attribution confidence decomposition and calibration curves.
- Add attribution benchmark harness for precision and recall.
- Add analyst override workflow for disputed attributions.

Exit criteria:
- Attribution quality metrics and calibration are published.
- Overrides are captured and feed retraining.
- Model performance gates are defined and active.

### Sprint 15 - Research and Notebook Workflows

Major epics:
- Add saved analysis notebooks linked to terminal pages.
- Add reusable query templates and scenario packs.
- Add exportable evidence packs for decision reviews.
- Add collaboration comments tied to artifacts.

Exit criteria:
- Analysts can reproduce decisions from notebook + evidence records.
- Query templates support command-driven execution.
- Review artifacts are shareable and permissioned.

### Sprint 16 - Governance and Compliance Hardening

Major epics:
- Add release governance controls for models and sources.
- Add policy checks for entitlements and data usage.
- Add security controls, key rotation, and audit retention.
- Add formal incident response runbooks.

Exit criteria:
- Governance checks are enforced in CI/CD and runtime.
- Audit retention and access controls pass compliance review.
- Gate D approval completed.

### Sprint 17 - Performance and SRE Hardening

Major epics:
- Add SLOs and reliability budgets by subsystem.
- Add chaos and failover testing for stream and storage layers.
- Add autoscaling strategy and cost controls.
- Add terminal responsiveness and startup optimization.

Exit criteria:
- SLO dashboards show stable compliance.
- Failover tests pass documented scenarios.
- Latency and cost budgets are inside target ranges.

### Sprint 18 - Workspace Personalization and Automation

Major epics:
- Add user macros and command shortcuts.
- Add role-based workspace presets.
- Add guided onboarding and in-terminal help.
- Add behavior analytics for workflow optimization.

Exit criteria:
- Users can provision role presets in one action.
- Macro execution is safe, logged, and reversible.
- Onboarding completion and adoption metrics improve.

### Sprint 19 - Pilot Rollout and Desk Validation

Major epics:
- Run pilot with target users and desk workflows.
- Collect scorecards for latency, trust, and utility.
- Close critical defects and tune workflow friction points.
- Finalize operating model for support and incident response.

Exit criteria:
- Pilot KPI thresholds are met for reliability and user trust.
- Critical defects are resolved with regression coverage.
- Launch checklist is complete and signed.

### Sprint 20 - Production Launch and Operating Rhythm

Major epics:
- Execute staged launch with rollback strategy.
- Establish weekly model/risk/governance review cadence.
- Publish KPI dashboards and quarterly roadmap continuation.
- Complete handover to steady-state operations.

Exit criteria:
- Gate E approval completed.
- Production metrics and runbooks are live.
- Program transitions from build mode to scale mode.

## KPI Tree

- Product utility: alert usefulness, workflow completion time, analyst retention.
- Data quality: freshness, completeness, duplicate rate, source reliability trend.
- Model quality: directional hit rate, attribution precision, calibration error.
- Platform reliability: uptime, streaming lag, P95 interaction latency, MTTR.
- Governance: policy violations, audit completeness, entitlement exceptions.

### KPI Ownership and Review Cadence

- Strategic outcomes: Product leadership + executive sponsor, reviewed monthly.
- Program outcomes: Product + Quant + Engineering leads, reviewed bi-weekly.
- Technical reliability: Platform/SRE, reviewed weekly.
- Operational hygiene and compliance: Ops + Compliance, reviewed daily/weekly by severity.

## Risks and Mitigations

- Data licensing and rights constraints -> source-level policy enforcement and fallback tiers.
- Model drift and event-regime shifts -> rolling calibration, champion-challenger process.
- UX complexity and operator overload -> command discipline, progressive disclosure, training packs.
- Operational fragility at scale -> SLO-first development and failover rehearsals.

## Ownership Model

- Product: roadmap, KPI governance, user-value prioritization.
- Design: terminal ergonomics, command semantics, information hierarchy.
- Data Engineering: connectors, ingestion reliability, historical backfills.
- Quant/ML: anomaly/attribution models, calibration, benchmark harness.
- Platform/SRE: reliability, observability, performance and incident response.
- Risk/Compliance: policy controls, auditability, release signoff.

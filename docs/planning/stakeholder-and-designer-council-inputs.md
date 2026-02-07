# Stakeholder and Designer Council Inputs

Version: v1.0
Purpose: Capture cross-functional requirements and decision constraints for a Bloomberg-style terminal roadmap.

## Stakeholder Council

### 1) Portfolio Manager / Trader

Primary asks:
- Keyboard-first speed for discovery, charting, and alert triage.
- High-signal ranking and fast drill-down into evidence.
- Portfolio-level impact view when new policy events arrive.

Acceptance signals:
- Core workflows complete without mouse usage.
- Top-ranked alerts have clear rationale and low noise.
- Portfolio impact panel updates in near real time.

### 2) Sector Analyst / Research

Primary asks:
- Deep evidence trails for policy and company linkages.
- Reusable research templates and event timelines.
- Collaboration artifacts for handoff and review.

Acceptance signals:
- Every signal has source, snippet, and attribution detail.
- Analysts can reproduce results from saved notebooks.
- Shared views preserve annotations and references.

### 3) Quant and ML

Primary asks:
- Reliable feature store and repeatable training datasets.
- Model calibration, benchmark harness, and drift monitoring.
- Human feedback integration for continuous improvement.

Acceptance signals:
- Walk-forward evaluation pipeline is automated.
- Attribution calibration metrics are tracked in production.
- Feedback labels are versioned and traceable.

### 4) Data Engineering

Primary asks:
- Durable connectors with retries, backoff, and checkpointed backfills.
- Dedupe and lineage controls across all data classes.
- Source reliability scoring and ingestion observability.

Acceptance signals:
- Multi-year replays are resumable and idempotent.
- Data freshness and completeness SLAs are monitored.
- Connector failures are visible with root-cause context.

### 5) Platform and SRE

Primary asks:
- Clear SLOs for API, stream, and UI responsiveness.
- Safe deploy controls, rollback strategy, and incident runbooks.
- Capacity planning and cost management guardrails.

Acceptance signals:
- SLO compliance is visible and enforceable.
- Failover drills and incident simulations pass.
- Scaling behavior is predictable under burst load.

### 6) Risk and Compliance

Primary asks:
- Entitlement enforcement and source licensing controls.
- Model and source change governance with approval records.
- Full auditability for user and system actions.

Acceptance signals:
- Restricted data cannot leak across roles.
- Governance checks block non-compliant releases.
- Audit retrieval is complete for any production decision.

### 7) Product and Program Management

Primary asks:
- Big-sprint milestones with objective gates.
- KPI hierarchy tied to user value and reliability.
- Predictable dependency management across teams.

Acceptance signals:
- Gate criteria are explicit and testable.
- KPI progress is reported per sprint and phase.
- Risks and dependencies are actively managed.

## Designer Council Inputs

## Interaction Model

- Command-first entry: symbols, functions, and actions all start from one keyboard surface.
- Persistent context bar: always visible scope (instrument, watchlist, portfolio, date context).
- Focus ring model: explicit panel focus to avoid keyboard ambiguity.
- Fast-switch layout: one-keystroke movement between primary workspaces.

## Information Architecture

- Three-layer structure:
  - Layer 1: market pulse and critical alerts.
  - Layer 2: investigation panes (chart, event timeline, signal details).
  - Layer 3: deep evidence and model diagnostics.
- Progressive disclosure: dense default views with optional expansion, never modal-heavy blocking.

## Visual Density and Legibility

- Data-dense, low-decoration design with strict typography hierarchy.
- Color reserved for status and urgency, not decoration.
- Alignment and grid discipline prioritized over card-heavy dashboard patterns.
- Temporal data shown with clear regime and event markers.

## Explainability UX

- Every ranked item must show:
  - "What changed"
  - "Why it matters"
  - "How confident"
  - "What evidence"
- Attribution confidence should expose component weights, not only a single score.

## Accessibility and Operations

- Keyboard map must be discoverable and printable.
- Command aliases and shorthand must be supported for expert users.
- Reduced-motion and high-contrast options are required for long-session usability.

## Cross-Functional Conflict Matrix

- Speed vs explainability:
  - Decision: default compact summaries, expandable evidence, no hidden provenance.
- Innovation vs governance:
  - Decision: champion-challenger experiments in sandbox, gated promotion to production.
- Breadth vs quality:
  - Decision: onboard high-reliability source tiers first, then expand coverage.
- Feature velocity vs reliability:
  - Decision: enforce gate reviews every four sprints with rollback readiness.

## Planning Rules Adopted

- No sprint closes without measurable exit criteria.
- No model or source change ships without governance metadata.
- No terminal feature ships without keyboard parity.
- No signal ships without evidence, rationale, and audit trace.

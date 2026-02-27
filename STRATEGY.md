# Strategy Roadmap: India Policy Signal Terminal

## Purpose

Build a keyboard-first intelligence terminal that converts India policy and market events into explainable, auditable, and actionable signals for investor and analyst workflows.

## Non-Negotiables

- No signal without evidence, rationale, and audit trace.
- No terminal workflow without keyboard parity.
- No model/source release without governance metadata and rollback readiness.
- No sprint closure without measurable exit criteria.

## Current Baseline (Implemented)

The repository has implemented the 20-sprint baseline capability set across ingestion, signal processing, governance, SRE, pilot, and launch APIs.

| Capability Area | Current Status | Evidence |
|---|---|---|
| Core FR coverage (FR-01 to FR-12) | Implemented | `docs/india-policy-signal-terminal-implementation.md` |
| 20-sprint baseline execution | Implemented | `docs/planning/README.md` |
| Backfill run-control + reconciliation | Implemented | `docs/production-backfill-playbook.md`, `src/services/backfill-control.ts` |
| Governance + policy checks + runbooks | Implemented | `src/services/governance-hardening.ts`, `src/server.ts` |
| SRE budgets, chaos drills, status | Implemented | `src/services/sre.ts`, `test/pipeline.test.ts` |
| Pilot and launch readiness surfaces | Implemented | `src/services/pilot.ts`, `src/services/launch.ts` |

## Strategic Problem Statement

The platform has strong functional breadth, but the next horizon requires moving from "feature-complete baseline" to "operator-grade decision system" by improving model quality, operational automation, and scale economics.

## Strategy Horizon (Next 4 Quarters)

## Q1: Reliability Closure and Operational Hardening

Objective: Close remaining baseline reliability gaps and raise day-2 operability.

Planned outcomes:
- Complete endpoint-wide entitlement enforcement and route coverage audits.
- Add stream fanout robustness (backpressure and replay consumer hardening).
- Complete latency SLO instrumentation for API, stream, and terminal-critical flows.
- Finalize checkpoint orchestration UX for long-running historical backfills.
- Expand automated reliability checks for connector freshness and failure diagnostics.

Exit metrics:
- P95 ingest-to-alert latency consistently inside target.
- Backfill resume success rate >99% across multi-year windows.
- Zero unaudited privileged access events.

## Q2: Intelligence Quality Lift

Objective: Improve signal quality and analyst trust.

Planned outcomes:
- Productionize prediction calibration workflow and challenger evaluation loop.
- Expand entity-link quality controls with measurable confidence decomposition.
- Add stronger drift and quality governance loops for source and model behavior.
- Strengthen evidence-pack workflows for analyst reproducibility and review.
- Introduce sector-level scorecards for directional quality tracking.

Exit metrics:
- Top-ranked alert precision trend reaches and sustains PRD threshold band.
- Entity-link precision and coverage reach agreed operational gate levels.
- "Useful" feedback ratio on top-ranked signals shows quarter-over-quarter gain.

## Q3: Scale Foundation and Cost Discipline

Objective: Prepare for higher-load, multi-desk usage without reliability regression.

Planned outcomes:
- Harden Postgres/Timescale path as primary production storage profile.
- Add automated failover rehearsal and recovery evidence collection.
- Introduce cost and capacity telemetry for stream, storage, and ingestion layers.
- Improve rollout controls with stronger CI/CD policy-gate enforcement.
- Formalize retention and archival policies for governance and audit artifacts.

Exit metrics:
- Reliability budgets remain green under controlled burst simulations.
- Disaster recovery exercises pass with documented MTTR improvement.
- Infrastructure unit economics trend down while latency SLOs hold.

## Q4: Launch Scale Mode

Objective: Transition from pilot readiness to repeatable launch operations.

Planned outcomes:
- Automate pilot sign-off workflow instrumentation and Gate-E evidence packs.
- Standardize weekly model/risk/governance operating cadence across desks.
- Expand workspace onboarding and adoption intelligence for desk rollout health.
- Publish launch and rollback playbooks as enforced operational controls.
- Create post-launch continuation plan for integration and UX deepening.

Exit metrics:
- Launch gate status remains programmatically verifiable and audit-complete.
- Critical defect escape rate remains below agreed control threshold.
- Pilot-to-launch conversion readiness is measurable per desk.

## KPI Tree

| KPI Domain | Leading Indicators | Lagging Indicators |
|---|---|---|
| Signal Quality | Calibration drift, link-confidence distribution, reviewer turnaround | Alert precision, directional hit-rate uplift |
| Reliability | Freshness lag, replay health, SLO burn rate | Uptime, incident frequency, MTTR |
| Trust & Explainability | Evidence completeness, audit retrieval success | User "useful" ratio, dispute reversal rate |
| Delivery | Gate-critical AC completion, dependency aging | Gate pass rate, schedule variance |
| Adoption | Command/workspace usage depth, onboarding completion | Active desk penetration, launch readiness score |

## Gate and Governance Model

- Preserve 4-sprint gate cycle (A through E) as release control structure.
- Require gate artifacts per phase (quality report, reliability evidence, governance verification).
- Keep champion-challenger experimentation in sandbox until policy checks pass.
- Treat idempotency and replayability as hard constraints for all ingest/backfill pathways.

## Operating Cadence and Ownership

| Cadence | Forum | Primary Owners | Output |
|---|---|---|---|
| Weekly | Model/Risk/Governance review | Quant, Risk, Product | KPI deltas, drift actions, release decisions |
| Weekly | Reliability operations review | Platform, SRE, Data Eng | SLO burn, incident follow-ups, runbook updates |
| Bi-weekly | Program dependency review | Product, Engineering leads | Gate-critical blocker resolution |
| Per sprint close | Gate-readiness checkpoint | Product, Engineering, Compliance | Pass/fail recommendation and evidence pack |
| Quarterly | Strategy refresh | Product, Engineering, Stakeholders | Priority re-sequencing and KPI re-forecast |

## Gate-Critical Acceptance Criteria Format

Use this format for all gate-critical deliverables:

```text
AC-ID: [Quarter]-[Domain]-[Index]
Given [operational context]
When [specific workflow/action]
Then [measurable observable outcome]
Verification: [automated|manual|benchmark|user validation]
Owner: [responsible team]
Dependencies: [upstream prerequisites]
```

## Dependencies and Assumptions

- Source ecosystem continuity: regulator/news endpoints and licensing posture remain stable.
- Infrastructure availability: Timescale, event-stream backbone, and storage performance budgets.
- Team bandwidth: data, platform, and quant lanes progress in parallel with shared gating.
- Validation substrate: test and replay datasets stay representative across regime changes.

## Risk Register

| Risk | Likely Impact | Mitigation Path |
|---|---|---|
| Source drift and payload instability | Signal freshness and quality degradation | Drift scoring, fallback paths, source quarantine workflow |
| Model quality regressions | Trust erosion and noisy ranking | Calibration gates, challenger runs, human review loop |
| Operational fragility under load | SLO breaches and launch delays | Failover drills, replay resilience, capacity guardrails |
| Compliance/control gaps | Release blockage and audit risk | Policy checks, entitlement enforcement, immutable audit trails |
| Scope expansion without sequencing | Delivery slippage | Gate discipline, dependency tracking, explicit deferrals |

## 90-Day Execution Plan

1. Publish gate-critical acceptance criteria for Q1 reliability closure.
2. Complete entitlement and stream hardening gap closure from planning backlog.
3. Add explicit SLO scorecard reporting for ingest, stream, and terminal pathways.
4. Run one full backfill resilience drill and one failover chaos rehearsal with evidence.
5. Refresh pilot readiness rubric to align with launch gate automation.

## Decision Log Inputs

This roadmap is aligned to the existing planning corpus and traceability inputs:

- `docs/planning/bloomberg-style-terminal-20-sprint-plan.md`
- `docs/planning/agent-inputs-and-decision-log.md`
- `docs/planning/stakeholder-and-designer-council-inputs.md`
- `docs/india-policy-signal-terminal-prd.md`
- `docs/production-backfill-playbook.md`

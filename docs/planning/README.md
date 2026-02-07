# Planning Docs Index

This folder contains the Bloomberg-style terminal planning set requested for a 20-sprint, large-scope program.

## Documents

- `bloomberg-style-terminal-20-sprint-plan.md`
  - Master 20-sprint roadmap with phase gates, major epics, exit criteria, ownership, risks, and KPI tree.
- `stakeholder-and-designer-council-inputs.md`
  - Consolidated inputs from stakeholder groups and design council, including conflict resolution rules and planning constraints.
- `agent-inputs-and-decision-log.md`
  - Traceability log of specialized agent inputs and how each informed architecture and roadmap decisions.

## Input Sources Used

- Internal capability and gap audit (`explore`) -> task `bg_6da9af92`
- External capability benchmark research (`librarian`) -> task `bg_4ea0d238`
- UX/interaction design proposal (`visual-engineering`) -> task `bg_6fa504a1`
- Architecture and delivery-risk guidance (`deep`) -> task `bg_635653c0`
- Stakeholder narrative and KPI/gate structure (`writing`) -> task `bg_576f53c7`

## How to Use

1. Start from `bloomberg-style-terminal-20-sprint-plan.md` for program-level sequencing.
2. Use `stakeholder-and-designer-council-inputs.md` to validate acceptance expectations by function.
3. Use `agent-inputs-and-decision-log.md` as evidence and rationale for roadmap choices.

## Execution Status

- Sprint 1/2 baseline is actively implemented in code (command routing, keyboard command surface, command telemetry).
- Sprint 3/4 foundation is actively implemented in code (identity/entitlement baseline, stream event bus baseline, replay and stream health APIs).
- Sprint 5 baseline is actively implemented in code (backfill run-control dashboard and reconciliation APIs).
- Sprint 6 baseline is actively implemented in code (source drift detection with reliability-oriented scoring).
- Sprint 7 baseline is actively implemented in code (adjustment-aware market snapshot and breadth view API).
- Sprint 8 baseline is actively implemented in code (entity-link diagnostics and explainable reason trails API).
- Sprint 9 baseline is actively implemented in code (chart template persistence and ticker event annotations APIs).
- Sprint 10 baseline is actively implemented in code (screening/discovery APIs with run and diagnostics primitives).
- Sprint 11 baseline is actively implemented in code (alert rule orchestration, routing, and quality APIs).
- Sprint 12 baseline is actively implemented in code (portfolio workspace, exposure/attribution, scenario bookmark APIs).
- Sprint 13 baseline is actively implemented in code (risk policy and risk snapshot APIs for portfolio controls).
- Sprint 14 baseline is actively implemented in code (attribution override and calibration reporting APIs).
- Sprint 15 baseline is actively implemented in code (research notebooks/templates/comments/evidence APIs).
- Sprint 16 baseline is actively implemented in code (release-gate, runbook, and runtime policy-check APIs).
- Sprint 17 baseline is actively implemented in code (SLO budget, chaos drill, and SRE status APIs).
- Sprint 18 baseline is actively implemented in code (macros, workspace presets, onboarding/adoption APIs).
- Sprint 19 baseline is actively implemented in code (pilot scorecards, defect tracking, readiness APIs).

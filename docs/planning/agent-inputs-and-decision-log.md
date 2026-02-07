# Agent Inputs and Decision Log

Version: v1.0
Purpose: Record planning inputs collected from specialized agents and map them to roadmap decisions.

## Input Collection Ledger

| Source | Task ID | Scope | Key outcome used in plan |
|---|---|---|---|
| Explore agent | `bg_6da9af92` | Repo capability gap vs Bloomberg-style terminal | Used to define baseline and gap-driven sprint priorities for data, UX, risk, and ops |
| Librarian agent | `bg_4ea0d238` | External benchmark patterns and phased rollout | Used to shape phased gate model and market/news/risk/enterprise capability benchmarks |
| Visual-engineering agent | `bg_6fa504a1` | Terminal interaction model and dense information design | Used for keyboard-first, pane-based workspace, progressive disclosure principles |
| Deep architecture agent | `bg_635653c0` | Plane separation, milestones, dependencies, risks | Used for data/control/observability/security/release governance architecture requirements |
| Writing agent | `bg_576f53c7` | Stakeholder document structure and decision gates | Used for gate structure, KPI hierarchy, and acceptance-criteria templates |
| Explore agent (prior) | `bg_7a477094` | Backfill robustness gaps | Used for resumability/idempotency and run-control emphasis |
| Explore agent (prior) | `bg_c2d78491` | Anomaly and attribution gaps | Used for explainability, score decomposition, calibration planning |
| Librarian agent (prior) | `bg_0ddeb14a` | Backfill architecture references | Used for checkpointing, retries, deterministic replay strategies |
| Librarian agent (prior) | `bg_6d06a1ad` | Anomaly-attribution best practices | Used for lightweight + advanced anomaly roadmap layers |
| Librarian agent (prior) | `bg_dcac74a9` | Historical India data source references | Used for source catalog prioritization and licensing-aware ingestion strategy |

## Consolidated Design Principles

- Keyboard-first command interaction is mandatory for core workflows.
- Multi-pane, dense workspace with layout persistence is the default operating mode.
- Progressive disclosure is required: concise ranked view first, deep evidence on demand.
- Explainability must be embedded into every signal and attribution view.
- Operational status and run history must be queryable without leaving the terminal.

## Consolidated Architecture Decisions

1. Separate responsibilities into planes:
   - Data plane for ingestion, parsing, eventing, feature generation, and signal serving.
   - Control plane for source governance, model policy, feature flags, and kill switches.
   - Observability plane for traceability, SLOs, drift, and data-quality monitoring.
   - Security and release governance plane for RBAC, approvals, audit, and rollback.
2. Move from monolithic in-process orchestration toward event-driven services by phase.
3. Keep idempotency and replayability as hard constraints in every ingestion and backfill path.
4. Gate releases every four sprints with explicit pass/fail criteria.

## Stakeholder-Driven Prioritization Decisions

- Product and trading users prioritized command speed, ranking quality, and evidence clarity.
- Design prioritized information density, explicit focus state, and terminal ergonomics.
- Quant prioritized calibration, benchmark harnesses, and feedback-integrated retraining.
- Data engineering prioritized connector reliability, dedupe, and checkpointed backfills.
- Platform and SRE prioritized SLOs, failure recovery, and runbook completeness.
- Compliance prioritized entitlement enforcement, audit trails, and licensing controls.

## Roadmap Binding Decisions

- The 20-sprint roadmap is intentionally large-scope and phase-gated.
- Each sprint in `bloomberg-style-terminal-20-sprint-plan.md` contains major epics and explicit exits.
- Stakeholder/design expectations are documented in `stakeholder-and-designer-council-inputs.md`.
- Backfill and source strategy references remain linked via `production-backfill-playbook.md`.

## Open Decisions for Sprint 0 Charter

- Exact vendor mix for real-time market data and historical corp-action coverage.
- Entitlement granularity model (feature-level vs source-level vs desk-level).
- Managed stream backbone selection and cost envelope.
- Final KPI targets by pilot cohort size and rollout geography.

import { Pool } from "pg";
import type {
  AlertRecord,
  AuditRecord,
  BackfillRunRecord,
  DataQualityIssue,
  EventRecord,
  FeedbackRecord,
  GovernanceChangeRecord,
  OutcomeRecord,
  RawArtifact,
  SignalRecord,
  SourceRegistryItem,
  Watchlist,
} from "./types.js";
import type { StateStore, Store } from "./store.js";

const TABLES = [
  "sources",
  "artifacts",
  "events",
  "signals",
  "alerts",
  "feedback",
  "audits",
  "data_quality_issues",
  "outcomes",
  "governance_changes",
  "backfill_runs",
  "watchlists",
] as const;

function rowPayload<T>(rows: Array<{ payload: T }>): T[] {
  return rows.map((row) => row.payload);
}

export class PostgresStore implements Store {
  private readonly pool: Pool;

  constructor(connectionString: string = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/policy_signal") {
    this.pool = new Pool({ connectionString });
  }

  async init(): Promise<void> {
    await this.pool.query("CREATE EXTENSION IF NOT EXISTS timescaledb");
    await this.pool.query("CREATE SCHEMA IF NOT EXISTS policy_signal");
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS policy_signal.sources (id text PRIMARY KEY, payload jsonb NOT NULL)",
    );
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS policy_signal.watchlists (id text PRIMARY KEY, payload jsonb NOT NULL)",
    );
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS policy_signal.artifacts (id text PRIMARY KEY, ts timestamptz NOT NULL, payload jsonb NOT NULL)",
    );
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS policy_signal.events (id text NOT NULL, ts timestamptz NOT NULL, payload jsonb NOT NULL)",
    );
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS policy_signal.signals (id text NOT NULL, ts timestamptz NOT NULL, payload jsonb NOT NULL)",
    );
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS policy_signal.alerts (id text NOT NULL, ts timestamptz NOT NULL, payload jsonb NOT NULL)",
    );
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS policy_signal.feedback (id text PRIMARY KEY, ts timestamptz NOT NULL, payload jsonb NOT NULL)",
    );
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS policy_signal.audits (id text PRIMARY KEY, ts timestamptz NOT NULL, payload jsonb NOT NULL)",
    );
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS policy_signal.data_quality_issues (id text PRIMARY KEY, ts timestamptz NOT NULL, payload jsonb NOT NULL)",
    );
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS policy_signal.outcomes (id text NOT NULL, ts timestamptz NOT NULL, payload jsonb NOT NULL)",
    );
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS policy_signal.governance_changes (id text PRIMARY KEY, ts timestamptz NOT NULL, payload jsonb NOT NULL)",
    );
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS policy_signal.backfill_runs (id text PRIMARY KEY, ts timestamptz NOT NULL, payload jsonb NOT NULL)",
    );

    await this.pool.query("ALTER TABLE policy_signal.signals DROP CONSTRAINT IF EXISTS signals_pkey");
    await this.pool.query("ALTER TABLE policy_signal.events DROP CONSTRAINT IF EXISTS events_pkey");
    await this.pool.query("ALTER TABLE policy_signal.alerts DROP CONSTRAINT IF EXISTS alerts_pkey");
    await this.pool.query("ALTER TABLE policy_signal.outcomes DROP CONSTRAINT IF EXISTS outcomes_pkey");
    await this.pool.query("ALTER TABLE policy_signal.signals ADD CONSTRAINT signals_pkey PRIMARY KEY (id, ts)");
    await this.pool.query("ALTER TABLE policy_signal.events ADD CONSTRAINT events_pkey PRIMARY KEY (id, ts)");
    await this.pool.query("ALTER TABLE policy_signal.alerts ADD CONSTRAINT alerts_pkey PRIMARY KEY (id, ts)");
    await this.pool.query("ALTER TABLE policy_signal.outcomes ADD CONSTRAINT outcomes_pkey PRIMARY KEY (id, ts)");

    await this.pool.query(
      "SELECT create_hypertable('policy_signal.signals', 'ts', if_not_exists => TRUE, migrate_data => TRUE)",
    );
    await this.pool.query(
      "SELECT create_hypertable('policy_signal.events', 'ts', if_not_exists => TRUE, migrate_data => TRUE)",
    );
    await this.pool.query(
      "SELECT create_hypertable('policy_signal.alerts', 'ts', if_not_exists => TRUE, migrate_data => TRUE)",
    );
    await this.pool.query(
      "SELECT create_hypertable('policy_signal.outcomes', 'ts', if_not_exists => TRUE, migrate_data => TRUE)",
    );

    const state = await this.read();
    if (state.sources.length === 0) {
      const { JsonStore } = await import("./store.js");
      const bootstrap = new JsonStore();
      await bootstrap.init();
      const seed = await bootstrap.read();
      await this.write(seed);
    }
  }

  getArtifactsDir(): string {
    return process.env.ARTIFACTS_DIR ?? `${process.cwd()}/data/artifacts`;
  }

  async read(): Promise<StateStore> {
    const [
      sources,
      artifacts,
      events,
      signals,
      alerts,
      feedback,
      audits,
      dataQualityIssues,
      outcomes,
      governanceChanges,
      backfillRuns,
      watchlists,
    ] =
      await Promise.all([
        this.pool.query<{ payload: SourceRegistryItem }>("SELECT payload FROM policy_signal.sources"),
        this.pool.query<{ payload: RawArtifact }>("SELECT payload FROM policy_signal.artifacts ORDER BY ts DESC"),
        this.pool.query<{ payload: EventRecord }>("SELECT payload FROM policy_signal.events ORDER BY ts DESC"),
        this.pool.query<{ payload: SignalRecord }>("SELECT payload FROM policy_signal.signals ORDER BY ts DESC"),
        this.pool.query<{ payload: AlertRecord }>("SELECT payload FROM policy_signal.alerts ORDER BY ts DESC"),
        this.pool.query<{ payload: FeedbackRecord }>("SELECT payload FROM policy_signal.feedback ORDER BY ts DESC"),
        this.pool.query<{ payload: AuditRecord }>("SELECT payload FROM policy_signal.audits ORDER BY ts DESC"),
        this.pool.query<{ payload: DataQualityIssue }>(
          "SELECT payload FROM policy_signal.data_quality_issues ORDER BY ts DESC",
        ),
        this.pool.query<{ payload: OutcomeRecord }>("SELECT payload FROM policy_signal.outcomes ORDER BY ts DESC"),
        this.pool.query<{ payload: GovernanceChangeRecord }>(
          "SELECT payload FROM policy_signal.governance_changes ORDER BY ts DESC",
        ),
        this.pool.query<{ payload: BackfillRunRecord }>("SELECT payload FROM policy_signal.backfill_runs ORDER BY ts DESC"),
        this.pool.query<{ payload: Watchlist }>("SELECT payload FROM policy_signal.watchlists"),
      ]);

    return {
      sources: rowPayload(sources.rows),
      artifacts: rowPayload(artifacts.rows),
      events: rowPayload(events.rows),
      signals: rowPayload(signals.rows),
      alerts: rowPayload(alerts.rows),
      feedback: rowPayload(feedback.rows),
      audits: rowPayload(audits.rows),
      dataQualityIssues: rowPayload(dataQualityIssues.rows),
      outcomes: rowPayload(outcomes.rows),
      governanceChanges: rowPayload(governanceChanges.rows),
      backfillRuns: rowPayload(backfillRuns.rows),
      watchlists: rowPayload(watchlists.rows),
    };
  }

  async write(state: StateStore): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const table of TABLES) {
        await client.query(`TRUNCATE TABLE policy_signal.${table}`);
      }

      for (const source of state.sources) {
        await client.query("INSERT INTO policy_signal.sources (id, payload) VALUES ($1, $2)", [
          source.id,
          source,
        ]);
      }
      for (const watchlist of state.watchlists) {
        await client.query("INSERT INTO policy_signal.watchlists (id, payload) VALUES ($1, $2)", [
          watchlist.id,
          watchlist,
        ]);
      }
      for (const artifact of state.artifacts) {
        await client.query("INSERT INTO policy_signal.artifacts (id, ts, payload) VALUES ($1, $2, $3)", [
          artifact.id,
          artifact.fetchedAt,
          artifact,
        ]);
      }
      for (const event of state.events) {
        await client.query("INSERT INTO policy_signal.events (id, ts, payload) VALUES ($1, NOW(), $2)", [
          event.id,
          event,
        ]);
      }
      for (const signal of state.signals) {
        await client.query("INSERT INTO policy_signal.signals (id, ts, payload) VALUES ($1, $2, $3)", [
          signal.id,
          signal.createdAt,
          signal,
        ]);
      }
      for (const alert of state.alerts) {
        await client.query("INSERT INTO policy_signal.alerts (id, ts, payload) VALUES ($1, $2, $3)", [
          alert.id,
          alert.triggeredAt,
          alert,
        ]);
      }
      for (const item of state.feedback) {
        await client.query("INSERT INTO policy_signal.feedback (id, ts, payload) VALUES ($1, $2, $3)", [
          item.id,
          item.createdAt,
          item,
        ]);
      }
      for (const audit of state.audits) {
        await client.query("INSERT INTO policy_signal.audits (id, ts, payload) VALUES ($1, $2, $3)", [
          audit.id,
          audit.createdAt,
          audit,
        ]);
      }
      for (const issue of state.dataQualityIssues) {
        await client.query(
          "INSERT INTO policy_signal.data_quality_issues (id, ts, payload) VALUES ($1, $2, $3)",
          [issue.id, issue.detectedAt, issue],
        );
      }
      for (const outcome of state.outcomes) {
        await client.query("INSERT INTO policy_signal.outcomes (id, ts, payload) VALUES ($1, $2, $3)", [
          outcome.id,
          outcome.evaluatedAt,
          outcome,
        ]);
      }
      for (const change of state.governanceChanges) {
        await client.query(
          "INSERT INTO policy_signal.governance_changes (id, ts, payload) VALUES ($1, $2, $3)",
          [change.id, change.createdAt, change],
        );
      }
      for (const run of state.backfillRuns) {
        await client.query("INSERT INTO policy_signal.backfill_runs (id, ts, payload) VALUES ($1, $2, $3)", [
          run.id,
          run.startedAt,
          run,
        ]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async transaction<T>(fn: (state: StateStore) => T): Promise<T> {
    const state = await this.read();
    const result = fn(state);
    await this.write(state);
    return result;
  }
}

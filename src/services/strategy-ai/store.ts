import { Pool } from "pg";
import type { Strategy } from "./dsl/strategy-schema.js";

const SCHEMA = "strategy_ai";

const TABLES = [
  "strategies",
  "strategy_versions",
  "strategy_templates",
  "sim_runs",
  "rankings",
  "rulebook_entries",
  "system_config",
  "game_experiments",
  "payoff_matrices",
  "evolution_history",
  "nash_equilibria",
  "strategy_interactions",
] as const;

export const STRATEGY_MIGRATIONS = [
  `CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.strategies (
    id text PRIMARY KEY,
    status text NOT NULL,
    sector text,
    regime text,
    tags text[] NOT NULL DEFAULT '{}',
    parent_strategy_id text,
    generation_method text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    payload jsonb NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.strategy_versions (
    id text PRIMARY KEY,
    strategy_id text NOT NULL REFERENCES ${SCHEMA}.strategies(id) ON DELETE CASCADE,
    version integer NOT NULL,
    created_at timestamptz NOT NULL,
    payload jsonb NOT NULL,
    UNIQUE(strategy_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.strategy_templates (
    id text PRIMARY KEY,
    category text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    payload jsonb NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.sim_runs (
    id text PRIMARY KEY,
    strategy_id text NOT NULL REFERENCES ${SCHEMA}.strategies(id),
    regime text,
    created_at timestamptz NOT NULL,
    payload jsonb NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.rankings (
    id text PRIMARY KEY,
    strategy_id text NOT NULL REFERENCES ${SCHEMA}.strategies(id),
    run_id text NOT NULL REFERENCES ${SCHEMA}.sim_runs(id),
    ranking_date date NOT NULL,
    sector text,
    regime text,
    composite_score numeric,
    created_at timestamptz NOT NULL,
    payload jsonb NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.rulebook_entries (
    id text PRIMARY KEY,
    context jsonb NOT NULL,
    confidence numeric,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    payload jsonb NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.system_config (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.game_experiments (
    id text PRIMARY KEY,
    type text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT NOW(),
    completed_at timestamptz,
    payload jsonb NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.payoff_matrices (
    id text PRIMARY KEY,
    experiment_id text REFERENCES ${SCHEMA}.game_experiments(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    payload jsonb NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.evolution_history (
    id text PRIMARY KEY,
    experiment_id text REFERENCES ${SCHEMA}.game_experiments(id) ON DELETE CASCADE,
    generation integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    payload jsonb NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.nash_equilibria (
    id text PRIMARY KEY,
    experiment_id text REFERENCES ${SCHEMA}.game_experiments(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    payload jsonb NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.strategy_interactions (
    id text PRIMARY KEY,
    strategy_a text NOT NULL REFERENCES ${SCHEMA}.strategies(id),
    strategy_b text NOT NULL REFERENCES ${SCHEMA}.strategies(id),
    interaction_type text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    payload jsonb NOT NULL,
    UNIQUE(strategy_a, strategy_b, interaction_type)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_strategies_status ON ${SCHEMA}.strategies(status)`,
  `CREATE INDEX IF NOT EXISTS idx_strategies_sector ON ${SCHEMA}.strategies(sector)`,
  `CREATE INDEX IF NOT EXISTS idx_strategies_parent ON ${SCHEMA}.strategies(parent_strategy_id)`,
  `CREATE INDEX IF NOT EXISTS idx_strategies_tags ON ${SCHEMA}.strategies USING GIN(tags)`,
  `CREATE INDEX IF NOT EXISTS idx_sim_runs_strategy ON ${SCHEMA}.sim_runs(strategy_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rankings_date ON ${SCHEMA}.rankings(ranking_date)`,
  `CREATE INDEX IF NOT EXISTS idx_rankings_composite ON ${SCHEMA}.rankings(composite_score DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_rulebook_context ON ${SCHEMA}.rulebook_entries USING GIN(context)`,
] as const;

function rowPayload<T>(rows: Array<{ payload: T }>): T[] {
  return rows.map((row) => row.payload);
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseDbDate(value: string): string {
  return `${value}T00:00:00.000Z`;
}

function toDbDate(value: string): string {
  return value.slice(0, 10);
}

export interface SimRun {
  id: string;
  strategyId: string;
  startDate: string;
  endDate: string;
  regime?: string;
  metrics: Record<string, unknown>;
  trades: unknown[];
  equityCurve?: unknown[];
  createdAt: string;
}

export interface Ranking {
  id: string;
  strategyId: string;
  runId: string;
  returnScore?: number;
  downsideControlScore?: number;
  robustnessScore?: number;
  simplicityScore?: number;
  executionFeasibilityScore?: number;
  compositeScore: number;
  globalRank?: number;
  sectorRank?: number;
  regimeRank?: number;
  confidence?: number;
  stabilityScore?: number;
  rankingDate: string;
  sector?: string;
  regime?: string;
  createdAt: string;
}

export interface ContextFeatures {
  regime?: string;
  volatilityState?: string;
  sectorMomentumBreadth?: string;
  seasonality?: string;
  policyFlags?: string[];
  [key: string]: unknown;
}

export interface RulebookEntry {
  id: string;
  context: ContextFeatures;
  eligibleStrategyIds: string[];
  allocationPolicy: "single-best" | "weighted" | "rotation";
  weights?: Record<string, number>;
  maxPositionSize: number;
  maxPortfolioRisk: number;
  createdAt: string;
  updatedAt: string;
  confidence: number;
  explanation: string;
}

export class StrategyStore {
  private readonly pool: Pool;

  constructor(connectionString: string = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/policy_signal") {
    this.pool = new Pool({ connectionString });
  }

  async init(): Promise<void> {
    for (const sql of STRATEGY_MIGRATIONS) {
      await this.pool.query(sql);
    }
  }

  async createStrategy(strategy: Strategy): Promise<Strategy> {
    await this.pool.query(
      `INSERT INTO ${SCHEMA}.strategies
       (id, status, sector, regime, tags, parent_strategy_id, generation_method, created_at, updated_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        strategy.id,
        strategy.status,
        strategy.sector ?? null,
        strategy.regime ?? null,
        strategy.tags,
        strategy.parentStrategyId ?? null,
        strategy.generationMethod,
        strategy.createdAt,
        strategy.updatedAt,
        strategy,
      ],
    );

    await this.pool.query(
      `INSERT INTO ${SCHEMA}.strategy_versions
       (id, strategy_id, version, created_at, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        `${strategy.id}:v${strategy.version}`,
        strategy.id,
        strategy.version,
        strategy.updatedAt,
        strategy,
      ],
    );

    return strategy;
  }

  async getStrategy(id: string): Promise<Strategy | null> {
    const result = await this.pool.query<{ payload: Strategy }>(
      `SELECT payload FROM ${SCHEMA}.strategies WHERE id = $1`,
      [id],
    );
    return result.rows[0]?.payload ?? null;
  }

  async listStrategies(filters?: {
    status?: Strategy["status"];
    sector?: string;
    tags?: string[];
    limit?: number;
    offset?: number;
  }): Promise<Strategy[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (filters?.status) {
      values.push(filters.status);
      clauses.push(`status = $${values.length}`);
    }
    if (filters?.sector) {
      values.push(filters.sector);
      clauses.push(`sector = $${values.length}`);
    }
    if (filters?.tags && filters.tags.length > 0) {
      values.push(filters.tags);
      clauses.push(`tags && $${values.length}::text[]`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;
    values.push(limit);
    values.push(offset);

    const result = await this.pool.query<{ payload: Strategy }>(
      `SELECT payload
       FROM ${SCHEMA}.strategies
       ${where}
       ORDER BY updated_at DESC
       LIMIT $${values.length - 1}
       OFFSET $${values.length}`,
      values,
    );

    return rowPayload(result.rows);
  }

  async updateStrategy(id: string, updates: Partial<Strategy>): Promise<Strategy> {
    const existing = await this.getStrategy(id);
    if (!existing) {
      throw new Error(`Strategy not found: ${id}`);
    }

    const merged: Strategy = {
      ...existing,
      ...updates,
      id,
      version: updates.version ?? existing.version + 1,
      createdAt: existing.createdAt,
      updatedAt: updates.updatedAt ?? nowIso(),
      status: updates.status ?? existing.status,
      generationMethod: updates.generationMethod ?? existing.generationMethod,
      signals: updates.signals ?? existing.signals,
      filters: updates.filters ?? existing.filters,
      universe: updates.universe ?? existing.universe,
      entryRules: updates.entryRules ?? existing.entryRules,
      exitRules: updates.exitRules ?? existing.exitRules,
      riskParams: updates.riskParams ?? existing.riskParams,
      tags: updates.tags ?? existing.tags,
      description: updates.description ?? existing.description,
      name: updates.name ?? existing.name,
      sector: updates.sector ?? existing.sector,
      regime: updates.regime ?? existing.regime,
      parentStrategyId: updates.parentStrategyId ?? existing.parentStrategyId,
    };

    await this.pool.query(
      `UPDATE ${SCHEMA}.strategies
       SET status = $2,
           sector = $3,
           regime = $4,
           tags = $5,
           parent_strategy_id = $6,
           generation_method = $7,
           updated_at = $8,
           payload = $9
       WHERE id = $1`,
      [
        id,
        merged.status,
        merged.sector ?? null,
        merged.regime ?? null,
        merged.tags,
        merged.parentStrategyId ?? null,
        merged.generationMethod,
        merged.updatedAt,
        merged,
      ],
    );

    await this.pool.query(
      `INSERT INTO ${SCHEMA}.strategy_versions
       (id, strategy_id, version, created_at, payload)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (strategy_id, version) DO UPDATE SET payload = $5, created_at = $4`,
      [`${id}:v${merged.version}`, id, merged.version, merged.updatedAt, merged],
    );

    return merged;
  }

  async archiveStrategy(id: string): Promise<void> {
    const existing = await this.getStrategy(id);
    if (!existing) {
      return;
    }
    await this.updateStrategy(id, { status: "archived" });
  }

  async getStrategyVersions(id: string): Promise<Strategy[]> {
    const result = await this.pool.query<{ payload: Strategy }>(
      `SELECT payload
       FROM ${SCHEMA}.strategy_versions
       WHERE strategy_id = $1
       ORDER BY version DESC`,
      [id],
    );
    return rowPayload(result.rows);
  }

  async createSimRun(run: SimRun): Promise<SimRun> {
    await this.pool.query(
      `INSERT INTO ${SCHEMA}.sim_runs (id, strategy_id, regime, created_at, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [run.id, run.strategyId, run.regime ?? null, run.createdAt, run],
    );
    return run;
  }

  async getSimRun(id: string): Promise<SimRun | null> {
    const result = await this.pool.query<{ payload: SimRun }>(`SELECT payload FROM ${SCHEMA}.sim_runs WHERE id = $1`, [id]);
    return result.rows[0]?.payload ?? null;
  }

  async listSimRuns(strategyId?: string): Promise<SimRun[]> {
    const result = strategyId
      ? await this.pool.query<{ payload: SimRun }>(
          `SELECT payload FROM ${SCHEMA}.sim_runs WHERE strategy_id = $1 ORDER BY created_at DESC`,
          [strategyId],
        )
      : await this.pool.query<{ payload: SimRun }>(
          `SELECT payload FROM ${SCHEMA}.sim_runs ORDER BY created_at DESC`,
        );
    return rowPayload(result.rows);
  }

  async createRanking(ranking: Ranking): Promise<Ranking> {
    await this.pool.query(
      `INSERT INTO ${SCHEMA}.rankings
       (id, strategy_id, run_id, ranking_date, sector, regime, composite_score, created_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        ranking.id,
        ranking.strategyId,
        ranking.runId,
        toDbDate(ranking.rankingDate),
        ranking.sector ?? null,
        ranking.regime ?? null,
        ranking.compositeScore,
        ranking.createdAt,
        ranking,
      ],
    );
    return ranking;
  }

  async getRankings(options?: { date?: string; sector?: string; regime?: string }): Promise<Ranking[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (options?.date) {
      values.push(toDbDate(options.date));
      clauses.push(`ranking_date = $${values.length}`);
    }
    if (options?.sector) {
      values.push(options.sector);
      clauses.push(`sector = $${values.length}`);
    }
    if (options?.regime) {
      values.push(options.regime);
      clauses.push(`regime = $${values.length}`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await this.pool.query<{ payload: Ranking }>(
      `SELECT payload FROM ${SCHEMA}.rankings ${where} ORDER BY ranking_date DESC, composite_score DESC`,
      values,
    );
    return rowPayload(result.rows);
  }

  async createRulebookEntry(entry: RulebookEntry): Promise<RulebookEntry> {
    await this.pool.query(
      `INSERT INTO ${SCHEMA}.rulebook_entries
       (id, context, confidence, created_at, updated_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         context = EXCLUDED.context,
         confidence = EXCLUDED.confidence,
         updated_at = EXCLUDED.updated_at,
         payload = EXCLUDED.payload`,
      [entry.id, entry.context, entry.confidence, entry.createdAt, entry.updatedAt, entry],
    );
    return entry;
  }

  async getRulebookEntries(): Promise<RulebookEntry[]> {
    const result = await this.pool.query<{ payload: RulebookEntry }>(
      `SELECT payload FROM ${SCHEMA}.rulebook_entries ORDER BY updated_at DESC`,
    );
    return rowPayload(result.rows);
  }

  async findRulebookEntry(context: ContextFeatures): Promise<RulebookEntry | null> {
    const result = await this.pool.query<{ payload: RulebookEntry }>(
      `SELECT payload
       FROM ${SCHEMA}.rulebook_entries
       WHERE context @> $1::jsonb
       ORDER BY confidence DESC, updated_at DESC
       LIMIT 1`,
      [context],
    );
    return result.rows[0]?.payload ?? null;
  }

  async getConfig(key: string): Promise<any> {
    const result = await this.pool.query<{ value: unknown }>(
      `SELECT value FROM ${SCHEMA}.system_config WHERE key = $1`,
      [key],
    );
    return result.rows[0]?.value ?? null;
  }

  async setConfig(key: string, value: any): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${SCHEMA}.system_config (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, value],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async clearAll(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const table of TABLES) {
        await client.query(`TRUNCATE TABLE ${SCHEMA}.${table} CASCADE`);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export const strategyStore = new StrategyStore();

export type StrategyStoreFilters = Parameters<StrategyStore["listStrategies"]>[0];
export type RankingFilters = Parameters<StrategyStore["getRankings"]>[0];
export type StrategyTableName = (typeof TABLES)[number];

export function normalizeRankingDate(value: string): string {
  return parseDbDate(toDbDate(value));
}

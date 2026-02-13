/**
 * MIT Trading System - PostgreSQL + TimescaleDB Store
 *
 * Replaces MitJsonStore when STORE_BACKEND=postgres.
 * Uses JSONB payload pattern consistent with store-postgres.ts.
 * Candles table is a TimescaleDB hypertable for efficient time-series queries.
 */

import { Pool } from "pg";
import type { MitStore } from "./mit-store.js";
import type { MitState, MitMarketTone } from "./mit-types.js";
import path from "node:path";
import { ensureDir } from "./utils.js";

const SCHEMA = "mit";

export class MitPostgresStore implements MitStore {
  private transactionQueue: Promise<void> = Promise.resolve();

  private readonly pool: Pool;
  private readonly candlesDir: string;

  constructor(
    connectionString: string = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/policy_signal",
    baseDir: string = process.cwd(),
  ) {
    this.pool = new Pool({ connectionString });
    this.candlesDir = path.join(baseDir, "data", "mit-candles");
  }

  async init(): Promise<void> {
    await ensureDir(this.candlesDir);
    await this.pool.query("CREATE EXTENSION IF NOT EXISTS timescaledb");
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);

    // Portfolio singleton (settings + cash + scalars)
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.portfolio (
        id text PRIMARY KEY DEFAULT 'singleton',
        payload jsonb NOT NULL
      )
    `);

    // Positions (open trades)
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.positions (
        id text PRIMARY KEY,
        ticker text NOT NULL,
        payload jsonb NOT NULL
      )
    `);

    // Closed trades
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.closed_trades (
        id text PRIMARY KEY,
        position_id text NOT NULL,
        ticker text NOT NULL,
        exit_date timestamptz NOT NULL,
        payload jsonb NOT NULL
      )
    `);

    // Equity curve
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.equity_curve (
        date date PRIMARY KEY,
        payload jsonb NOT NULL
      )
    `);

    // Daily runs
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.daily_runs (
        id text PRIMARY KEY,
        date date NOT NULL,
        payload jsonb NOT NULL
      )
    `);

    // Weekly reports
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.weekly_reports (
        id text PRIMARY KEY,
        payload jsonb NOT NULL
      )
    `);

    // Monthly reports
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.monthly_reports (
        id text PRIMARY KEY,
        payload jsonb NOT NULL
      )
    `);

    // Fundamentals per ticker
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.fundamentals (
        ticker text PRIMARY KEY,
        payload jsonb NOT NULL
      )
    `);

    // Technicals per ticker
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.technicals (
        ticker text PRIMARY KEY,
        payload jsonb NOT NULL
      )
    `);

    // Composite scores per ticker
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.composite_scores (
        ticker text PRIMARY KEY,
        payload jsonb NOT NULL
      )
    `);

    // Checklist results per ticker
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.checklist_results (
        ticker text PRIMARY KEY,
        payload jsonb NOT NULL
      )
    `);

    // Peer median PE per sector
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.peer_median_pe (
        sector text PRIMARY KEY,
        value numeric NOT NULL
      )
    `);

    // Governance flags per ticker
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.governance_flags (
        ticker text PRIMARY KEY,
        flags jsonb NOT NULL DEFAULT '[]'
      )
    `);

    // Global state (market tone etc.)
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.global_state (
        id text PRIMARY KEY DEFAULT 'singleton',
        market_tone text NOT NULL DEFAULT 'neutral'
      )
    `);

    // Candles - TimescaleDB hypertable for time-series queries
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.candles (
        ticker text NOT NULL,
        date date NOT NULL,
        open numeric NOT NULL,
        high numeric NOT NULL,
        low numeric NOT NULL,
        close numeric NOT NULL,
        volume bigint NOT NULL DEFAULT 0,
        PRIMARY KEY (ticker, date)
      )
    `);

    // Make candles a hypertable (partitioned by date)
    try {
      await this.pool.query(
        `SELECT create_hypertable('${SCHEMA}.candles', 'date', if_not_exists => TRUE, migrate_data => TRUE)`,
      );
    } catch {
      // hypertable may already exist or timescaledb not available — continue
    }

    // Seed singleton rows if missing
    await this.pool.query(`
      INSERT INTO ${SCHEMA}.portfolio (id, payload)
      VALUES ('singleton', $1::jsonb)
      ON CONFLICT (id) DO NOTHING
    `, [JSON.stringify(defaultPortfolio())]);

    await this.pool.query(`
      INSERT INTO ${SCHEMA}.global_state (id, market_tone)
      VALUES ('singleton', 'neutral')
      ON CONFLICT (id) DO NOTHING
    `);
  }

  getCandlesDir(): string {
    return this.candlesDir;
  }

  async read(): Promise<MitState> {
    const [
      portfolioRes,
      positionsRes,
      closedTradesRes,
      equityCurveRes,
      dailyRunsRes,
      weeklyReportsRes,
      monthlyReportsRes,
      fundamentalsRes,
      technicalsRes,
      compositesRes,
      checklistsRes,
      peerMedianRes,
      governanceFlagsRes,
      globalStateRes,
      candlesRes,
    ] = await Promise.all([
      this.pool.query(`SELECT payload FROM ${SCHEMA}.portfolio WHERE id = 'singleton'`),
      this.pool.query(`SELECT payload FROM ${SCHEMA}.positions ORDER BY (payload->>'createdAt') ASC`),
      this.pool.query(`SELECT payload FROM ${SCHEMA}.closed_trades ORDER BY exit_date DESC`),
      this.pool.query(`SELECT payload FROM ${SCHEMA}.equity_curve ORDER BY date ASC`),
      this.pool.query(`SELECT payload FROM ${SCHEMA}.daily_runs ORDER BY date DESC`),
      this.pool.query(`SELECT payload FROM ${SCHEMA}.weekly_reports ORDER BY id DESC`),
      this.pool.query(`SELECT payload FROM ${SCHEMA}.monthly_reports ORDER BY id DESC`),
      this.pool.query(`SELECT ticker, payload FROM ${SCHEMA}.fundamentals`),
      this.pool.query(`SELECT ticker, payload FROM ${SCHEMA}.technicals`),
      this.pool.query(`SELECT ticker, payload FROM ${SCHEMA}.composite_scores`),
      this.pool.query(`SELECT ticker, payload FROM ${SCHEMA}.checklist_results`),
      this.pool.query(`SELECT sector, value FROM ${SCHEMA}.peer_median_pe`),
      this.pool.query(`SELECT ticker, flags FROM ${SCHEMA}.governance_flags`),
      this.pool.query(`SELECT market_tone FROM ${SCHEMA}.global_state WHERE id = 'singleton'`),
      this.pool.query(`SELECT ticker, json_agg(json_build_object('date', date, 'open', open, 'high', high, 'low', low, 'close', close, 'volume', volume) ORDER BY date ASC) AS candles FROM ${SCHEMA}.candles GROUP BY ticker`),
    ]);

    const portfolioPayload = portfolioRes.rows[0]?.payload ?? defaultPortfolio();
    const positions = positionsRes.rows.map((r: { payload: unknown }) => r.payload);
    const closedTrades = closedTradesRes.rows.map((r: { payload: unknown }) => r.payload);
    const equityCurve = equityCurveRes.rows.map((r: { payload: unknown }) => r.payload);

    const fundamentals: Record<string, unknown> = {};
    for (const r of fundamentalsRes.rows) fundamentals[r.ticker] = r.payload;

    const technicals: Record<string, unknown> = {};
    for (const r of technicalsRes.rows) technicals[r.ticker] = r.payload;

    const compositeScores: Record<string, unknown> = {};
    for (const r of compositesRes.rows) compositeScores[r.ticker] = r.payload;

    const checklistResults: Record<string, unknown> = {};
    for (const r of checklistsRes.rows) checklistResults[r.ticker] = r.payload;

    const peerMedianPE: Record<string, number> = {};
    for (const r of peerMedianRes.rows) peerMedianPE[r.sector] = Number(r.value);

    const governanceFlags: Record<string, string[]> = {};
    for (const r of governanceFlagsRes.rows) governanceFlags[r.ticker] = r.flags;

    const candles: Record<string, unknown[]> = {};
    for (const r of candlesRes.rows) {
      candles[r.ticker] = (r.candles as Array<{ date: string; open: string; high: string; low: string; close: string; volume: string }>).map(
        (c) => ({ date: c.date, open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume) }),
      );
    }

    const marketTone = (globalStateRes.rows[0]?.market_tone ?? "neutral") as MitMarketTone;

    return {
      portfolio: {
        settings: portfolioPayload.settings ?? defaultPortfolio().settings,
        cash: portfolioPayload.cash ?? defaultPortfolio().cash,
        positions,
        closedTrades,
        equityCurve,
        peakEquity: portfolioPayload.peakEquity ?? defaultPortfolio().peakEquity,
        maxDrawdownPct: portfolioPayload.maxDrawdownPct ?? 0,
        paused: portfolioPayload.paused ?? false,
        lastPipelineRun: portfolioPayload.lastPipelineRun ?? null,
      },
      fundamentals,
      technicals,
      candles,
      checklistResults,
      compositeScores,
      peerMedianPE,
      dailyRuns: dailyRunsRes.rows.map((r: { payload: unknown }) => r.payload),
      weeklyReports: weeklyReportsRes.rows.map((r: { payload: unknown }) => r.payload),
      monthlyReports: monthlyReportsRes.rows.map((r: { payload: unknown }) => r.payload),
      marketTone,
      governanceFlags,
    } as MitState;
  }

  async write(state: MitState): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Portfolio singleton (without positions/closedTrades/equityCurve — those are in separate tables)
      const portfolioScalars = {
        settings: state.portfolio.settings,
        cash: state.portfolio.cash,
        peakEquity: state.portfolio.peakEquity,
        maxDrawdownPct: state.portfolio.maxDrawdownPct,
        paused: state.portfolio.paused,
        lastPipelineRun: state.portfolio.lastPipelineRun,
      };
      await client.query(
        `INSERT INTO ${SCHEMA}.portfolio (id, payload) VALUES ('singleton', $1::jsonb)
         ON CONFLICT (id) DO UPDATE SET payload = $1::jsonb`,
        [JSON.stringify(portfolioScalars)],
      );

      // Positions — full replace
      await client.query(`DELETE FROM ${SCHEMA}.positions`);
      for (const pos of state.portfolio.positions) {
        await client.query(
          `INSERT INTO ${SCHEMA}.positions (id, ticker, payload) VALUES ($1, $2, $3::jsonb)`,
          [pos.id, pos.ticker, JSON.stringify(pos)],
        );
      }

      // Closed trades — upsert (append-only)
      for (const trade of state.portfolio.closedTrades) {
        await client.query(
          `INSERT INTO ${SCHEMA}.closed_trades (id, position_id, ticker, exit_date, payload)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (id) DO NOTHING`,
          [trade.id, trade.positionId, trade.ticker, trade.exitDate, JSON.stringify(trade)],
        );
      }

      // Equity curve — upsert by date
      for (const point of state.portfolio.equityCurve) {
        await client.query(
          `INSERT INTO ${SCHEMA}.equity_curve (date, payload)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (date) DO UPDATE SET payload = $2::jsonb`,
          [point.date, JSON.stringify(point)],
        );
      }

      // Daily runs — upsert by id
      for (const run of state.dailyRuns) {
        await client.query(
          `INSERT INTO ${SCHEMA}.daily_runs (id, date, payload)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (id) DO UPDATE SET payload = $3::jsonb`,
          [run.id, run.date, JSON.stringify(run)],
        );
      }

      // Weekly reports
      for (const report of state.weeklyReports) {
        await client.query(
          `INSERT INTO ${SCHEMA}.weekly_reports (id, payload)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (id) DO UPDATE SET payload = $2::jsonb`,
          [report.id, JSON.stringify(report)],
        );
      }

      // Monthly reports
      for (const report of state.monthlyReports) {
        await client.query(
          `INSERT INTO ${SCHEMA}.monthly_reports (id, payload)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (id) DO UPDATE SET payload = $2::jsonb`,
          [report.id, JSON.stringify(report)],
        );
      }

      // Fundamentals — upsert per ticker
      for (const [ticker, snapshot] of Object.entries(state.fundamentals)) {
        await client.query(
          `INSERT INTO ${SCHEMA}.fundamentals (ticker, payload)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (ticker) DO UPDATE SET payload = $2::jsonb`,
          [ticker, JSON.stringify(snapshot)],
        );
      }

      // Technicals — upsert per ticker
      for (const [ticker, snapshot] of Object.entries(state.technicals)) {
        await client.query(
          `INSERT INTO ${SCHEMA}.technicals (ticker, payload)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (ticker) DO UPDATE SET payload = $2::jsonb`,
          [ticker, JSON.stringify(snapshot)],
        );
      }

      // Composite scores — upsert per ticker
      for (const [ticker, score] of Object.entries(state.compositeScores)) {
        await client.query(
          `INSERT INTO ${SCHEMA}.composite_scores (ticker, payload)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (ticker) DO UPDATE SET payload = $2::jsonb`,
          [ticker, JSON.stringify(score)],
        );
      }

      // Checklist results — upsert per ticker
      for (const [ticker, result] of Object.entries(state.checklistResults)) {
        await client.query(
          `INSERT INTO ${SCHEMA}.checklist_results (ticker, payload)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (ticker) DO UPDATE SET payload = $2::jsonb`,
          [ticker, JSON.stringify(result)],
        );
      }

      // Peer median PE — upsert per sector
      for (const [sector, value] of Object.entries(state.peerMedianPE)) {
        await client.query(
          `INSERT INTO ${SCHEMA}.peer_median_pe (sector, value)
           VALUES ($1, $2)
           ON CONFLICT (sector) DO UPDATE SET value = $2`,
          [sector, value],
        );
      }

      // Governance flags — upsert per ticker
      for (const [ticker, flags] of Object.entries(state.governanceFlags)) {
        await client.query(
          `INSERT INTO ${SCHEMA}.governance_flags (ticker, flags)
           VALUES ($1, $2::jsonb)
           ON CONFLICT (ticker) DO UPDATE SET flags = $2::jsonb`,
          [ticker, JSON.stringify(flags)],
        );
      }

      // Market tone
      await client.query(
        `INSERT INTO ${SCHEMA}.global_state (id, market_tone)
         VALUES ('singleton', $1)
         ON CONFLICT (id) DO UPDATE SET market_tone = $1`,
        [state.marketTone],
      );

      // Candles — bulk upsert
      for (const [ticker, candleArr] of Object.entries(state.candles)) {
        const arr = candleArr as Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>;
        for (const c of arr) {
          await client.query(
            `INSERT INTO ${SCHEMA}.candles (ticker, date, open, high, low, close, volume)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (ticker, date) DO UPDATE SET open = $3, high = $4, low = $5, close = $6, volume = $7`,
            [ticker, c.date, c.open, c.high, c.low, c.close, c.volume],
          );
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async transaction<T>(fn: (state: MitState) => T): Promise<T> {
    let release: () => void = () => {};
    const previous = this.transactionQueue;
    this.transactionQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      const state = await this.read();
      const draft = structuredClone(state);
      const result = await fn(draft);
      await this.write(draft);
      return result;
    } finally {
      release();
    }
  }
}

function defaultPortfolio() {
  return {
    settings: {
      capital: 200000,
      allocPct: 0.05,
      stopPct: 0.06,
      pauseCashPct: 0.03,
      maxDeployedPct: 0.95,
      maxHorizonDays: 90,
      trailingActivationPct: 0.75,
    },
    cash: 200000,
    peakEquity: 200000,
    maxDrawdownPct: 0,
    paused: false,
    lastPipelineRun: null,
  };
}

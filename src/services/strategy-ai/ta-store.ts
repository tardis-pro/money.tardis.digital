import { Pool } from "pg";
import { atr, ema, macd, rsi, sma } from "../mit/technical-indicators.js";
import type { DailyCandle } from "../../mit-types.js";

const SCHEMA = "strategy_ai";

export interface OHLCV {
  ticker: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorSnapshot {
  ticker: string;
  timestamp: Date;
  sma: Record<number, number>;
  ema: Record<number, number>;
  rsi: Record<number, number>;
  macd: {
    macd: number;
    signal: number;
    histogram: number;
  };
  atr: Record<number, number>;
  bollinger: {
    upper: number;
    middle: number;
    lower: number;
  };
}

type IndicatorRow = {
  ticker: string;
  timestamp: Date;
  sma: Record<string, number>;
  ema: Record<string, number>;
  rsi: Record<string, number>;
  macd: { macd: number; signal: number; histogram: number };
  atr: Record<string, number>;
  bollinger: { upper: number; middle: number; lower: number };
};

export class TimescaleTechnicalStore {
  private readonly pool: Pool;

  constructor(connectionString: string = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/policy_signal") {
    this.pool = new Pool({ connectionString });
  }

  async init(): Promise<void> {
    await this.pool.query("CREATE EXTENSION IF NOT EXISTS timescaledb");
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.ta_candlesticks (
        ticker text NOT NULL,
        ts timestamptz NOT NULL,
        open double precision NOT NULL,
        high double precision NOT NULL,
        low double precision NOT NULL,
        close double precision NOT NULL,
        volume double precision NOT NULL,
        PRIMARY KEY (ticker, ts)
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.ta_indicators (
        ticker text NOT NULL,
        ts timestamptz NOT NULL,
        sma jsonb NOT NULL DEFAULT '{}'::jsonb,
        ema jsonb NOT NULL DEFAULT '{}'::jsonb,
        rsi jsonb NOT NULL DEFAULT '{}'::jsonb,
        macd jsonb NOT NULL,
        atr jsonb NOT NULL DEFAULT '{}'::jsonb,
        bollinger jsonb NOT NULL,
        PRIMARY KEY (ticker, ts)
      )
    `);

    try {
      await this.pool.query(
        `SELECT create_hypertable('${SCHEMA}.ta_candlesticks', 'ts', if_not_exists => TRUE, migrate_data => TRUE)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`Could not create hypertable ${SCHEMA}.ta_candlesticks: ${message}`);
    }

    try {
      await this.pool.query(
        `SELECT create_hypertable('${SCHEMA}.ta_indicators', 'ts', if_not_exists => TRUE, migrate_data => TRUE)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`Could not create hypertable ${SCHEMA}.ta_indicators: ${message}`);
    }

    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_ta_candlesticks_ticker_ts_desc ON ${SCHEMA}.ta_candlesticks (ticker, ts DESC)`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_ta_candlesticks_ts_desc ON ${SCHEMA}.ta_candlesticks (ts DESC)`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_ta_indicators_ticker_ts_desc ON ${SCHEMA}.ta_indicators (ticker, ts DESC)`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_ta_indicators_ts_desc ON ${SCHEMA}.ta_indicators (ts DESC)`,
    );
  }

  async ingestCandles(ticker: string, candles: OHLCV[]): Promise<void> {
    if (candles.length === 0) {
      return;
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const candle of candles) {
        await client.query(
          `INSERT INTO ${SCHEMA}.ta_candlesticks (ticker, ts, open, high, low, close, volume)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (ticker, ts) DO UPDATE
           SET open = EXCLUDED.open,
               high = EXCLUDED.high,
               low = EXCLUDED.low,
               close = EXCLUDED.close,
               volume = EXCLUDED.volume`,
          [ticker, candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getCandles(ticker: string, from: Date, to: Date): Promise<OHLCV[]> {
    const result = await this.pool.query<{
      ticker: string;
      ts: Date;
      open: string;
      high: string;
      low: string;
      close: string;
      volume: string;
    }>(
      `SELECT ticker, ts, open, high, low, close, volume
       FROM ${SCHEMA}.ta_candlesticks
       WHERE ticker = $1 AND ts >= $2 AND ts <= $3
       ORDER BY ts ASC`,
      [ticker, from, to],
    );

    return result.rows.map((row) => ({
      ticker: row.ticker,
      timestamp: new Date(row.ts),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
    }));
  }

  async getLatestCandles(ticker: string, count: number): Promise<OHLCV[]> {
    const safeCount = Math.max(1, Math.floor(count));
    const result = await this.pool.query<{
      ticker: string;
      ts: Date;
      open: string;
      high: string;
      low: string;
      close: string;
      volume: string;
    }>(
      `SELECT ticker, ts, open, high, low, close, volume
       FROM ${SCHEMA}.ta_candlesticks
       WHERE ticker = $1
       ORDER BY ts DESC
       LIMIT $2`,
      [ticker, safeCount],
    );

    return result.rows
      .map((row) => ({
        ticker: row.ticker,
        timestamp: new Date(row.ts),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
      }))
      .reverse();
  }

  async saveIndicators(ticker: string, indicators: IndicatorSnapshot[]): Promise<void> {
    if (indicators.length === 0) {
      return;
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const snapshot of indicators) {
        await client.query(
          `INSERT INTO ${SCHEMA}.ta_indicators (ticker, ts, sma, ema, rsi, macd, atr, bollinger)
           VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)
           ON CONFLICT (ticker, ts) DO UPDATE
           SET sma = EXCLUDED.sma,
               ema = EXCLUDED.ema,
               rsi = EXCLUDED.rsi,
               macd = EXCLUDED.macd,
               atr = EXCLUDED.atr,
               bollinger = EXCLUDED.bollinger`,
          [
            ticker,
            snapshot.timestamp,
            JSON.stringify(snapshot.sma),
            JSON.stringify(snapshot.ema),
            JSON.stringify(snapshot.rsi),
            JSON.stringify(snapshot.macd),
            JSON.stringify(snapshot.atr),
            JSON.stringify(snapshot.bollinger),
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getIndicators(ticker: string, from: Date, to: Date): Promise<IndicatorSnapshot[]> {
    const result = await this.pool.query<IndicatorRow>(
      `SELECT ticker, ts AS timestamp, sma, ema, rsi, macd, atr, bollinger
       FROM ${SCHEMA}.ta_indicators
       WHERE ticker = $1 AND ts >= $2 AND ts <= $3
       ORDER BY ts ASC`,
      [ticker, from, to],
    );

    return result.rows.map((row) => ({
      ticker: row.ticker,
      timestamp: new Date(row.timestamp),
      sma: numberKeyedRecord(row.sma),
      ema: numberKeyedRecord(row.ema),
      rsi: numberKeyedRecord(row.rsi),
      macd: row.macd,
      atr: numberKeyedRecord(row.atr),
      bollinger: row.bollinger,
    }));
  }

  async computeAndSaveIndicators(ticker: string, periods: number[]): Promise<IndicatorSnapshot> {
    const normalizedPeriods = uniqueSortedPeriods(periods);
    if (normalizedPeriods.length === 0) {
      throw new Error("At least one indicator period is required");
    }

    const maxPeriod = Math.max(...normalizedPeriods);
    const lookback = Math.max(80, maxPeriod + 5);
    const candles = await this.getLatestCandles(ticker, lookback);

    if (candles.length === 0) {
      throw new Error(`No candles available for ${ticker}`);
    }

    const dailyCandles = toDailyCandles(candles);
    const closes = candles.map((c) => c.close);
    const latest = candles[candles.length - 1];
    if (!latest) {
      throw new Error(`Unable to resolve latest candle for ${ticker}`);
    }

    const smaValues: Record<number, number> = {};
    const emaValues: Record<number, number> = {};
    const rsiValues: Record<number, number> = {};
    const atrValues: Record<number, number> = {};

    for (const period of normalizedPeriods) {
      const smaValue = sma(dailyCandles, period);
      if (smaValue !== null) {
        smaValues[period] = smaValue;
      }

      const emaValue = ema(dailyCandles, period);
      if (emaValue !== null) {
        emaValues[period] = emaValue;
      }

      const rsiValue = rsi(dailyCandles, period);
      if (rsiValue !== null) {
        rsiValues[period] = rsiValue;
      }

      const atrValue = atr(dailyCandles, period);
      if (atrValue !== null) {
        atrValues[period] = atrValue;
      }
    }

    const macdValue = macd(closes) ?? { macd: 0, signal: 0, histogram: 0 };
    const bollingerValue = computeBollingerBands(closes, 20, 2);

    const snapshot: IndicatorSnapshot = {
      ticker,
      timestamp: latest.timestamp,
      sma: smaValues,
      ema: emaValues,
      rsi: rsiValues,
      macd: macdValue,
      atr: atrValues,
      bollinger: bollingerValue,
    };

    await this.saveIndicators(ticker, [snapshot]);
    return snapshot;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function uniqueSortedPeriods(periods: number[]): number[] {
  const filtered = periods
    .map((p) => Math.floor(p))
    .filter((p) => Number.isFinite(p) && p > 0);
  return [...new Set(filtered)].sort((a, b) => a - b);
}

function toDailyCandles(candles: OHLCV[]): DailyCandle[] {
  return candles.map((candle) => ({
    date: candle.timestamp.toISOString().slice(0, 10),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }));
}

function numberKeyedRecord(input: Record<string, number>): Record<number, number> {
  const output: Record<number, number> = {};
  for (const [key, value] of Object.entries(input)) {
    const parsed = Number(key);
    if (Number.isFinite(parsed)) {
      output[parsed] = value;
    }
  }
  return output;
}

function computeBollingerBands(closes: number[], period: number, stdDevMultiplier: number): {
  upper: number;
  middle: number;
  lower: number;
} {
  if (closes.length < period) {
    return { upper: 0, middle: 0, lower: 0 };
  }

  const window = closes.slice(-period);
  const middle = window.reduce((sum, value) => sum + value, 0) / period;
  const variance = window.reduce((sum, value) => {
    const diff = value - middle;
    return sum + diff * diff;
  }, 0) / period;
  const standardDeviation = Math.sqrt(variance);

  return {
    upper: middle + standardDeviation * stdDevMultiplier,
    middle,
    lower: middle - standardDeviation * stdDevMultiplier,
  };
}

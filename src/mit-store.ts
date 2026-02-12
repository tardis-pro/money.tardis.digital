/**
 * MIT Trading System - JSON Store
 * 
 * Separate state store for MIT data to avoid bloating the main state.json file.
 * Follows the same pattern as the existing JsonStore in store.ts.
 */

import path from "node:path";
import type { MitState } from "./mit-types.js";
import { ensureDir, readJsonFile, writeJsonFile } from "./utils.js";

export interface MitStore {
  init(): Promise<void>;
  read(): Promise<MitState>;
  write(state: MitState): Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction<T>(fn: (state: MitState) => T): Promise<T>;
  getCandlesDir(): string;
}

function makeDefaultMitState(): MitState {
  return {
    portfolio: {
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
      positions: [],
      closedTrades: [],
      equityCurve: [],
      peakEquity: 200000,
      maxDrawdownPct: 0,
      paused: false,
      lastPipelineRun: null,
    },
    fundamentals: {},
    technicals: {},
    candles: {},
    checklistResults: {},
    compositeScores: {},
    peerMedianPE: {},
    dailyRuns: [],
    weeklyReports: [],
    monthlyReports: [],
    marketTone: "neutral",
    governanceFlags: {},
  };
}

export class MitJsonStore implements MitStore {
  private readonly dataDir: string;
  private readonly stateFile: string;
  private readonly candlesDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.dataDir = path.join(baseDir, "data");
    this.stateFile = path.join(this.dataDir, "mit-state.json");
    this.candlesDir = path.join(this.dataDir, "mit-candles");
  }

  async init(): Promise<void> {
    await ensureDir(this.dataDir);
    await ensureDir(this.candlesDir);
    
    const existing = await this.read();
    let dirty = false;
    
    // Ensure default settings if not present
    if (!existing.portfolio.settings) {
      existing.portfolio.settings = makeDefaultMitState().portfolio.settings;
      dirty = true;
    }
    
    // Ensure arrays are present
    if (!existing.portfolio.positions) existing.portfolio.positions = [];
    if (!existing.portfolio.closedTrades) existing.portfolio.closedTrades = [];
    if (!existing.portfolio.equityCurve) existing.portfolio.equityCurve = [];
    if (!existing.dailyRuns) existing.dailyRuns = [];
    if (!existing.weeklyReports) existing.weeklyReports = [];
    if (!existing.monthlyReports) existing.monthlyReports = [];
    if (!existing.fundamentals) existing.fundamentals = {};
    if (!existing.technicals) existing.technicals = {};
    if (!existing.candles) existing.candles = {};
    if (!existing.checklistResults) existing.checklistResults = {};
    if (!existing.compositeScores) existing.compositeScores = {};
    if (!existing.peerMedianPE) existing.peerMedianPE = {};
    if (!existing.governanceFlags) existing.governanceFlags = {};
    
    if (dirty) {
      await this.write(existing);
    }
  }

  getCandlesDir(): string {
    return this.candlesDir;
  }

  async read(): Promise<MitState> {
    const fallback = makeDefaultMitState();
    const loaded = await readJsonFile<Partial<MitState>>(this.stateFile, fallback);
    return {
      ...fallback,
      ...loaded,
      portfolio: {
        ...fallback.portfolio,
        ...loaded.portfolio,
        settings: loaded.portfolio?.settings ?? fallback.portfolio.settings,
        positions: loaded.portfolio?.positions ?? fallback.portfolio.positions,
        closedTrades: loaded.portfolio?.closedTrades ?? fallback.portfolio.closedTrades,
        equityCurve: loaded.portfolio?.equityCurve ?? fallback.portfolio.equityCurve,
      },
      fundamentals: loaded.fundamentals ?? fallback.fundamentals,
      technicals: loaded.technicals ?? fallback.technicals,
      candles: loaded.candles ?? fallback.candles,
      checklistResults: loaded.checklistResults ?? fallback.checklistResults,
      compositeScores: loaded.compositeScores ?? fallback.compositeScores,
      peerMedianPE: loaded.peerMedianPE ?? fallback.peerMedianPE,
      dailyRuns: loaded.dailyRuns ?? fallback.dailyRuns,
      weeklyReports: loaded.weeklyReports ?? fallback.weeklyReports,
      monthlyReports: loaded.monthlyReports ?? fallback.monthlyReports,
      marketTone: loaded.marketTone ?? fallback.marketTone,
      governanceFlags: loaded.governanceFlags ?? fallback.governanceFlags,
    };
  }

  async write(state: MitState): Promise<void> {
    await writeJsonFile(this.stateFile, state);
  }

  async transaction<T>(fn: (state: MitState) => T): Promise<T> {
    const state = await this.read();
    const result = await fn(state);
    await this.write(state);
    return result;
  }
}

// Singleton instance
let mitStoreInstance: MitJsonStore | null = null;

export function getMitStore(baseDir?: string): MitJsonStore {
  if (!mitStoreInstance) {
    mitStoreInstance = new MitJsonStore(baseDir);
  }
  return mitStoreInstance;
}

export function resetMitStore(): void {
  mitStoreInstance = null;
}

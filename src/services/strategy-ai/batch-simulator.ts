import type { Strategy } from "./dsl/strategy-schema.js";
import { type SimulationConfig, type SimulationResult, Simulator } from "./simulator.js";
import { StrategyStore, type SimRun } from "./store.js";

export interface BatchSimulatorConfig {
  maxConcurrent: number;
  retryFailed: boolean;
  saveIntermediate: boolean;
  earlyStoppingThreshold?: number;
}

const DEFAULT_CONFIG: BatchSimulatorConfig = {
  maxConcurrent: 4,
  retryFailed: true,
  saveIntermediate: true,
};

export class BatchSimulator {
  private readonly baseSimulator: Simulator;
  private readonly store: StrategyStore;
  private readonly config: BatchSimulatorConfig;
  private running = false;
  private cancelled = false;
  private completed = 0;
  private failed = 0;
  private total = 0;

  constructor(deps: { simulator: Simulator; store: StrategyStore; config?: BatchSimulatorConfig }) {
    this.baseSimulator = deps.simulator;
    this.store = deps.store;
    this.config = {
      ...DEFAULT_CONFIG,
      ...deps.config,
      maxConcurrent: Math.max(1, Math.floor(deps.config?.maxConcurrent ?? DEFAULT_CONFIG.maxConcurrent)),
    };
  }

  async runBatch(strategies: Strategy[], config: SimulationConfig): Promise<Map<string, SimulationResult>> {
    return this.executeBatch(strategies, async (strategy) => {
      const simulator = new Simulator(config);
      return simulator.run(strategy);
    });
  }

  async runWithProgress(
    strategies: Strategy[],
    config: SimulationConfig,
    onProgress: (done: number, total: number) => void,
  ): Promise<Map<string, SimulationResult>> {
    return this.executeBatch(
      strategies,
      async (strategy) => {
        const simulator = new Simulator(config);
        return simulator.run(strategy);
      },
      onProgress,
    );
  }

  async runWalkForwardBatch(strategies: Strategy[], windowSize: number, stepSize: number): Promise<Map<string, SimulationResult[]>> {
    this.resetState(strategies.length);
    this.running = true;

    const results = new Map<string, SimulationResult[]>();
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (!this.cancelled) {
        const index = cursor;
        cursor += 1;

        const strategy = strategies[index];
        if (!strategy) {
          return;
        }

        try {
          const runResults = await this.runWalkForwardWithRetry(strategy, windowSize, stepSize);
          results.set(strategy.id, runResults);
          this.completed += 1;
          if (this.config.saveIntermediate) {
            for (const result of runResults) {
              await this.store.createSimRun(this.toSimRun(result));
            }
          }
        } catch {
          this.failed += 1;
        }

        if (this.shouldEarlyStop()) {
          this.cancelled = true;
        }
      }
    };

    const workers = Array.from({ length: Math.min(this.config.maxConcurrent, strategies.length) }, () => worker());
    await Promise.all(workers);
    this.running = false;
    return results;
  }

  cancel(): void {
    this.cancelled = true;
  }

  getStatus(): { running: boolean; completed: number; failed: number; total: number } {
    return {
      running: this.running,
      completed: this.completed,
      failed: this.failed,
      total: this.total,
    };
  }

  private async executeBatch(
    strategies: Strategy[],
    runner: (strategy: Strategy) => Promise<SimulationResult>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<string, SimulationResult>> {
    this.resetState(strategies.length);
    this.running = true;

    const resultMap = new Map<string, SimulationResult>();
    let cursor = 0;

    const updateProgress = (): void => {
      if (!onProgress) {
        return;
      }
      onProgress(this.completed + this.failed, this.total);
    };

    const worker = async (): Promise<void> => {
      while (!this.cancelled) {
        const index = cursor;
        cursor += 1;

        const strategy = strategies[index];
        if (!strategy) {
          return;
        }

        try {
          const result = await this.runSingleWithRetry(strategy, runner);
          resultMap.set(strategy.id, result);
          this.completed += 1;
          if (this.config.saveIntermediate) {
            await this.store.createSimRun(this.toSimRun(result));
          }
        } catch {
          this.failed += 1;
        }

        updateProgress();

        if (this.shouldEarlyStop()) {
          this.cancelled = true;
        }
      }
    };

    const workers = Array.from({ length: Math.min(this.config.maxConcurrent, strategies.length) }, () => worker());
    await Promise.all(workers);
    this.running = false;
    return resultMap;
  }

  private async runSingleWithRetry(
    strategy: Strategy,
    runner: (strategy: Strategy) => Promise<SimulationResult>,
  ): Promise<SimulationResult> {
    const maxAttempts = this.config.retryFailed ? 2 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await runner(strategy);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Simulation failed for strategy ${strategy.id}`);
  }

  private async runWalkForwardWithRetry(strategy: Strategy, windowSize: number, stepSize: number): Promise<SimulationResult[]> {
    const maxAttempts = this.config.retryFailed ? 2 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.baseSimulator.runWalkForward(strategy, windowSize, stepSize);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Walk-forward simulation failed for strategy ${strategy.id}`);
  }

  private shouldEarlyStop(): boolean {
    const threshold = this.config.earlyStoppingThreshold;
    if (threshold === undefined) {
      return false;
    }
    const processed = this.completed + this.failed;
    if (processed === 0) {
      return false;
    }
    return this.failed / processed >= threshold;
  }

  private toSimRun(result: SimulationResult): SimRun {
    return {
      id: result.runId,
      strategyId: result.strategyId,
      startDate: result.startDate,
      endDate: result.endDate,
      metrics: {
        totalReturn: result.totalReturn,
        annualizedReturn: result.annualizedReturn,
        sharpeRatio: result.sharpeRatio,
        maxDrawdown: result.maxDrawdown,
        winRate: result.winRate,
        profitFactor: result.profitFactor,
        turnover: result.turnover,
        volatility: result.volatility,
        beta: result.beta,
        var95: result.var95,
      },
      trades: result.trades,
      equityCurve: result.equityCurve,
      createdAt: new Date().toISOString(),
    };
  }

  private resetState(total: number): void {
    this.running = false;
    this.cancelled = false;
    this.completed = 0;
    this.failed = 0;
    this.total = total;
  }
}

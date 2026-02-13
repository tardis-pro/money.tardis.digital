import type { Strategy } from "./dsl/strategy-schema.js";
import type { SimulationResult } from "./simulator.js";
import { type Ranking, StrategyStore } from "./store.js";

export interface RankingScore {
  strategyId: string;
  runId: string;
  returnScore: number;
  downsideControlScore: number;
  robustnessScore: number;
  simplicityScore: number;
  executionFeasibilityScore: number;
  compositeScore: number;
  globalRank: number;
  sectorRank: number;
  regimeRank: number;
  confidence: number;
  stabilityScore: number;
}

export interface RankingWeights {
  returnWeight: number;
  downsideControlWeight: number;
  robustnessWeight: number;
  simplicityWeight: number;
  executionWeight: number;
}

const DEFAULT_WEIGHTS: RankingWeights = {
  returnWeight: 0.3,
  downsideControlWeight: 0.25,
  robustnessWeight: 0.2,
  simplicityWeight: 0.1,
  executionWeight: 0.15,
};

type StrategyMeta = Pick<Strategy, "id" | "sector" | "regime" | "signals" | "entryRules" | "exitRules">;

export class Ranker {
  private readonly store: StrategyStore;
  private readonly weights: RankingWeights;
  private readonly strategyCache = new Map<string, StrategyMeta>();

  constructor(deps: { store: StrategyStore; weights?: RankingWeights }) {
    this.store = deps.store;
    this.weights = deps.weights ?? DEFAULT_WEIGHTS;
    void this.refreshStrategyCache();
  }

  computeScores(simResults: SimulationResult[]): RankingScore[] {
    if (simResults.length === 0) {
      return [];
    }

    const byStrategy = new Map<string, SimulationResult[]>();
    for (const result of simResults) {
      const bucket = byStrategy.get(result.strategyId) ?? [];
      bucket.push(result);
      byStrategy.set(result.strategyId, bucket);
    }

    const scores = simResults.map((result) => {
      const strategyResults = byStrategy.get(result.strategyId) ?? [result];
      const strategy = this.strategyCache.get(result.strategyId);

      const returnScore = this.computeReturnScore(result);
      const downsideControlScore = this.computeDownsideControlScore(result);
      const robustnessScore = this.computeRobustnessScore(strategyResults);
      const simplicityScore = this.computeSimplicityScore(strategy);
      const executionFeasibilityScore = this.computeExecutionFeasibilityScore(strategy, result);
      const stabilityScore = this.computeStabilityScore(strategyResults);
      const confidence = this.computeConfidence(strategyResults, robustnessScore, stabilityScore);

      const compositeScore = this.computeCompositeScore(
        {
          returnScore,
          downsideControlScore,
          robustnessScore,
          simplicityScore,
          executionFeasibilityScore,
        },
        this.weights,
      );

      return {
        strategyId: result.strategyId,
        runId: result.runId,
        returnScore,
        downsideControlScore,
        robustnessScore,
        simplicityScore,
        executionFeasibilityScore,
        compositeScore,
        globalRank: 0,
        sectorRank: 0,
        regimeRank: 0,
        confidence,
        stabilityScore,
      } satisfies RankingScore;
    });

    return this.rankByRegime(this.rankBySector(this.rankAll(scores)));
  }

  computeCompositeScore(scores: Partial<RankingScore>, weights: RankingWeights): number {
    const weighted = [
      [scores.returnScore ?? 0, weights.returnWeight],
      [scores.downsideControlScore ?? 0, weights.downsideControlWeight],
      [scores.robustnessScore ?? 0, weights.robustnessWeight],
      [scores.simplicityScore ?? 0, weights.simplicityWeight],
      [scores.executionFeasibilityScore ?? 0, weights.executionWeight],
    ] as const;

    const totalWeight = weighted.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
    if (totalWeight === 0) {
      return 0;
    }

    const weightedSum = weighted.reduce((sum, [value, weight]) => sum + value * Math.max(0, weight), 0);
    return clampScore(weightedSum / totalWeight);
  }

  rankAll(scores: RankingScore[]): RankingScore[] {
    const sorted = [...scores].sort((a, b) => this.compareScores(a, b));
    sorted.forEach((score, index) => {
      score.globalRank = index + 1;
    });
    return sorted;
  }

  rankBySector(scores: RankingScore[]): RankingScore[] {
    const grouped = new Map<string, RankingScore[]>();
    for (const score of scores) {
      const sector = this.strategyCache.get(score.strategyId)?.sector ?? "__unknown__";
      const bucket = grouped.get(sector) ?? [];
      bucket.push(score);
      grouped.set(sector, bucket);
    }

    for (const bucket of grouped.values()) {
      bucket.sort((a, b) => this.compareScores(a, b));
      bucket.forEach((score, index) => {
        score.sectorRank = index + 1;
      });
    }

    return scores;
  }

  rankByRegime(scores: RankingScore[]): RankingScore[] {
    const grouped = new Map<string, RankingScore[]>();
    for (const score of scores) {
      const regime = this.strategyCache.get(score.strategyId)?.regime ?? "__unknown__";
      const bucket = grouped.get(regime) ?? [];
      bucket.push(score);
      grouped.set(regime, bucket);
    }

    for (const bucket of grouped.values()) {
      bucket.sort((a, b) => this.compareScores(a, b));
      bucket.forEach((score, index) => {
        score.regimeRank = index + 1;
      });
    }

    return scores;
  }

  async getTopStrategies(n: number, filter?: { sector?: string; regime?: string }): Promise<RankingScore[]> {
    await this.refreshStrategyCache();

    const ranked = await this.store.getRankings({
      ...(filter?.sector ? { sector: filter.sector } : {}),
      ...(filter?.regime ? { regime: filter.regime } : {}),
    });

    const mapped = ranked.map((entry) => this.mapStoredRankingToScore(entry));
    const reranked = this.rankByRegime(this.rankBySector(this.rankAll(mapped)));
    return reranked.slice(0, Math.max(0, Math.floor(n)));
  }

  async saveRankings(scores: RankingScore[]): Promise<void> {
    await this.refreshStrategyCache();

    const rankingDate = new Date().toISOString();
    const createdAt = rankingDate;

    for (const score of scores) {
      const strategyMeta = this.strategyCache.get(score.strategyId);
      const payload: Ranking = {
        id: `ranking-${score.runId}`,
        strategyId: score.strategyId,
        runId: score.runId,
        returnScore: score.returnScore,
        downsideControlScore: score.downsideControlScore,
        robustnessScore: score.robustnessScore,
        simplicityScore: score.simplicityScore,
        executionFeasibilityScore: score.executionFeasibilityScore,
        compositeScore: score.compositeScore,
        globalRank: score.globalRank,
        sectorRank: score.sectorRank,
        regimeRank: score.regimeRank,
        confidence: score.confidence,
        stabilityScore: score.stabilityScore,
        rankingDate,
        ...(strategyMeta?.sector ? { sector: strategyMeta.sector } : {}),
        ...(strategyMeta?.regime ? { regime: strategyMeta.regime } : {}),
        createdAt,
      };

      await this.store.createRanking(payload);
    }
  }

  computeReturnScore(result: SimulationResult): number {
    const returnComponent = clamp01((result.totalReturn + 0.3) / 0.8);
    const sharpeComponent = clamp01((result.sharpeRatio + 1) / 3);
    return clampScore((returnComponent * 0.65 + sharpeComponent * 0.35) * 100);
  }

  computeDownsideControlScore(result: SimulationResult): number {
    const drawdownComponent = clamp01(1 - Math.abs(result.maxDrawdown) / 0.5);
    const varComponent = clamp01(1 - result.var95 / 0.05);
    return clampScore((drawdownComponent * 0.7 + varComponent * 0.3) * 100);
  }

  computeRobustnessScore(results: SimulationResult[]): number {
    if (results.length <= 1) {
      return 65;
    }

    const returns = results.map((result) => result.totalReturn);
    const sharpes = results.map((result) => result.sharpeRatio);
    const returnVariance = variance(returns);
    const sharpeVariance = variance(sharpes);
    const normalized = clamp01(1 - (returnVariance / 0.05 + sharpeVariance / 1.5));
    return clampScore(normalized * 100);
  }

  computeSimplicityScore(strategy: StrategyMeta | undefined): number {
    if (!strategy) {
      return 50;
    }

    const signalPenalty = Math.max(0, strategy.signals.length - 2) * 8;
    const entryPenalty = Math.max(0, strategy.entryRules.length - 1) * 6;
    const exitPenalty = Math.max(0, strategy.exitRules.length - 1) * 6;
    const ruleConditionPenalty = [...strategy.entryRules, ...strategy.exitRules].reduce(
      (sum, rule) => sum + Math.max(0, rule.conditions.length - 2) * 3,
      0,
    );

    return clampScore(100 - signalPenalty - entryPenalty - exitPenalty - ruleConditionPenalty);
  }

  computeExecutionFeasibilityScore(strategy: StrategyMeta | undefined, result: SimulationResult): number {
    const turnoverPenalty = clamp01(result.turnover / 8) * 50;
    const complexityPenalty = strategy
      ? clamp01((strategy.signals.length + strategy.entryRules.length + strategy.exitRules.length) / 20) * 35
      : 20;
    const riskPenalty = clamp01(Math.abs(result.var95) / 0.08) * 15;
    return clampScore(100 - turnoverPenalty - complexityPenalty - riskPenalty);
  }

  private async refreshStrategyCache(): Promise<void> {
    const strategies = await this.store.listStrategies({ limit: 10_000, offset: 0 });
    this.strategyCache.clear();
    for (const strategy of strategies) {
      this.strategyCache.set(strategy.id, strategy);
    }
  }

  private computeStabilityScore(results: SimulationResult[]): number {
    if (results.length <= 1) {
      return 60;
    }
    const returns = results.map((result) => result.totalReturn);
    const returnStd = Math.sqrt(variance(returns));
    return clampScore((1 - clamp01(returnStd / 0.2)) * 100);
  }

  private computeConfidence(results: SimulationResult[], robustnessScore: number, stabilityScore: number): number {
    const sampleComponent = clamp01(results.length / 6) * 40;
    const robustnessComponent = clamp01(robustnessScore / 100) * 35;
    const stabilityComponent = clamp01(stabilityScore / 100) * 25;
    return clampScore(sampleComponent + robustnessComponent + stabilityComponent);
  }

  private compareScores(a: RankingScore, b: RankingScore): number {
    if (b.compositeScore !== a.compositeScore) {
      return b.compositeScore - a.compositeScore;
    }
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    return a.strategyId.localeCompare(b.strategyId);
  }

  private mapStoredRankingToScore(entry: Ranking): RankingScore {
    return {
      strategyId: entry.strategyId,
      runId: entry.runId,
      returnScore: entry.returnScore ?? 0,
      downsideControlScore: entry.downsideControlScore ?? 0,
      robustnessScore: entry.robustnessScore ?? 0,
      simplicityScore: entry.simplicityScore ?? 0,
      executionFeasibilityScore: entry.executionFeasibilityScore ?? 0,
      compositeScore: entry.compositeScore,
      globalRank: entry.globalRank ?? 0,
      sectorRank: entry.sectorRank ?? 0,
      regimeRank: entry.regimeRank ?? 0,
      confidence: entry.confidence ?? 0,
      stabilityScore: entry.stabilityScore ?? 0,
    };
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(Math.max(0, Math.min(100, value)).toFixed(2));
}

function variance(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sumSq = values.reduce((sum, value) => {
    const diff = value - mean;
    return sum + diff * diff;
  }, 0);
  return sumSq / values.length;
}

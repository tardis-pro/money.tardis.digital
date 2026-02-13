import { type RankingScore, Ranker } from "./ranker.js";
import { type RulebookEntry as StoreRulebookEntry, StrategyStore } from "./store.js";

type ScalarCondition<T extends string | number> =
  | T
  | {
      equals?: T;
      oneOf?: T[];
    };

type NumericCondition =
  | number
  | {
      equals?: number;
      min?: number;
      max?: number;
    };

type PolicyFlagsCondition =
  | string[]
  | {
      includesAny?: string[];
      includesAll?: string[];
      excludes?: string[];
    };

type SectorMomentumCondition = Record<string, NumericCondition>;

interface RuleContextConditions {
  marketRegime?: ScalarCondition<ContextFeatures["marketRegime"]>;
  volatilityState?: ScalarCondition<ContextFeatures["volatilityState"]>;
  sectorMomentum?: SectorMomentumCondition;
  seasonality?: {
    month?: NumericCondition;
    quarter?: NumericCondition;
  };
  policyFlags?: PolicyFlagsCondition;
  dayOfWeek?: NumericCondition;
}

export interface ContextFeatures {
  marketRegime: "bull" | "bear" | "sideways";
  volatilityState: "high" | "medium" | "low";
  sectorMomentum: Record<string, number>;
  seasonality: { month: number; quarter: number };
  policyFlags: string[];
  dayOfWeek: number;
}

export interface RulebookEntry {
  id: string;
  context: ContextFeatures | RuleContextConditions;
  eligibleStrategyIds: string[];
  allocationPolicy: "single-best" | "weighted" | "rotation";
  weights?: Record<string, number>;
  maxPositionSize: number;
  maxPortfolioRisk: number;
  confidence: number;
  explanation: string;
  createdAt: string;
  updatedAt: string;
}

export interface Recommendation {
  strategies: { strategyId: string; allocation: number; reason: string }[];
  totalAllocation: number;
  riskEnvelope: { maxPositionSize: number; maxPortfolioRisk: number };
  context: ContextFeatures;
  confidence: number;
}

export class RulebookEngine {
  private readonly store: StrategyStore;
  private readonly ranker: Ranker;
  private entriesCache: RulebookEntry[] = [];
  private cacheLoaded = false;

  constructor(deps: { store: StrategyStore; ranker: Ranker }) {
    this.store = deps.store;
    this.ranker = deps.ranker;
  }

  async createEntry(entry: Omit<RulebookEntry, "id" | "createdAt" | "updatedAt">): Promise<RulebookEntry> {
    const timestamp = nowIso();
    const normalizedWeights = normalizeWeights(entry.weights);
    const createdBase = {
      id: rulebookEntryId(),
      context: entry.context,
      eligibleStrategyIds: [...entry.eligibleStrategyIds],
      allocationPolicy: entry.allocationPolicy,
      createdAt: timestamp,
      updatedAt: timestamp,
      confidence: clamp(entry.confidence, 0, 100),
      maxPositionSize: clamp(entry.maxPositionSize, 0, 1),
      maxPortfolioRisk: clamp(entry.maxPortfolioRisk, 0, 1),
      explanation: entry.explanation,
    };
    const created: RulebookEntry = normalizedWeights ? { ...createdBase, weights: normalizedWeights } : createdBase;

    await this.store.createRulebookEntry(created as unknown as StoreRulebookEntry);
    await this.removeDeletedId(created.id);
    this.entriesCache = [created, ...this.entriesCache.filter((existing) => existing.id !== created.id)];
    this.cacheLoaded = true;
    return created;
  }

  async updateEntry(id: string, updates: Partial<RulebookEntry>): Promise<RulebookEntry> {
    const existing = await this.findEntryById(id);
    if (!existing) {
      throw new Error(`Rulebook entry not found: ${id}`);
    }

    const normalizedWeights = normalizeWeights(updates.weights ?? existing.weights);
    const mergedBase = {
      id,
      context: updates.context ?? existing.context,
      eligibleStrategyIds: [...(updates.eligibleStrategyIds ?? existing.eligibleStrategyIds)],
      allocationPolicy: updates.allocationPolicy ?? existing.allocationPolicy,
      createdAt: existing.createdAt,
      updatedAt: nowIso(),
      confidence: clamp(updates.confidence ?? existing.confidence, 0, 100),
      maxPositionSize: clamp(updates.maxPositionSize ?? existing.maxPositionSize, 0, 1),
      maxPortfolioRisk: clamp(updates.maxPortfolioRisk ?? existing.maxPortfolioRisk, 0, 1),
      explanation: updates.explanation ?? existing.explanation,
    };
    const merged: RulebookEntry = normalizedWeights ? { ...mergedBase, weights: normalizedWeights } : mergedBase;

    await this.store.createRulebookEntry(merged as unknown as StoreRulebookEntry);
    await this.removeDeletedId(id);
    this.entriesCache = [merged, ...this.entriesCache.filter((entry) => entry.id !== id)];
    this.cacheLoaded = true;
    return merged;
  }

  async deleteEntry(id: string): Promise<void> {
    await this.ensureEntriesLoaded();
    const deleted = await this.getDeletedIds();
    deleted.add(id);
    await this.store.setConfig(DELETED_IDS_CONFIG_KEY, Array.from(deleted));
    this.entriesCache = this.entriesCache.filter((entry) => entry.id !== id);
  }

  async listEntries(): Promise<RulebookEntry[]> {
    await this.ensureEntriesLoaded();
    return [...this.entriesCache];
  }

  async recommend(context: ContextFeatures): Promise<Recommendation> {
    await this.ensureEntriesLoaded();

    const matches = this.findMatchingEntries(context).sort((a, b) => b.confidence - a.confidence);
    if (matches.length > 0) {
      const best = matches[0]!;
      const strategies = buildAllocations(best).map((item) => ({
        strategyId: item.strategyId,
        allocation: item.allocation,
        reason: `${best.explanation} (policy=${best.allocationPolicy})`,
      }));
      const totalAllocation = strategies.reduce((sum, item) => sum + item.allocation, 0);

      return {
        strategies,
        totalAllocation: Number(totalAllocation.toFixed(4)),
        riskEnvelope: {
          maxPositionSize: best.maxPositionSize,
          maxPortfolioRisk: best.maxPortfolioRisk,
        },
        context,
        confidence: best.confidence,
      };
    }

    const topRanked = await this.ranker.getTopStrategies(3, { regime: context.marketRegime });
    if (topRanked.length === 0) {
      return {
        strategies: [],
        totalAllocation: 0,
        riskEnvelope: { maxPositionSize: 0.05, maxPortfolioRisk: 0.1 },
        context,
        confidence: 0,
      };
    }

    const fallbackWeights = normalizeWeights(
      Object.fromEntries(topRanked.map((score) => [score.strategyId, Math.max(score.compositeScore, 0.01)])),
    );
    const fallbackStrategies = topRanked.map((score) => {
      const allocation = fallbackWeights?.[score.strategyId] ?? 0;
      return {
        strategyId: score.strategyId,
        allocation,
        reason: `Fallback from ranker: score=${score.compositeScore.toFixed(2)}, confidence=${score.confidence.toFixed(2)}`,
      };
    });

    return {
      strategies: fallbackStrategies,
      totalAllocation: Number(fallbackStrategies.reduce((sum, item) => sum + item.allocation, 0).toFixed(4)),
      riskEnvelope: {
        maxPositionSize: 0.1,
        maxPortfolioRisk: 0.2,
      },
      context,
      confidence: Number((topRanked.reduce((sum, item) => sum + item.confidence, 0) / topRanked.length).toFixed(2)),
    };
  }

  findMatchingEntries(context: ContextFeatures): RulebookEntry[] {
    return this.entriesCache.filter((entry) => matchesRuleContext(entry.context, context));
  }

  async buildFromRankings(rankings: RankingScore[], context: ContextFeatures): Promise<RulebookEntry[]> {
    if (rankings.length === 0) {
      return [];
    }

    const sorted = [...rankings].sort((a, b) => b.compositeScore - a.compositeScore);
    const selected = sorted.slice(0, Math.min(5, sorted.length));
    const weights = normalizeWeights(
      Object.fromEntries(selected.map((score) => [score.strategyId, Math.max(score.compositeScore, 0.01)])),
    );

    const top = selected[0]!;
    const gap = selected.length > 1 ? top.compositeScore - selected[1]!.compositeScore : top.compositeScore;
    const allocationPolicy: RulebookEntry["allocationPolicy"] = gap >= 12 ? "single-best" : gap >= 4 ? "weighted" : "rotation";
    const confidence = Number((selected.reduce((sum, item) => sum + item.confidence, 0) / selected.length).toFixed(2));

    const created = await this.createEntry({
      context,
      eligibleStrategyIds: selected.map((score) => score.strategyId),
      allocationPolicy,
      ...(weights ? { weights } : {}),
      maxPositionSize: allocationPolicy === "single-best" ? 0.15 : 0.08,
      maxPortfolioRisk: allocationPolicy === "single-best" ? 0.25 : 0.18,
      confidence,
      explanation: `Auto-built from ${selected.length} ranked strategies for ${context.marketRegime}/${context.volatilityState}.`,
    });

    return [created];
  }

  async rebuild(): Promise<void> {
    const context = this.senseCurrentContext();
    const rankings = await this.ranker.getTopStrategies(10, { regime: context.marketRegime });
    const existing = await this.listEntries();
    for (const entry of existing) {
      await this.deleteEntry(entry.id);
    }
    await this.buildFromRankings(rankings, context);
  }

  senseCurrentContext(): ContextFeatures {
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const quarter = Math.floor((month - 1) / 3) + 1;
    const dayOfWeek = now.getUTCDay();

    return {
      marketRegime: "sideways",
      volatilityState: "medium",
      sectorMomentum: {
        broadMarket: 0,
      },
      seasonality: { month, quarter },
      policyFlags: [],
      dayOfWeek,
    };
  }

  private async ensureEntriesLoaded(): Promise<void> {
    if (this.cacheLoaded) {
      return;
    }

    const [storedEntries, deletedIds] = await Promise.all([this.store.getRulebookEntries(), this.getDeletedIds()]);
    this.entriesCache = (storedEntries as unknown as RulebookEntry[]).filter((entry) => !deletedIds.has(entry.id));
    this.cacheLoaded = true;
  }

  private async findEntryById(id: string): Promise<RulebookEntry | null> {
    await this.ensureEntriesLoaded();
    return this.entriesCache.find((entry) => entry.id === id) ?? null;
  }

  private async getDeletedIds(): Promise<Set<string>> {
    const value = await this.store.getConfig(DELETED_IDS_CONFIG_KEY);
    if (!Array.isArray(value)) {
      return new Set<string>();
    }
    return new Set(value.filter((item): item is string => typeof item === "string"));
  }

  private async removeDeletedId(id: string): Promise<void> {
    const deleted = await this.getDeletedIds();
    if (!deleted.delete(id)) {
      return;
    }
    await this.store.setConfig(DELETED_IDS_CONFIG_KEY, Array.from(deleted));
  }
}

const DELETED_IDS_CONFIG_KEY = "strategy-ai.rulebook.deleted-entry-ids";

function matchesRuleContext(ruleContext: RulebookEntry["context"], context: ContextFeatures): boolean {
  const candidate = ruleContext as RuleContextConditions;

  if (!matchesScalarCondition(context.marketRegime, candidate.marketRegime)) {
    return false;
  }
  if (!matchesScalarCondition(context.volatilityState, candidate.volatilityState)) {
    return false;
  }
  if (!matchesSeasonalityCondition(context.seasonality, candidate.seasonality)) {
    return false;
  }
  if (!matchesNumericCondition(context.dayOfWeek, candidate.dayOfWeek)) {
    return false;
  }
  if (!matchesPolicyFlagsCondition(context.policyFlags, candidate.policyFlags)) {
    return false;
  }
  if (!matchesSectorMomentumCondition(context.sectorMomentum, candidate.sectorMomentum)) {
    return false;
  }

  return true;
}

function matchesScalarCondition<T extends string | number>(value: T, condition: ScalarCondition<T> | undefined): boolean {
  if (condition === undefined) {
    return true;
  }
  if (typeof condition === "string" || typeof condition === "number") {
    return condition === value;
  }
  if (condition.equals !== undefined && condition.equals !== value) {
    return false;
  }
  if (condition.oneOf && condition.oneOf.length > 0 && !condition.oneOf.includes(value)) {
    return false;
  }
  return true;
}

function matchesNumericCondition(value: number, condition: NumericCondition | undefined): boolean {
  if (condition === undefined) {
    return true;
  }
  if (typeof condition === "number") {
    return value === condition;
  }
  if (condition.equals !== undefined && value !== condition.equals) {
    return false;
  }
  if (condition.min !== undefined && value < condition.min) {
    return false;
  }
  if (condition.max !== undefined && value > condition.max) {
    return false;
  }
  return true;
}

function matchesSeasonalityCondition(
  seasonality: ContextFeatures["seasonality"],
  condition: RuleContextConditions["seasonality"],
): boolean {
  if (!condition) {
    return true;
  }
  if (!matchesNumericCondition(seasonality.month, condition.month)) {
    return false;
  }
  if (!matchesNumericCondition(seasonality.quarter, condition.quarter)) {
    return false;
  }
  return true;
}

function matchesPolicyFlagsCondition(flags: string[], condition: PolicyFlagsCondition | undefined): boolean {
  if (!condition) {
    return true;
  }

  const flagSet = new Set(flags);
  if (Array.isArray(condition)) {
    return condition.every((item) => flagSet.has(item));
  }

  if (condition.includesAll && !condition.includesAll.every((item) => flagSet.has(item))) {
    return false;
  }
  if (condition.includesAny && condition.includesAny.length > 0 && !condition.includesAny.some((item) => flagSet.has(item))) {
    return false;
  }
  if (condition.excludes && condition.excludes.some((item) => flagSet.has(item))) {
    return false;
  }
  return true;
}

function matchesSectorMomentumCondition(
  sectorMomentum: Record<string, number>,
  condition: SectorMomentumCondition | undefined,
): boolean {
  if (!condition) {
    return true;
  }

  for (const [sector, sectorCondition] of Object.entries(condition)) {
    const current = sectorMomentum[sector];
    if (current === undefined) {
      return false;
    }
    if (!matchesNumericCondition(current, sectorCondition)) {
      return false;
    }
  }

  return true;
}

function buildAllocations(entry: RulebookEntry): { strategyId: string; allocation: number }[] {
  const ids = entry.eligibleStrategyIds;
  if (ids.length === 0) {
    return [];
  }

  if (entry.allocationPolicy === "single-best") {
    const [first] = ids;
    return first ? [{ strategyId: first, allocation: 1 }] : [];
  }

  if (entry.allocationPolicy === "weighted") {
    const normalized = normalizeWeights(entry.weights);
    if (normalized) {
      return ids.map((strategyId) => ({
        strategyId,
        allocation: normalized[strategyId] ?? 0,
      }));
    }
  }

  const equal = 1 / ids.length;
  return ids.map((strategyId) => ({ strategyId, allocation: Number(equal.toFixed(4)) }));
}

function normalizeWeights(weights: Record<string, number> | undefined): Record<string, number> | undefined {
  if (!weights) {
    return undefined;
  }

  const positive = Object.entries(weights).filter(([, value]) => Number.isFinite(value) && value > 0);
  if (positive.length === 0) {
    return undefined;
  }

  const total = positive.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) {
    return undefined;
  }

  return Object.fromEntries(positive.map(([key, value]) => [key, Number((value / total).toFixed(6))]));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Number(Math.max(min, Math.min(max, value)).toFixed(6));
}

function nowIso(): string {
  return new Date().toISOString();
}

function rulebookEntryId(): string {
  return `rulebook-${crypto.randomUUID()}`;
}

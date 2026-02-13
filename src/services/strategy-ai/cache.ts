import type { Strategy } from "./dsl/strategy-schema.js";
import type { RankingScore } from "./ranker.js";
import type { SimulationResult } from "./simulator.js";

interface CacheOptions {
  maxSize?: number;
  defaultTTL?: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_MAX_SIZE = 1_000;
const DEFAULT_TTL_MS = 5 * 60 * 1_000;
const STRATEGY_PREFIX = "strategy:";
const RANKINGS_PREFIX = "rankings:";
const SIMULATION_PREFIX = "simulation:";
const DEFAULT_RANKINGS_CONTEXT = "default";

export class StrategyCache {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly maxSize: number;
  private readonly defaultTTL: number;

  constructor(options: CacheOptions = {}) {
    this.maxSize = this.toPositiveInteger(options.maxSize, DEFAULT_MAX_SIZE);
    this.defaultTTL = this.toPositiveInteger(options.defaultTTL, DEFAULT_TTL_MS);
  }

  get<T>(key: string): T | undefined {
    this.purgeExpiredKey(key);
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttl?: number): void {
    const effectiveTTL = this.toPositiveInteger(ttl, this.defaultTTL);
    const entry: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + effectiveTTL,
    };

    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    this.cache.set(key, entry);
    this.purgeExpired();
    this.evictIfNeeded();
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  has(key: string): boolean {
    this.purgeExpiredKey(key);
    return this.cache.has(key);
  }

  cacheStrategy(strategy: Strategy): void {
    this.set<Strategy>(this.strategyKey(strategy.id), strategy);
  }

  getStrategy(id: string): Strategy | undefined {
    return this.get<Strategy>(this.strategyKey(id));
  }

  invalidateStrategy(id: string): void {
    this.delete(this.strategyKey(id));
  }

  cacheRankings(rankings: RankingScore[]): void {
    this.set<RankingScore[]>(this.rankingsKey(DEFAULT_RANKINGS_CONTEXT), rankings);
  }

  getRankings(context: string): RankingScore[] | undefined {
    return this.get<RankingScore[]>(this.rankingsKey(context));
  }

  cacheSimulation(id: string, result: SimulationResult): void {
    this.set<SimulationResult>(this.simulationKey(id), result);
  }

  getSimulation(id: string): SimulationResult | undefined {
    return this.get<SimulationResult>(this.simulationKey(id));
  }

  private strategyKey(id: string): string {
    return `${STRATEGY_PREFIX}${id}`;
  }

  private rankingsKey(context: string): string {
    return `${RANKINGS_PREFIX}${context}`;
  }

  private simulationKey(id: string): string {
    return `${SIMULATION_PREFIX}${id}`;
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }

  private purgeExpiredKey(key: string): void {
    const entry = this.cache.get(key);
    if (!entry) {
      return;
    }
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
    }
  }

  private evictIfNeeded(): void {
    while (this.cache.size > this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) {
        return;
      }
      this.cache.delete(oldestKey);
    }
  }

  private toPositiveInteger(value: number | undefined, fallback: number): number {
    if (value === undefined || !Number.isFinite(value) || value <= 0) {
      return fallback;
    }
    return Math.floor(value);
  }
}

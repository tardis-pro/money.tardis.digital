import type { RiskParameters } from "./dsl/risk-definitions.js";
import type { Signal } from "./dsl/signal-definitions.js";
import type { Rule, Strategy } from "./dsl/strategy-schema.js";
import { validateStrategyDsl } from "./dsl/validation-rules.js";

type ParamRange = { min: number; max: number; step: number };

export interface Constraint {
  field: string;
  message: string;
  min?: number;
  max?: number;
  relation?: string;
}

export interface MetaStrategyTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  requiredSignals: string[];
  paramSpaces: Record<string, ParamRange>;
  defaultParams: Record<string, unknown>;
  constraints: Constraint[];
}

export type GenerationMethod = "template" | "mutation" | "crossover" | "random";

export interface GeneratorConfig {
  numVariations: number;
  mutationRate: number;
  crossoverRate: number;
  randomSearchRatio: number;
}

type StrategyGenerationMethod = Strategy["generationMethod"];

const DEFAULT_CONFIG: GeneratorConfig = {
  numVariations: 12,
  mutationRate: 0.35,
  crossoverRate: 0.3,
  randomSearchRatio: 0.25,
};

const DEFAULT_RISK_PARAMS: RiskParameters = {
  positionSizing: {
    method: "fixed_fractional",
    riskPerTradePct: 0.01,
    maxPositionSizePct: 0.1,
  },
  stopLoss: {
    type: "fixed_pct",
    value: 0.03,
  },
  takeProfit: {
    type: "risk_reward",
    value: 2,
  },
  maxDrawdownPct: 0.2,
  maxOpenPositions: 8,
  maxSectorExposurePct: 0.3,
  maxPortfolioHeatPct: 0.15,
  rebalanceFrequency: "weekly",
};

export const BUILTIN_TEMPLATES: Record<string, MetaStrategyTemplate> = {
  trendFollowing: {
    id: "trend-following",
    name: "Trend Following",
    category: "trend",
    description: "SMA/EMA crossover with trend momentum confirmation.",
    requiredSignals: ["sma", "ema", "macd"],
    paramSpaces: {
      "sma.period": { min: 10, max: 120, step: 5 },
      "ema.period": { min: 20, max: 200, step: 5 },
      "macd.fastPeriod": { min: 6, max: 20, step: 1 },
      "macd.slowPeriod": { min: 16, max: 40, step: 1 },
      "macd.signalPeriod": { min: 5, max: 18, step: 1 },
    },
    defaultParams: {
      smaPeriod: 20,
      emaPeriod: 55,
      macdFastPeriod: 12,
      macdSlowPeriod: 26,
      macdSignalPeriod: 9,
      momentumThreshold: 0,
    },
    constraints: [
      { field: "sma.period", message: "SMA must be shorter than EMA.", relation: "sma.period < ema.period" },
      { field: "macd.fastPeriod", message: "MACD fast period must be shorter than slow period.", relation: "macd.fastPeriod < macd.slowPeriod" },
    ],
  },
  meanReversion: {
    id: "mean-reversion",
    name: "Mean Reversion",
    category: "mean-reversion",
    description: "RSI oversold/overbought with Bollinger band extremes.",
    requiredSignals: ["rsi", "bollinger"],
    paramSpaces: {
      "rsi.period": { min: 5, max: 30, step: 1 },
      "bollinger.period": { min: 10, max: 40, step: 1 },
      "bollinger.stdDev": { min: 1, max: 3.5, step: 0.1 },
      "rsi.oversold": { min: 15, max: 40, step: 1 },
      "rsi.overbought": { min: 60, max: 85, step: 1 },
    },
    defaultParams: {
      rsiPeriod: 14,
      bollingerPeriod: 20,
      stdDev: 2,
      oversold: 30,
      overbought: 70,
    },
    constraints: [
      { field: "rsi.oversold", message: "Oversold threshold must be lower than overbought.", relation: "rsi.oversold < rsi.overbought" },
    ],
  },
  breakout: {
    id: "breakout",
    name: "Breakout",
    category: "breakout",
    description: "Price breakout gated by volume spike confirmation.",
    requiredSignals: ["volume", "sma"],
    paramSpaces: {
      "volume.period": { min: 5, max: 60, step: 1 },
      "volume.multiplier": { min: 1.1, max: 4, step: 0.1 },
      "sma.period": { min: 15, max: 100, step: 5 },
      "breakout.multiplier": { min: 1, max: 1.1, step: 0.005 },
    },
    defaultParams: {
      volumePeriod: 20,
      volumeMultiplier: 1.8,
      breakoutPeriod: 55,
      breakoutMultiplier: 1.02,
    },
    constraints: [
      { field: "volume.multiplier", message: "Volume spike threshold should be >= 1.1x.", min: 1.1 },
    ],
  },
  momentum: {
    id: "momentum",
    name: "Momentum",
    category: "momentum",
    description: "RSI + MACD alignment for directional continuation.",
    requiredSignals: ["rsi", "macd"],
    paramSpaces: {
      "rsi.period": { min: 5, max: 35, step: 1 },
      "rsi.threshold": { min: 45, max: 70, step: 1 },
      "macd.fastPeriod": { min: 6, max: 20, step: 1 },
      "macd.slowPeriod": { min: 18, max: 50, step: 1 },
      "macd.signalPeriod": { min: 5, max: 18, step: 1 },
    },
    defaultParams: {
      rsiPeriod: 14,
      rsiMomentumThreshold: 55,
      macdFastPeriod: 12,
      macdSlowPeriod: 26,
      macdSignalPeriod: 9,
    },
    constraints: [
      { field: "macd.fastPeriod", message: "MACD fast period must be shorter than slow period.", relation: "macd.fastPeriod < macd.slowPeriod" },
    ],
  },
};

export class StrategyGenerator {
  private readonly config: GeneratorConfig;

  constructor(config: GeneratorConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      numVariations: Math.max(1, Math.floor(config.numVariations)),
      mutationRate: clamp01(config.mutationRate),
      crossoverRate: clamp01(config.crossoverRate),
      randomSearchRatio: clamp01(config.randomSearchRatio),
    };
  }

  generateFromTemplate(template: MetaStrategyTemplate, baseStrategy?: Strategy): Strategy[] {
    const candidates: Strategy[] = [];
    for (let i = 0; i < this.config.numVariations; i += 1) {
      const params = i === 0
        ? template.defaultParams
        : this.sampleTemplateParams(template, false);
      const candidate = this.buildStrategyFromTemplate(template, params, baseStrategy, "template");
      this.pushIfValid(candidates, candidate);
    }
    return candidates;
  }

  mutate(strategy: Strategy, numVariations: number): Strategy[] {
    const variations = Math.max(1, Math.floor(numVariations));
    const candidates: Strategy[] = [];

    for (let i = 0; i < variations; i += 1) {
      let next = this.cloneAsChild(strategy, "mutation");
      const opCount = randomInt(1, 3);

      for (let opIndex = 0; opIndex < opCount; opIndex += 1) {
        const signal = randomPick(next.signals);
        if (!signal) {
          break;
        }

        const op = randomPick(["param", "threshold", "lookback", "add", "remove"] as const);
        if (!op) {
          break;
        }

        if (op === "param") {
          const paramKeys = Object.keys(signal.params as Record<string, unknown>);
          const targetParam = randomPick(paramKeys);
          if (!targetParam) {
            continue;
          }
          const currentValue = (signal.params as Record<string, unknown>)[targetParam];
          if (typeof currentValue === "number") {
            const mutatedValue = mutateNumber(currentValue);
            next = this.mutateSignalParams(next, signal.id, targetParam, mutatedValue);
          }
        }

        if (op === "threshold" && signal.conditions.length > 0) {
          const thresholdIndex = randomInt(0, signal.conditions.length - 1);
          const base = signal.conditions[thresholdIndex]?.threshold ?? 0;
          next = this.mutateThreshold(next, signal.id, thresholdIndex, mutateNumber(base));
        }

        if (op === "lookback") {
          const lookback = Math.max(1, Math.round(mutateNumber(signal.lookback, 0.35)));
          next = this.mutateLookback(next, signal.id, lookback);
        }

        if (op === "add") {
          const newSignal = this.randomSignalFromTypes(["rsi", "macd", "sma", "ema", "bollinger", "volume"]);
          if (newSignal) {
            next = this.addSignal(next, newSignal);
          }
        }

        if (op === "remove" && next.signals.length > 1) {
          const removable = randomPick(next.signals);
          if (removable) {
            next = this.removeSignal(next, removable.id);
          }
        }
      }

      this.pushIfValid(candidates, this.finalizeStrategy(next, "mutation", strategy.id));
    }

    return candidates;
  }

  crossover(strategyA: Strategy, strategyB: Strategy): Strategy[] {
    const variations = Math.max(1, Math.round(this.config.numVariations * this.config.crossoverRate));
    const candidates: Strategy[] = [];

    for (let i = 0; i < variations; i += 1) {
      const child: Strategy = {
        ...this.cloneAsChild(strategyA, "crossover"),
        signals: this.crossoverSignals(strategyA, strategyB),
        ...this.crossoverRules(strategyA, strategyB),
        riskParams: this.crossoverRiskParams(strategyA, strategyB),
        tags: dedupe([...(strategyA.tags ?? []), ...(strategyB.tags ?? []), "crossover"]),
        parentStrategyId: strategyA.id,
      };
      this.pushIfValid(candidates, this.finalizeStrategy(child, "crossover", strategyA.id));
    }

    return candidates;
  }

  randomSearch(template: MetaStrategyTemplate, numVariations: number): Strategy[] {
    const variations = Math.max(1, Math.floor(numVariations));
    const candidates: Strategy[] = [];

    for (let i = 0; i < variations; i += 1) {
      const params = this.sampleTemplateParams(template, true);
      const candidate = this.buildStrategyFromTemplate(template, params, undefined, "random");
      this.pushIfValid(candidates, candidate);
    }

    return candidates;
  }

  generateAll(parentStrategy: Strategy | null, templates: MetaStrategyTemplate[]): Strategy[] {
    const results: Strategy[] = [];

    for (const template of templates) {
      results.push(...this.generateFromTemplate(template, parentStrategy ?? undefined));

      const randomCount = Math.max(1, Math.round(this.config.numVariations * this.config.randomSearchRatio));
      results.push(...this.randomSearch(template, randomCount));

      if (parentStrategy) {
        const mutationCount = Math.max(1, Math.round(this.config.numVariations * this.config.mutationRate));
        results.push(...this.mutate(parentStrategy, mutationCount));

        const generatedPeer = randomPick(results);
        if (generatedPeer) {
          results.push(...this.crossover(parentStrategy, generatedPeer));
        }
      }
    }

    return results;
  }

  mutateSignalParams(strategy: Strategy, signalId: string, param: string, newValue: unknown): Strategy {
    const next = structuredClone(strategy);
    const signalIndex = next.signals.findIndex((signal) => signal.id === signalId);
    if (signalIndex < 0) {
      return next;
    }
    const signal = next.signals[signalIndex];
    if (!signal) {
      return next;
    }
    const params = { ...(signal.params as Record<string, unknown>), [param]: newValue };
    next.signals[signalIndex] = { ...signal, params } as Signal;
    next.updatedAt = nowIso();
    return next;
  }

  mutateThreshold(strategy: Strategy, signalId: string, threshold: number, newThreshold: number): Strategy {
    const next = structuredClone(strategy);
    const signalIndex = next.signals.findIndex((signal) => signal.id === signalId);
    const signal = signalIndex >= 0 ? next.signals[signalIndex] : undefined;
    if (!signal) {
      return next;
    }
    if (!signal.conditions[threshold]) {
      return next;
    }
    const updatedConditions = signal.conditions.map((condition, index) => {
      if (index !== threshold) {
        return condition;
      }
      return { ...condition, threshold: newThreshold };
    });
    next.signals[signalIndex] = { ...signal, conditions: updatedConditions } as Signal;
    next.updatedAt = nowIso();
    return next;
  }

  addSignal(strategy: Strategy, newSignal: Signal): Strategy {
    const next = structuredClone(strategy);
    next.signals = [...next.signals, newSignal];
    const entryRule = next.entryRules[0];
    if (entryRule) {
      entryRule.conditions = [
        ...entryRule.conditions,
        { signalId: newSignal.id, conditionIndex: 0, combinedWith: "and", negate: false },
      ];
    }
    next.updatedAt = nowIso();
    return next;
  }

  removeSignal(strategy: Strategy, signalId: string): Strategy {
    const next = structuredClone(strategy);
    const remaining = next.signals.filter((signal) => signal.id !== signalId);
    if (remaining.length === 0) {
      return next;
    }
    next.signals = remaining;
    this.repairRuleSignalReferences(next);
    next.updatedAt = nowIso();
    return next;
  }

  mutateLookback(strategy: Strategy, signalId: string, newLookback: number): Strategy {
    const next = structuredClone(strategy);
    const signalIndex = next.signals.findIndex((signal) => signal.id === signalId);
    const signal = signalIndex >= 0 ? next.signals[signalIndex] : undefined;
    if (!signal) {
      return next;
    }
    next.signals[signalIndex] = { ...signal, lookback: Math.max(1, Math.round(newLookback)) } as Signal;
    next.updatedAt = nowIso();
    return next;
  }

  crossoverSignals(strategyA: Strategy, strategyB: Strategy): Signal[] {
    const left = randomSubset(strategyA.signals);
    const right = randomSubset(strategyB.signals);
    const merged = [...left, ...right].map((signal) => structuredClone(signal));
    if (merged.length === 0) {
      const fallback = strategyA.signals[0] ?? strategyB.signals[0];
      return fallback ? [structuredClone(fallback)] : [];
    }
    return merged;
  }

  crossoverRules(strategyA: Strategy, strategyB: Strategy): Pick<Strategy, "entryRules" | "exitRules"> {
    const entryRules = randomSubset(strategyA.entryRules).concat(randomSubset(strategyB.entryRules));
    const exitRules = randomSubset(strategyA.exitRules).concat(randomSubset(strategyB.exitRules));

    const fallbackEntry = strategyA.entryRules[0] ?? strategyB.entryRules[0];
    const fallbackExit = strategyA.exitRules[0] ?? strategyB.exitRules[0];

    return {
      entryRules: entryRules.length > 0 ? structuredClone(entryRules) : (fallbackEntry ? [structuredClone(fallbackEntry)] : []),
      exitRules: exitRules.length > 0 ? structuredClone(exitRules) : (fallbackExit ? [structuredClone(fallbackExit)] : []),
    };
  }

  crossoverRiskParams(strategyA: Strategy, strategyB: Strategy): Strategy["riskParams"] {
    const selectFromA = Math.random() >= 0.5;
    return structuredClone(selectFromA ? strategyA.riskParams : strategyB.riskParams);
  }

  private buildStrategyFromTemplate(
    template: MetaStrategyTemplate,
    templateParams: Record<string, unknown>,
    baseStrategy: Strategy | undefined,
    method: GenerationMethod,
  ): Strategy {
    const signals = this.buildTemplateSignals(template, templateParams);
    const signalIds = signals.map((signal) => signal.id);
    const entrySignalId = signalIds[0] ?? "signal-primary";
    const exitSignalId = signalIds[signalIds.length - 1] ?? entrySignalId;
    const defaultName = `${template.name} Candidate ${shortId()}`;

    const fromBase = baseStrategy
      ? {
        filters: structuredClone(baseStrategy.filters),
        universe: structuredClone(baseStrategy.universe),
        riskParams: structuredClone(baseStrategy.riskParams),
        tags: [...baseStrategy.tags],
      }
      : {
        filters: [],
        universe: {
          mode: "all_equities" as const,
          exchanges: ["NSE"],
          indexIds: [],
          tickers: [],
        },
        riskParams: structuredClone(DEFAULT_RISK_PARAMS),
        tags: [],
      };

    const strategy: Strategy = {
      id: crypto.randomUUID(),
      name: defaultName,
      description: `${template.description} Generated via ${method} search.`,
      version: baseStrategy ? baseStrategy.version + 1 : 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: "draft",
      signals,
      filters: fromBase.filters,
      universe: fromBase.universe,
      entryRules: [
        this.createRule("Entry Logic", [entrySignalId]),
      ],
      exitRules: [
        this.createRule("Exit Logic", [exitSignalId]),
      ],
      riskParams: fromBase.riskParams,
      tags: dedupe([...fromBase.tags, template.category, template.id, method]),
      parentStrategyId: baseStrategy?.id,
      generationMethod: this.toStrategyGenerationMethod(method),
    };

    return this.finalizeStrategy(strategy, method, baseStrategy?.id);
  }

  private buildTemplateSignals(template: MetaStrategyTemplate, params: Record<string, unknown>): Signal[] {
    switch (template.id) {
      case "trend-following":
        return this.buildTrendFollowingSignals(params);
      case "mean-reversion":
        return this.buildMeanReversionSignals(params);
      case "breakout":
        return this.buildBreakoutSignals(params);
      case "momentum":
        return this.buildMomentumSignals(params);
      default:
        return [this.randomSignalFromTypes(template.requiredSignals) ?? this.randomSignalFromTypes(["sma"])].filter(
          (signal): signal is Signal => signal !== undefined,
        );
    }
  }

  private buildTrendFollowingSignals(params: Record<string, unknown>): Signal[] {
    const smaPeriod = intValue(params.smaPeriod, 20);
    const emaPeriod = Math.max(smaPeriod + 5, intValue(params.emaPeriod, 55));
    const macdFastPeriod = intValue(params.macdFastPeriod, 12);
    const macdSlowPeriod = Math.max(macdFastPeriod + 2, intValue(params.macdSlowPeriod, 26));
    const macdSignalPeriod = intValue(params.macdSignalPeriod, 9);
    const momentumThreshold = numberValue(params.momentumThreshold, 0);

    return [
      {
        id: signalId("sma"),
        type: "sma",
        lookback: Math.max(2, smaPeriod),
        params: { period: smaPeriod, source: "close" },
        conditions: [{ operator: "crosses_above", threshold: 0 }],
      },
      {
        id: signalId("ema"),
        type: "ema",
        lookback: Math.max(2, emaPeriod),
        params: { period: emaPeriod, source: "close" },
        conditions: [{ operator: "gt", threshold: 0 }],
      },
      {
        id: signalId("macd"),
        type: "macd",
        lookback: Math.max(2, macdSlowPeriod + macdSignalPeriod),
        params: {
          fastPeriod: macdFastPeriod,
          slowPeriod: macdSlowPeriod,
          signalPeriod: macdSignalPeriod,
          source: "close",
        },
        conditions: [{ operator: "gt", threshold: momentumThreshold }],
      },
    ];
  }

  private buildMeanReversionSignals(params: Record<string, unknown>): Signal[] {
    const rsiPeriod = intValue(params.rsiPeriod, 14);
    const bollingerPeriod = intValue(params.bollingerPeriod, 20);
    const stdDev = numberValue(params.stdDev, 2);
    const oversold = numberValue(params.oversold, 30);
    const overbought = Math.max(oversold + 5, numberValue(params.overbought, 70));

    return [
      {
        id: signalId("rsi"),
        type: "rsi",
        lookback: Math.max(2, rsiPeriod),
        params: { period: rsiPeriod, source: "close" },
        conditions: [
          { operator: "lt", threshold: oversold },
          { operator: "gt", threshold: overbought, combinedWith: "or" },
        ],
      },
      {
        id: signalId("bollinger"),
        type: "bollinger",
        lookback: Math.max(2, bollingerPeriod),
        params: { period: bollingerPeriod, stdDev, source: "close" },
        conditions: [{ operator: "crosses_below", threshold: 0 }],
      },
    ];
  }

  private buildBreakoutSignals(params: Record<string, unknown>): Signal[] {
    const volumePeriod = intValue(params.volumePeriod, 20);
    const volumeMultiplier = numberValue(params.volumeMultiplier, 1.8);
    const breakoutPeriod = intValue(params.breakoutPeriod, 55);
    const breakoutMultiplier = numberValue(params.breakoutMultiplier, 1.02);

    return [
      {
        id: signalId("volume"),
        type: "volume",
        lookback: Math.max(1, volumePeriod),
        params: { period: volumePeriod, mode: "sma_ratio" },
        conditions: [{ operator: "gt", threshold: volumeMultiplier }],
      },
      {
        id: signalId("sma"),
        type: "sma",
        lookback: Math.max(2, breakoutPeriod),
        params: { period: breakoutPeriod, source: "close" },
        conditions: [{ operator: "crosses_above", threshold: breakoutMultiplier }],
      },
    ];
  }

  private buildMomentumSignals(params: Record<string, unknown>): Signal[] {
    const rsiPeriod = intValue(params.rsiPeriod, 14);
    const rsiThreshold = numberValue(params.rsiMomentumThreshold, 55);
    const macdFastPeriod = intValue(params.macdFastPeriod, 12);
    const macdSlowPeriod = Math.max(macdFastPeriod + 2, intValue(params.macdSlowPeriod, 26));
    const macdSignalPeriod = intValue(params.macdSignalPeriod, 9);

    return [
      {
        id: signalId("rsi"),
        type: "rsi",
        lookback: Math.max(2, rsiPeriod),
        params: { period: rsiPeriod, source: "close" },
        conditions: [{ operator: "gt", threshold: rsiThreshold }],
      },
      {
        id: signalId("macd"),
        type: "macd",
        lookback: Math.max(2, macdSlowPeriod + macdSignalPeriod),
        params: {
          fastPeriod: macdFastPeriod,
          slowPeriod: macdSlowPeriod,
          signalPeriod: macdSignalPeriod,
          source: "close",
        },
        conditions: [{ operator: "crosses_above", threshold: 0 }],
      },
    ];
  }

  private sampleTemplateParams(template: MetaStrategyTemplate, fullyRandom: boolean): Record<string, unknown> {
    const sampled: Record<string, unknown> = { ...template.defaultParams };
    for (const [key, range] of Object.entries(template.paramSpaces)) {
      if (!fullyRandom && Math.random() < 0.5) {
        continue;
      }
      sampled[toDefaultParamKey(key)] = sampleRange(range);
    }
    return sampled;
  }

  private randomSignalFromTypes(signalTypes: string[]): Signal | undefined {
    const normalized = signalTypes
      .map((rawType) => rawType.toLowerCase().replace(/\s+/g, ""))
      .filter((rawType) => ["rsi", "macd", "sma", "ema", "bollinger", "volume"].includes(rawType));

    const type = randomPick(normalized);
    if (!type) {
      return undefined;
    }

    if (type === "rsi") {
      const period = randomInt(7, 30);
      return {
        id: signalId("rsi"),
        type: "rsi",
        lookback: period,
        params: { period, source: "close" },
        conditions: [{ operator: "gt", threshold: randomInt(45, 70) }],
      };
    }

    if (type === "macd") {
      const fastPeriod = randomInt(6, 16);
      const slowPeriod = randomInt(fastPeriod + 2, 40);
      const signalPeriod = randomInt(5, 15);
      return {
        id: signalId("macd"),
        type: "macd",
        lookback: slowPeriod + signalPeriod,
        params: { fastPeriod, slowPeriod, signalPeriod, source: "close" },
        conditions: [{ operator: "crosses_above", threshold: 0 }],
      };
    }

    if (type === "sma") {
      const period = randomInt(10, 120);
      return {
        id: signalId("sma"),
        type: "sma",
        lookback: period,
        params: { period, source: "close" },
        conditions: [{ operator: "gt", threshold: 0 }],
      };
    }

    if (type === "ema") {
      const period = randomInt(10, 120);
      return {
        id: signalId("ema"),
        type: "ema",
        lookback: period,
        params: { period, source: "close" },
        conditions: [{ operator: "gt", threshold: 0 }],
      };
    }

    if (type === "bollinger") {
      const period = randomInt(10, 30);
      return {
        id: signalId("bollinger"),
        type: "bollinger",
        lookback: period,
        params: { period, stdDev: roundTo(randomNumber(1.5, 3), 1), source: "close" },
        conditions: [{ operator: "crosses_below", threshold: 0 }],
      };
    }

    const period = randomInt(10, 60);
    return {
      id: signalId("volume"),
      type: "volume",
      lookback: period,
      params: { period, mode: "sma_ratio" },
      conditions: [{ operator: "gt", threshold: roundTo(randomNumber(1.2, 3), 1) }],
    };
  }

  private createRule(name: string, signalIds: string[]): Rule {
    const ids = signalIds.length > 0 ? signalIds : [signalId("fallback")];
    const conditions = ids.map((id, index) => ({
      signalId: id,
      conditionIndex: 0,
      negate: false,
      combinedWith: index === 0 ? undefined : ("and" as const),
    }));

    return {
      id: `rule-${shortId()}`,
      name,
      conditions,
    };
  }

  private toStrategyGenerationMethod(method: GenerationMethod): StrategyGenerationMethod {
    if (method === "mutation") {
      return "mutation";
    }
    if (method === "crossover") {
      return "crossover";
    }
    return "ai-generated";
  }

  private pushIfValid(bucket: Strategy[], strategy: Strategy): void {
    const validation = validateStrategyDsl(strategy);
    if (validation.success) {
      bucket.push(strategy);
    }
  }

  private cloneAsChild(strategy: Strategy, method: GenerationMethod): Strategy {
    const cloned = structuredClone(strategy);
    cloned.id = crypto.randomUUID();
    cloned.version = strategy.version + 1;
    cloned.createdAt = nowIso();
    cloned.updatedAt = nowIso();
    cloned.name = `${strategy.name} ${method} ${shortId()}`;
    cloned.status = "draft";
    cloned.parentStrategyId = strategy.id;
    cloned.generationMethod = this.toStrategyGenerationMethod(method);
    cloned.tags = dedupe([...(strategy.tags ?? []), method]);
    return cloned;
  }

  private finalizeStrategy(strategy: Strategy, method: GenerationMethod, parentId: string | undefined): Strategy {
    const next = structuredClone(strategy);
    next.id = crypto.randomUUID();
    next.updatedAt = nowIso();
    next.createdAt = next.createdAt || nowIso();
    next.generationMethod = this.toStrategyGenerationMethod(method);
    next.parentStrategyId = parentId;
    next.tags = dedupe([...(next.tags ?? []), method]);
    this.normalizeSignalIds(next);
    this.normalizeRuleIds(next);
    this.repairRuleSignalReferences(next);
    return next;
  }

  private normalizeSignalIds(strategy: Strategy): void {
    const idMap = new Map<string, string>();
    const seen = new Set<string>();

    strategy.signals = strategy.signals.map((signal) => {
      let nextId = signal.id;
      if (seen.has(nextId)) {
        nextId = signalId(signal.type);
      }
      seen.add(nextId);
      idMap.set(signal.id, nextId);
      return { ...signal, id: nextId } as Signal;
    });

    for (const rule of [...strategy.entryRules, ...strategy.exitRules]) {
      rule.conditions = rule.conditions.map((condition) => ({
        ...condition,
        signalId: idMap.get(condition.signalId) ?? condition.signalId,
      }));
    }
  }

  private normalizeRuleIds(strategy: Strategy): void {
    strategy.entryRules = strategy.entryRules.map((rule) => ({ ...rule, id: `entry-${shortId()}` }));
    strategy.exitRules = strategy.exitRules.map((rule) => ({ ...rule, id: `exit-${shortId()}` }));
  }

  private repairRuleSignalReferences(strategy: Strategy): void {
    const signalIds = new Set(strategy.signals.map((signal) => signal.id));
    const fallbackId = strategy.signals[0]?.id;
    if (!fallbackId) {
      return;
    }

    const repairRuleList = (rules: Rule[]): Rule[] => {
      const repaired = rules.map((rule) => {
        const conditions = rule.conditions.map((condition, index) => ({
          ...condition,
          signalId: signalIds.has(condition.signalId) ? condition.signalId : fallbackId,
          combinedWith: index === 0 ? undefined : (condition.combinedWith ?? "and"),
        }));
        return {
          ...rule,
          conditions: conditions.length > 0 ? conditions : [{ signalId: fallbackId, conditionIndex: 0, negate: false }],
        };
      });

      return repaired.length > 0 ? repaired : [this.createRule("Auto Repaired Rule", [fallbackId])];
    };

    strategy.entryRules = repairRuleList(strategy.entryRules);
    strategy.exitRules = repairRuleList(strategy.exitRules);
  }
}

function signalId(prefix: string): string {
  return `${prefix}-${shortId()}`;
}

function shortId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomInt(min: number, max: number): number {
  if (max <= min) {
    return min;
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomNumber(min: number, max: number): number {
  if (max <= min) {
    return min;
  }
  return Math.random() * (max - min) + min;
}

function randomPick<T>(items: readonly T[]): T | undefined {
  if (items.length === 0) {
    return undefined;
  }
  return items[randomInt(0, items.length - 1)];
}

function randomSubset<T>(items: readonly T[]): T[] {
  if (items.length === 0) {
    return [];
  }
  return items.filter(() => Math.random() >= 0.5);
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sampleRange(range: ParamRange): number {
  const steps = Math.max(1, Math.floor((range.max - range.min) / range.step));
  const selectedStep = randomInt(0, steps);
  return roundTo(range.min + selectedStep * range.step, countDecimals(range.step));
}

function countDecimals(value: number): number {
  const text = `${value}`;
  const index = text.indexOf(".");
  return index < 0 ? 0 : text.length - index - 1;
}

function mutateNumber(value: number, ratio = 0.2): number {
  const magnitude = Math.max(1, Math.abs(value));
  const delta = magnitude * ratio * randomNumber(-1, 1);
  const candidate = value + delta;
  return roundTo(candidate, 4);
}

function toDefaultParamKey(paramSpaceKey: string): string {
  const [signal, key] = paramSpaceKey.split(".");
  if (!signal || !key) {
    return paramSpaceKey;
  }
  return `${signal}${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

function intValue(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.round(value));
}

function numberValue(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

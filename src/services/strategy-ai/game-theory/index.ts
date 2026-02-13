import type { Strategy } from "../dsl/strategy-schema.js";
import type { Simulator } from "../simulator.js";
import type { StrategyStore } from "../store.js";

export type GameExperimentType =
  | "nash-equilibrium"
  | "evolutionary"
  | "zero-sum"
  | "cooperator-defector"
  | "signaling";

export interface GameExperiment {
  id: string;
  name: string;
  type: GameExperimentType;
  strategies: string[];
  baselineStrategies?: string[];
  config: GameConfig;
  results?: GameResult;
  createdAt: string;
  completedAt?: string;
}

export interface GameConfig {
  iterations: number;
  populationSize: number;
  convergenceThreshold: number;
  mutationRate: number;
  crossoverRate: number;
  generations: number;
  selectionMethod: "tournament" | "roulette" | "rank";
  numSimulations: number;
  explorationRate: number;
  signalTypes: string[];
  observationDelay: number;
}

export interface GameResult {
  equilibriumFound: boolean;
  equilibriumStrategies?: string[];
  bestStrategies: Array<{ strategyId: string; fitness: number }>;
  fitnessHistory: number[];
  generation: number;
  payoffMatrix: number[][];
  exploitability: Record<string, number>;
  convergenceProgress: number[];
  runtime: number;
  warnings: string[];
}

export interface PayoffMatrix {
  strategies: string[];
  matrix: number[][];
  symmetric: boolean;
}

export interface EvolutionIndividual {
  strategyId: string;
  genome: Record<string, number>;
  fitness: number;
  parents: string[];
}

export interface EvolutionPopulation {
  generation: number;
  individuals: EvolutionIndividual[];
  bestFitness: number;
  avgFitness: number;
  diversity: number;
}

export interface GameExperimentConfig {
  id?: string;
  name: string;
  type: GameExperimentType;
  strategies: string[];
  baselineStrategies?: string[];
  config?: Partial<GameConfig>;
}

export interface NashResult {
  equilibriumFound: boolean;
  equilibriumStrategies: string[];
  payoffMatrix: PayoffMatrix;
  iterations: number;
  convergence: number;
}

export interface EvolutionConfig {
  generations: number;
  populationSize: number;
  mutationRate: number;
  crossoverRate: number;
  selectionMethod: "tournament" | "roulette" | "rank";
}

export interface EvolutionResult {
  populations: EvolutionPopulation[];
  bestIndividuals: EvolutionIndividual[];
  fitnessHistory: number[];
}

export interface DilemmaResult {
  rounds: number;
  cooperationRate: number;
  pairPayoffs: Record<string, number>;
  stableStrategies: string[];
}

export interface EquilibriumAnalysis {
  isSymmetric: boolean;
  pureEquilibria: string[];
  maximinStrategy: string;
  averagePayoff: number;
  payoffVariance: number;
}

export interface GameExperimentTemplate {
  id: string;
  name: string;
  description: string;
  type: GameExperimentType;
  defaultConfig: Partial<GameConfig>;
  requiredStrategies: number;
  outputMetrics: string[];
}

const DEFAULT_GAME_CONFIG: GameConfig = {
  iterations: 1000,
  populationSize: 50,
  convergenceThreshold: 0.001,
  mutationRate: 0.1,
  crossoverRate: 0.7,
  generations: 100,
  selectionMethod: "tournament",
  numSimulations: 1000,
  explorationRate: 0.05,
  signalTypes: ["entry", "exit", "size"],
  observationDelay: 1,
};

export const NASH_POPULATION: GameExperimentTemplate = {
  id: "nash-population",
  name: "Nash Equilibrium Discovery",
  description: "Find strategies in Nash Equilibrium from generated population",
  type: "nash-equilibrium",
  defaultConfig: {
    iterations: 1000,
    convergenceThreshold: 0.001,
  },
  requiredStrategies: 10,
  outputMetrics: ["equilibriumFound", "equilibriumStrategies", "exploitability"],
};

export const EVOLUTION_COMPETE: GameExperimentTemplate = {
  id: "evolution-compete",
  name: "Evolutionary Competition",
  description: "Simulate strategies competing over multiple generations",
  type: "evolutionary",
  defaultConfig: {
    populationSize: 50,
    generations: 100,
    mutationRate: 0.1,
    crossoverRate: 0.7,
    selectionMethod: "tournament",
  },
  requiredStrategies: 20,
  outputMetrics: ["bestStrategies", "fitnessHistory", "diversity"],
};

export const ZERO_SUM_ARENA: GameExperimentTemplate = {
  id: "zero-sum-arena",
  name: "Zero-Sum Arena",
  description: "Test strategies in head-to-head zero-sum competitions",
  type: "zero-sum",
  defaultConfig: {
    numSimulations: 10_000,
    explorationRate: 0.05,
  },
  requiredStrategies: 5,
  outputMetrics: ["payoffMatrix", "exploitability", "gtoStrategies"],
};

export const MARKET_DILEMMA: GameExperimentTemplate = {
  id: "market-dilemma",
  name: "Market Prisoner's Dilemma",
  description: "Model cooperation vs competition between strategies",
  type: "cooperator-defector",
  defaultConfig: {
    iterations: 5000,
  },
  requiredStrategies: 8,
  outputMetrics: ["cooperationRate", "clusters", "stableStrategies"],
};

export const SIGNAL_GAMES: GameExperimentTemplate = {
  id: "signal-games",
  name: "Strategy Signaling Analysis",
  description: "Analyze how strategies signal and respond to each other",
  type: "signaling",
  defaultConfig: {
    signalTypes: ["entry", "exit", "size"],
    observationDelay: 1,
  },
  requiredStrategies: 10,
  outputMetrics: ["signalEffectiveness", "responsePatterns", "informationValue"],
};

export const EXPERIMENT_TEMPLATES: GameExperimentTemplate[] = [
  NASH_POPULATION,
  EVOLUTION_COMPETE,
  ZERO_SUM_ARENA,
  MARKET_DILEMMA,
  SIGNAL_GAMES,
];

export class GameTheoryEngine {
  private readonly store: StrategyStore;
  private readonly simulator: Simulator;
  private readonly experiments = new Map<string, GameExperiment>();

  constructor(deps: { store: StrategyStore; simulator: Simulator }) {
    this.store = deps.store;
    this.simulator = deps.simulator;
  }

  createExperiment(config: GameExperimentConfig): GameExperiment {
    const id = config.id ?? crypto.randomUUID();
    const experiment: GameExperiment = {
      id,
      name: config.name,
      type: config.type,
      strategies: [...new Set(config.strategies)],
      ...(config.baselineStrategies ? { baselineStrategies: [...new Set(config.baselineStrategies)] } : {}),
      config: this.resolveConfig(config.config),
      createdAt: new Date().toISOString(),
    };
    this.experiments.set(id, experiment);
    return experiment;
  }

  async runExperiment(experiment: GameExperiment): Promise<GameResult> {
    const startedAt = Date.now();
    const warnings: string[] = [];
    const strategies = await this.getStrategiesByIds(experiment.strategies);

    if (strategies.length === 0) {
      warnings.push("No valid strategies found for experiment.");
      const empty = this.emptyResult(Date.now() - startedAt, warnings);
      this.storeExperimentResult(experiment, empty);
      return empty;
    }

    if (strategies.length !== experiment.strategies.length) {
      warnings.push("Some strategy IDs were not found and were ignored.");
    }

    let result: GameResult;
    if (experiment.type === "nash-equilibrium") {
      const nash = await this.findNashEquilibrium(strategies);
      result = {
        equilibriumFound: nash.equilibriumFound,
        ...(nash.equilibriumStrategies.length > 0 ? { equilibriumStrategies: nash.equilibriumStrategies } : {}),
        bestStrategies: nash.equilibriumStrategies.map((strategyId) => ({ strategyId, fitness: 1 })),
        fitnessHistory: [nash.convergence],
        generation: 0,
        payoffMatrix: nash.payoffMatrix.matrix,
        exploitability: this.computeExploitability(nash.payoffMatrix),
        convergenceProgress: [nash.convergence],
        runtime: 0,
        warnings,
      };
    } else if (experiment.type === "evolutionary") {
      const evolution = await this.evolvePopulation(strategies, {
        generations: experiment.config.generations,
        populationSize: experiment.config.populationSize,
        mutationRate: experiment.config.mutationRate,
        crossoverRate: experiment.config.crossoverRate,
        selectionMethod: experiment.config.selectionMethod,
      });
      const lastPopulation = evolution.populations[evolution.populations.length - 1];
      result = {
        equilibriumFound: false,
        bestStrategies: evolution.bestIndividuals.map((individual) => ({
          strategyId: individual.strategyId,
          fitness: individual.fitness,
        })),
        fitnessHistory: evolution.fitnessHistory,
        generation: lastPopulation?.generation ?? 0,
        payoffMatrix: [],
        exploitability: {},
        convergenceProgress: this.normalizeProgress(evolution.fitnessHistory),
        runtime: 0,
        warnings,
      };
    } else if (experiment.type === "zero-sum") {
      const payoffMatrix = await this.computeZeroSumPayoffs(strategies);
      const gto = this.findGTOStrategy(payoffMatrix);
      result = {
        equilibriumFound: gto.length > 0,
        ...(gto.length > 0 ? { equilibriumStrategies: [gto] } : {}),
        bestStrategies: gto.length > 0 ? [{ strategyId: gto, fitness: 1 }] : [],
        fitnessHistory: [],
        generation: 0,
        payoffMatrix: payoffMatrix.matrix,
        exploitability: this.computeExploitability(payoffMatrix),
        convergenceProgress: [],
        runtime: 0,
        warnings,
      };
    } else if (experiment.type === "cooperator-defector") {
      const dilemma = await this.playDilemma(strategies, Math.max(1, experiment.config.iterations));
      const clusters = await this.findCooperativeClusters(strategies);
      result = {
        equilibriumFound: dilemma.stableStrategies.length > 0,
        ...(dilemma.stableStrategies.length > 0 ? { equilibriumStrategies: dilemma.stableStrategies } : {}),
        bestStrategies: dilemma.stableStrategies.map((strategyId) => ({
          strategyId,
          fitness: dilemma.pairPayoffs[strategyId] ?? 0,
        })),
        fitnessHistory: [dilemma.cooperationRate],
        generation: clusters.length,
        payoffMatrix: [],
        exploitability: {},
        convergenceProgress: [dilemma.cooperationRate],
        runtime: 0,
        warnings,
      };
    } else {
      const matrix = await this.computePayoffMatrix(strategies);
      const signalScore = this.computeSignalEfficiency(strategies, experiment.config.signalTypes);
      result = {
        equilibriumFound: false,
        bestStrategies: matrix.strategies.map((strategyId, index) => ({
          strategyId,
          fitness: signalScore[index] ?? 0,
        })),
        fitnessHistory: signalScore,
        generation: experiment.config.observationDelay,
        payoffMatrix: matrix.matrix,
        exploitability: this.computeExploitability(matrix),
        convergenceProgress: this.normalizeProgress(signalScore),
        runtime: 0,
        warnings,
      };
    }

    result.runtime = Date.now() - startedAt;
    this.storeExperimentResult(experiment, result);
    return result;
  }

  getExperiment(id: string): GameExperiment | null {
    return this.experiments.get(id) ?? null;
  }

  listExperiments(): GameExperiment[] {
    return [...this.experiments.values()];
  }

  async findNashEquilibrium(strategies: Strategy[]): Promise<NashResult> {
    const payoffMatrix = await this.computePayoffMatrix(strategies);
    const equilibria: string[] = [];

    for (let i = 0; i < payoffMatrix.strategies.length; i += 1) {
      let isBestResponseToSelf = true;
      const selfPayoff = payoffMatrix.matrix[i]?.[i] ?? Number.NEGATIVE_INFINITY;
      for (let k = 0; k < payoffMatrix.strategies.length; k += 1) {
        const challengerPayoff = payoffMatrix.matrix[k]?.[i] ?? Number.NEGATIVE_INFINITY;
        if (challengerPayoff > selfPayoff + 1e-9) {
          isBestResponseToSelf = false;
          break;
        }
      }
      if (isBestResponseToSelf) {
        const strategyId = payoffMatrix.strategies[i];
        if (strategyId) {
          equilibria.push(strategyId);
        }
      }
    }

    const fallback = equilibria.length > 0
      ? equilibria
      : await this.fictitiousPlay(strategies, Math.max(10, payoffMatrix.strategies.length * 20));

    const convergence = fallback.length > 0 ? 1 : 0;
    return {
      equilibriumFound: fallback.length > 0,
      equilibriumStrategies: fallback,
      payoffMatrix,
      iterations: Math.max(1, strategies.length),
      convergence,
    };
  }

  async computePayoffMatrix(strategies: Strategy[]): Promise<PayoffMatrix> {
    const strategyIds = strategies.map((strategy) => strategy.id);
    const baseFitness = await this.computeBaseFitnessMap(strategies);
    const matrix: number[][] = [];

    for (let i = 0; i < strategies.length; i += 1) {
      const row: number[] = [];
      const strategyA = strategies[i];
      if (!strategyA) {
        continue;
      }

      for (let j = 0; j < strategies.length; j += 1) {
        const strategyB = strategies[j];
        if (!strategyB) {
          row.push(0);
          continue;
        }
        const ownFitness = baseFitness.get(strategyA.id) ?? 0;
        const interaction = this.computeStrategyInteraction(strategyA, strategyB);
        row.push(ownFitness + interaction);
      }
      matrix.push(row);
    }

    return {
      strategies: strategyIds,
      matrix,
      symmetric: this.isMatrixSymmetric(matrix),
    };
  }

  async fictitiousPlay(strategies: Strategy[], iterations: number): Promise<string[]> {
    if (strategies.length === 0 || iterations <= 0) {
      return [];
    }

    const payoffMatrix = await this.computePayoffMatrix(strategies);
    const counts = new Array<number>(strategies.length).fill(0);
    let current = 0;

    for (let t = 0; t < iterations; t += 1) {
      counts[current] = (counts[current] ?? 0) + 1;
      const frequencies = counts.map((count) => count / (t + 1));

      let bestIndex = 0;
      let bestValue = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < strategies.length; i += 1) {
        const row = payoffMatrix.matrix[i] ?? [];
        let expected = 0;
        for (let j = 0; j < strategies.length; j += 1) {
          expected += (row[j] ?? 0) * (frequencies[j] ?? 0);
        }
        if (expected > bestValue) {
          bestValue = expected;
          bestIndex = i;
        }
      }
      current = bestIndex;
    }

    const maxCount = Math.max(...counts);
    return counts
      .map((count, index) => ({ count, strategyId: strategies[index]?.id }))
      .filter((entry) => entry.strategyId !== undefined && entry.count === maxCount)
      .map((entry) => entry.strategyId as string);
  }

  async evolvePopulation(initial: Strategy[], config: EvolutionConfig): Promise<EvolutionResult> {
    const populationSize = Math.max(1, config.populationSize);
    const generations = Math.max(1, config.generations);
    const initialIds = initial.map((strategy) => strategy.id);
    const baseFitness = await this.computeBaseFitnessMap(initial);

    const seedPopulation: EvolutionIndividual[] = [];
    for (let i = 0; i < populationSize; i += 1) {
      const strategyId = initialIds[i % Math.max(1, initialIds.length)] ?? `synthetic-${i}`;
      seedPopulation.push({
        strategyId,
        genome: { aggressiveness: Math.random(), patience: Math.random(), riskBias: Math.random() },
        fitness: 0,
        parents: [],
      });
    }

    let population = this.evaluatePopulation(seedPopulation, baseFitness);
    const populations: EvolutionPopulation[] = [];
    const fitnessHistory: number[] = [];

    for (let generation = 0; generation < generations; generation += 1) {
      const ranked = [...population].sort((a, b) => b.fitness - a.fitness);
      const bestFitness = ranked[0]?.fitness ?? 0;
      const avgFitness = ranked.length > 0
        ? ranked.reduce((sum, individual) => sum + individual.fitness, 0) / ranked.length
        : 0;

      populations.push({
        generation,
        individuals: ranked,
        bestFitness,
        avgFitness,
        diversity: this.computeDiversity(ranked),
      });
      fitnessHistory.push(bestFitness);

      const selected = this.selection(ranked, config.selectionMethod);
      const nextPopulation: EvolutionIndividual[] = [];
      while (nextPopulation.length < populationSize) {
        const parentA = selected[nextPopulation.length % Math.max(1, selected.length)] ?? selected[0];
        const parentB = selected[(nextPopulation.length + 1) % Math.max(1, selected.length)] ?? selected[0];

        if (!parentA || !parentB) {
          break;
        }

        const shouldCrossover = Math.random() <= config.crossoverRate;
        const children = shouldCrossover ? this.crossover(parentA, parentB) : [{ ...parentA }, { ...parentB }];

        for (const child of children) {
          const mutated = this.mutate(child, config.mutationRate);
          nextPopulation.push(mutated);
          if (nextPopulation.length >= populationSize) {
            break;
          }
        }
      }

      population = this.evaluatePopulation(nextPopulation.length > 0 ? nextPopulation : ranked, baseFitness);
    }

    const finalBest = [...population]
      .sort((a, b) => b.fitness - a.fitness)
      .slice(0, Math.min(5, population.length));

    return {
      populations,
      bestIndividuals: finalBest,
      fitnessHistory,
    };
  }

  selection(population: EvolutionIndividual[], method: string): EvolutionIndividual[] {
    if (population.length === 0) {
      return [];
    }

    const survivorCount = Math.max(2, Math.floor(population.length / 2));

    if (method === "rank") {
      return [...population].sort((a, b) => b.fitness - a.fitness).slice(0, survivorCount);
    }

    if (method === "roulette") {
      const shifted = population.map((individual) => Math.max(0, individual.fitness) + 1e-6);
      const total = shifted.reduce((sum, value) => sum + value, 0);
      const selected: EvolutionIndividual[] = [];
      for (let i = 0; i < survivorCount; i += 1) {
        const target = Math.random() * total;
        let running = 0;
        for (let j = 0; j < population.length; j += 1) {
          running += shifted[j] ?? 0;
          if (running >= target) {
            const candidate = population[j];
            if (candidate) {
              selected.push(candidate);
            }
            break;
          }
        }
      }
      return selected.length > 0 ? selected : [population[0]].filter((entry): entry is EvolutionIndividual => entry !== undefined);
    }

    const tournamentSelected: EvolutionIndividual[] = [];
    for (let i = 0; i < survivorCount; i += 1) {
      const a = population[Math.floor(Math.random() * population.length)] ?? population[0];
      const b = population[Math.floor(Math.random() * population.length)] ?? population[0];
      if (!a || !b) {
        continue;
      }
      tournamentSelected.push(a.fitness >= b.fitness ? a : b);
    }
    return tournamentSelected;
  }

  mutate(individual: EvolutionIndividual, rate: number): EvolutionIndividual {
    const next = structuredClone(individual);
    const safeRate = Math.max(0, Math.min(1, rate));
    for (const [key, value] of Object.entries(next.genome)) {
      if (Math.random() <= safeRate) {
        const delta = (Math.random() * 2 - 1) * safeRate;
        next.genome[key] = clamp01(value + delta);
      }
    }
    next.parents = next.parents.length > 0 ? next.parents : [individual.strategyId];
    return next;
  }

  crossover(parentA: EvolutionIndividual, parentB: EvolutionIndividual): EvolutionIndividual[] {
    const keys = [...new Set([...Object.keys(parentA.genome), ...Object.keys(parentB.genome)])];
    const childA: EvolutionIndividual = {
      strategyId: parentA.strategyId,
      genome: {},
      fitness: 0,
      parents: [parentA.strategyId, parentB.strategyId],
    };
    const childB: EvolutionIndividual = {
      strategyId: parentB.strategyId,
      genome: {},
      fitness: 0,
      parents: [parentA.strategyId, parentB.strategyId],
    };

    for (const key of keys) {
      const aValue = parentA.genome[key] ?? 0;
      const bValue = parentB.genome[key] ?? 0;
      if (Math.random() < 0.5) {
        childA.genome[key] = aValue;
        childB.genome[key] = bValue;
      } else {
        childA.genome[key] = bValue;
        childB.genome[key] = aValue;
      }
    }

    return [childA, childB];
  }

  async computeZeroSumPayoffs(strategies: Strategy[]): Promise<PayoffMatrix> {
    const matrix = Array.from({ length: strategies.length }, () => new Array<number>(strategies.length).fill(0));
    for (let i = 0; i < strategies.length; i += 1) {
      const strategyA = strategies[i];
      if (!strategyA) {
        continue;
      }
      for (let j = i + 1; j < strategies.length; j += 1) {
        const strategyB = strategies[j];
        if (!strategyB) {
          continue;
        }
        const edge = this.computeStrategyInteraction(strategyA, strategyB);
        matrix[i]![j] = edge;
        matrix[j]![i] = -edge;
      }
    }

    return {
      strategies: strategies.map((strategy) => strategy.id),
      matrix,
      symmetric: false,
    };
  }

  computeExploitability(payoffMatrix: PayoffMatrix): Record<string, number> {
    const exploitability: Record<string, number> = {};
    const size = payoffMatrix.strategies.length;

    for (let i = 0; i < size; i += 1) {
      const strategyId = payoffMatrix.strategies[i];
      if (!strategyId) {
        continue;
      }
      let bestResponseAgainstI = Number.NEGATIVE_INFINITY;
      let selfValue = Number.NEGATIVE_INFINITY;

      for (let k = 0; k < size; k += 1) {
        const responseValue = payoffMatrix.matrix[k]?.[i] ?? Number.NEGATIVE_INFINITY;
        if (responseValue > bestResponseAgainstI) {
          bestResponseAgainstI = responseValue;
        }
      }
      selfValue = payoffMatrix.matrix[i]?.[i] ?? 0;
      exploitability[strategyId] = round(bestResponseAgainstI - selfValue, 6);
    }

    return exploitability;
  }

  findGTOStrategy(payoffMatrix: PayoffMatrix): string {
    if (payoffMatrix.strategies.length === 0) {
      return "";
    }

    let bestStrategy = payoffMatrix.strategies[0] ?? "";
    let bestMinValue = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < payoffMatrix.strategies.length; i += 1) {
      const row = payoffMatrix.matrix[i] ?? [];
      const minValue = row.length > 0 ? Math.min(...row) : Number.NEGATIVE_INFINITY;
      if (minValue > bestMinValue) {
        bestMinValue = minValue;
        bestStrategy = payoffMatrix.strategies[i] ?? bestStrategy;
      }
    }

    return bestStrategy;
  }

  async playDilemma(strategies: Strategy[], rounds: number): Promise<DilemmaResult> {
    const safeRounds = Math.max(1, rounds);
    const pairPayoffs: Record<string, number> = {};
    let cooperativeMoves = 0;
    let totalMoves = 0;

    for (const strategy of strategies) {
      pairPayoffs[strategy.id] = 0;
    }

    for (let i = 0; i < strategies.length; i += 1) {
      const strategyA = strategies[i];
      if (!strategyA) {
        continue;
      }
      for (let j = i + 1; j < strategies.length; j += 1) {
        const strategyB = strategies[j];
        if (!strategyB) {
          continue;
        }

        let cooperationA = this.cooperationSignal(strategyA);
        let cooperationB = this.cooperationSignal(strategyB);

        for (let roundIndex = 0; roundIndex < safeRounds; roundIndex += 1) {
          const payoff = this.dilemmaPayoff(cooperationA, cooperationB);
          pairPayoffs[strategyA.id] = (pairPayoffs[strategyA.id] ?? 0) + payoff.a;
          pairPayoffs[strategyB.id] = (pairPayoffs[strategyB.id] ?? 0) + payoff.b;

          cooperativeMoves += Number(cooperationA) + Number(cooperationB);
          totalMoves += 2;

          const memoryBiasA = this.strategyMemoryBias(strategyA);
          const memoryBiasB = this.strategyMemoryBias(strategyB);
          cooperationA = Math.random() < (cooperationB ? 0.6 + memoryBiasA : 0.3 + memoryBiasA / 2);
          cooperationB = Math.random() < (cooperationA ? 0.6 + memoryBiasB : 0.3 + memoryBiasB / 2);
        }
      }
    }

    const stableStrategies = Object.entries(pairPayoffs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.min(3, strategies.length))
      .map(([strategyId]) => strategyId);

    return {
      rounds: safeRounds,
      cooperationRate: totalMoves === 0 ? 0 : cooperativeMoves / totalMoves,
      pairPayoffs,
      stableStrategies,
    };
  }

  async findCooperativeClusters(strategies: Strategy[]): Promise<string[][]> {
    const unvisited = new Set(strategies.map((strategy) => strategy.id));
    const byId = new Map(strategies.map((strategy) => [strategy.id, strategy] as const));
    const clusters: string[][] = [];

    while (unvisited.size > 0) {
      const seed = unvisited.values().next().value as string | undefined;
      if (!seed) {
        break;
      }

      const queue = [seed];
      const cluster: string[] = [];
      unvisited.delete(seed);

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
          continue;
        }
        cluster.push(current);
        const currentStrategy = byId.get(current);
        if (!currentStrategy) {
          continue;
        }

        for (const otherId of [...unvisited]) {
          const other = byId.get(otherId);
          if (!other) {
            continue;
          }
          const affinity = this.computeStrategyInteraction(currentStrategy, other);
          if (affinity > 0) {
            unvisited.delete(otherId);
            queue.push(otherId);
          }
        }
      }

      clusters.push(cluster);
    }

    return clusters;
  }

  computeStrategyInteraction(strategyA: Strategy, strategyB: Strategy): number {
    const signalOverlap = jaccard(
      strategyA.signals.map((signal) => signal.type),
      strategyB.signals.map((signal) => signal.type),
    );
    const tagOverlap = jaccard(strategyA.tags ?? [], strategyB.tags ?? []);

    const complexityA = strategyA.entryRules.length + strategyA.exitRules.length + strategyA.signals.length;
    const complexityB = strategyB.entryRules.length + strategyB.exitRules.length + strategyB.signals.length;
    const complexityGap = Math.abs(complexityA - complexityB);

    const synergy = signalOverlap * 0.6 + tagOverlap * 0.4;
    const competition = clamp01(complexityGap / 10) * 0.5;
    return round(synergy - competition, 6);
  }

  analyzeEquilibriumProperties(payoffMatrix: PayoffMatrix): EquilibriumAnalysis {
    const pureEquilibria: string[] = [];
    let sum = 0;
    let count = 0;
    const values: number[] = [];

    for (let i = 0; i < payoffMatrix.strategies.length; i += 1) {
      const diagonal = payoffMatrix.matrix[i]?.[i] ?? Number.NEGATIVE_INFINITY;
      let isEquilibrium = true;
      for (let k = 0; k < payoffMatrix.strategies.length; k += 1) {
        if ((payoffMatrix.matrix[k]?.[i] ?? Number.NEGATIVE_INFINITY) > diagonal) {
          isEquilibrium = false;
          break;
        }
      }
      if (isEquilibrium) {
        const strategyId = payoffMatrix.strategies[i];
        if (strategyId) {
          pureEquilibria.push(strategyId);
        }
      }

      for (let j = 0; j < payoffMatrix.strategies.length; j += 1) {
        const value = payoffMatrix.matrix[i]?.[j] ?? 0;
        sum += value;
        count += 1;
        values.push(value);
      }
    }

    const averagePayoff = count === 0 ? 0 : sum / count;
    const payoffVariance = variance(values, averagePayoff);

    return {
      isSymmetric: payoffMatrix.symmetric,
      pureEquilibria,
      maximinStrategy: this.findGTOStrategy(payoffMatrix),
      averagePayoff,
      payoffVariance,
    };
  }

  private resolveConfig(config?: Partial<GameConfig>): GameConfig {
    return {
      ...DEFAULT_GAME_CONFIG,
      ...config,
      signalTypes: config?.signalTypes ?? DEFAULT_GAME_CONFIG.signalTypes,
      selectionMethod: config?.selectionMethod ?? DEFAULT_GAME_CONFIG.selectionMethod,
    };
  }

  private async getStrategiesByIds(ids: string[]): Promise<Strategy[]> {
    const unique = [...new Set(ids)];
    const loaded = await Promise.all(unique.map((id) => this.store.getStrategy(id)));
    return loaded.filter((strategy): strategy is Strategy => strategy !== null);
  }

  private async computeBaseFitnessMap(strategies: Strategy[]): Promise<Map<string, number>> {
    const fitness = new Map<string, number>();
    for (const strategy of strategies) {
      const result = await this.simulator.run(strategy);
      const value =
        result.totalReturn * 0.5 +
        result.sharpeRatio * 0.3 +
        (1 - Math.abs(result.maxDrawdown)) * 0.2;
      fitness.set(strategy.id, value);
    }
    return fitness;
  }

  private evaluatePopulation(
    population: EvolutionIndividual[],
    baseFitness: Map<string, number>,
  ): EvolutionIndividual[] {
    return population.map((individual) => {
      const genes = Object.values(individual.genome);
      const geneMean = genes.length > 0 ? genes.reduce((sum, value) => sum + value, 0) / genes.length : 0;
      const base = baseFitness.get(individual.strategyId) ?? 0;
      return {
        ...individual,
        fitness: round(base + geneMean, 6),
      };
    });
  }

  private computeDiversity(population: EvolutionIndividual[]): number {
    if (population.length <= 1) {
      return 0;
    }
    const encoded = population.map((individual) => JSON.stringify(individual.genome));
    return new Set(encoded).size / population.length;
  }

  private emptyResult(runtime: number, warnings: string[]): GameResult {
    return {
      equilibriumFound: false,
      bestStrategies: [],
      fitnessHistory: [],
      generation: 0,
      payoffMatrix: [],
      exploitability: {},
      convergenceProgress: [],
      runtime,
      warnings,
    };
  }

  private normalizeProgress(values: number[]): number[] {
    if (values.length === 0) {
      return [];
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min;
    if (span === 0) {
      return values.map(() => 1);
    }
    return values.map((value) => (value - min) / span);
  }

  private computeSignalEfficiency(strategies: Strategy[], signalTypes: string[]): number[] {
    const normalizedTypes = new Set(signalTypes.map((signal) => signal.toLowerCase()));
    return strategies.map((strategy) => {
      if (strategy.signals.length === 0) {
        return 0;
      }
      const matches = strategy.signals.filter((signal) => normalizedTypes.has(signal.type.toLowerCase())).length;
      return matches / strategy.signals.length;
    });
  }

  private cooperationSignal(strategy: Strategy): boolean {
    const cooperativeTags = new Set(["cooperative", "portfolio", "diversified", "hedge"]);
    return (strategy.tags ?? []).some((tag) => cooperativeTags.has(tag.toLowerCase()));
  }

  private strategyMemoryBias(strategy: Strategy): number {
    const ruleCount = strategy.entryRules.length + strategy.exitRules.length;
    return clamp01(ruleCount / 12) * 0.3;
  }

  private dilemmaPayoff(cooperateA: boolean, cooperateB: boolean): { a: number; b: number } {
    if (cooperateA && cooperateB) {
      return { a: 3, b: 3 };
    }
    if (!cooperateA && !cooperateB) {
      return { a: 1, b: 1 };
    }
    if (cooperateA && !cooperateB) {
      return { a: 0, b: 5 };
    }
    return { a: 5, b: 0 };
  }

  private isMatrixSymmetric(matrix: number[][]): boolean {
    for (let i = 0; i < matrix.length; i += 1) {
      for (let j = i + 1; j < matrix.length; j += 1) {
        const a = matrix[i]?.[j] ?? 0;
        const b = matrix[j]?.[i] ?? 0;
        if (Math.abs(a - b) > 1e-9) {
          return false;
        }
      }
    }
    return true;
  }

  private storeExperimentResult(experiment: GameExperiment, result: GameResult): void {
    const current = this.experiments.get(experiment.id) ?? experiment;
    this.experiments.set(experiment.id, {
      ...current,
      results: result,
      completedAt: new Date().toISOString(),
    });
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function jaccard(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const value of leftSet) {
    if (rightSet.has(value)) {
      intersection += 1;
    }
  }
  return intersection / union.size;
}

function variance(values: number[], mean: number): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => {
    const diff = value - mean;
    return sum + diff * diff;
  }, 0) / values.length;
}

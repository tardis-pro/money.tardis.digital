import type { FastifyInstance } from "fastify";
import { BUILTIN_TEMPLATES, StrategyGenerator } from "./generator.js";
import { ADVANCED_TEMPLATES } from "./templates.js";
import type { Strategy } from "./dsl/strategy-schema.js";
import { NLManagerAgent, type ChatMessage, type LLMProvider } from "./manager-agent.js";
import { Simulator, type SimulationConfig, type SimulationResult } from "./simulator.js";
import { HistoricalBacktester, type BacktestConfig, type BacktestResult, type MonteCarloResult } from "./historical-backtest.js";
import { Ranker } from "./ranker.js";
import { BatchSimulator } from "./batch-simulator.js";
import { RulebookEngine, type ContextFeatures } from "./rulebook.js";
import { GameTheoryEngine } from "./game-theory/index.js";
import { StrategyStore, type SimRun, type StrategyStoreFilters, type BacktestRun } from "./store.js";
import { TimescaleTechnicalStore } from "./ta-store.js";

const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
  endDate: new Date().toISOString(),
  initialCapital: 1_000_000,
  commissionRate: 0.0005,
  slippageRate: 0.0005,
};

class UnavailableLlmProvider implements LLMProvider {
  async chat(_messages: ChatMessage[]): Promise<{ content: string }> {
    throw new Error("LLM provider is not configured");
  }

  async structuredOutput<T>(_messages: ChatMessage[], _schema: object): Promise<T> {
    throw new Error("LLM provider is not configured");
  }
}

export async function registerStrategyAiRoutes(app: FastifyInstance): Promise<void> {
  const store = new StrategyStore();
  await store.init();

  const taStore = new TimescaleTechnicalStore();
  await taStore.init();

  const generator = new StrategyGenerator({
    numVariations: 12,
    mutationRate: 0.35,
    crossoverRate: 0.3,
    randomSearchRatio: 0.25,
  });
  const manager = new NLManagerAgent({
    llm: new UnavailableLlmProvider(),
    store,
    generator,
  });
  const simulator = new Simulator({ ...DEFAULT_SIMULATION_CONFIG, taStore });
  const batchSimulator = new BatchSimulator({ simulator, store });
  const ranker = new Ranker({ store });
  const rulebook = new RulebookEngine({ store, ranker });
  const gameTheory = new GameTheoryEngine({ store, simulator });

  app.post("/api/strategies", async (request, reply) => {
    try {
      const body = request.body as { prompt?: string; query?: string; text?: string } | undefined;
      const prompt = body?.prompt ?? body?.query ?? body?.text;
      if (!prompt || prompt.trim().length === 0) {
        return reply.code(400).send({ error: "Request body must include a non-empty prompt/query/text" });
      }

      const intent = await manager.parseIntent(prompt);
      const strategy = await manager.generateStrategy(intent);
      return reply.code(201).send({ strategy, intent });
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.get("/api/strategies", async (request, reply) => {
    try {
      const query = request.query as {
        status?: Strategy["status"];
        sector?: string;
        tags?: string | string[];
        limit?: string | number;
        offset?: string | number;
      };

      const tags = parseTags(query.tags);
      const limit = parseOptionalInt(query.limit);
      const offset = parseOptionalInt(query.offset);
      const filters: StrategyStoreFilters = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.sector ? { sector: query.sector } : {}),
        ...(tags.length > 0 ? { tags } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(offset !== undefined ? { offset } : {}),
      };

      const strategies = await store.listStrategies(filters);
      return { strategies, count: strategies.length, filters };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.get("/api/strategies/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const strategy = await store.getStrategy(id);
      if (!strategy) {
        return reply.code(404).send({ error: `Strategy not found: ${id}` });
      }
      return { strategy };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.put("/api/strategies/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const updates = (request.body ?? {}) as Partial<Strategy>;
      const strategy = await store.updateStrategy(id, updates);
      return { strategy };
    } catch (error) {
      const message = messageOf(error);
      if (message.includes("not found")) {
        return reply.code(404).send({ error: message });
      }
      return reply.code(500).send({ error: message });
    }
  });

  app.delete("/api/strategies/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await store.archiveStrategy(id);
      return { ok: true, strategyId: id, status: "archived" };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.post("/api/strategies/:id/generate", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const strategy = await store.getStrategy(id);
      if (!strategy) {
        return reply.code(404).send({ error: `Strategy not found: ${id}` });
      }

      const body = request.body as { count?: number } | undefined;
      const count = Math.max(1, Math.floor(body?.count ?? 10));
      const candidates = generator.mutate(strategy, count);
      const created = await Promise.all(candidates.map((candidate) => store.createStrategy(candidate)));

      return reply.code(201).send({
        parentStrategyId: id,
        generatedCount: created.length,
        strategies: created,
      });
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.post("/api/strategies/:id/simulate", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const strategy = await store.getStrategy(id);
      if (!strategy) {
        return reply.code(404).send({ error: `Strategy not found: ${id}` });
      }

      const config = toSimulationConfig(request.body, { ...DEFAULT_SIMULATION_CONFIG, taStore });
      const singleRunSimulator = new Simulator(config);
      const result = await singleRunSimulator.run(strategy);
      const simRun = toSimRun(result);
      await store.createSimRun(simRun);

      const scores = ranker.computeScores([result]);
      await ranker.saveRankings(scores);

      return { simulation: result, simRun, rankings: scores };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.get("/api/templates", async () => {
    const allTemplates = [...Object.values(BUILTIN_TEMPLATES), ...ADVANCED_TEMPLATES];
    return { templates: allTemplates, count: allTemplates.length };
  });

  app.get("/api/templates/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const allTemplates = [...Object.values(BUILTIN_TEMPLATES), ...ADVANCED_TEMPLATES];
    const template = allTemplates.find((item) => item.id === id)
      ?? BUILTIN_TEMPLATES[id]
      ?? allTemplates.find((item) => normalize(item.id) === normalize(id));

    if (!template) {
      return reply.code(404).send({ error: `Template not found: ${id}` });
    }

    return { template };
  });

  app.get("/api/sim-runs", async (request, reply) => {
    try {
      const query = request.query as { strategyId?: string };
      const simRuns = await store.listSimRuns(query.strategyId);
      return { simRuns, count: simRuns.length };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.get("/api/sim-runs/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const simRun = await store.getSimRun(id);
      if (!simRun) {
        return reply.code(404).send({ error: `Simulation run not found: ${id}` });
      }
      return { simRun };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.post("/api/sim-runs/batch", async (request, reply) => {
    try {
      const body = request.body as {
        strategyIds?: string[];
        strategyFilter?: { status?: Strategy["status"]; sector?: string; tags?: string[] };
        config?: Partial<SimulationConfig>;
      } | undefined;

      const selected = await resolveStrategiesForBatch(store, body);
      if (selected.length === 0) {
        return reply.code(400).send({ error: "No strategies available for batch simulation" });
      }

      const config = toSimulationConfig(body?.config, { ...DEFAULT_SIMULATION_CONFIG, taStore });
      const resultMap = await batchSimulator.runBatch(selected, config);
      const results = Array.from(resultMap.values());

      const scores = ranker.computeScores(results);
      await ranker.saveRankings(scores);

      return {
        totalRequested: selected.length,
        completed: results.length,
        failed: selected.length - results.length,
        simulations: results,
        rankings: scores,
      };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.get("/api/rankings", async (request, reply) => {
    try {
      const query = request.query as { date?: string; sector?: string; regime?: string };
      const rankings = await store.getRankings({
        ...(query.date ? { date: query.date } : {}),
        ...(query.sector ? { sector: query.sector } : {}),
        ...(query.regime ? { regime: query.regime } : {}),
      });
      return { rankings, count: rankings.length };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.get("/api/rankings/global", async (request, reply) => {
    try {
      const query = request.query as { limit?: string | number };
      const limit = parseOptionalInt(query.limit) ?? 20;
      const rankings = await ranker.getTopStrategies(limit);
      return { rankings, count: rankings.length };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.get("/api/rankings/sector/:sector", async (request, reply) => {
    try {
      const { sector } = request.params as { sector: string };
      const query = request.query as { limit?: string | number };
      const limit = parseOptionalInt(query.limit) ?? 20;
      const rankings = await ranker.getTopStrategies(limit, { sector });
      return { sector, rankings, count: rankings.length };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.get("/api/rulebook", async (_request, reply) => {
    try {
      void _request;
      const entries = await rulebook.listEntries();
      return { entries, count: entries.length };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.post("/api/rulebook/refresh", async (_request, reply) => {
    try {
      void _request;
      await rulebook.rebuild();
      const entries = await rulebook.listEntries();
      return { ok: true, entries, count: entries.length };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.get("/api/rulebook/recommend", async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const base = rulebook.senseCurrentContext();
      const context = parseContextFromQuery(query, base);
      const recommendation = await rulebook.recommend(context);
      return { recommendation };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.post("/api/game-experiments", async (request, reply) => {
    try {
      const body = request.body as {
        id?: string;
        name?: string;
        type?: "nash-equilibrium" | "evolutionary" | "zero-sum" | "cooperator-defector" | "signaling";
        strategies?: string[];
        baselineStrategies?: string[];
        config?: Record<string, unknown>;
      };

      if (!body?.name || !body?.type || !Array.isArray(body.strategies) || body.strategies.length === 0) {
        return reply.code(400).send({
          error: "name, type and strategies[] are required",
        });
      }

      const experiment = gameTheory.createExperiment({
        ...(body.id ? { id: body.id } : {}),
        name: body.name,
        type: body.type,
        strategies: body.strategies,
        ...(body.baselineStrategies ? { baselineStrategies: body.baselineStrategies } : {}),
        ...(body.config ? { config: body.config } : {}),
      });

      return reply.code(201).send({ experiment });
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.get("/api/game-experiments", async () => {
    const experiments = gameTheory.listExperiments();
    return { experiments, count: experiments.length };
  });

  app.get("/api/game-experiments/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const experiment = gameTheory.getExperiment(id);
    if (!experiment) {
      return reply.code(404).send({ error: `Experiment not found: ${id}` });
    }
    return { experiment };
  });

  app.post("/api/game-experiments/:id/run", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const experiment = gameTheory.getExperiment(id);
      if (!experiment) {
        return reply.code(404).send({ error: `Experiment not found: ${id}` });
      }

      const results = await gameTheory.runExperiment(experiment);
      return { experimentId: id, results };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  const defaultBacktestConfig: BacktestConfig = {
    startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    endDate: new Date().toISOString(),
    initialCapital: 1_000_000,
    commissionRate: 0.0005,
    slippageRate: 0.0005,
    maxPositionSize: 0.2,
    riskPerTrade: 0.02,
    allowMultiplePositions: true,
  };

  app.post("/api/backtest/run", async (request, reply) => {
    try {
      const body = request.body as {
        strategyId: string;
        ticker?: string;
        config?: Partial<BacktestConfig>;
      } | undefined;

      if (!body?.strategyId) {
        return reply.code(400).send({ error: "strategyId is required" });
      }

      const strategy = await store.getStrategy(body.strategyId);
      if (!strategy) {
        return reply.code(404).send({ error: `Strategy not found: ${body.strategyId}` });
      }

      const config = { ...defaultBacktestConfig, ...body.config };
      const backtester = new HistoricalBacktester(taStore, config);
      
      const ticker = body.ticker ?? (strategy.universe.mode === "custom_tickers" && strategy.universe.tickers.length > 0 
        ? strategy.universe.tickers[0] 
        : "SANDBOX") ?? "SANDBOX";

      const result = await backtester.run(strategy, ticker);

      const backtestRun: BacktestRun = {
        id: result.runId,
        strategyId: result.strategyId,
        ticker: result.ticker,
        startDate: result.startDate,
        endDate: result.endDate,
        backtestType: "historical",
        createdAt: new Date().toISOString(),
        payload: result as unknown as Record<string, unknown>,
      };
      await store.createBacktestRun(backtestRun);

      return { backtest: result };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.post("/api/backtest/universe", async (request, reply) => {
    try {
      const body = request.body as {
        strategyId: string;
        config?: Partial<BacktestConfig>;
      } | undefined;

      if (!body?.strategyId) {
        return reply.code(400).send({ error: "strategyId is required" });
      }

      const strategy = await store.getStrategy(body.strategyId);
      if (!strategy) {
        return reply.code(404).send({ error: `Strategy not found: ${body.strategyId}` });
      }

      const config = { ...defaultBacktestConfig, ...body.config };
      const backtester = new HistoricalBacktester(taStore, config);
      
      const results = await backtester.runUniverse(strategy);

      for (const result of results) {
        const backtestRun: BacktestRun = {
          id: result.runId,
          strategyId: result.strategyId,
          ticker: result.ticker,
          startDate: result.startDate,
          endDate: result.endDate,
          backtestType: "historical",
          createdAt: new Date().toISOString(),
          payload: result as unknown as Record<string, unknown>,
        };
        await store.createBacktestRun(backtestRun);
      }

      return { backtests: results, count: results.length };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.post("/api/backtest/walkforward", async (request, reply) => {
    try {
      const body = request.body as {
        strategyId: string;
        ticker?: string;
        trainDays?: number;
        testDays?: number;
        stepDays?: number;
      } | undefined;

      if (!body?.strategyId) {
        return reply.code(400).send({ error: "strategyId is required" });
      }

      const strategy = await store.getStrategy(body.strategyId);
      if (!strategy) {
        return reply.code(404).send({ error: `Strategy not found: ${body.strategyId}` });
      }

      const config = { ...defaultBacktestConfig };
      const backtester = new HistoricalBacktester(taStore, config);
      
      const ticker = body.ticker ?? (strategy.universe.mode === "custom_tickers" && strategy.universe.tickers.length > 0 
        ? strategy.universe.tickers[0] 
        : "SANDBOX") ?? "SANDBOX";

      const results = await backtester.runWalkForward(
        strategy, 
        ticker,
        body.trainDays ?? 252,
        body.testDays ?? 63,
        body.stepDays ?? 21
      );

      for (const result of results) {
        const backtestRun: BacktestRun = {
          id: result.runId,
          strategyId: result.strategyId,
          ticker: result.ticker,
          startDate: result.startDate,
          endDate: result.endDate,
          backtestType: "walkforward",
          createdAt: new Date().toISOString(),
          payload: result as unknown as Record<string, unknown>,
        };
        await store.createBacktestRun(backtestRun);
      }

      return { walkforward: results, windows: results.length };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.post("/api/backtest/montecarlo", async (request, reply) => {
    try {
      const body = request.body as {
        strategyId: string;
        ticker?: string;
        simulations?: number;
      } | undefined;

      if (!body?.strategyId) {
        return reply.code(400).send({ error: "strategyId is required" });
      }

      const strategy = await store.getStrategy(body.strategyId);
      if (!strategy) {
        return reply.code(404).send({ error: `Strategy not found: ${body.strategyId}` });
      }

      const config = { ...defaultBacktestConfig };
      const backtester = new HistoricalBacktester(taStore, config);
      
      const ticker = body.ticker ?? (strategy.universe.mode === "custom_tickers" && strategy.universe.tickers.length > 0 
        ? strategy.universe.tickers[0] 
        : "SANDBOX") ?? "SANDBOX";

      const result = await backtester.runMonteCarlo(
        strategy, 
        ticker,
        body.simulations ?? 1000
      );

      return { montecarlo: result };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.post("/api/backtest/batch", async (request, reply) => {
    try {
      const body = request.body as {
        strategyIds?: string[];
        strategyFilter?: { status?: Strategy["status"]; sector?: string; tags?: string[] };
        tickers?: string[];
        config?: Partial<BacktestConfig>;
      } | undefined;

      let strategies: Strategy[] = [];
      
      if (Array.isArray(body?.strategyIds) && body.strategyIds.length > 0) {
        const loaded = await Promise.all(body.strategyIds.map(id => store.getStrategy(id)));
        strategies = loaded.filter((s): s is Strategy => s !== null);
      } else if (body?.strategyFilter) {
        strategies = await store.listStrategies({
          ...(body.strategyFilter.status ? { status: body.strategyFilter.status } : {}),
          ...(body.strategyFilter.sector ? { sector: body.strategyFilter.sector } : {}),
          ...(body.strategyFilter.tags ? { tags: body.strategyFilter.tags } : {}),
          limit: 100,
          offset: 0,
        });
      }

      if (strategies.length === 0) {
        return reply.code(400).send({ error: "No strategies available for batch backtest" });
      }

      const config = { ...defaultBacktestConfig, ...body?.config };
      const backtester = new HistoricalBacktester(taStore, config);
      
      const resultMap = await backtester.runBatch(strategies, body?.tickers);
      const results = Array.from(resultMap.values());

      for (const result of results) {
        const backtestRun: BacktestRun = {
          id: result.runId,
          strategyId: result.strategyId,
          ticker: result.ticker,
          startDate: result.startDate,
          endDate: result.endDate,
          backtestType: "historical",
          createdAt: new Date().toISOString(),
          payload: result as unknown as Record<string, unknown>,
        };
        await store.createBacktestRun(backtestRun);
      }

      return { 
        totalRequested: strategies.length,
        completed: results.length,
        backtests: results 
      };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.get("/api/backtest/runs", async (request, reply) => {
    try {
      const query = request.query as { strategyId?: string; ticker?: string; backtestType?: string };
      const runs = await store.listBacktestRuns({
        ...(query.strategyId ? { strategyId: query.strategyId } : {}),
        ...(query.ticker ? { ticker: query.ticker } : {}),
        ...(query.backtestType ? { backtestType: query.backtestType } : {}),
      });
      return { backtestRuns: runs, count: runs.length };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.get("/api/backtest/runs/:id", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const run = await store.getBacktestRun(id);
      if (!run) {
        return reply.code(404).send({ error: `Backtest run not found: ${id}` });
      }
      return { backtestRun: run };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });

  app.get("/api/backtest/metrics", async (request, reply) => {
    try {
      const query = request.query as { strategyId?: string; ticker?: string };
      const metrics = await store.getBacktestMetrics({
        ...(query.strategyId ? { strategyId: query.strategyId } : {}),
        ...(query.ticker ? { ticker: query.ticker } : {}),
      });
      return { metrics };
    } catch (error) {
      return reply.code(500).send({ error: messageOf(error) });
    }
  });
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseOptionalInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseTags(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseTags(item));
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
}

function toSimulationConfig(input: unknown, fallback: SimulationConfig): SimulationConfig {
  const candidate = (input && typeof input === "object") ? (input as Partial<SimulationConfig>) : {};
  return {
    startDate: typeof candidate.startDate === "string" ? candidate.startDate : fallback.startDate,
    endDate: typeof candidate.endDate === "string" ? candidate.endDate : fallback.endDate,
    initialCapital: positiveNumber(candidate.initialCapital, fallback.initialCapital),
    commissionRate: nonNegativeNumber(candidate.commissionRate, fallback.commissionRate),
    slippageRate: nonNegativeNumber(candidate.slippageRate, fallback.slippageRate),
    ...(candidate.taStore ? { taStore: candidate.taStore } : fallback.taStore ? { taStore: fallback.taStore } : {}),
    ...(Array.isArray(candidate.tickers) ? { tickers: candidate.tickers } : fallback.tickers ? { tickers: fallback.tickers } : {}),
    ...(typeof candidate.regime === "string" ? { regime: candidate.regime } : {}),
    ...(Array.isArray(candidate.walkForwardWindows) ? { walkForwardWindows: candidate.walkForwardWindows } : {}),
  };
}

function positiveNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return fallback;
}

function toSimRun(result: SimulationResult): SimRun {
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

async function resolveStrategiesForBatch(
  store: StrategyStore,
  body: {
    strategyIds?: string[];
    strategyFilter?: { status?: Strategy["status"]; sector?: string; tags?: string[] };
  } | undefined,
): Promise<Strategy[]> {
  if (Array.isArray(body?.strategyIds) && body.strategyIds.length > 0) {
    const uniqueIds = [...new Set(body.strategyIds)];
    const loaded = await Promise.all(uniqueIds.map((id) => store.getStrategy(id)));
    return loaded.filter((item): item is Strategy => item !== null);
  }

  const filter = body?.strategyFilter;
  return store.listStrategies({
    ...(filter?.status ? { status: filter.status } : {}),
    ...(filter?.sector ? { sector: filter.sector } : {}),
    ...(filter?.tags && filter.tags.length > 0 ? { tags: filter.tags } : {}),
    limit: 500,
    offset: 0,
  });
}

function parseContextFromQuery(query: Record<string, unknown>, fallback: ContextFeatures): ContextFeatures {
  const policyFlags = parseContextPolicyFlags(query.policyFlags, fallback.policyFlags);
  const sectorMomentum = parseSectorMomentum(query.sectorMomentum, fallback.sectorMomentum);

  return {
    marketRegime: parseEnum(query.marketRegime, ["bull", "bear", "sideways"], fallback.marketRegime),
    volatilityState: parseEnum(query.volatilityState, ["high", "medium", "low"], fallback.volatilityState),
    sectorMomentum,
    seasonality: {
      month: boundedInt(query.month, fallback.seasonality.month, 1, 12),
      quarter: boundedInt(query.quarter, fallback.seasonality.quarter, 1, 4),
    },
    policyFlags,
    dayOfWeek: boundedInt(query.dayOfWeek, fallback.dayOfWeek, 0, 6),
  };
}

function parseEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value !== "string") {
    return fallback;
  }
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = parseOptionalInt(value);
  if (parsed === undefined) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function parseContextPolicyFlags(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  }
  return fallback;
}

function parseSectorMomentum(value: unknown, fallback: Record<string, number>): Record<string, number> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value).filter(([, item]) => typeof item === "number" && Number.isFinite(item));
    if (entries.length > 0) {
      return Object.fromEntries(entries) as Record<string, number>;
    }
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const entries = Object.entries(parsed).filter(([, item]) => typeof item === "number" && Number.isFinite(item));
        if (entries.length > 0) {
          return Object.fromEntries(entries) as Record<string, number>;
        }
      }
    } catch {
      return fallback;
    }
  }
  return fallback;
}

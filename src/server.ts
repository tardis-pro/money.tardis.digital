import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PostgresStore } from "./store-postgres.js";
import { JsonStore } from "./store.js";
import type { Store } from "./store.js";
import { DataQualityService } from "./services/data-quality.js";
import { AnomalyCorrelationService } from "./services/anomaly-correlation.js";
import { FeedbackService } from "./services/feedback.js";
import { GovernanceService } from "./services/governance.js";
import { HistoricalBackfillService } from "./services/historical-backfill.js";
import { LearningLoopService } from "./services/learning-loop.js";
import { ModelTrainingService } from "./services/model-training.js";
import { OutcomeService } from "./services/outcomes.js";
import { SignalPipelineService } from "./services/pipeline.js";
import { ScreeniPyService } from "./services/screenipy.js";
import { SourceRegistryService } from "./services/source-registry.js";
import { SourceReliabilityLoopService } from "./services/source-reliability-loop.js";
import { SupplyChainGraphService } from "./services/supply-chain-graph.js";
import { TerminalService } from "./services/terminal.js";

async function terminalHtml(): Promise<string> {
  return readFile(path.join(process.cwd(), "public/terminal.html"), "utf8");
}

const feedbackReviewSchema = z.object({
  reviewState: z.enum(["pending", "validated", "rejected"]),
});

const sourceReliabilitySchema = z.object({
  reliabilityTier: z.enum(["high", "medium", "low"]),
});

const sourceEnabledSchema = z.object({
  enabled: z.boolean(),
});

const outcomeInputSchema = z.object({
  signalId: z.string().min(1),
  realizedReturn: z.number().min(-1).max(1),
});

const outcomeSummaryQuerySchema = z.object({
  horizon: z.enum(["intraday", "1D", "1W"]).optional(),
});

const governanceInputSchema = z.object({
  category: z.enum(["source", "model", "pipeline"]),
  actor: z.string().min(1).default("system"),
  summary: z.string().min(3).max(1_000),
  rollbackReady: z.boolean(),
});

const screeniPyInputSchema = z.object({
  tickerOption: z.string().default("1"),
  executeOption: z.string().default("0"),
});

const modelTrainInputSchema = z.object({
  trainCsvPath: z.string().min(1),
  testCsvPath: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
});

const notableBackfillInputSchema = z.object({
  from: z.string().min(10).optional(),
  to: z.string().min(10).optional(),
  tickers: z.array(z.string().min(1)).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

const anomalyObservationSchema = z.object({
  at: z.string().min(10),
  close: z.number().positive(),
});

const anomalyInputSchema = z.object({
  ticker: z.string().min(1),
  observations: z.array(anomalyObservationSchema).optional(),
  windowSize: z.coerce.number().int().min(5).max(120).optional(),
  zThreshold: z.number().min(1.5).max(6).optional(),
  lookbackHours: z.coerce.number().int().min(1).max(720).optional(),
  maxMatches: z.coerce.number().int().min(1).max(10).optional(),
});

const supplyChainQuerySchema = z.object({
  watchlistId: z.string().optional(),
});

const backfillRunsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
});

async function makeStore(): Promise<Store> {
  if ((process.env.STORE_BACKEND ?? "json") === "postgres") {
    const store = new PostgresStore();
    await store.init();
    return store;
  }

  const store = new JsonStore();
  await store.init();
  return store;
}

async function buildServer() {
  const app = Fastify({ logger: true });
  const store = await makeStore();

  const registry = new SourceRegistryService(store);
  const pipeline = new SignalPipelineService(store);
  const terminal = new TerminalService(store);
  const feedback = new FeedbackService(store);
  const learning = new LearningLoopService(store);
  const outcomes = new OutcomeService(store);
  const dataQuality = new DataQualityService(store);
  const reliabilityLoop = new SourceReliabilityLoopService(store);
  const governance = new GovernanceService(store);
  const modelTraining = new ModelTrainingService();
  const screeniPy = new ScreeniPyService();
  const supplyChain = new SupplyChainGraphService(store);
  const backfill = new HistoricalBackfillService(store);
  const anomalyCorrelation = new AnomalyCorrelationService(store);

  app.get("/", async () => terminalHtml());

  app.get("/api/sources", async () => registry.list());

  app.post("/api/sources", async (request, reply) => {
    try {
      const created = await registry.add(request.body as Parameters<typeof registry.add>[0]);
      return reply.code(201).send(created);
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  app.post("/api/sources/:sourceId/reliability", async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    const parsed = sourceReliabilitySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    try {
      await registry.updateReliability(sourceId, parsed.data.reliabilityTier);
      await governance.log({
        category: "source",
        actor: "api",
        summary: `Updated reliability tier for ${sourceId} to ${parsed.data.reliabilityTier}`,
        rollbackReady: true,
      });
      return { ok: true };
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.post("/api/sources/:sourceId/enabled", async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    const parsed = sourceEnabledSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    try {
      const source = await registry.setEnabled(sourceId, parsed.data.enabled);
      await governance.log({
        category: "source",
        actor: "api",
        summary: `${parsed.data.enabled ? "Enabled" : "Disabled"} source ${sourceId}`,
        rollbackReady: true,
      });
      return source;
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.post("/api/ingest/run", async (request, reply) => {
    const querySchema = z.object({ sourceId: z.string().optional() });
    const parsedQuery = querySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({ error: parsedQuery.error.issues });
    }
    const result = await pipeline.run(parsedQuery.data.sourceId);
    return reply.send(result);
  });

  app.get("/api/signals", async (request, reply) => {
    const querySchema = z.object({ limit: z.coerce.number().int().positive().max(200).optional() });
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return terminal.topSignals(parsed.data.limit ?? 25);
  });

  app.get("/api/heatmap", async () => terminal.sectorHeatmap());

  app.get("/api/supply-chain-graph", async (request, reply) => {
    const parsed = supplyChainQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return supplyChain.buildGraph(parsed.data.watchlistId);
  });

  app.get("/api/watchlists", async () => terminal.watchlists());

  app.get("/api/watchlists/:watchlistId/signals", async (request) => {
    const { watchlistId } = request.params as { watchlistId: string };
    return terminal.signalsForWatchlist(watchlistId);
  });

  app.get("/api/sources/:sourceId/signals", async (request) => {
    const { sourceId } = request.params as { sourceId: string };
    return terminal.sourceDrillDown(sourceId);
  });

  app.get("/api/alerts", async () => {
    const state = await store.read();
    return [...state.alerts].sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
  });

  app.get("/api/audit/:signalId", async (request, reply) => {
    const { signalId } = request.params as { signalId: string };
    const state = await store.read();
    const rows = state.audits.filter((item) => item.signalId === signalId);
    if (rows.length === 0) {
      return reply.code(404).send({ error: "No audit rows found" });
    }
    return rows;
  });

  app.get("/api/feedback", async () => feedback.list());

  app.post("/api/feedback", async (request, reply) => {
    try {
      const created = await feedback.create(request.body as Parameters<typeof feedback.create>[0]);
      return reply.code(201).send(created);
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  app.post("/api/feedback/:feedbackId/review", async (request, reply) => {
    const { feedbackId } = request.params as { feedbackId: string };
    const parsed = feedbackReviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    try {
      return await feedback.setReviewState(feedbackId, parsed.data.reviewState);
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.post("/api/reliability/review", async () => {
    const report = await reliabilityLoop.runReview();
    if (report.actions.length > 0) {
      await governance.log({
        category: "pipeline",
        actor: "reliability-loop",
        summary: `Reliability loop applied ${report.actions.length} source adjustment(s)`,
        rollbackReady: true,
      });
    }
    return report;
  });

  app.get("/api/data-quality", async () => dataQuality.list());

  app.post("/api/data-quality/:issueId/resolve", async (request, reply) => {
    const { issueId } = request.params as { issueId: string };
    try {
      return await dataQuality.resolve(issueId);
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.post("/api/outcomes", async (request, reply) => {
    const parsed = outcomeInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    try {
      return await outcomes.record(parsed.data.signalId, parsed.data.realizedReturn);
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  app.get("/api/outcomes/summary", async (request, reply) => {
    const parsed = outcomeSummaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return outcomes.summary(parsed.data.horizon);
  });

  app.get("/api/governance", async () => governance.list());

  app.post("/api/governance", async (request, reply) => {
    const parsed = governanceInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    try {
      return await governance.log(parsed.data);
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  app.post("/api/learning/recalibrate", async () => {
    const report = await learning.runRecalibration();
    await governance.log({
      category: "model",
      actor: "learning-loop",
      summary: `Recalibration executed for model ${report.modelVersion}`,
      rollbackReady: true,
    });
    return report;
  });

  app.post("/api/screenipy/run", async (request, reply) => {
    const parsed = screeniPyInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    try {
      const rows = await screeniPy.run(parsed.data);
      return { count: rows.length, rows };
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  app.post("/api/model/train", async (request, reply) => {
    const parsed = modelTrainInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    try {
      const result = await modelTraining.train(parsed.data);
      await governance.log({
        category: "model",
        actor: "training-pipeline",
        summary: `Model trained with train file ${parsed.data.trainCsvPath}`,
        rollbackReady: true,
      });
      return result;
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  app.post("/api/backfill/notable", async (request, reply) => {
    const parsed = notableBackfillInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    try {
      const backfillInput = {
        ...(parsed.data.from ? { from: parsed.data.from } : {}),
        ...(parsed.data.to ? { to: parsed.data.to } : {}),
        ...(parsed.data.tickers ? { tickers: parsed.data.tickers } : {}),
        ...(parsed.data.limit ? { limit: parsed.data.limit } : {}),
      };
      const result = await backfill.run(backfillInput);
      await governance.log({
        category: "pipeline",
        actor: "historical-backfill",
        summary: `Backfill loaded ${result.seededSignals} historical signal(s)`,
        rollbackReady: true,
      });
      return result;
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  app.get("/api/backfill/runs", async (request, reply) => {
    const parsed = backfillRunsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    const state = await store.read();
    const limit = parsed.data.limit ?? 50;
    return [...state.backfillRuns]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  });

  app.post("/api/anomalies/correlate", async (request, reply) => {
    const parsed = anomalyInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    try {
      const anomalyInput = {
        ticker: parsed.data.ticker,
        ...(parsed.data.observations ? { observations: parsed.data.observations } : {}),
        ...(parsed.data.windowSize ? { windowSize: parsed.data.windowSize } : {}),
        ...(parsed.data.zThreshold ? { zThreshold: parsed.data.zThreshold } : {}),
        ...(parsed.data.lookbackHours ? { lookbackHours: parsed.data.lookbackHours } : {}),
        ...(parsed.data.maxMatches ? { maxMatches: parsed.data.maxMatches } : {}),
      };
      return await anomalyCorrelation.correlate(anomalyInput);
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  return app;
}

const port = Number(process.env.PORT ?? 3000);

const app = await buildServer();
await app.listen({ host: "0.0.0.0", port });

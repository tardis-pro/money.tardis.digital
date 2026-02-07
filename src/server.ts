import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { TerminalRoute } from "./types.js";
import historicalSources from "./config/historical-sources.json" with { type: "json" };
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
import { IdentityService } from "./services/identity.js";
import { StreamBusService } from "./services/stream-bus.js";
import { BackfillControlService } from "./services/backfill-control.js";
import { SourceDriftService } from "./services/source-drift.js";

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
  offset: z.coerce.number().int().min(0).optional(),
  batchSize: z.coerce.number().int().positive().max(500).optional(),
  persist: z.boolean().optional(),
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
  minEventScore: z.number().min(0).max(1).optional(),
  requireEvents: z.boolean().optional(),
});

const supplyChainQuerySchema = z.object({
  watchlistId: z.string().optional(),
});

const terminalCommandInputSchema = z.object({
  input: z.string().max(128),
});

const terminalCommandQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const identityRoleUpdateSchema = z.object({
  role: z.enum(["viewer", "analyst", "operator", "admin"]),
});

const streamReplayQuerySchema = z.object({
  fromSequence: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

const backfillReconcileQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
});

const backfillRunsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  status: z.enum(["running", "completed", "failed"]).optional(),
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
  const identity = new IdentityService(store);
  const streamBus = new StreamBusService(store);
  const backfillControl = new BackfillControlService(store);
  const sourceDrift = new SourceDriftService(store);

  function requestUserId(request: { headers: Record<string, unknown> }): string {
    const header = request.headers["x-user-id"];
    if (typeof header === "string" && header.trim().length > 0) {
      return header.trim();
    }
    return "demo-analyst";
  }

  async function ensureRouteAccess(
    request: { headers: Record<string, unknown> },
    reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } },
    route: TerminalRoute,
  ): Promise<{ allowed: true; userId: string } | { allowed: false; response: unknown }> {
    const userId = requestUserId(request);
    const user = await identity.getUser(userId);
    if (!user) {
      return {
        allowed: false,
        response: reply.code(401).send({ error: `Unknown user ${userId}` }),
      };
    }
    const auth = await identity.authorizeRoute(user, route);
    await identity.auditAccess({
      userId: user.id,
      role: user.role,
      action: "route.access",
      resource: route,
      allowed: auth.allowed,
      reason: auth.reason,
    });
    if (!auth.allowed) {
      await streamBus.publish({
        type: "identity.denied",
        payload: {
          userId: user.id,
          route,
          reason: auth.reason,
        },
      });
      return {
        allowed: false,
        response: reply.code(403).send({ error: auth.reason }),
      };
    }
    return { allowed: true, userId };
  }

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

  app.get("/api/sources/drift", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return sourceDrift.detect();
  });

  app.post("/api/ingest/run", async (request, reply) => {
    const querySchema = z.object({ sourceId: z.string().optional() });
    const parsedQuery = querySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({ error: parsedQuery.error.issues });
    }
    const result = await pipeline.run(parsedQuery.data.sourceId);
    await streamBus.publish({
      type: "pipeline.run.completed",
      payload: {
        ingested: result.ingested,
        producedSignals: result.producedSignals,
        alertsCreated: result.alertsCreated,
      },
    });
    return reply.send(result);
  });

  app.get("/api/signals", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    const querySchema = z.object({ limit: z.coerce.number().int().positive().max(200).optional() });
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    const user = await identity.requireUser(access.userId);
    return terminal.topSignals(parsed.data.limit ?? 25, user.sourceEntitlements);
  });

  app.get("/api/heatmap", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "heatmap");
    if (!access.allowed) {
      return access.response;
    }
    const user = await identity.requireUser(access.userId);
    return terminal.sectorHeatmap(user.sourceEntitlements);
  });

  app.get("/api/supply-chain-graph", async (request, reply) => {
    const parsed = supplyChainQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return supplyChain.buildGraph(parsed.data.watchlistId);
  });

  app.get("/api/watchlists", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "watchlists");
    if (!access.allowed) {
      return access.response;
    }
    return terminal.watchlists();
  });

  app.post("/api/terminal/command", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "overview");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = terminalCommandInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    const result = await terminal.runCommand(parsed.data.input);
    await streamBus.publish({
      type: "command.executed",
      payload: {
        route: result.route,
        status: result.status,
        latencyMs: result.latencyMs,
      },
    });
    return result;
  });

  app.get("/api/terminal/commands", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = terminalCommandQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return terminal.commandLogs(parsed.data.limit ?? 50);
  });

  app.get("/api/identity/me", async (request, reply) => {
    const userId = requestUserId(request);
    const user = await identity.getUser(userId);
    if (!user) {
      return reply.code(401).send({ error: `Unknown user ${userId}` });
    }
    return user;
  });

  app.get("/api/identity/users", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const user = await identity.requireUser(access.userId);
    const auth = await identity.authorizeRole(user, ["admin", "operator"]);
    await identity.auditAccess({
      userId: user.id,
      role: user.role,
      action: "identity.list-users",
      resource: "identity",
      allowed: auth.allowed,
      reason: auth.reason,
    });
    if (!auth.allowed) {
      return reply.code(403).send({ error: auth.reason });
    }
    return identity.listUsers();
  });

  app.post("/api/identity/users/:userId/role", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const caller = await identity.requireUser(access.userId);
    const roleCheck = await identity.authorizeRole(caller, ["admin"]);
    if (!roleCheck.allowed) {
      return reply.code(403).send({ error: roleCheck.reason });
    }
    const parsed = identityRoleUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    try {
      const { userId } = request.params as { userId: string };
      const updated = await identity.updateUserRole(userId, parsed.data);
      await streamBus.publish({
        type: "identity.updated",
        payload: {
          userId: updated.id,
          role: updated.role,
          actor: caller.id,
        },
      });
      return updated;
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.get("/api/access-audits", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return identity.listAccessAudits(100);
  });

  app.get("/api/stream/events", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = streamReplayQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return streamBus.replay(parsed.data.fromSequence, parsed.data.limit ?? 200);
  });

  app.get("/api/stream/health", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return streamBus.health();
  });

  app.get("/api/watchlists/:watchlistId/signals", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "watchlists");
    if (!access.allowed) {
      return access.response;
    }
    const { watchlistId } = request.params as { watchlistId: string };
    const user = await identity.requireUser(access.userId);
    return terminal.signalsForWatchlist(watchlistId, user.sourceEntitlements);
  });

  app.get("/api/sources/:sourceId/signals", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    const { sourceId } = request.params as { sourceId: string };
    const user = await identity.requireUser(access.userId);
    return terminal.sourceDrillDown(sourceId, user.sourceEntitlements);
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
      const change = await governance.log(parsed.data);
      await streamBus.publish({
        type: "governance.changed",
        payload: {
          category: change.category,
          actor: change.actor,
          rollbackReady: change.rollbackReady,
        },
      });
      return change;
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
        ...(parsed.data.offset !== undefined ? { offset: parsed.data.offset } : {}),
        ...(parsed.data.batchSize !== undefined ? { batchSize: parsed.data.batchSize } : {}),
        ...(parsed.data.persist !== undefined ? { persist: parsed.data.persist } : {}),
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

  app.post("/api/backfill/notable/preview", async (request, reply) => {
    const parsed = notableBackfillInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    try {
      const input = {
        ...(parsed.data.from ? { from: parsed.data.from } : {}),
        ...(parsed.data.to ? { to: parsed.data.to } : {}),
        ...(parsed.data.tickers ? { tickers: parsed.data.tickers } : {}),
        ...(parsed.data.limit ? { limit: parsed.data.limit } : {}),
        ...(parsed.data.offset !== undefined ? { offset: parsed.data.offset } : {}),
        ...(parsed.data.batchSize !== undefined ? { batchSize: parsed.data.batchSize } : {}),
      };
      return backfill.preview(input);
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
    const filtered = parsed.data.status
      ? state.backfillRuns.filter((run) => run.status === parsed.data.status)
      : state.backfillRuns;
    return [...filtered]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit)
      .map((run) => {
        const started = Date.parse(run.startedAt);
        const completed = run.completedAt ? Date.parse(run.completedAt) : null;
        const durationMs = Number.isFinite(started) && completed !== null && Number.isFinite(completed)
          ? Math.max(0, completed - started)
          : null;
        return { ...run, durationMs };
      });
  });

  app.get("/api/backfill/dashboard", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return backfillControl.dashboard();
  });

  app.get("/api/backfill/reconcile", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = backfillReconcileQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return backfillControl.reconcile(parsed.data.limit ?? 100);
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
        ...(parsed.data.minEventScore !== undefined ? { minEventScore: parsed.data.minEventScore } : {}),
        ...(parsed.data.requireEvents !== undefined ? { requireEvents: parsed.data.requireEvents } : {}),
      };
      return await anomalyCorrelation.correlate(anomalyInput);
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  app.get("/api/system/status", async () => {
    const state = await store.read();
    const completedBackfills = state.backfillRuns.filter((item) => item.status === "completed").length;
    const failedBackfills = state.backfillRuns.filter((item) => item.status === "failed").length;
    return {
      sources: state.sources.length,
      artifacts: state.artifacts.length,
      signals: state.signals.length,
      outcomes: state.outcomes.length,
      completedBackfills,
      failedBackfills,
      latestBackfill: state.backfillRuns[0] ?? null,
    };
  });

  app.get("/api/backfill/sources", async () => historicalSources);

  return app;
}

const port = Number(process.env.PORT ?? 3000);

const app = await buildServer();
await app.listen({ host: "0.0.0.0", port });

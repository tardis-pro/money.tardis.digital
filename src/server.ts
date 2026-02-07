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
import { MarketSnapshotService } from "./services/market-snapshot.js";
import { EntityLinkDiagnosticsService } from "./services/entity-link-diagnostics.js";
import { ChartingService } from "./services/charting.js";
import { ScreeningService } from "./services/screening.js";
import { AlertOrchestratorService } from "./services/alert-orchestrator.js";
import { PortfolioService } from "./services/portfolio.js";
import { RiskService } from "./services/risk.js";
import { AnomalyV3Service } from "./services/anomaly-v3.js";
import { ResearchService } from "./services/research.js";
import { GovernanceHardeningService } from "./services/governance-hardening.js";
import { SreService } from "./services/sre.js";
import { PersonalizationService } from "./services/personalization.js";

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

const marketSnapshotQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const entityLinkDiagnosticsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
});

const chartTemplateInputSchema = z.object({
  name: z.string().min(2).max(80),
  ticker: z.string().min(1).max(24),
  timeframe: z.enum(["intraday", "1D", "1W"]),
  overlays: z.array(z.string().min(1).max(40)).max(12),
  studies: z.array(z.string().min(1).max(40)).max(12),
});

const chartAnnotationsQuerySchema = z.object({
  ticker: z.string().min(1),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const screenCreateSchema = z.object({
  name: z.string().min(2).max(80),
  filters: z.object({
    minSignalScore: z.number().min(0).max(1),
    sectors: z.array(z.string().min(1).max(60)).max(20),
    minLiquidityScore: z.number().min(0).max(1),
    policyTags: z.array(z.string().min(1).max(60)).max(20),
  }),
  scheduleCron: z.string().min(5).max(80).nullable(),
  createdBy: z.string().min(1).max(64),
});

const discoveryFeedQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const alertRuleCreateSchema = z.object({
  name: z.string().min(2).max(80),
  watchlistId: z.string().min(1).max(64).nullable(),
  minScore: z.number().min(0).max(1),
  severity: z.enum(["low", "medium", "high"]),
  cooldownMinutes: z.number().int().min(1).max(240),
  escalationMinutes: z.number().int().min(1).max(1_440),
  suppressionWindowMinutes: z.number().int().min(0).max(1_440),
  channels: z.array(z.enum(["terminal", "email", "webhook"])).min(1).max(3),
  ownerUserId: z.string().min(1).max(64),
});

const alertRouteQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(300).optional(),
});

const portfolioCreateSchema = z.object({
  name: z.string().min(2).max(80),
  createdBy: z.string().min(1).max(64),
  positions: z.array(
    z.object({
      ticker: z.string().min(1).max(24),
      quantity: z.number().positive(),
      avgPrice: z.number().positive(),
      marketPrice: z.number().positive(),
    }),
  ).min(1),
});

const portfolioScenarioSchema = z.object({
  name: z.string().min(2).max(80),
  shockPct: z.number().min(-1).max(1),
  notes: z.string().min(1).max(400),
});

const riskPolicySchema = z.object({
  maxSingleNameWeight: z.number().min(0).max(1),
  maxSectorWeight: z.number().min(0).max(1),
  maxDrawdownPct: z.number().min(0).max(1),
  minLiquidityScore: z.number().min(0).max(1),
});

const riskSnapshotsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const anomalyOverrideSchema = z.object({
  anomalyId: z.string().min(1).max(64),
  ticker: z.string().min(1).max(24),
  actor: z.string().min(1).max(64),
  previousConfidence: z.number().min(0).max(1),
  overrideConfidence: z.number().min(0).max(1),
  reason: z.string().min(5).max(400),
});

const anomalyOverridesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const notebookSchema = z.object({
  page: z.string().min(1).max(80),
  title: z.string().min(2).max(120),
  content: z.string().min(5).max(20_000),
  author: z.string().min(1).max(64),
});

const queryTemplateSchema = z.object({
  name: z.string().min(2).max(120),
  command: z.string().min(2).max(500),
  owner: z.string().min(1).max(64),
});

const artifactCommentSchema = z.object({
  artifactId: z.string().min(1).max(120),
  comment: z.string().min(2).max(2_000),
  author: z.string().min(1).max(64),
});

const releaseGateSchema = z.object({
  gateName: z.string().min(2).max(80),
  actor: z.string().min(1).max(64),
  checks: z.array(z.string().min(2).max(120)).min(1).max(20),
});

const runbookSchema = z.object({
  name: z.string().min(2).max(120),
  severity: z.enum(["sev1", "sev2", "sev3"]),
  steps: z.array(z.string().min(4).max(400)).min(2).max(20),
  owner: z.string().min(1).max(64),
});

const sloSchema = z.object({
  subsystem: z.string().min(2).max(80),
  uptimeTarget: z.number().min(0).max(1),
  p95LatencyMsTarget: z.number().int().positive().max(60_000),
  errorBudgetPct: z.number().min(0).max(1),
  owner: z.string().min(1).max(64),
});

const chaosSchema = z.object({
  scenario: z.string().min(3).max(200),
  result: z.enum(["pass", "fail"]),
  mttrMinutes: z.number().int().min(0).max(10_000),
  owner: z.string().min(1).max(64),
});

const macroSchema = z.object({
  userId: z.string().min(1).max(64),
  name: z.string().min(2).max(80),
  commands: z.array(z.string().min(1).max(120)).min(1).max(20),
  reversible: z.boolean(),
});

const presetSchema = z.object({
  role: z.enum(["viewer", "analyst", "operator", "admin"]),
  name: z.string().min(2).max(80),
  routes: z.array(z.string().min(1).max(40)).min(1).max(20),
});

const onboardingSchema = z.object({
  userId: z.string().min(1).max(64),
  completedSteps: z.number().int().min(0).max(50),
  totalSteps: z.number().int().min(1).max(50),
  sessionMinutes: z.number().int().min(0).max(10_000),
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
  const marketSnapshot = new MarketSnapshotService(store);
  const entityLinkDiagnostics = new EntityLinkDiagnosticsService(store);
  const charting = new ChartingService(store);
  const screening = new ScreeningService(store);
  const alertOrchestrator = new AlertOrchestratorService(store);
  const portfolio = new PortfolioService(store);
  const risk = new RiskService(store);
  const anomalyV3 = new AnomalyV3Service(store);
  const research = new ResearchService(store);
  const governanceHardening = new GovernanceHardeningService(store);
  const sre = new SreService(store);
  const personalization = new PersonalizationService(store);

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

  app.get("/api/market/snapshots", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = marketSnapshotQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return marketSnapshot.snapshots(parsed.data.limit ?? 50);
  });

  app.get("/api/entity-links/diagnostics", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = entityLinkDiagnosticsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return entityLinkDiagnostics.summary(parsed.data.limit ?? 10);
  });

  app.post("/api/chart/templates", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = chartTemplateInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return charting.saveTemplate(parsed.data);
  });

  app.get("/api/chart/templates", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    return charting.templates();
  });

  app.get("/api/chart/annotations", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = chartAnnotationsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return charting.annotations(parsed.data.ticker, parsed.data.limit ?? 25);
  });

  app.post("/api/screens", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = screenCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return screening.saveScreen(parsed.data);
  });

  app.get("/api/screens", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    return screening.listScreens();
  });

  app.post("/api/screens/:screenId/run", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    const { screenId } = request.params as { screenId: string };
    try {
      return await screening.runScreen(screenId);
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.get("/api/discovery/feed", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = discoveryFeedQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return screening.discoveryFeed(parsed.data.limit ?? 50);
  });

  app.get("/api/screens/:screenId/diagnostics", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    const { screenId } = request.params as { screenId: string };
    try {
      return await screening.diagnostics(screenId);
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.post("/api/alert-rules", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "alerts");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = alertRuleCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return alertOrchestrator.saveRule(parsed.data);
  });

  app.get("/api/alert-rules", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "alerts");
    if (!access.allowed) {
      return access.response;
    }
    return alertOrchestrator.listRules();
  });

  app.post("/api/alerts/route", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "alerts");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = alertRouteQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return alertOrchestrator.routeAlerts(parsed.data.limit ?? 100);
  });

  app.get("/api/alerts/quality", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "alerts");
    if (!access.allowed) {
      return access.response;
    }
    return alertOrchestrator.quality();
  });

  app.post("/api/portfolios", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "watchlists");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = portfolioCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return portfolio.createPortfolio(parsed.data);
  });

  app.get("/api/portfolios", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "watchlists");
    if (!access.allowed) {
      return access.response;
    }
    return portfolio.listPortfolios();
  });

  app.get("/api/portfolios/:portfolioId/exposure", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "watchlists");
    if (!access.allowed) {
      return access.response;
    }
    const { portfolioId } = request.params as { portfolioId: string };
    try {
      return await portfolio.exposure(portfolioId);
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.get("/api/portfolios/:portfolioId/attribution", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "watchlists");
    if (!access.allowed) {
      return access.response;
    }
    const { portfolioId } = request.params as { portfolioId: string };
    try {
      return await portfolio.attribution(portfolioId);
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.post("/api/portfolios/:portfolioId/scenarios", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "watchlists");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = portfolioScenarioSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    const { portfolioId } = request.params as { portfolioId: string };
    try {
      return await portfolio.saveScenario({
        portfolioId,
        name: parsed.data.name,
        shockPct: parsed.data.shockPct,
        notes: parsed.data.notes,
      });
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.get("/api/portfolios/:portfolioId/scenarios", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "watchlists");
    if (!access.allowed) {
      return access.response;
    }
    const { portfolioId } = request.params as { portfolioId: string };
    return portfolio.listScenarios(portfolioId);
  });

  app.post("/api/portfolios/:portfolioId/risk-policy", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = riskPolicySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    const { portfolioId } = request.params as { portfolioId: string };
    try {
      return await risk.savePolicy({
        portfolioId,
        maxSingleNameWeight: parsed.data.maxSingleNameWeight,
        maxSectorWeight: parsed.data.maxSectorWeight,
        maxDrawdownPct: parsed.data.maxDrawdownPct,
        minLiquidityScore: parsed.data.minLiquidityScore,
      });
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.post("/api/portfolios/:portfolioId/risk-snapshot", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const { portfolioId } = request.params as { portfolioId: string };
    try {
      return await risk.snapshot(portfolioId);
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.get("/api/portfolios/:portfolioId/risk-snapshots", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = riskSnapshotsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    const { portfolioId } = request.params as { portfolioId: string };
    return risk.snapshots(portfolioId, parsed.data.limit ?? 50);
  });

  app.post("/api/anomalies/overrides", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = anomalyOverrideSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return anomalyV3.addOverride(parsed.data);
  });

  app.get("/api/anomalies/overrides", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = anomalyOverridesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return anomalyV3.listOverrides(parsed.data.limit ?? 100);
  });

  app.get("/api/anomalies/calibration", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return anomalyV3.calibration();
  });

  app.post("/api/research/notebooks", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = notebookSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return research.saveNotebook(parsed.data);
  });

  app.get("/api/research/notebooks", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    return research.list("notebook", 100);
  });

  app.post("/api/research/query-templates", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = queryTemplateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return research.saveQueryTemplate(parsed.data);
  });

  app.get("/api/research/query-templates", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    return research.list("query-template", 100);
  });

  app.post("/api/research/comments", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = artifactCommentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return research.addComment(parsed.data);
  });

  app.post("/api/research/evidence-pack/:signalId", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    const { signalId } = request.params as { signalId: string };
    try {
      return await research.evidencePack(signalId);
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.post("/api/governance/release-gates", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = releaseGateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return governanceHardening.saveReleaseGate(parsed.data);
  });

  app.post("/api/governance/runbooks", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = runbookSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return governanceHardening.saveRunbook(parsed.data);
  });

  app.get("/api/governance/policy-checks", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return governanceHardening.policyChecks();
  });

  app.get("/api/governance/release-gates", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return governanceHardening.list("release-gate", 100);
  });

  app.get("/api/governance/runbooks", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return governanceHardening.list("incident-runbook", 100);
  });

  app.post("/api/sre/slo-budgets", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = sloSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return sre.addSloBudget(parsed.data);
  });

  app.post("/api/sre/chaos-drills", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = chaosSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return sre.addChaosDrill(parsed.data);
  });

  app.get("/api/sre/slo-budgets", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return sre.list("slo-budget", 100);
  });

  app.get("/api/sre/chaos-drills", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return sre.list("chaos-drill", 100);
  });

  app.get("/api/sre/status", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return sre.status();
  });

  app.post("/api/workspace/macros", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = macroSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return personalization.saveMacro(parsed.data);
  });

  app.get("/api/workspace/macros", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return personalization.list("macro", 100);
  });

  app.post("/api/workspace/presets", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = presetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return personalization.savePreset(parsed.data);
  });

  app.get("/api/workspace/presets", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return personalization.list("workspace-preset", 100);
  });

  app.post("/api/workspace/onboarding", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = onboardingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return personalization.recordOnboarding(parsed.data);
  });

  app.get("/api/workspace/adoption", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return personalization.adoption();
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

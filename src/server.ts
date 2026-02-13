try { process.loadEnvFile(); } catch {}

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
import { RealNewsBackfillService } from "./services/real-news-backfill.js";
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
import { PilotService } from "./services/pilot.js";
import { LaunchService } from "./services/launch.js";
import { MitJsonStore } from "./mit-store.js";
import type { MitStore } from "./mit-store.js";
import { MitPostgresStore } from "./mit-store-postgres.js";
import { registerMitRoutes } from "./mit-routes.js";
import { TelegramNotificationService, type HeroAlertPayload } from "./services/telegram-notifier.js";
import { SurveillanceBot, getSurveillanceBot } from "./services/mit/surveillance-bot.js";
import { TelegramFeatureService, getTelegramFeatureService } from "./services/telegram-feature-service.js";
import { MitTradeManager } from "./services/mit/trade-manager.js";

const isDev = process.env.NODE_ENV !== "production";

async function getHtml() {
  const template = await readFile(path.join(process.cwd(), isDev ? "index.html" : "dist/client/index.html"), "utf-8");
  
  if (!isDev) {
    try {
      const ssr = await import(path.join(process.cwd(), "dist/server/entry-server.js"));
      const appHtml = ssr.renderApp();
      return template.replace("<!--SSR_CONTENT-->", appHtml);
    } catch {
      return template;
    }
  }
  
  return template;
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

const realBackfillInputSchema = z.object({
  from: z.string().min(10).optional(),
  to: z.string().min(10).optional(),
  query: z.string().min(3).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  batchSize: z.coerce.number().int().positive().max(250).optional(),
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
  channels: z.array(z.enum(["terminal", "email", "webhook", "telegram"])).min(1).max(3),
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

const pilotScorecardSchema = z.object({
  desk: z.string().min(2).max(80),
  latencyScore: z.number().min(0).max(1),
  trustScore: z.number().min(0).max(1),
  utilityScore: z.number().min(0).max(1),
  reviewer: z.string().min(1).max(64),
});

const pilotDefectSchema = z.object({
  title: z.string().min(3).max(140),
  severity: z.enum(["critical", "high", "medium", "low"]),
  status: z.enum(["open", "in-progress", "resolved"]),
  owner: z.string().min(1).max(64),
});

const launchChecklistSchema = z.object({
  item: z.string().min(3).max(160),
  owner: z.string().min(1).max(64),
  completed: z.boolean(),
  rollbackReady: z.boolean(),
});

const opsCadenceSchema = z.object({
  meeting: z.string().min(2).max(120),
  frequency: z.enum(["daily", "weekly", "bi-weekly", "monthly"]),
  owner: z.string().min(1).max(64),
  scope: z.string().min(3).max(300),
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
  const mitStore: MitStore = (process.env.STORE_BACKEND ?? "json") === "postgres"
    ? new MitPostgresStore()
    : new MitJsonStore();
  await mitStore.init();

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
  const realBackfill = new RealNewsBackfillService(store);
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
  const pilot = new PilotService(store);
  const launch = new LaunchService(store);

  function requestUserId(request: { headers: Record<string, unknown> }): string {
    const header = request.headers["x-user-id"];
    if (typeof header === "string" && header.trim().length > 0) {
      return header.trim();
    }
    return "demo-analyst";
  }

  const q1ReliabilityRouteCoverage: Array<{ method: "GET" | "POST"; path: string; entitlement: TerminalRoute }> = [
    { method: "GET", path: "/api/sources", entitlement: "system" },
    { method: "POST", path: "/api/sources", entitlement: "system" },
    { method: "POST", path: "/api/sources/:sourceId/reliability", entitlement: "system" },
    { method: "POST", path: "/api/sources/:sourceId/enabled", entitlement: "system" },
    { method: "POST", path: "/api/ingest/run", entitlement: "system" },
    { method: "GET", path: "/api/supply-chain-graph", entitlement: "supply-chain" },
    { method: "GET", path: "/api/alerts", entitlement: "alerts" },
    { method: "GET", path: "/api/audit/:signalId", entitlement: "signals" },
    { method: "GET", path: "/api/feedback", entitlement: "signals" },
    { method: "POST", path: "/api/feedback", entitlement: "signals" },
    { method: "POST", path: "/api/feedback/:feedbackId/review", entitlement: "system" },
    { method: "POST", path: "/api/reliability/review", entitlement: "system" },
    { method: "GET", path: "/api/data-quality", entitlement: "system" },
    { method: "POST", path: "/api/data-quality/:issueId/resolve", entitlement: "system" },
    { method: "POST", path: "/api/outcomes", entitlement: "signals" },
    { method: "GET", path: "/api/outcomes/summary", entitlement: "signals" },
    { method: "GET", path: "/api/governance", entitlement: "system" },
    { method: "POST", path: "/api/governance", entitlement: "system" },
    { method: "POST", path: "/api/learning/recalibrate", entitlement: "system" },
    { method: "POST", path: "/api/screenipy/run", entitlement: "system" },
    { method: "POST", path: "/api/model/train", entitlement: "system" },
    { method: "POST", path: "/api/backfill/notable", entitlement: "system" },
    { method: "POST", path: "/api/backfill/notable/preview", entitlement: "system" },
    { method: "POST", path: "/api/backfill/real", entitlement: "system" },
    { method: "GET", path: "/api/backfill/runs", entitlement: "system" },
    { method: "POST", path: "/api/anomalies/correlate", entitlement: "system" },
    { method: "GET", path: "/api/system/status", entitlement: "system" },
    { method: "GET", path: "/api/backfill/sources", entitlement: "system" },
  ];

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

  app.get("/", async (_request, reply) => {
    const html = await getHtml();
    return reply.type("text/html").send(html);
  });

  app.get("/terminal", async (_request, reply) => {
    try {
      const html = await readFile(path.join(process.cwd(), "dist/terminal/index.html"), "utf-8");
      return reply.type("text/html").send(html);
    } catch {
      return reply.code(404).send("Terminal not found - run npm run build:terminal");
    }
  });

  app.get("/terminal.html", async (_request, reply) => {
    try {
      const html = await readFile(path.join(process.cwd(), "dist/terminal/index.html"), "utf-8");
      return reply.type("text/html").send(html);
    } catch {
      return reply.code(404).send("Terminal not found - run npm run build:terminal");
    }
  });

  app.get("/api/sources", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return registry.list();
  });

  app.post("/api/sources", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    try {
      const created = await registry.add(request.body as Parameters<typeof registry.add>[0]);
      return reply.code(201).send(created);
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  app.post("/api/sources/:sourceId/reliability", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
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
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
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
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
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
    const access = await ensureRouteAccess(request, reply, "supply-chain");
    if (!access.allowed) {
      return access.response;
    }
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

  app.post("/api/pilot/scorecards", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = pilotScorecardSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return pilot.addScorecard(parsed.data);
  });

  app.post("/api/pilot/defects", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = pilotDefectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return pilot.addDefect(parsed.data);
  });

  app.get("/api/pilot/scorecards", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return pilot.list("pilot-scorecard", 200);
  });

  app.get("/api/pilot/defects", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return pilot.list("defect", 200);
  });

  app.get("/api/pilot/readiness", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return pilot.readiness();
  });

  app.post("/api/launch/checklist", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = launchChecklistSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return launch.addChecklistItem(parsed.data);
  });

  app.post("/api/launch/cadence", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = opsCadenceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return launch.addCadence(parsed.data);
  });

  app.get("/api/launch/checklist", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return launch.list("launch-checklist", 200);
  });

  app.get("/api/launch/cadence", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return launch.list("ops-cadence", 200);
  });

  app.get("/api/launch/status", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return launch.launchStatus();
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
    const access = await ensureRouteAccess(request, reply, "overview");
    if (!access.allowed) {
      return access.response;
    }
    return identity.requireUser(access.userId);
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

  app.get("/api/alerts", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "alerts");
    if (!access.allowed) {
      return access.response;
    }
    const state = await store.read();
    return [...state.alerts].sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
  });

  app.get("/api/audit/:signalId", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    const { signalId } = request.params as { signalId: string };
    const state = await store.read();
    const rows = state.audits.filter((item) => item.signalId === signalId);
    if (rows.length === 0) {
      return reply.code(404).send({ error: "No audit rows found" });
    }
    return rows;
  });

  app.get("/api/feedback", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    return feedback.list();
  });

  app.post("/api/feedback", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    try {
      const created = await feedback.create(request.body as Parameters<typeof feedback.create>[0]);
      return reply.code(201).send(created);
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  app.post("/api/feedback/:feedbackId/review", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
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

  app.post("/api/reliability/review", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
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

  app.get("/api/data-quality", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return dataQuality.list();
  });

  app.post("/api/data-quality/:issueId/resolve", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const { issueId } = request.params as { issueId: string };
    try {
      return await dataQuality.resolve(issueId);
    } catch (error) {
      return reply.code(404).send({ error: String(error) });
    }
  });

  app.post("/api/outcomes", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
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
    const access = await ensureRouteAccess(request, reply, "signals");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = outcomeSummaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    return outcomes.summary(parsed.data.horizon);
  });

  app.get("/api/governance", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return governance.list();
  });

  app.post("/api/governance", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
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

  app.post("/api/learning/recalibrate", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
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
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
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
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
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
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
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
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
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

  app.post("/api/backfill/real", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const parsed = realBackfillInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    try {
      const input = {
        ...(parsed.data.from ? { from: parsed.data.from } : {}),
        ...(parsed.data.to ? { to: parsed.data.to } : {}),
        ...(parsed.data.query ? { query: parsed.data.query } : {}),
        ...(parsed.data.offset !== undefined ? { offset: parsed.data.offset } : {}),
        ...(parsed.data.batchSize !== undefined ? { batchSize: parsed.data.batchSize } : {}),
        ...(parsed.data.persist !== undefined ? { persist: parsed.data.persist } : {}),
      };
      const result = await realBackfill.run(input);
      await governance.log({
        category: "pipeline",
        actor: "real-news-backfill",
        summary: `Real backfill loaded ${result.seededSignals} article-derived signal(s)`,
        rollbackReady: true,
      });
      return result;
    } catch (error) {
      return reply.code(400).send({ error: String(error) });
    }
  });

  app.get("/api/backfill/runs", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
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
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
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

  app.get("/api/system/status", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
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

  app.get("/api/system/route-coverage", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    const state = await store.read();
    const deniedAudits = state.accessAudits.filter((row) => !row.allowed);
    return {
      generatedAt: new Date().toISOString(),
      totalRoutes: q1ReliabilityRouteCoverage.length,
      routeEntitlements: q1ReliabilityRouteCoverage,
      deniedAccessCount: deniedAudits.length,
      lastDeniedAt: deniedAudits[0]?.createdAt ?? null,
    };
  });

  app.get("/api/backfill/sources", async (request, reply) => {
    const access = await ensureRouteAccess(request, reply, "system");
    if (!access.allowed) {
      return access.response;
    }
    return historicalSources;
  });

  // Register MIT routes inside a scoped plugin so the onRequest auth hook
  // only fires for /api/mit/* routes, not every route in the app.
  await app.register(async (scoped) => {
    scoped.addHook("onRequest", async (request, reply) => {
      const access = await ensureRouteAccess(request, reply, "mit");
      if (!access.allowed) {
        return access.response;
      }
    });
    registerMitRoutes(scoped, { mitStore, store });
  });

  // Telegram webhook for handling inline button callbacks and commands
  const telegramService = new TelegramNotificationService();
  const surveillanceBot = getSurveillanceBot();
  const featureService = getTelegramFeatureService();
  const tradeManager = new MitTradeManager();
  const telegramWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET ?? null;
  const allowedTelegramChatId = process.env.TELEGRAM_CHAT_ID ?? null;
  
  app.post("/api/telegram/webhook", async (request, reply) => {
    const body = request.body as { 
      callback_query?: { id: string; data?: string; message?: { chat?: { id: number } } };
      message?: { text?: string; chat?: { id: number } };
    };

    if (telegramWebhookSecret) {
      const header = request.headers["x-telegram-bot-api-secret-token"];
      const provided = typeof header === "string" ? header : Array.isArray(header) ? header[0] : undefined;
      if (!provided || provided !== telegramWebhookSecret) {
        return reply.code(403).send({ error: "Invalid webhook secret" });
      }
    }
    
    // Handle callback queries (button clicks)
    const callbackQuery = body.callback_query;
    if (callbackQuery) {
      const callbackData = callbackQuery.data;
      if (!callbackData) {
        await telegramService.answerCallbackQuery(callbackQuery.id, "No action data");
        return reply.code(200).send({ ok: true });
      }

      const separator = callbackData.indexOf(":");
      const action = separator >= 0 ? callbackData.slice(0, separator) : "";
      const callbackToken = separator >= 0 ? callbackData.slice(separator + 1) : "";
      if (!action || !callbackToken) {
        await telegramService.answerCallbackQuery(callbackQuery.id, "Invalid format");
        return reply.code(200).send({ ok: true });
      }

      const payload = telegramService.getHeroPayloadFromToken(callbackToken);
      if (!payload) {
        await telegramService.answerCallbackQuery(callbackQuery.id, "Invalid payload");
        return reply.code(200).send({ ok: true });
      }

      const callbackChatId = callbackQuery.message?.chat?.id;
      if (allowedTelegramChatId && callbackChatId !== undefined && String(callbackChatId) !== allowedTelegramChatId) {
        await telegramService.answerCallbackQuery(callbackQuery.id, "Unauthorized chat");
        return reply.code(200).send({ ok: true });
      }

      if (action === "hero_execute") {
        if (!(payload.buyPrice > payload.stopLoss)) {
          await telegramService.answerCallbackQuery(callbackQuery.id, "Invalid risk setup");
          return reply.code(200).send({ ok: true });
        }

        await telegramService.answerCallbackQuery(callbackQuery.id, `Executing ${payload.ticker}...`);

        const riskAmount = payload.buyPrice - payload.stopLoss;
        const qty = Math.max(1, Math.floor(10000 / riskAmount));

        const entered = await mitStore.transaction((draft) => tradeManager.enter(draft, {
          ticker: payload.ticker,
          feed: "nt-lite",
          entryPrice: payload.buyPrice,
          qty,
          stopLoss: payload.stopLoss,
          firstTarget: payload.target,
          notes: "telegram-hero-execute",
        }));

        if (!entered.ok) {
          await telegramService.answerCallbackQuery(callbackQuery.id, entered.reason ?? "Execution failed");
          return reply.code(200).send({ ok: true, action: "execute", success: false, reason: entered.reason });
        }

        await telegramService.notifyHeroExecuted(payload.ticker, payload.buyPrice, qty);
        
        return reply.code(200).send({ 
          ok: true, 
          action: "execute", 
          ticker: payload.ticker,
          buyPrice: payload.buyPrice,
          qty 
        });
      } 
      
      if (action === "hero_pass") {
        await telegramService.answerCallbackQuery(callbackQuery.id, `Trade passed for ${payload.ticker}`);
        await telegramService.notifyHeroRejected(payload.ticker);
        
        return reply.code(200).send({ 
          ok: true, 
          action: "pass", 
          ticker: payload.ticker 
        });
      }

      await telegramService.answerCallbackQuery(callbackQuery.id, "Unknown action");
      return reply.code(200).send({ ok: true });
    }
    
    // Handle commands (/why, /hero, /surveillance, /status)
    const message = body.message;
    if (message?.text) {
      const chatId = message.chat?.id;
      const command = message.text.split(" ")[0]?.toLowerCase();
      
      if (!chatId) {
        return reply.code(200).send({ ok: true });
      }

      if (allowedTelegramChatId && String(chatId) !== allowedTelegramChatId) {
        return reply.code(200).send({ ok: true });
      }
      
      if (command === "/why") {
        const mitState = await mitStore.read();
        const latest = [...mitState.dailyRuns].sort((a, b) => b.date.localeCompare(a.date))[0];
        
        if (!latest) {
          await telegramService.sendMessage("No analysis available. Run pipeline first.");
          return reply.code(200).send({ ok: true });
        }
        
        const validCandidates = latest.ideas.filter(idea => !idea.isAvoid && idea.entryExitPlan);
        if (validCandidates.length === 0) {
          await telegramService.sendMessage("No valid candidates available.");
          return reply.code(200).send({ ok: true });
        }
        
        const heroAnalysis = await (async () => {
          const { HeroAnalyst } = await import("./services/mit/hero-analyst.js");
          const { MarketDataService } = await import("./services/mit/market-data.js");
          
          const analyst = new HeroAnalyst();
          analyst.setMarketDataService(new MarketDataService());
          
          return await analyst.analyzeCandidates(validCandidates);
        })();
        
        if (!heroAnalysis?.heroPick) {
          await telegramService.sendMessage("Could not determine hero pick.");
          return reply.code(200).send({ ok: true });
        }
        
        const explanation = surveillanceBot.generateWhyExplanation(
          heroAnalysis.heroPick,
          heroAnalysis.allCandidates
        );
        
        await telegramService.sendMessage(explanation);
        return reply.code(200).send({ ok: true });
      }
      
      if (command === "/hero") {
        const mitState = await mitStore.read();
        const latest = [...mitState.dailyRuns].sort((a, b) => b.date.localeCompare(a.date))[0];
        
        if (!latest) {
          await telegramService.sendMessage("No analysis available. Run pipeline first.");
          return reply.code(200).send({ ok: true });
        }
        
        const validCandidates = latest.ideas.filter(idea => !idea.isAvoid && idea.entryExitPlan);
        if (validCandidates.length === 0) {
          await telegramService.sendMessage("No valid candidates available.");
          return reply.code(200).send({ ok: true });
        }
        
        const heroAnalysis = await (async () => {
          const { HeroAnalyst } = await import("./services/mit/hero-analyst.js");
          const { MarketDataService } = await import("./services/mit/market-data.js");
          
          const analyst = new HeroAnalyst();
          analyst.setMarketDataService(new MarketDataService());
          
          return await analyst.analyzeCandidates(validCandidates);
        })();
        
        if (!heroAnalysis?.heroPick) {
          await telegramService.sendMessage("Could not determine hero pick.");
          return reply.code(200).send({ ok: true });
        }
        
        const hero = heroAnalysis.heroPick;
        const plan = hero.candidate.entryExitPlan;
        
        const heroBrief = `🏆 HERO PICK: ${hero.symbol}
Score: ${hero.totalScore}/100

Why: ${hero.narrative}

Trade Details:
Buy @ ${plan.buyZoneHigh.toFixed(0)} | Stop @ ${plan.stopLoss.toFixed(0)} | Target @ ${plan.firstTarget.toFixed(0)}`;
        
        const payload: HeroAlertPayload = {
          ticker: hero.symbol,
          action: "execute",
          buyPrice: plan.buyZoneHigh,
          stopLoss: plan.stopLoss,
          target: plan.firstTarget,
          score: hero.totalScore,
        };
        
        await telegramService.sendHeroAlertWithButtons(heroBrief, payload);
        return reply.code(200).send({ ok: true });
      }
      
      if (command === "/surveillance" || command === "/status") {
        const mitState = await mitStore.read();
        
        const { MarketDataService } = await import("./services/mit/market-data.js");
        const marketDataService = new MarketDataService();
        
        await mitStore.transaction(async (draft) => {
          const latest: Record<string, number> = {};
          for (const pos of draft.portfolio.positions) {
            const candles = await marketDataService.fetchCandles(pos.ticker, 2).catch(() => []);
            const close = candles[candles.length - 1]?.close;
            if (close !== undefined) {
              latest[pos.ticker] = close;
            }
          }
          for (const pos of draft.portfolio.positions) {
            const currentPrice = latest[pos.ticker];
            if (currentPrice !== undefined) {
              pos.currentPrice = currentPrice;
              pos.unrealizedPnl = (currentPrice - pos.entryPrice) * pos.qty;
            }
          }
        });
        
        const updatedState = await mitStore.read();
        const status = surveillanceBot.getSurveillanceStatus(updatedState.portfolio);
        
        let statusMsg = `📊 *Surveillance Status*

🛡️ Kill Switch: ${status.killSwitch.triggered ? "⚠️ TRIGGERED" : "✅ OK"} (${status.killSwitch.lossPct.toFixed(2)}%)
📋 Blacklist: ${status.blacklist.length} stocks`;
        
        if (status.blacklist.length > 0) {
          statusMsg += "\n\n🚫 *Blacklisted:*";
          for (const entry of status.blacklist.slice(0, 5)) {
            statusMsg += `\n• ${entry.ticker} - ${entry.reason}`;
          }
        }
        
        const drifting = status.positions.filter(p => p.drifting);
        if (drifting.length > 0) {
          statusMsg += "\n\n⚠️ *Drifting Positions:*";
          for (const p of drifting) {
            statusMsg += `\n• ${p.ticker}: ${p.driftPct.toFixed(2)}%`;
          }
        }
        
        statusMsg += "\n\n💡 Say /hero for current pick";
        
        await telegramService.sendMessage(statusMsg);
        return reply.code(200).send({ ok: true });
      }
      
      if (command === "/help") {
        const helpText = featureService.generateHelpMessage();
        await telegramService.sendMessage(helpText);
        return reply.code(200).send({ ok: true });
      }
      
      if (command === "/extended") {
        const args = message.text.split(" ").slice(1);
        const requestedRank = parseInt(args[0] ?? "6", 10);
        
        const latest = [...(await mitStore.read()).dailyRuns].sort((a, b) => b.date.localeCompare(a.date))[0];
        if (!latest) {
          await telegramService.sendMessage("No analysis available. Run pipeline first.");
          return reply.code(200).send({ ok: true });
        }
        
        const validCandidates = latest.ideas.filter(idea => !idea.isAvoid && idea.entryExitPlan);
        if (validCandidates.length === 0) {
          await telegramService.sendMessage("No valid candidates available.");
          return reply.code(200).send({ ok: true });
        }
        
        const heroAnalysis = await (async () => {
          const { HeroAnalyst } = await import("./services/mit/hero-analyst.js");
          const { MarketDataService } = await import("./services/mit/market-data.js");
          
          const analyst = new HeroAnalyst();
          analyst.setMarketDataService(new MarketDataService());
          return await analyst.analyzeCandidates(validCandidates);
        })();
        
        if (!heroAnalysis?.allCandidates?.length) {
          await telegramService.sendMessage("Could not analyze candidates.");
          return reply.code(200).send({ ok: true });
        }
        
        const extended = featureService.getExtendedCandidates(heroAnalysis.allCandidates, heroAnalysis.allCandidates.length);
        
        if (requestedRank > extended.length) {
          await telegramService.sendMessage(`Only ${extended.length} candidates available. Rank ${requestedRank} not found.`);
          return reply.code(200).send({ ok: true });
        }
        
        if (requestedRank === 10 || args[0] === "10") {
          const table = featureService.formatTable(extended);
          await telegramService.sendMessage(table);
          return reply.code(200).send({ ok: true });
        }
        
        const candidate = extended.find(c => c.rank === requestedRank) ?? extended[requestedRank - 1];
        if (!candidate) {
          await telegramService.sendMessage(`Rank ${requestedRank} not found.`);
          return reply.code(200).send({ ok: true });
        }
        
        const extendedMsg = featureService.formatExtendedMessage(candidate);
        await telegramService.sendMessage(extendedMsg);
        return reply.code(200).send({ ok: true });
      }
      
      if (command === "/viz") {
        const args = message.text.split(" ").slice(1);
        const latest = [...(await mitStore.read()).dailyRuns].sort((a, b) => b.date.localeCompare(a.date))[0];
        if (!latest) {
          await telegramService.sendMessage("No analysis available. Run pipeline first.");
          return reply.code(200).send({ ok: true });
        }
        
        const state = await mitStore.read();
        let ticker1 = args[0]?.toUpperCase();
        let ticker2 = args[1]?.toUpperCase();
        
        if (!ticker1 || !ticker2) {
          const top2 = latest.ideas.filter(i => !i.isAvoid).slice(0, 2);
          ticker1 = top2[0]?.ticker ?? "RELIANCE";
          ticker2 = top2[1]?.ticker ?? "TCS";
        }
        
        const candles1 = state.candles[ticker1] ?? [];
        const candles2 = state.candles[ticker2] ?? [];
        
        const chart1Url = featureService.generatePriceChartUrl(ticker1, candles1);
        
        const validCandidates = latest.ideas.filter(idea => !idea.isAvoid && idea.entryExitPlan);
        const heroAnalysis = await (async () => {
          const { HeroAnalyst } = await import("./services/mit/hero-analyst.js");
          const { MarketDataService } = await import("./services/mit/market-data.js");
          const analyst = new HeroAnalyst();
          analyst.setMarketDataService(new MarketDataService());
          return await analyst.analyzeCandidates(validCandidates);
        })();
        
        const extended = heroAnalysis ? featureService.getExtendedCandidates(heroAnalysis.allCandidates, heroAnalysis.allCandidates.length) : [];
        const chart2Url = featureService.generateScoreBreakdownChartUrl(extended);
        
        const vizMessage = `📈 *Price Visualization*

Stocks: ${ticker1} vs ${ticker2}

[📊 View Price Chart](${chart1Url})
[📊 View Score Comparison](${chart2Url})

💡 Click links to view charts`;
        
        await telegramService.sendMessage(vizMessage);
        return reply.code(200).send({ ok: true });
      }
      
      if (command === "/export") {
        const latest = [...(await mitStore.read()).dailyRuns].sort((a, b) => b.date.localeCompare(a.date))[0];
        if (!latest) {
          await telegramService.sendMessage("No analysis available. Run pipeline first.");
          return reply.code(200).send({ ok: true });
        }
        
        const validCandidates = latest.ideas.filter(idea => !idea.isAvoid && idea.entryExitPlan);
        const heroAnalysis = await (async () => {
          const { HeroAnalyst } = await import("./services/mit/hero-analyst.js");
          const { MarketDataService } = await import("./services/mit/market-data.js");
          const analyst = new HeroAnalyst();
          analyst.setMarketDataService(new MarketDataService());
          return await analyst.analyzeCandidates(validCandidates);
        })();
        
        if (!heroAnalysis?.allCandidates?.length) {
          await telegramService.sendMessage("No candidates to export.");
          return reply.code(200).send({ ok: true });
        }
        
        const extended = featureService.getExtendedCandidates(heroAnalysis.allCandidates, heroAnalysis.allCandidates.length);
        const table = featureService.formatTable(extended);
        
        await telegramService.sendMessage(`📊 *Candidate Rankings*\n\n${table}\n\n💡 Full CSV available at: ${process.env.PUBLIC_URL ?? "http://localhost:3000"}/api/mit/export/watchlist.csv`);
        return reply.code(200).send({ ok: true });
      }
      
      if (command === "/table") {
        const latest = [...(await mitStore.read()).dailyRuns].sort((a, b) => b.date.localeCompare(a.date))[0];
        if (!latest) {
          await telegramService.sendMessage("No analysis available. Run pipeline first.");
          return reply.code(200).send({ ok: true });
        }
        
        const validCandidates = latest.ideas.filter(idea => !idea.isAvoid && idea.entryExitPlan);
        const heroAnalysis = await (async () => {
          const { HeroAnalyst } = await import("./services/mit/hero-analyst.js");
          const { MarketDataService } = await import("./services/mit/market-data.js");
          const analyst = new HeroAnalyst();
          analyst.setMarketDataService(new MarketDataService());
          return await analyst.analyzeCandidates(validCandidates);
        })();
        
        if (!heroAnalysis?.allCandidates?.length) {
          await telegramService.sendMessage("No candidates available.");
          return reply.code(200).send({ ok: true });
        }
        
        const extended = featureService.getExtendedCandidates(heroAnalysis.allCandidates, heroAnalysis.allCandidates.length);
        const table = featureService.formatTable(extended);
        await telegramService.sendMessage(table);
        return reply.code(200).send({ ok: true });
      }
      
      if (command === "/links") {
        const args = message.text.split(" ").slice(1);
        const ticker = args[0]?.toUpperCase();
        
        if (!ticker) {
          await telegramService.sendMessage("Usage: /links SYMBOL\nExample: /links TCS");
          return reply.code(200).send({ ok: true });
        }
        
        const linksMessage = featureService.generateLinksMessage(ticker);
        await telegramService.sendMessage(linksMessage);
        return reply.code(200).send({ ok: true });
      }
    }
    
    return reply.code(200).send({ ok: true });
  });

  return app;
}

const port = Number(process.env.PORT ?? 3000);

const app = await buildServer();
await app.listen({ host: "0.0.0.0", port });

console.log(`Server running at http://localhost:${port}`);
if (isDev) {
  console.log(`UI: Run 'bun vite' for Vite dev server at http://localhost:5173`);
}

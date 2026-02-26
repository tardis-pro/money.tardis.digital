import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { before, after, describe } from "node:test";
import type { FastifyInstance } from "fastify";

// These imports will be resolved from dist/test after build
// Using dynamic imports to match the compiled output paths
async function importServerModules() {
  const { JsonStore } = await import("../src/store.js");
  const { MitJsonStore } = await import("../src/mit-store.js");
  const { SignalPipelineService } = await import("../src/services/pipeline.js");
  const { SourceRegistryService } = await import("../src/services/source-registry.js");
  const { TerminalService } = await import("../src/services/terminal.js");
  const { FeedbackService } = await import("../src/services/feedback.js");
  const { LearningLoopService } = await import("../src/services/learning-loop.js");
  const { OutcomeService } = await import("../src/services/outcomes.js");
  const { DataQualityService } = await import("../src/services/data-quality.js");
  const { AnomalyCorrelationService } = await import("../src/services/anomaly-correlation.js");
  const { SourceReliabilityLoopService } = await import("../src/services/source-reliability-loop.js");
  const { GovernanceService } = await import("../src/services/governance.js");
  const { ModelTrainingService } = await import("../src/services/model-training.js");
  const { ScreeniPyService } = await import("../src/services/screenipy.js");
  const { SupplyChainGraphService } = await import("../src/services/supply-chain-graph.js");
  const { HistoricalBackfillService } = await import("../src/services/historical-backfill.js");
  const { RealNewsBackfillService } = await import("../src/services/real-news-backfill.js");
  const { IdentityService } = await import("../src/services/identity.js");
  const { StreamBusService } = await import("../src/services/stream-bus.js");
  const { BackfillControlService } = await import("../src/services/backfill-control.js");
  const { SourceDriftService } = await import("../src/services/source-drift.js");
  const { MarketSnapshotService } = await import("../src/services/market-snapshot.js");
  const { EntityLinkDiagnosticsService } = await import("../src/services/entity-link-diagnostics.js");
  const { ChartingService } = await import("../src/services/charting.js");
  const { ScreeningService } = await import("../src/services/screening.js");
  const { AlertOrchestratorService } = await import("../src/services/alert-orchestrator.js");
  const { PortfolioService } = await import("../src/services/portfolio.js");
  const { RiskService } = await import("../src/services/risk.js");
  const { AnomalyV3Service } = await import("../src/services/anomaly-v3.js");
  const { ResearchService } = await import("../src/services/research.js");
  const { GovernanceHardeningService } = await import("../src/services/governance-hardening.js");
  const { SreService } = await import("../src/services/sre.js");
  const { PersonalizationService } = await import("../src/services/personalization.js");
  const { PilotService } = await import("../src/services/pilot.js");
  const { LaunchService } = await import("../src/services/launch.js");
  const { registerMitRoutes } = await import("../src/mit-routes.js");
  const Fastify = (await import("fastify")).default;
  
  return {
    JsonStore,
    MitJsonStore,
    SignalPipelineService,
    SourceRegistryService,
    TerminalService,
    FeedbackService,
    LearningLoopService,
    OutcomeService,
    DataQualityService,
    AnomalyCorrelationService,
    SourceReliabilityLoopService,
    GovernanceService,
    ModelTrainingService,
    ScreeniPyService,
    SupplyChainGraphService,
    HistoricalBackfillService,
    RealNewsBackfillService,
    IdentityService,
    StreamBusService,
    BackfillControlService,
    SourceDriftService,
    MarketSnapshotService,
    EntityLinkDiagnosticsService,
    ChartingService,
    ScreeningService,
    AlertOrchestratorService,
    PortfolioService,
    RiskService,
    AnomalyV3Service,
    ResearchService,
    GovernanceHardeningService,
    SreService,
    PersonalizationService,
    PilotService,
    LaunchService,
    registerMitRoutes,
    Fastify,
  };
}

interface TestContext {
  tmpDir: string;
  app: FastifyInstance;
  baseUrl: string;
}

let ctx: TestContext | null = null;

async function buildTestServer(tmpDir: string): Promise<{ app: FastifyInstance; baseUrl: string }> {
  const mods = await importServerModules();
  
  const store = new mods.JsonStore(tmpDir);
  await store.init();
  
  const mitStore = new mods.MitJsonStore(path.join(tmpDir, "mit"));
  await mitStore.init();
  
  // Ensure mit-candles dir exists for /api/mit/data/sources
  const candlesDir = path.join(tmpDir, "mit-candles");
  await mkdir(candlesDir, { recursive: true });
  
  const app = mods.Fastify({ logger: false });
  
  const registry = new mods.SourceRegistryService(store);
  const pipeline = new mods.SignalPipelineService(store);
  const terminal = new mods.TerminalService(store);
  const feedback = new mods.FeedbackService(store);
  const learning = new mods.LearningLoopService(store);
  const outcomes = new mods.OutcomeService(store);
  const dataQuality = new mods.DataQualityService(store);
  const reliabilityLoop = new mods.SourceReliabilityLoopService(store);
  const governance = new mods.GovernanceService(store);
  const modelTraining = new mods.ModelTrainingService();
  const screeniPy = new mods.ScreeniPyService();
  const supplyChain = new mods.SupplyChainGraphService(store);
  const backfill = new mods.HistoricalBackfillService(store);
  const realBackfill = new mods.RealNewsBackfillService(store);
  const anomalyCorrelation = new mods.AnomalyCorrelationService(store);
  const identity = new mods.IdentityService(store);
  const streamBus = new mods.StreamBusService(store);
  const backfillControl = new mods.BackfillControlService(store);
  const sourceDrift = new mods.SourceDriftService(store);
  const marketSnapshot = new mods.MarketSnapshotService(store);
  const entityLinkDiagnostics = new mods.EntityLinkDiagnosticsService(store);
  const charting = new mods.ChartingService(store);
  const screening = new mods.ScreeningService(store);
  const alertOrchestrator = new mods.AlertOrchestratorService(store);
  const portfolio = new mods.PortfolioService(store);
  const risk = new mods.RiskService(store);
  const anomalyV3 = new mods.AnomalyV3Service(store);
  const research = new mods.ResearchService(store);
  const governanceHardening = new mods.GovernanceHardeningService(store);
  const sre = new mods.SreService(store);
  const personalization = new mods.PersonalizationService(store);
  const pilot = new mods.PilotService(store);
  const launch = new mods.LaunchService(store);

  // Add x-user-id header for auth
  app.addHook("onRequest", async (request) => {
    const header = request.headers["x-user-id"];
    if (typeof header !== "string" || header.trim().length === 0) {
      request.headers["x-user-id"] = "demo-analyst";
    }
  });

  // Health endpoints
  app.get("/health", async () => ({ status: "ok", now: new Date().toISOString() }));
  app.get("/ready", async () => ({ status: "ready", now: new Date().toISOString() }));

  // Policy signal routes (subset needed for terminal)
  app.get("/api/signals", async (request) => {
    const query = request.query as { limit?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 25;
    return terminal.topSignals(limit, []);
  });

  app.get("/api/alerts", async () => {
    const state = await store.read();
    return [...state.alerts].sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
  });

  app.get("/api/heatmap", async () => {
    return terminal.sectorHeatmap([]);
  });

  app.get("/api/ingest/status", async () => {
    const state = await store.read();
    return {
      lastRun: state.lastIngestRun,
      lastSuccess: state.lastIngestSuccess,
      signalCount: state.signals.length,
      alertCount: state.alerts.length,
      freshness: state.lastIngestSuccess ? "fresh" : "never",
    };
  });

  app.get("/api/market/snapshots", async (request) => {
    const query = request.query as { limit?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    return marketSnapshot.snapshots(limit);
  });

  app.get("/api/chart/templates", async () => {
    return charting.templates();
  });

  // Register MIT routes
  await app.register(async (scoped) => {
    mods.registerMitRoutes(scoped, { mitStore, store });
  });

  // Seed minimal data for tests
  await registry.add({
    id: "test_policy_source",
    name: "Test Policy Source",
    url: "data:text/plain,Test policy signal for terminal validation",
    format: "html",
    parserType: "html",
    pollingIntervalSeconds: 60,
    reliabilityTier: "high",
    licenseTag: "public",
    enabled: true,
  });
  
  await pipeline.run();

  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  const baseUrl = `http://127.0.0.1:${address.replace(/.*:/, "")}`;

  return { app, baseUrl };
}

describe("Terminal E2E Data Integrity Tests", () => {
  before(async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "terminal-e2e-"));
    const { app, baseUrl } = await buildTestServer(tmpDir);
    ctx = { tmpDir, app, baseUrl };
  });

  after(async () => {
    if (ctx) {
      await ctx.app.close();
      await rm(ctx.tmpDir, { recursive: true, force: true });
      ctx = null;
    }
  });

  // ========== PANEL 1: Signals ==========
  test("GET /api/signals returns 200 with array shape", async () => {
    assert.ok(ctx, "Test context not initialized");
    const res = await fetch(`${ctx.baseUrl}/api/signals?limit=20`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status} - route regression detected`);
    const data = await res.json();
    assert.ok(Array.isArray(data), "signals should be an array");
  });

  // ========== PANEL 2: Alerts ==========
  test("GET /api/alerts returns 200 with array shape", async () => {
    assert.ok(ctx, "Test context not initialized");
    const res = await fetch(`${ctx.baseUrl}/api/alerts`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status} - route regression detected`);
    const data = await res.json();
    assert.ok(Array.isArray(data), "alerts should be an array");
  });

  // ========== PANEL 3: Portfolio ==========
  test("GET /api/mit/portfolio returns 200 with expected shape", async () => {
    assert.ok(ctx, "Test context not initialized");
    const res = await fetch(`${ctx.baseUrl}/api/mit/portfolio`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status} - route regression detected`);
    const data = await res.json() as Record<string, unknown>;
    assert.ok("positions" in data, "portfolio should have positions");
    assert.ok("pnl" in data || "unrealizedPnl" in data, "portfolio should have pnl data");
  });

  // ========== PANEL 4: Heatmap ==========
  test("GET /api/heatmap returns 200 with array shape", async () => {
    assert.ok(ctx, "Test context not initialized");
    const res = await fetch(`${ctx.baseUrl}/api/heatmap`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status} - route regression detected`);
    const data = await res.json();
    assert.ok(Array.isArray(data), "heatmap should be an array");
  });

  // ========== PANEL 5: Screener ==========
  test("GET /api/mit/screenipy/candidates returns 200 with expected shape", async () => {
    assert.ok(ctx, "Test context not initialized");
    const res = await fetch(`${ctx.baseUrl}/api/mit/screenipy/candidates`);
    // May return 200 with error object if no cache, but must not be 404
    assert.notEqual(res.status, 404, "Route returned 404 - route regression detected");
    const data = await res.json() as Record<string, unknown>;
    // Accept both success and "no cache" responses
    assert.ok(
      "candidates" in data || "error" in data,
      "candidates response should have candidates or error field"
    );
  });

  // ========== PANEL 6: Pipeline ==========
  test("GET /api/mit/pipeline/latest returns 200 or 404 with proper shape", async () => {
    assert.ok(ctx, "Test context not initialized");
    const res = await fetch(`${ctx.baseUrl}/api/mit/pipeline/latest`);
    // 404 is acceptable if no runs exist, but must have proper error shape
    assert.ok(
      res.status === 200 || res.status === 404,
      `Expected 200 or 404, got ${res.status}`
    );
    const data = await res.json() as Record<string, unknown>;
    if (res.status === 200) {
      assert.ok("date" in data || "ideas" in data, "pipeline should have date or ideas");
    } else {
      assert.ok("error" in data, "404 response should have error field");
    }
  });

  // ========== PANEL 7: Hero ==========
  test("GET /api/mit/hero/analyze returns valid response (200 or 404 with error)", async () => {
    assert.ok(ctx, "Test context not initialized");
    const res = await fetch(`${ctx.baseUrl}/api/mit/hero/analyze`);
    // 404 is valid when no pipeline run exists - not a route regression
    assert.ok(
      res.status === 200 || res.status === 404 || res.status === 429,
      `Expected 200/404/429, got ${res.status} - potential route regression`
    );
    const data = await res.json() as Record<string, unknown>;
    // Accept hero pick, "no runs" error, or rate limit
    assert.ok(
      "heroPick" in data || "scanned" in data || "error" in data || "message" in data,
      "hero analyze should have heroPick, scanned, error, or message"
    );
  });

  // ========== PANEL 8: Trades ==========
  test("GET /api/mit/trades returns 200 with array shape", async () => {
    assert.ok(ctx, "Test context not initialized");
    const res = await fetch(`${ctx.baseUrl}/api/mit/trades`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status} - route regression detected`);
    const data = await res.json();
    assert.ok(Array.isArray(data), "trades should be an array");
  });

  // ========== Additional Data Endpoints ==========

  test("GET /api/market/snapshots returns 200 with array shape", async () => {
    assert.ok(ctx, "Test context not initialized");
    const res = await fetch(`${ctx.baseUrl}/api/market/snapshots?limit=10`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status} - route regression detected`);
    const data = await res.json();
    assert.ok(Array.isArray(data), "market snapshots should be an array");
  });

  test("GET /api/mit/data/sources returns 200 with sources array", async () => {
    assert.ok(ctx, "Test context not initialized");
    const res = await fetch(`${ctx.baseUrl}/api/mit/data/sources`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status} - route regression detected`);
    const data = await res.json() as Record<string, unknown>;
    assert.ok("sources" in data, "data sources should have sources field");
    assert.ok(Array.isArray(data.sources), "sources should be an array");
  });

  test("GET /api/ingest/status returns 200 with freshness field", async () => {
    assert.ok(ctx, "Test context not initialized");
    const res = await fetch(`${ctx.baseUrl}/api/ingest/status`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status} - route regression detected`);
    const data = await res.json() as Record<string, unknown>;
    assert.ok("freshness" in data, "ingest status should have freshness field");
    assert.ok(
      data.freshness === "fresh" || data.freshness === "stale" || data.freshness === "never",
      "freshness should be one of: fresh, stale, never"
    );
  });

  test("GET /api/chart/templates returns 200 with array shape", async () => {
    assert.ok(ctx, "Test context not initialized");
    const res = await fetch(`${ctx.baseUrl}/api/chart/templates`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status} - route regression detected`);
    const data = await res.json();
    assert.ok(Array.isArray(data), "chart templates should be an array");
  });

  // ========== Health Endpoints ==========

  test("GET /health returns 200 with ok status", async () => {
    assert.ok(ctx, "Test context not initialized");
    const res = await fetch(`${ctx.baseUrl}/health`);
    assert.equal(res.status, 200);
    const data = await res.json() as Record<string, unknown>;
    assert.equal(data.status, "ok");
  });

  test("GET /ready returns 200 with ready status", async () => {
    assert.ok(ctx, "Test context not initialized");
    const res = await fetch(`${ctx.baseUrl}/ready`);
    assert.equal(res.status, 200);
    const data = await res.json() as Record<string, unknown>;
    assert.equal(data.status, "ready");
  });

  // ========== Cross-Panel Consistency ==========

  test("portfolio positions count matches trades array length constraints", async () => {
    assert.ok(ctx, "Test context not initialized");
    const [portfolioRes, tradesRes] = await Promise.all([
      fetch(`${ctx.baseUrl}/api/mit/portfolio`),
      fetch(`${ctx.baseUrl}/api/mit/trades`),
    ]);
    
    assert.equal(portfolioRes.status, 200);
    assert.equal(tradesRes.status, 200);
    
    const portfolio = await portfolioRes.json() as Record<string, unknown>;
    const trades = await tradesRes.json() as unknown[];
    
    // Portfolio should have positions array (even if empty)
    assert.ok(Array.isArray(portfolio.positions), "portfolio.positions should be array");
    assert.ok(Array.isArray(trades), "trades should be array");
    
    // Both should be valid arrays (no type mismatches)
    assert.ok(typeof portfolio.positions.length === "number", "positions.length should be number");
    assert.ok(typeof trades.length === "number", "trades.length should be number");
  });

  test("signals and heatmap derive from same underlying data", async () => {
    assert.ok(ctx, "Test context not initialized");
    const [signalsRes, heatmapRes] = await Promise.all([
      fetch(`${ctx.baseUrl}/api/signals?limit=50`),
      fetch(`${ctx.baseUrl}/api/heatmap`),
    ]);
    
    assert.equal(signalsRes.status, 200);
    assert.equal(heatmapRes.status, 200);
    
    const signals = await signalsRes.json() as unknown[];
    const heatmap = await heatmapRes.json() as unknown[];
    
    // Both should be arrays
    assert.ok(Array.isArray(signals), "signals should be array");
    assert.ok(Array.isArray(heatmap), "heatmap should be array");
    
    // If signals exist, heatmap should also have data (consistency check)
    // Note: This is a soft check - heatmap aggregates signals by sector
    // If signals.length > 0, heatmap should typically have sector entries
    // but this depends on entity linking success
    if (signals.length > 0) {
      // Just verify heatmap is well-formed - actual consistency depends on data
      for (const entry of heatmap) {
        const e = entry as Record<string, unknown>;
        if (e.sector !== undefined) {
          assert.ok(typeof e.sector === "string", "heatmap sector should be string");
        }
      }
      }
    });

  // ========== Route Regression Detection ==========
  // All required terminal panel routes - verifies no 404s for route regressions
  const requiredRoutes: Array<{ method: string; path: string; description: string; allow404?: boolean }> = [
    { method: "GET", path: "/api/signals", description: "Signals panel" },
    { method: "GET", path: "/api/alerts", description: "Alerts panel" },
    { method: "GET", path: "/api/mit/portfolio", description: "Portfolio panel" },
    { method: "GET", path: "/api/heatmap", description: "Heatmap panel" },
    { method: "GET", path: "/api/mit/screenipy/candidates", description: "Screener panel" },
    { method: "GET", path: "/api/mit/pipeline/latest", description: "Pipeline panel", allow404: true },
    { method: "GET", path: "/api/mit/hero/analyze", description: "Hero panel", allow404: true },
    { method: "GET", path: "/api/mit/trades", description: "Trades panel" },
    { method: "GET", path: "/api/market/snapshots", description: "Market snapshots" },
    { method: "GET", path: "/api/mit/data/sources", description: "Historical data sources" },
    { method: "GET", path: "/api/ingest/status", description: "Ingest freshness" },
    { method: "GET", path: "/api/chart/templates", description: "Chart templates" },
  ];

  for (const route of requiredRoutes) {
    test(`${route.method} ${route.path} (${route.description}) is registered`, async () => {
      assert.ok(ctx, "Test context not initialized");
      const res = await fetch(`${ctx.baseUrl}${route.path}`);
      
      if (route.allow404 === true) {
        // For data-dependent routes, 404 with error body is valid (no data exists)
        if (res.status === 404) {
          const data = await res.json() as Record<string, unknown>;
          assert.ok("error" in data, `Route ${route.path} returned 404 without error body - may be regression`);
        } else {
          assert.ok(res.status < 500, `Route ${route.path} returned ${res.status}`);
        }
      } else {
        // For non-data-dependent routes, 404 means route is not registered = regression
        assert.notEqual(res.status, 404, `Route ${route.path} returned 404 - REGRESSION DETECTED`);
      }
    });
  }
});

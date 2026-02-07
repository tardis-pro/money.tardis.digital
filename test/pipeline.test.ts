import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { JsonStore } from "../src/store.js";
import { FeedbackService } from "../src/services/feedback.js";
import { GovernanceService } from "../src/services/governance.js";
import { AnomalyCorrelationService } from "../src/services/anomaly-correlation.js";
import { HistoricalBackfillService } from "../src/services/historical-backfill.js";
import { LearningLoopService } from "../src/services/learning-loop.js";
import { OutcomeService } from "../src/services/outcomes.js";
import { SignalPipelineService } from "../src/services/pipeline.js";
import { SourceRegistryService } from "../src/services/source-registry.js";
import { SourceReliabilityLoopService } from "../src/services/source-reliability-loop.js";
import { SupplyChainGraphService } from "../src/services/supply-chain-graph.js";
import { TerminalService } from "../src/services/terminal.js";
import { IdentityService } from "../src/services/identity.js";
import { StreamBusService } from "../src/services/stream-bus.js";
import { BackfillControlService } from "../src/services/backfill-control.js";
import { makeId, nowIso } from "../src/utils.js";
import { SourceDriftService } from "../src/services/source-drift.js";
import { MarketSnapshotService } from "../src/services/market-snapshot.js";
import { EntityLinkDiagnosticsService } from "../src/services/entity-link-diagnostics.js";
import { ChartingService } from "../src/services/charting.js";
import { ScreeningService } from "../src/services/screening.js";
import { AlertOrchestratorService } from "../src/services/alert-orchestrator.js";
import { PortfolioService } from "../src/services/portfolio.js";
import { RiskService } from "../src/services/risk.js";
import { AnomalyV3Service } from "../src/services/anomaly-v3.js";
import { ResearchService } from "../src/services/research.js";

test("pipeline run creates explainable signals with audit records", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();

    const registry = new SourceRegistryService(store);
    const source = await registry.add({
      id: "local_policy_feed",
      name: "Local Policy Feed",
      url: "data:text/plain,Policy incentive approved for railway capex expansion",
      format: "html",
      parserType: "html",
      pollingIntervalSeconds: 10,
      reliabilityTier: "high",
      licenseTag: "public",
      enabled: true,
    });

    const pipeline = new SignalPipelineService(store);
    const result = await pipeline.run(source.id);

    assert.equal(result.ingested, 1);
    assert.equal(result.producedSignals, 1);

    const state = await store.read();
    assert.equal(state.signals.length, 1);
    assert.equal(state.audits.length, 1);
    const firstSignal = state.signals[0];
    assert.ok(firstSignal);
    assert.ok(firstSignal.event.evidenceSnippet.length > 0);
    assert.ok(firstSignal.impact.rationale.length > 0);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("feedback review participates in recalibration report", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();

    const registry = new SourceRegistryService(store);
    const source = await registry.add({
      id: "local_tender_feed",
      name: "Local Tender Feed",
      url: "data:text/plain,Tender bid awarded for power infrastructure project",
      format: "html",
      parserType: "html",
      pollingIntervalSeconds: 10,
      reliabilityTier: "high",
      licenseTag: "public",
      enabled: true,
    });

    const pipeline = new SignalPipelineService(store);
    await pipeline.run(source.id);

    const state = await store.read();
    const firstSignal = state.signals[0];
    assert.ok(firstSignal);
    const signalId = firstSignal.id;

    const feedbackService = new FeedbackService(store);
    const feedback = await feedbackService.create({
      signalId,
      label: "useful",
      notes: "Direction matched expected policy impact",
    });
    await feedbackService.setReviewState(feedback.id, "validated");

    const learning = new LearningLoopService(store);
    const report = await learning.runRecalibration();

    assert.equal(report.validatedFeedback, 1);
    assert.equal(report.precisionUseful, 1);
    assert.ok(report.suggestedAction.length > 0);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("outcome loop, source reliability loop, and governance log work together", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();

    const registry = new SourceRegistryService(store);
    const source = await registry.add({
      id: "local_noise_feed",
      name: "Local Noisy Feed",
      url: "data:text/plain,Policy update with uncertain direction",
      format: "html",
      parserType: "html",
      pollingIntervalSeconds: 10,
      reliabilityTier: "high",
      licenseTag: "public",
      enabled: true,
    });

    const pipeline = new SignalPipelineService(store);
    await pipeline.run(source.id);
    const state = await store.read();
    const firstSignal = state.signals[0];
    assert.ok(firstSignal);
    const signalId = firstSignal.id;

    const outcomeService = new OutcomeService(store);
    await outcomeService.record(signalId, 0.012);
    const summary = await outcomeService.summary();
    assert.equal(summary.total, 1);
    assert.equal(summary.averageReturn, 0.012);

    const feedbackService = new FeedbackService(store);
    for (let i = 0; i < 3; i += 1) {
      const feedback = await feedbackService.create({
        signalId,
        label: "noise",
        notes: "High-noise observation",
      });
      await feedbackService.setReviewState(feedback.id, "validated");
    }

    const reliability = new SourceReliabilityLoopService(store);
    const report = await reliability.runReview();
    assert.equal(report.actions.length, 1);
    const action = report.actions[0];
    assert.ok(action);
    assert.equal(action.sourceId, source.id);
    assert.equal(action.fromTier, "high");
    assert.equal(action.toTier, "medium");
    assert.equal(action.quarantined, true);

    const postReview = await store.read();
    const updated = postReview.sources.find((item) => item.id === source.id);
    assert.ok(updated);
    assert.equal(updated?.enabled, false);

    const governance = new GovernanceService(store);
    await governance.log({
      category: "pipeline",
      actor: "test-suite",
      summary: "Reliability review applied quarantine",
      rollbackReady: true,
    });
    const changes = await governance.list();
    assert.equal(changes.length, 1);
    const firstChange = changes[0];
    assert.ok(firstChange);
    assert.equal(firstChange.actor, "test-suite");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("supply chain graph includes direct and indirect relationships", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();

    const graphService = new SupplyChainGraphService(store);
    const graph = await graphService.buildGraph();

    assert.ok(graph.nodes.length > 0);
    assert.ok(graph.edges.length > 0);
    assert.ok(graph.edges.some((edge) => edge.relation === "direct"));
    assert.ok(graph.edges.some((edge) => edge.relation === "indirect"));
    assert.ok(graph.edges.every((edge) => edge.propagationScore >= 0.25));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("historical notable-event backfill seeds signals across years", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();

    const backfill = new HistoricalBackfillService(store);
    const preview = backfill.preview({
      from: "2022-01-01T00:00:00.000Z",
      to: "2024-12-31T23:59:59.000Z",
      tickers: ["SBIN", "IRCTC"],
      batchSize: 1,
    });
    assert.equal(preview.batchSize, 1);
    assert.ok(preview.totalMatchingSeeds >= 1);

    const result = await backfill.run({
      from: "2022-01-01T00:00:00.000Z",
      to: "2024-12-31T23:59:59.000Z",
      tickers: ["SBIN", "IRCTC"],
      batchSize: 1,
    });

    assert.ok(result.loadedSeeds > 0);
    assert.ok(result.seededSignals > 0);
    assert.equal(result.status, "completed");
    const state = await store.read();
    assert.ok(state.signals.some((signal) => signal.linkedEntities.some((entity) => entity.ticker === "SBIN")));
    const run = state.backfillRuns.find((item) => item.id === result.runId);
    assert.ok(run);
    assert.equal(run?.status, "completed");
    assert.equal(run?.error, null);
    assert.equal(typeof result.hasMore, "boolean");
    assert.ok(result.nextOffset >= 1);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("anomaly correlation links return spikes to nearby events", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();

    const backfill = new HistoricalBackfillService(store);
    await backfill.run({
      from: "2022-01-01T00:00:00.000Z",
      to: "2025-12-31T23:59:59.000Z",
      tickers: ["SBIN"],
    });

    const anomaly = new AnomalyCorrelationService(store);
    const result = await anomaly.correlate({
      ticker: "SBIN",
      windowSize: 6,
      zThreshold: 2.0,
      lookbackHours: 240,
      minEventScore: 0.4,
      requireEvents: true,
      observations: [
        { at: "2024-12-05T10:00:00.000Z", close: 100 },
        { at: "2024-12-06T10:00:00.000Z", close: 99.7 },
        { at: "2024-12-07T10:00:00.000Z", close: 99.8 },
        { at: "2024-12-08T10:00:00.000Z", close: 99.6 },
        { at: "2024-12-09T10:00:00.000Z", close: 99.7 },
        { at: "2024-12-10T10:00:00.000Z", close: 99.6 },
        { at: "2024-12-11T10:00:00.000Z", close: 99.5 },
        { at: "2024-12-12T10:00:00.000Z", close: 106.8 },
      ],
    });

    assert.equal(result.ticker, "SBIN");
    assert.ok(result.clippedPoints >= 0);
    assert.ok(result.anomaliesWithEvents >= 1);
    assert.ok(result.totalEventLinks >= 1);
    assert.ok(result.anomalies.length >= 1);
    assert.ok(result.anomalies.some((item) => item.events.length > 0));
    const first = result.anomalies[0];
    assert.ok(first);
    assert.ok(first.baselineStdDev > 0);
    assert.equal(first.threshold, 2);
    assert.ok(first.events[0]?.components.signalWeight !== undefined);
    assert.ok(first.events.every((event) => event.score >= 0.4));
    assert.ok(result.anomalies.every((item) => item.events.length > 0));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("anomaly correlation rejects duplicate observation timestamps", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();
    const anomaly = new AnomalyCorrelationService(store);
    await assert.rejects(
      () =>
        anomaly.correlate({
          ticker: "SBIN",
          windowSize: 2,
          observations: [
            { at: "2024-12-05T10:00:00.000Z", close: 100 },
            { at: "2024-12-05T10:00:00.000Z", close: 101 },
            { at: "2024-12-06T10:00:00.000Z", close: 102 },
          ],
        }),
      /Duplicate observation timestamp/,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("historical backfill rejects inverted date range", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();
    const backfill = new HistoricalBackfillService(store);
    await assert.rejects(
      () =>
        backfill.run({
          from: "2025-01-01T00:00:00.000Z",
          to: "2024-01-01T00:00:00.000Z",
        }),
      /Invalid backfill range/,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("historical backfill dry-run does not mutate store state", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();
    const backfill = new HistoricalBackfillService(store);
    const result = await backfill.run({
      from: "2022-01-01T00:00:00.000Z",
      to: "2025-12-31T23:59:59.000Z",
      tickers: ["SBIN"],
      persist: false,
      batchSize: 2,
    });
    assert.equal(result.persisted, false);
    const state = await store.read();
    assert.equal(state.backfillRuns.length, 0);
    assert.equal(state.signals.length, 0);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("anomaly requireEvents can filter out weak matches", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();

    const backfill = new HistoricalBackfillService(store);
    await backfill.run({
      from: "2022-01-01T00:00:00.000Z",
      to: "2025-12-31T23:59:59.000Z",
      tickers: ["SBIN"],
      batchSize: 2,
    });

    const anomaly = new AnomalyCorrelationService(store);
    const result = await anomaly.correlate({
      ticker: "SBIN",
      windowSize: 6,
      zThreshold: 2,
      lookbackHours: 240,
      requireEvents: true,
      minEventScore: 0.95,
      observations: [
        { at: "2024-12-05T10:00:00.000Z", close: 100 },
        { at: "2024-12-06T10:00:00.000Z", close: 99.7 },
        { at: "2024-12-07T10:00:00.000Z", close: 99.8 },
        { at: "2024-12-08T10:00:00.000Z", close: 99.6 },
        { at: "2024-12-09T10:00:00.000Z", close: 99.7 },
        { at: "2024-12-10T10:00:00.000Z", close: 99.6 },
        { at: "2024-12-11T10:00:00.000Z", close: 99.5 },
        { at: "2024-12-12T10:00:00.000Z", close: 106.8 },
      ],
    });

    assert.equal(result.anomaliesWithEvents, 0);
    assert.equal(result.totalEventLinks, 0);
    assert.equal(result.anomalies.length, 0);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("terminal command parser dispatches routes and stores telemetry", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();

    const terminal = new TerminalService(store);
    const command = await terminal.runCommand("signals");
    assert.equal(command.status, "success");
    assert.equal(command.route, "signals");
    assert.ok(command.latencyMs >= 1);

    const empty = await terminal.runCommand("   ");
    assert.equal(empty.status, "error");
    assert.equal(empty.errorMessage, "Command cannot be empty");

    const logs = await terminal.commandLogs(10);
    assert.equal(logs.length, 2);
    assert.ok(logs.some((row) => row.status === "error" && row.errorMessage === "Command cannot be empty"));
    assert.ok(logs.some((row) => row.route === "signals" && row.status === "success"));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("identity authorization and stream bus replay provide S3/S4 baseline", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();
    const identity = new IdentityService(store);
    const streamBus = new StreamBusService(store);

    const viewer = await identity.requireUser("demo-viewer");
    const routeAuth = await identity.authorizeRoute(viewer, "signals");
    assert.equal(routeAuth.allowed, true);

    const sourceAuth = await identity.authorizeSource(viewer, "pib_press");
    assert.equal(sourceAuth.allowed, false);
    await identity.auditAccess({
      userId: viewer.id,
      role: viewer.role,
      action: "source.access",
      resource: "pib_press",
      allowed: sourceAuth.allowed,
      reason: sourceAuth.reason,
    });

    const published = await streamBus.publish({
      type: "identity.denied",
      payload: {
        userId: viewer.id,
        reason: sourceAuth.reason,
      },
    });
    assert.equal(published.sequence, 1);

    const replay = await streamBus.replay(0, 10);
    assert.equal(replay.length, 1);
    assert.equal(replay[0]?.type, "identity.denied");

    const health = await streamBus.health();
    assert.equal(health.latestSequence, 1);
    assert.ok(health.eventsLastMinute >= 1);

    const audits = await identity.listAccessAudits(10);
    assert.equal(audits.length, 1);
    assert.equal(audits[0]?.allowed, false);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("backfill control dashboard and reconciliation summarize run health", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();
    const backfill = new HistoricalBackfillService(store);
    await backfill.run({
      from: "2022-01-01T00:00:00.000Z",
      to: "2025-12-31T23:59:59.000Z",
      tickers: ["SBIN"],
      batchSize: 2,
    });
    await backfill.run({
      from: "2022-01-01T00:00:00.000Z",
      to: "2025-12-31T23:59:59.000Z",
      tickers: ["SBIN"],
      batchSize: 2,
    });

    const control = new BackfillControlService(store);
    const dashboard = await control.dashboard();
    assert.ok(dashboard.totalRuns >= 2);
    assert.ok(dashboard.completedRuns >= 2);
    assert.ok(dashboard.totalSkippedDuplicates >= 1);

    await store.transaction((state) => {
      const fetchedAt = nowIso();
      state.artifacts.push({
        id: makeId("artifact"),
        sourceId: "historical_notable_events",
        sourceUrl: "https://www.data.gov.in/",
        fetchedAt,
        contentHash: "manual-duplicate-hash",
        parserVersion: "parser-v1",
        modelVersion: "predictor-v1",
        contentType: "text/plain",
        bodyPath: `${tmpDir}/artifact-manual-a.txt`,
        metadata: {
          sourceName: "manual",
          parserType: "html",
        },
      });
      state.artifacts.push({
        id: makeId("artifact"),
        sourceId: "historical_notable_events",
        sourceUrl: "https://www.data.gov.in/",
        fetchedAt,
        contentHash: "manual-duplicate-hash",
        parserVersion: "parser-v1",
        modelVersion: "predictor-v1",
        contentType: "text/plain",
        bodyPath: `${tmpDir}/artifact-manual-b.txt`,
        metadata: {
          sourceName: "manual",
          parserType: "html",
        },
      });
    });

    const reconcile = await control.reconcile(20);
    assert.ok(reconcile.totalArtifacts >= 1);
    assert.ok(reconcile.duplicateGroups >= 1);
    assert.ok(reconcile.totalDuplicateArtifacts >= 1);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("source drift service ranks stale and fallback-prone feeds", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();

    await store.transaction((state) => {
      const oldTimestamp = "2020-01-01T00:00:00.000Z";
      state.artifacts.push({
        id: makeId("artifact"),
        sourceId: "businessline_rss",
        sourceUrl: "https://www.thehindubusinessline.com/feeder/default.rss",
        fetchedAt: oldTimestamp,
        contentHash: "old-feed",
        parserVersion: "parser-v1",
        modelVersion: "predictor-v1",
        contentType: "application/xml",
        bodyPath: `${tmpDir}/artifact-old-feed.txt`,
        metadata: {
          sourceName: "BusinessLine RSS",
          parserType: "rss",
        },
      });
      state.events.push({
        id: makeId("event"),
        artifactId: state.artifacts[0]?.id ?? "",
        sourceId: "businessline_rss",
        eventType: "news",
        title: "Fallback event",
        summary: "fallback payload due to fetch limitations",
        evidenceSnippet: "fallback payload",
        publishedAt: oldTimestamp,
        noveltyScore: 0.4,
        confidence: 0.4,
      });
    });

    const driftService = new SourceDriftService(store);
    const entries = await driftService.detect();
    assert.ok(entries.length > 0);
    const top = entries[0];
    assert.ok(top);
    assert.equal(top.sourceId, "businessline_rss");
    assert.ok(top.driftScore > 0);
    assert.ok(top.reasons.length > 0);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("market snapshot service returns adjustment-aware breadth snapshots", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();
    const pipeline = new SignalPipelineService(store);
    await pipeline.run();

    const service = new MarketSnapshotService(store);
    const rows = await service.snapshots(20);
    assert.ok(rows.length > 0);
    assert.ok(rows.some((row) => row.adjustmentFactor !== 1));
    assert.ok(rows.every((row) => Number.isFinite(row.adjustedPrice)));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("entity link diagnostics returns coverage and explainable reason trails", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();
    const pipeline = new SignalPipelineService(store);
    await pipeline.run();

    const diagnostics = new EntityLinkDiagnosticsService(store);
    const result = await diagnostics.summary(5);
    assert.ok(result.totalSignals > 0);
    assert.ok(result.coverageRatio > 0);
    assert.ok(result.averageEntityConfidence > 0);
    assert.ok(result.topEntityLinks.length > 0);
    const firstLink = result.topEntityLinks[0];
    assert.ok(firstLink);
    assert.ok(firstLink.reasons.length > 0);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("charting service stores templates and emits ticker annotations", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();
    const pipeline = new SignalPipelineService(store);
    await pipeline.run();

    const charting = new ChartingService(store);
    const template = await charting.saveTemplate({
      name: "SBIN Intraday Momentum",
      ticker: "SBIN",
      timeframe: "intraday",
      overlays: ["ema20", "vwap"],
      studies: ["rsi", "macd"],
    });
    assert.equal(template.ticker, "SBIN");

    const templates = await charting.templates();
    assert.ok(templates.length >= 1);

    const annotations = await charting.annotations("SBIN", 10);
    assert.ok(annotations.length >= 1);
    assert.ok(annotations.every((row) => row.ticker === "SBIN"));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("screening service supports saved screens, runs, discovery feed, and diagnostics", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();
    const pipeline = new SignalPipelineService(store);
    await pipeline.run();

    const screening = new ScreeningService(store);
    const screen = await screening.saveScreen({
      name: "Policy Momentum",
      filters: {
        minSignalScore: 0.4,
        sectors: [],
        minLiquidityScore: 0.2,
        policyTags: ["policy", "incentive"],
      },
      scheduleCron: "*/30 * * * *",
      createdBy: "demo-analyst",
    });
    assert.ok(screen.id.length > 0);

    const run = await screening.runScreen(screen.id);
    assert.equal(run.status, "completed");

    const feed = await screening.discoveryFeed(20);
    assert.ok(feed.length >= 1);

    const diag = await screening.diagnostics(screen.id);
    assert.ok(diag.totalRuns >= 1);
    assert.equal(diag.scheduled, true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("alert orchestrator supports rule routing and quality metrics", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();

    const registry = new SourceRegistryService(store);
    const source = await registry.add({
      id: "alert_test_source",
      name: "Alert Test Source",
      url: "data:text/plain,Policy incentive approved for heavy infrastructure funding",
      format: "html",
      parserType: "html",
      pollingIntervalSeconds: 10,
      reliabilityTier: "high",
      licenseTag: "public",
      enabled: true,
    });

    const pipeline = new SignalPipelineService(store);
    await pipeline.run(source.id);

    await store.transaction((state) => {
      const signal = state.signals.find((item) => item.sourceId === source.id);
      if (!signal) {
        throw new Error("Expected signal for alert orchestrator test");
      }
      state.alerts.push({
        id: makeId("alert"),
        signalId: signal.id,
        severity: "low",
        reason: "Synthetic alert for orchestration routing",
        triggeredAt: nowIso(),
      });
    });

    const orchestrator = new AlertOrchestratorService(store);
    await orchestrator.saveRule({
      name: "High Score Critical Route",
      watchlistId: null,
      minScore: 0.35,
      severity: "low",
      cooldownMinutes: 10,
      escalationMinutes: 1,
      suppressionWindowMinutes: 0,
      channels: ["terminal", "email"],
      ownerUserId: "demo-analyst",
    });

    const dispatches = await orchestrator.routeAlerts(30);
    assert.ok(dispatches.length >= 1);

    const quality = await orchestrator.quality();
    assert.ok(quality.totalAlerts >= 1);
    assert.ok(quality.dispatches >= 1);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("portfolio service supports exposure attribution and scenario bookmarks", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();
    const pipeline = new SignalPipelineService(store);
    await pipeline.run();

    const portfolioService = new PortfolioService(store);
    const portfolio = await portfolioService.createPortfolio({
      name: "Core Infra Book",
      createdBy: "demo-analyst",
      positions: [
        { ticker: "SBIN", quantity: 100, avgPrice: 720, marketPrice: 736 },
        { ticker: "LT", quantity: 40, avgPrice: 3200, marketPrice: 3290 },
      ],
    });
    assert.ok(portfolio.id.length > 0);

    const exposure = await portfolioService.exposure(portfolio.id);
    assert.ok(exposure.totalMarketValue > 0);
    assert.ok(exposure.sectorExposure.length > 0);

    const attribution = await portfolioService.attribution(portfolio.id);
    assert.equal(attribution.length, 2);

    const scenario = await portfolioService.saveScenario({
      portfolioId: portfolio.id,
      name: "Rate Shock -100bps",
      shockPct: -0.04,
      notes: "Stress policy-sensitive holdings",
    });
    assert.ok(scenario.id.length > 0);

    const scenarios = await portfolioService.listScenarios(portfolio.id);
    assert.equal(scenarios.length, 1);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("risk service enforces policy and produces reproducible snapshots", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();
    const portfolioService = new PortfolioService(store);
    const portfolio = await portfolioService.createPortfolio({
      name: "Risk Book",
      createdBy: "demo-operator",
      positions: [
        { ticker: "SBIN", quantity: 100, avgPrice: 750, marketPrice: 700 },
        { ticker: "LT", quantity: 20, avgPrice: 3500, marketPrice: 3300 },
      ],
    });

    const riskService = new RiskService(store);
    await riskService.savePolicy({
      portfolioId: portfolio.id,
      maxSingleNameWeight: 0.55,
      maxSectorWeight: 0.8,
      maxDrawdownPct: 0.03,
      minLiquidityScore: 0.4,
    });
    const snapshot = await riskService.snapshot(portfolio.id);
    assert.equal(snapshot.portfolioId, portfolio.id);
    assert.ok(snapshot.drawdownProxyPct >= 0);

    const rows = await riskService.snapshots(portfolio.id, 10);
    assert.equal(rows.length, 1);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("anomaly v3 service supports overrides and calibration reporting", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();
    const pipeline = new SignalPipelineService(store);
    await pipeline.run();

    await store.transaction((state) => {
      if (state.signals.length === 0) {
        return;
      }
      const signal = state.signals[0];
      if (!signal) {
        return;
      }
      state.outcomes.push({
        id: makeId("outcome"),
        signalId: signal.id,
        horizon: signal.impact.horizon,
        predictedDirection: signal.impact.direction,
        realizedReturn: 0.01,
        realizedDirection: "positive",
        matched: true,
        evaluatedAt: nowIso(),
      });
    });

    const service = new AnomalyV3Service(store);
    const override = await service.addOverride({
      anomalyId: "anomaly-001",
      ticker: "SBIN",
      actor: "demo-analyst",
      previousConfidence: 0.42,
      overrideConfidence: 0.71,
      reason: "Desk validated attribution with higher confidence",
    });
    assert.ok(override.id.length > 0);

    const overrides = await service.listOverrides(10);
    assert.equal(overrides.length, 1);

    const report = await service.calibration();
    assert.equal(report.points.length, 5);
    assert.ok(report.meanAbsoluteError >= 0);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("research service stores notebooks templates comments and evidence packs", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "signal-terminal-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();
    const pipeline = new SignalPipelineService(store);
    await pipeline.run();
    const state = await store.read();
    const signal = state.signals[0];
    assert.ok(signal);

    const research = new ResearchService(store);
    await research.saveNotebook({
      page: "signals",
      title: "Policy Event Notes",
      content: "Tracking policy momentum and linked entities.",
      author: "demo-analyst",
    });
    await research.saveQueryTemplate({
      name: "high-signal-policy",
      command: "signals --min-score 0.6 --tag policy",
      owner: "demo-analyst",
    });
    await research.addComment({
      artifactId: "artifact-1",
      comment: "Need verification from ministry bulletin.",
      author: "demo-analyst",
    });
    const pack = await research.evidencePack(signal!.id);
    assert.equal(pack.kind, "evidence-pack");

    const notebooks = await research.list("notebook", 10);
    assert.equal(notebooks.length, 1);
    const templates = await research.list("query-template", 10);
    assert.equal(templates.length, 1);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

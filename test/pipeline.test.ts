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

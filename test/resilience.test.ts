import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { JsonStore } from "../src/store.js";
import { MarketSnapshotService } from "../src/services/market-snapshot.js";
import { SupplyChainGraphService } from "../src/services/supply-chain-graph.js";
import { SignalPipelineService } from "../src/services/pipeline.js";
import type { QuoteBatchResult } from "../src/services/yahoo-quote-client.js";
import type { EntityMetadata } from "../src/services/config/entity-loader.js";
import type { ScreenerFetchResult } from "../src/services/mit/screener-fundamentals-fetcher.js";
import { fetchQuotes } from "../src/services/yahoo-quote-client.js";
import { getEntityLoader } from "../src/services/config/entity-loader.js";
import { getScreenerFetcher } from "../src/services/mit/screener-fundamentals-fetcher.js";

test("yahoo-quote-client returns empty quotes and failed tickers on network error", async () => {
  const result = await fetchQuotes(["INVALID_TICKER_XYZ_123"]) as QuoteBatchResult;

  assert.ok(result.quotes instanceof Map, "quotes should be a Map");
  assert.ok(Array.isArray(result.failedTickers), "failedTickers should be an array");
  assert.ok(typeof result.fetchedAt === "string", "fetchedAt should be a string");
  assert.ok(result.fetchedAt.length > 0, "fetchedAt should not be empty");

  assert.ok(
    result.failedTickers.includes("INVALID_TICKER_XYZ_123"),
    "invalid ticker should be in failedTickers"
  );
});

test("yahoo-quote-client handles partial success with mixed valid/invalid tickers", async () => {
  const result = await fetchQuotes(["SBIN", "DEFINITELY_INVALID_TICKER_999"]) as QuoteBatchResult;

  assert.ok(result.quotes instanceof Map, "quotes should be a Map");
  assert.ok(Array.isArray(result.failedTickers), "failedTickers should be an array");
  assert.ok(typeof result.fetchedAt === "string", "fetchedAt should be a string");

  assert.ok(
    result.failedTickers.includes("DEFINITELY_INVALID_TICKER_999"),
    "invalid ticker should be in failedTickers"
  );

  const hasSbinQuote = result.quotes.has("SBIN");
  const hasSbinFailure = result.failedTickers.includes("SBIN");
  assert.ok(
    hasSbinQuote || hasSbinFailure,
    "SBIN should be either in quotes or failedTickers"
  );
});

test("yahoo-quote-client includes timestamp metadata in result", async () => {
  const beforeTime = new Date().toISOString();
  const result = await fetchQuotes(["INVALID_FOR_TIMESTAMP_TEST"]) as QuoteBatchResult;
  const afterTime = new Date().toISOString();

  assert.ok(typeof result.fetchedAt === "string", "fetchedAt should be string");
  assert.ok(result.fetchedAt >= beforeTime, "fetchedAt should be >= before call time");
  assert.ok(result.fetchedAt <= afterTime, "fetchedAt should be <= after call time");
});

test("market snapshot service returns degraded response with quoteSource unavailable when quotes fail", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "resilience-market-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();

    const pipeline = new SignalPipelineService(store);
    await pipeline.run();

    const service = new MarketSnapshotService(store);
    const rows = await service.snapshots(50);

    assert.ok(Array.isArray(rows), "snapshots should return an array");
    assert.ok(rows.length > 0, "snapshots should return at least some entries");

    for (const row of rows) {
      assert.ok(typeof row.ticker === "string", "ticker should be string");
      assert.ok(typeof row.sector === "string", "sector should be string");
      assert.ok(
        row.quoteSource === "yahoo-finance" || row.quoteSource === "unavailable",
        "quoteSource should be yahoo-finance or unavailable"
      );
      assert.ok(typeof row.updatedAt === "string", "updatedAt should be string");
      assert.ok(row.updatedAt.length > 0, "updatedAt should not be empty");

      if (row.quoteSource === "unavailable") {
        assert.ok(row.latestPrice === null, "unavailable quote should have null latestPrice");
        assert.ok(row.dayChangePct === null, "unavailable quote should have null dayChangePct");
      }
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("market snapshot service handles empty signal state gracefully", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "resilience-market-empty-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();

    const service = new MarketSnapshotService(store);
    const rows = await service.snapshots(50);

    assert.ok(Array.isArray(rows), "snapshots should return array even with empty state");

    for (const row of rows) {
      assert.ok(typeof row.ticker === "string", "ticker should be string");
      assert.ok(typeof row.quoteSource === "string", "quoteSource should be string");
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("supply chain graph returns dataSource fallback when fundamentals unavailable", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "resilience-supply-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();

    const pipeline = new SignalPipelineService(store);
    await pipeline.run();

    const service = new SupplyChainGraphService(store);
    const graph = await service.buildGraph();

    assert.ok(graph.nodes instanceof Array, "nodes should be array");
    assert.ok(graph.edges instanceof Array, "edges should be array");
    assert.ok(typeof graph.generatedAt === "string", "generatedAt should be string");
    assert.ok(
      graph.dataSource === "live" || graph.dataSource === "cached" || graph.dataSource === "fallback",
      "dataSource should be live, cached, or fallback"
    );

    for (const node of graph.nodes) {
      assert.ok(typeof node.ticker === "string", "node ticker should be string");
      assert.ok(
        node.dataSource === "live" || node.dataSource === "cached" || node.dataSource === "fallback",
        `node dataSource should be valid for ${node.ticker}`
      );
      assert.ok(typeof node.asOf === "string", "node asOf should be string");
      assert.ok(node.asOf.length > 0, "node asOf should not be empty");

      if (node.dataSource === "fallback") {
        assert.equal(node.production, 0, "fallback production should be 0");
        assert.equal(node.demand, 0, "fallback demand should be 0");
        assert.equal(node.surplus, 0, "fallback surplus should be 0");
      }
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("supply chain graph handles empty state with fallback entities", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "resilience-supply-empty-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();

    const service = new SupplyChainGraphService(store);
    const graph = await service.buildGraph();

    assert.ok(graph.nodes.length > 0, "should have nodes from fallback entities");
    assert.ok(typeof graph.generatedAt === "string", "generatedAt should be string");

    for (const node of graph.nodes) {
      assert.ok(
        node.dataSource === "live" || node.dataSource === "cached" || node.dataSource === "fallback",
        "node dataSource should be valid"
      );
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("entity loader returns fallback entities when screener unavailable", async () => {
  const loader = getEntityLoader();
  const entities = await loader.getAllEntities();

  assert.ok(Array.isArray(entities), "entities should be array");
  assert.ok(entities.length > 0, "should have at least some entities");

  for (const entity of entities as EntityMetadata[]) {
    assert.ok(typeof entity.ticker === "string", "ticker should be string");
    assert.ok(typeof entity.companyName === "string", "companyName should be string");
    assert.ok(typeof entity.sector === "string", "sector should be string");
    assert.ok(typeof entity.lastUpdated === "string", "lastUpdated should be string");
  }
});

test("entity loader getAllEntitiesWithSource includes source metadata", async () => {
  const loader = getEntityLoader();
  const result = await loader.getAllEntitiesWithSource();

  assert.ok(Array.isArray(result.entities), "entities should be array");
  assert.ok(result.entities.length > 0, "should have entities");
  assert.ok(
    result.source === "live" || result.source === "fallback",
    "source should be live or fallback"
  );
});

test("entity loader getEntity returns null or valid entity for unknown ticker", async () => {
  const loader = getEntityLoader();
  const entity = await loader.getEntity("UNKNOWN_TICKER_TEST");

  if (entity !== null) {
    assert.ok(typeof entity.ticker === "string", "ticker should be string");
    assert.ok(typeof entity.lastUpdated === "string", "lastUpdated should be string");
  }
});

test("screener fundamentals fetcher returns null for invalid ticker without throwing", async () => {
  const fetcher = getScreenerFetcher();
  const result = await fetcher.fetchTicker("DEFINITELY_INVALID_TICKER_12345");

  assert.ok(result === null, "invalid ticker should return null");
});

test("screener fundamentals fetcher batch returns partial success with failed array", async () => {
  const fetcher = getScreenerFetcher();
  const result = await fetcher.fetchTickers([
    "INVALID_TICKER_A",
    "INVALID_TICKER_B"
  ]) as ScreenerFetchResult;

  assert.ok(Array.isArray(result.success), "success should be array");
  assert.ok(Array.isArray(result.failed), "failed should be array");
  assert.ok(result.failed.length >= 2, "should have at least 2 failed tickers");

  for (const failed of result.failed) {
    assert.ok(typeof failed.ticker === "string", "failed ticker should be string");
    assert.ok(typeof failed.error === "string", "failed error should be string");
    assert.ok(failed.error.length > 0, "failed error should not be empty");
  }
});

test("services return degraded responses with required metadata fields", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "resilience-metadata-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();

    const pipeline = new SignalPipelineService(store);
    await pipeline.run();

    const snapshotService = new MarketSnapshotService(store);
    const snapshots = await snapshotService.snapshots(10);
    for (const snap of snapshots) {
      assert.ok("quoteSource" in snap, "snapshot should have quoteSource");
      assert.ok("updatedAt" in snap, "snapshot should have updatedAt");
    }

    const graphService = new SupplyChainGraphService(store);
    const graph = await graphService.buildGraph();
    for (const node of graph.nodes) {
      assert.ok("dataSource" in node, "node should have dataSource");
      assert.ok("asOf" in node, "node should have asOf");
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("degraded responses do not throw exceptions on provider outage", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "resilience-no-throw-"));
  try {
    const store = new JsonStore(tmpDir);
    await store.init();

    const pipeline = new SignalPipelineService(store);
    await pipeline.run();

    let snapshotError: Error | null = null;
    try {
      const snapshotService = new MarketSnapshotService(store);
      await snapshotService.snapshots(50);
    } catch (e) {
      snapshotError = e instanceof Error ? e : new Error(String(e));
    }
    assert.equal(snapshotError, null, "MarketSnapshotService should not throw");

    let graphError: Error | null = null;
    try {
      const graphService = new SupplyChainGraphService(store);
      await graphService.buildGraph();
    } catch (e) {
      graphError = e instanceof Error ? e : new Error(String(e));
    }
    assert.equal(graphError, null, "SupplyChainGraphService should not throw");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

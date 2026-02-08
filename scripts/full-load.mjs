#!/usr/bin/env node

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const USER = "demo-analyst";

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json", "x-user-id": USER, ...(init.headers ?? {}) },
    ...init,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text}`);
  return text.length > 0 ? JSON.parse(text) : null;
}

async function main() {
  console.log("=== Full Data Load ===\n");

  // 1. Notable events (all 8 seeds)
  console.log("[1/3] Loading all notable event seeds...");
  const notable = await api("/api/backfill/notable", {
    method: "POST",
    body: JSON.stringify({ from: "2000-01-01T00:00:00.000Z", to: "2100-01-01T00:00:00.000Z", batchSize: 500 }),
  });
  console.log(`  seeds=${notable.loadedSeeds} signals=${notable.seededSignals} alerts=${notable.createdAlerts} skipped=${notable.skippedDuplicates}`);

  // 2. RSS/HTML source ingestion
  console.log("\n[2/3] Ingesting all enabled RSS/HTML sources...");
  const ingest = await api("/api/ingest/run", { method: "POST" });
  console.log(`  ingested=${ingest.ingested} signals=${ingest.producedSignals} alerts=${ingest.alertsCreated} sources=${ingest.sourcesProcessed}`);

  // 3. GDELT real-news backfill (auto-paginate)
  console.log("\n[3/3] GDELT real-news backfill (auto-paginating)...");
  let offset = 0;
  let totalSeeds = 0;
  let totalSignals = 0;
  let totalAlerts = 0;
  let totalSkipped = 0;
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    page += 1;
    process.stdout.write(`  page ${page} (offset ${offset})... `);
    try {
      const result = await api("/api/backfill/real", {
        method: "POST",
        body: JSON.stringify({
          from: "2023-01-01T00:00:00.000Z",
          to: new Date().toISOString(),
          batchSize: 250,
          offset,
        }),
      });
      totalSeeds += result.loadedSeeds;
      totalSignals += result.seededSignals;
      totalAlerts += result.createdAlerts;
      totalSkipped += result.skippedDuplicates;
      hasMore = result.hasMore;
      offset = result.nextOffset;
      console.log(`loaded=${result.loadedSeeds} signals=${result.seededSignals} hasMore=${result.hasMore}`);
    } catch (err) {
      console.log(`error: ${err.message}`);
      hasMore = false;
    }
  }

  console.log(`\n  GDELT totals: seeds=${totalSeeds} signals=${totalSignals} alerts=${totalAlerts} skipped=${totalSkipped}`);

  // Summary
  console.log("\n=== Summary ===");
  console.log(`Notable seeds:  ${notable.loadedSeeds} (${notable.skippedDuplicates} duplicates skipped)`);
  console.log(`RSS/HTML:       ${ingest.ingested} artifacts from ${ingest.sourcesProcessed} sources`);
  console.log(`GDELT:          ${totalSeeds} articles across ${page} pages`);
  console.log(`Total signals:  ${notable.seededSignals + ingest.producedSignals + totalSignals}`);
  console.log(`Total alerts:   ${notable.createdAlerts + ingest.alertsCreated + totalAlerts}`);
}

main().catch((err) => {
  console.error("\nFATAL:", err.message);
  process.exitCode = 1;
});

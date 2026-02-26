#!/usr/bin/env node
/**
 * Bulk-register all sources from sources.json into a running server.
 * Safe to re-run — skips sources that already exist.
 *
 * Usage:
 *   node scripts/seed-sources.mjs
 *   E2E_BASE_URL=http://localhost:3000 node scripts/seed-sources.mjs
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcesPath = join(__dirname, "../src/config/sources.json");
const sources = JSON.parse(readFileSync(sourcesPath, "utf-8"));

async function getExistingSources() {
  const res = await fetch(`${baseUrl}/api/sources`);
  if (!res.ok) throw new Error(`GET /api/sources failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function addSource(source) {
  const res = await fetch(`${baseUrl}/api/sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(source),
  });
  const text = await res.text();
  const body = text.length > 0 ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`POST /api/sources failed (${res.status}): ${text}`);
  }
  return body;
}

async function main() {
  console.log(`Seeding sources → ${baseUrl}`);

  let existing;
  try {
    existing = await getExistingSources();
  } catch (err) {
    console.error(`\n❌ Could not reach server at ${baseUrl}`);
    console.error(`   Make sure the server is running: npm run dev`);
    console.error(`   ${err.message}`);
    process.exit(1);
  }

  const existingIds = new Set(existing.map((s) => s.id));
  console.log(`Found ${existingIds.size} existing source(s): ${[...existingIds].join(", ") || "(none)"}\n`);

  const toAdd = sources.filter((s) => !existingIds.has(s.id));
  const skipped = sources.filter((s) => existingIds.has(s.id));

  if (skipped.length > 0) {
    console.log(`⏭  Skipping ${skipped.length} already-registered: ${skipped.map((s) => s.id).join(", ")}\n`);
  }

  if (toAdd.length === 0) {
    console.log("✅ All sources already registered. Nothing to do.");
    return;
  }

  console.log(`➕ Adding ${toAdd.length} new source(s)...\n`);

  let added = 0;
  let failed = 0;

  for (const source of toAdd) {
    try {
      await addSource(source);
      console.log(`  ✓ ${source.id.padEnd(28)} ${source.name}`);
      added++;
    } catch (err) {
      console.error(`  ✗ ${source.id.padEnd(28)} ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Done. Added: ${added}  Skipped: ${skipped.length}  Failed: ${failed}`);

  if (added > 0) {
    console.log(`\nRun an ingest to pull data from all new sources:`);
    console.log(`  curl -X POST ${baseUrl}/api/ingest/run`);
  }
}

main();

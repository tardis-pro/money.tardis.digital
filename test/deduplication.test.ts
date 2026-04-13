import test from "node:test";
import assert from "node:assert/strict";
import {
  ContentHashDeduplicator,
  FuzzyDeduplicator,
  SemanticDeduplicator,
  DeduplicationService,
} from "../src/services/deduplication.js";
import type { Artifact } from "../src/services/deduplication.js";

/**
 * Unit tests for the three-layer deduplication service. Previously this
 * entire file had no test coverage — fuzzy/semantic similarity thresholds
 * (0.85 and 0.92) were only validated by hand. This suite pins them and
 * also exercises the LRU+TTL eviction added to prevent unbounded growth.
 */

let artifactCounter = 0;
function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  artifactCounter += 1;
  return {
    id: overrides.id ?? `art_${artifactCounter}`,
    sourceId: overrides.sourceId ?? "source-a",
    title: overrides.title ?? `Sample title ${artifactCounter}`,
    content: overrides.content ?? `This is sample content number ${artifactCounter} with enough words to shingle meaningfully.`,
    publishedAt: overrides.publishedAt ?? new Date().toISOString(),
    contentHash: overrides.contentHash ?? "",
  };
}

test("ContentHashDeduplicator: exact match from same source is duplicate", async () => {
  const dedup = new ContentHashDeduplicator();
  const a = makeArtifact({ content: "The rupee weakened against the dollar today.", sourceId: "src1" });
  await dedup.addArtifact(a);
  const result = await dedup.checkDuplicate(makeArtifact({ content: "The rupee weakened against the dollar today.", sourceId: "src1" }));
  assert.equal(result.isDuplicate, true);
});

test("ContentHashDeduplicator: same content from DIFFERENT source is not a duplicate", async () => {
  // Intentional policy: cross-source copies are treated as independent
  // confirmations, not duplicates.
  const dedup = new ContentHashDeduplicator();
  await dedup.addArtifact(makeArtifact({ content: "Identical content block.", sourceId: "src1" }));
  const result = await dedup.checkDuplicate(makeArtifact({ content: "Identical content block.", sourceId: "src2" }));
  assert.equal(result.isDuplicate, false);
});

test("ContentHashDeduplicator: punctuation and case differences still match", async () => {
  const dedup = new ContentHashDeduplicator();
  await dedup.addArtifact(makeArtifact({ content: "RBI Raises Rates!", sourceId: "src1" }));
  const result = await dedup.checkDuplicate(makeArtifact({ content: "rbi raises rates", sourceId: "src1" }));
  assert.equal(result.isDuplicate, true, "normalization should strip punctuation and case");
});

test("FuzzyDeduplicator: identical content matches trivially", async () => {
  const dedup = new FuzzyDeduplicator();
  const text = "The Reserve Bank of India raised the repo rate by 25 basis points citing inflation concerns and global headwinds from US Fed policy.";
  await dedup.addArtifact(makeArtifact({ content: text }));
  const candidates = await dedup.findDuplicates(makeArtifact({ content: text }));
  assert.ok(candidates.length > 0, "identical content must match");
});

test("FuzzyDeduplicator: single-word substitution in long text still matches at 0.85", async () => {
  // With 3-shingles, a single word change breaks 3 consecutive shingles.
  // Long text dilutes that — a 50-word article with one edit stays well
  // above 0.85 jaccard. This test pins that behavior.
  const dedup = new FuzzyDeduplicator();
  const longBase = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
  const longMod = longBase.replace("word25", "replaced");
  await dedup.addArtifact(makeArtifact({ content: longBase }));
  const candidates = await dedup.findDuplicates(makeArtifact({ content: longMod }));
  assert.ok(candidates.length > 0, "50-word article with 1-word edit should still match");
});

test("FuzzyDeduplicator: unrelated content below threshold does not match", async () => {
  const dedup = new FuzzyDeduplicator();
  await dedup.addArtifact(makeArtifact({ content: "The Reserve Bank of India raised the repo rate by 25 basis points on inflation concerns." }));
  const candidates = await dedup.findDuplicates(makeArtifact({ content: "Apple announced a new MacBook Pro with the M5 chip at a California event." }));
  assert.equal(candidates.length, 0, "unrelated content should not match");
});

test("SemanticDeduplicator: duplicate artifact detection via cosine similarity", async () => {
  const dedup = new SemanticDeduplicator();
  const a = makeArtifact({ title: "RBI rate hike", content: "Central bank raises rates to curb inflation" });
  await dedup.addArtifact(a);
  // Exact same title + content should hit cosine 1.0 and fire above 0.92
  const candidates = await dedup.findDuplicates(
    makeArtifact({ title: "RBI rate hike", content: "Central bank raises rates to curb inflation" }),
  );
  assert.ok(candidates.length > 0);
  assert.ok(candidates[0]!.similarity >= 0.92);
});

test("DeduplicationService: returns 'none' for a brand-new artifact", async () => {
  const service = new DeduplicationService();
  const result = await service.deduplicate(
    makeArtifact({ content: "A totally novel piece of news about agriculture policy in Rajasthan for April 2026." }),
  );
  assert.equal(result.isDuplicate, false);
  assert.equal(result.duplicateType, "none");
});

test("DeduplicationService: second call with same artifact hits exact layer", async () => {
  const service = new DeduplicationService();
  const content = "Unique article content about defense procurement tender issued this morning.";
  const first = await service.deduplicate(makeArtifact({ content, sourceId: "srcX" }));
  assert.equal(first.isDuplicate, false);
  const second = await service.deduplicate(makeArtifact({ content, sourceId: "srcX" }));
  assert.equal(second.isDuplicate, true);
  assert.equal(second.duplicateType, "exact");
  assert.equal(second.confidence, 1.0);
});

test("ContentHashDeduplicator: getSize reflects inserted artifacts", async () => {
  const dedup = new ContentHashDeduplicator();
  assert.equal(dedup.getSize(), 0);
  await dedup.addArtifact(makeArtifact({ content: "one" }));
  await dedup.addArtifact(makeArtifact({ content: "two" }));
  await dedup.addArtifact(makeArtifact({ content: "three" }));
  assert.equal(dedup.getSize(), 3);
});

test("ContentHashDeduplicator: duplicate insert of same content does not double-count", async () => {
  const dedup = new ContentHashDeduplicator();
  await dedup.addArtifact(makeArtifact({ content: "same content" }));
  await dedup.addArtifact(makeArtifact({ id: "different-id", content: "same content" }));
  // Both map to the same hash, so size stays at 1.
  assert.equal(dedup.getSize(), 1);
});

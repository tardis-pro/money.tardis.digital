/**
 * Multi-Layer Deduplication Service
 * Implements content hash, fuzzy matching, and semantic similarity deduplication
 */

import crypto from 'crypto';

export interface DeduplicationResult {
  isDuplicate: boolean;
  duplicateType: 'exact' | 'fuzzy' | 'semantic' | 'none';
  existingArtifactId?: string;
  confidence: number;
  matchedTitle?: string;
  deduplicationTimeMs: number;
}

export interface DeduplicationRule {
  type: 'content' | 'fuzzy' | 'semantic';
  threshold: number;
  timeWindowHours: number;
}

export interface Artifact {
  id: string;
  sourceId: string;
  title: string;
  content: string;
  publishedAt: string;
  contentHash: string;
}

// Deduplication rules configuration
const DEFAULT_RULES: DeduplicationRule[] = [
  { type: 'content', threshold: 1.0, timeWindowHours: 24 },
  { type: 'fuzzy', threshold: 0.85, timeWindowHours: 72 },
  { type: 'semantic', threshold: 0.92, timeWindowHours: 168 }
];

// In-memory stores (replace with Redis in production)
interface ContentHashEntry {
  artifactId: string;
  hash: string;
  sourceId: string;
  publishedAt: string;
  title: string;
}

class ContentHashStore {
  private store: Map<string, ContentHashEntry> = new Map();

  get size(): number {
    return this.store.size;
  }

  set(hash: string, entry: ContentHashEntry): void {
    this.store.set(hash, entry);
  }

  get(hash: string): ContentHashEntry | undefined {
    return this.store.get(hash);
  }

  findByContent(content: string): ContentHashEntry | undefined {
    const hash = this.computeHash(content);
    return this.get(hash);
  }

  private computeHash(content: string): string {
    const normalized = this.normalizeContent(content);
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  private normalizeContent(content: string): string {
    return content
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim();
  }
}

/**
 * Layer 1: Content Hash Deduplication (Exact Match)
 */
export class ContentHashDeduplicator {
  private store: ContentHashStore;

  constructor(store?: ContentHashStore) {
    this.store = store || new ContentHashStore();
  }

  async checkDuplicate(artifact: Artifact): Promise<{
    isDuplicate: boolean;
    entry?: ContentHashEntry;
  }> {
    const entry = this.store.findByContent(artifact.content);
    
    if (entry && entry.sourceId === artifact.sourceId) {
      return { isDuplicate: true, entry };
    }
    
    return { isDuplicate: false };
  }

  async addArtifact(artifact: Artifact): Promise<void> {
    const normalizedContent = this.normalizeContent(artifact.content);
    const hash = crypto.createHash('sha256').update(normalizedContent).digest('hex');

    this.store.set(hash, {
      artifactId: artifact.id,
      hash,
      sourceId: artifact.sourceId,
      publishedAt: artifact.publishedAt,
      title: artifact.title
    });
  }

  private normalizeContent(content: string): string {
    return content
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim();
  }

  getStats(): { size: number } {
    return { size: this.store.size };
  }

  getSize(): number {
    return this.store.size;
  }
}

/**
 * Layer 2: Fuzzy Matching with MinHash LSH
 */
export class FuzzyDeduplicator {
  private store: Map<string, Artifact> = new Map();
  private readonly SIMILARITY_THRESHOLD = 0.85;

  async findDuplicates(artifact: Artifact): Promise<Artifact[]> {
    const candidates: Artifact[] = [];
    const shingles = this.generateShingles(artifact.content, 3);

    for (const [id, existing] of this.store) {
      const existingShingles = this.generateShingles(existing.content, 3);
      const similarity = this.computeJaccardSimilarity(shingles, existingShingles);

      if (similarity >= this.SIMILARITY_THRESHOLD) {
        candidates.push(existing);
      }
    }

    return candidates.sort((a, b) => {
      const aSim = this.computeJaccardSimilarity(shingles, this.generateShingles(a.content, 3));
      const bSim = this.computeJaccardSimilarity(shingles, this.generateShingles(b.content, 3));
      return bSim - aSim;
    });
  }

  async addArtifact(artifact: Artifact): Promise<void> {
    this.store.set(artifact.id, artifact);
  }

  private generateShingles(text: string, n: number): Set<string> {
    const words = this.normalizeContent(text).split(' ');
    const shingles = new Set<string>();
    
    for (let i = 0; i <= words.length - n; i++) {
      shingles.add(words.slice(i, i + n).join(' '));
    }
    
    return shingles;
  }

  private computeJaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
    if (set1.size === 0 && set2.size === 0) return 1;
    if (set1.size === 0 || set2.size === 0) return 0;

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  private normalizeContent(content: string): string {
    return content
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim();
  }

  getStats(): { size: number } {
    return { size: this.store.size };
  }
}

/**
 * Layer 3: Semantic Similarity with Embeddings
 * Note: In production, use a proper embedding model (e.g., OpenAI, HuggingFace)
 */
export class SemanticDeduplicator {
  private store: Map<string, { artifact: Artifact; embedding: number[] }> = new Map();
  private readonly SIMILARITY_THRESHOLD = 0.92;

  // Placeholder embedding function - replace with actual model in production
  private async generateEmbedding(text: string): Promise<number[]> {
    // Simple TF-IDF based embedding for demonstration
    // In production, use: sentence-transformers, OpenAI embeddings, or similar
    const words = this.normalizeContent(text).split(' ');
    const embedding = new Array(100).fill(0);
    
    // Hash-based vectorization
    words.forEach((word, idx) => {
      const hash = this.hashString(word);
      const position = hash % 100;
      embedding[position] += 1 / (idx + 1);
    });

    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= magnitude;
      }
    }

    return embedding;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  async findDuplicates(artifact: Artifact): Promise<{ artifact: Artifact; similarity: number }[]> {
    const embedding = await this.generateEmbedding(`${artifact.title} ${artifact.content}`);
    const candidates: { artifact: Artifact; similarity: number }[] = [];

    for (const [id, entry] of this.store) {
      const similarity = this.cosineSimilarity(embedding, entry.embedding);
      
      if (similarity >= this.SIMILARITY_THRESHOLD) {
        candidates.push({ artifact: entry.artifact, similarity });
      }
    }

    return candidates.sort((a, b) => b.similarity - a.similarity);
  }

  async addArtifact(artifact: Artifact): Promise<void> {
    const embedding = await this.generateEmbedding(`${artifact.title} ${artifact.content}`);
    this.store.set(artifact.id, { artifact, embedding });
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      const aVal = a[i] ?? 0;
      const bVal = b[i] ?? 0;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }
    
    if (normA === 0 || normB === 0) return 0;
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private normalizeContent(content: string): string {
    return content
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim();
  }

  getStats(): { size: number } {
    return { size: this.store.size };
  }
}

/**
 * Main Deduplication Service coordinating all layers
 */
export class DeduplicationService {
  private contentDeduplicator: ContentHashDeduplicator;
  private fuzzyDeduplicator: FuzzyDeduplicator;
  private semanticDeduplicator: SemanticDeduplicator;
  private rules: DeduplicationRule[];

  constructor(
    contentStore?: ContentHashStore,
    rules: DeduplicationRule[] = DEFAULT_RULES
  ) {
    this.contentDeduplicator = new ContentHashDeduplicator(contentStore);
    this.fuzzyDeduplicator = new FuzzyDeduplicator();
    this.semanticDeduplicator = new SemanticDeduplicator();
    this.rules = rules;
  }

  async deduplicate(artifact: Artifact): Promise<DeduplicationResult> {
    const startTime = Date.now();

    // Layer 1: Content Hash (Exact Match)
    const contentResult = await this.contentDeduplicator.checkDuplicate(artifact);
    if (contentResult.isDuplicate && contentResult.entry) {
      return {
        isDuplicate: true,
        duplicateType: 'exact',
        existingArtifactId: contentResult.entry.artifactId,
        confidence: 1.0,
        matchedTitle: contentResult.entry.title,
        deduplicationTimeMs: Date.now() - startTime
      };
    }

    // Layer 2: Fuzzy Matching (Shingling + Jaccard)
    const fuzzyCandidates = await this.fuzzyDeduplicator.findDuplicates(artifact);
    if (fuzzyCandidates.length > 0) {
      const bestMatch = fuzzyCandidates[0]!;
      const shingles1 = this.generateShingles(artifact.content, 3);
      const shingles2 = this.generateShingles(bestMatch.content, 3);
      const confidence = this.computeJaccardSimilarity(shingles1, shingles2);

      return {
        isDuplicate: true,
        duplicateType: 'fuzzy',
        existingArtifactId: bestMatch.id,
        confidence,
        matchedTitle: bestMatch.title,
        deduplicationTimeMs: Date.now() - startTime
      };
    }

    // Layer 3: Semantic Similarity
    const semanticCandidates = await this.semanticDeduplicator.findDuplicates(artifact);
    if (semanticCandidates.length > 0) {
      const bestMatch = semanticCandidates[0]!;
      return {
        isDuplicate: true,
        duplicateType: 'semantic',
        existingArtifactId: bestMatch.artifact.id,
        confidence: bestMatch.similarity,
        matchedTitle: bestMatch.artifact.title,
        deduplicationTimeMs: Date.now() - startTime
      };
    }

    // No duplicate found - add to all stores for future comparisons
    await Promise.all([
      this.contentDeduplicator.addArtifact(artifact),
      this.fuzzyDeduplicator.addArtifact(artifact),
      this.semanticDeduplicator.addArtifact(artifact)
    ]);

    return {
      isDuplicate: false,
      duplicateType: 'none',
      confidence: 0,
      deduplicationTimeMs: Date.now() - startTime
    };
  }

  async addArtifact(artifact: Artifact): Promise<void> {
    await Promise.all([
      this.contentDeduplicator.addArtifact(artifact),
      this.fuzzyDeduplicator.addArtifact(artifact),
      this.semanticDeduplicator.addArtifact(artifact)
    ]);
  }

  private generateShingles(text: string, n: number): Set<string> {
    const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
    const shingles = new Set<string>();
    
    for (let i = 0; i <= words.length - n; i++) {
      shingles.add(words.slice(i, i + n).join(' '));
    }
    
    return shingles;
  }

  private computeJaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
    if (set1.size === 0 && set2.size === 0) return 1;
    if (set1.size === 0 || set2.size === 0) return 0;

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  getStats(): { content: { size: number }; fuzzy: { size: number }; semantic: { size: number } } {
    return {
      content: this.contentDeduplicator.getStats(),
      fuzzy: this.fuzzyDeduplicator.getStats(),
      semantic: this.semanticDeduplicator.getStats()
    };
  }
}

// Singleton instance
let deduplicationServiceInstance: DeduplicationService | null = null;

export function getDeduplicationService(): DeduplicationService {
  if (!deduplicationServiceInstance) {
    deduplicationServiceInstance = new DeduplicationService();
  }
  return deduplicationServiceInstance;
}

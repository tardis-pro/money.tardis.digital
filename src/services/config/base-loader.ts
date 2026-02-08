/**
 * Base Configuration Loader with fallback chain support
 * Provides unified interface for loading dynamic configurations from multiple sources
 */

import crypto from 'crypto';

export interface ConfigurationSource<T> {
  /** Unique identifier for this source */
  id: string;
  
  /** Display name for logging and monitoring */
  name: string;
  
  /** Priority (lower = higher priority) */
  priority: number;
  
  /** Whether this source is currently available */
  isAvailable(): Promise<boolean>;
  
  /** Fetch configuration data from this source */
  fetch(): Promise<T>;
  
  /** Cache TTL in seconds */
  cacheTtlSeconds: number;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  sourceId: string;
  etag?: string;
}

export interface LoadResult<T> {
  data: T;
  sourceId: string;
  sourceName: string;
  fromCache: boolean;
  latencyMs: number;
  cachedAt?: number;
}

/**
 * Generic configuration loader with multi-source fallback
 */
export abstract class BaseConfigurationLoader<T> {
  protected cache: Map<string, CacheEntry<T>> = new Map();
  protected sources: ConfigurationSource<T>[] = [];
  
  constructor(
    protected readonly name: string,
    protected readonly defaultTtlSeconds: number = 3600
  ) {}

  /**
   * Register a configuration source
   */
  addSource(source: ConfigurationSource<T>): void {
    this.sources.push(source);
    this.sources.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Load configuration with automatic fallback
   */
  async load(): Promise<LoadResult<T>> {
    const startTime = Date.now();
    const errors: Array<{ sourceId: string; error: string }> = [];

    for (const source of this.sources) {
      try {
        // Check if source is available
        const isAvailable = await this.isSourceAvailableWithTimeout(source);
        if (!isAvailable) {
          console.log(`[${this.name}] Source ${source.name} is not available, skipping`);
          continue;
        }

        // Check cache first
        const cached = this.cache.get(source.id);
        if (cached && this.isCacheValid(cached, source.cacheTtlSeconds)) {
          return {
            data: cached.data,
            sourceId: source.id,
            sourceName: source.name,
            fromCache: true,
            latencyMs: Date.now() - startTime,
            cachedAt: cached.timestamp
          };
        }

        // Fetch fresh data
        const data = await this.withTimeout(source.fetch(), 30000); // 30s timeout
        
        // Validate fetched data
        if (!this.validateData(data)) {
          console.warn(`[${this.name}] Validation failed for ${source.name}, skipping`);
          continue;
        }

        // Cache the result
        this.cache.set(source.id, {
          data,
          timestamp: Date.now(),
          sourceId: source.id
        });

        return {
          data,
          sourceId: source.id,
          sourceName: source.name,
          fromCache: false,
          latencyMs: Date.now() - startTime
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`[${this.name}] Failed to load from ${source.name}: ${errorMessage}`);
        errors.push({ sourceId: source.id, error: errorMessage });
      }
    }

    // All sources failed - attempt to load from fallback
    const fallbackResult = await this.loadFallback();
    if (fallbackResult) {
      return {
        data: fallbackResult,
        sourceId: 'fallback',
        sourceName: 'hardcoded-fallback',
        fromCache: false,
        latencyMs: Date.now() - startTime
      };
    }

    throw new Error(
      `Failed to load ${this.name} from any source. Errors: ${errors.map(e => e.error).join(', ')}`
    );
  }

  /**
   * Check if source is available with timeout
   */
  protected async isSourceAvailableWithTimeout(source: ConfigurationSource<T>): Promise<boolean> {
    try {
      return await Promise.race([
        source.isAvailable(),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 5000))
      ]);
    } catch {
      return false;
    }
  }

  /**
   * Execute promise with timeout
   */
  protected async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  }

  /**
   * Check if cached entry is still valid
   */
  protected isCacheValid(entry: CacheEntry<T>, ttlSeconds: number): boolean {
    const ageMs = Date.now() - entry.timestamp;
    return ageMs < ttlSeconds * 1000;
  }

  /**
   * Validate fetched data - override in subclasses
   */
  protected validateData(data: T): boolean {
    return data !== null && data !== undefined;
  }

  /**
   * Load from hardcoded fallback - override in subclasses
   */
  protected abstract loadFallback(): Promise<T | null>;

  /**
   * Force refresh - bypass cache and reload
   */
  async forceRefresh(): Promise<LoadResult<T>> {
    // Clear cache for all sources
    this.cache.clear();
    // Load fresh
    return this.load();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { entries: number; sources: string[] } {
    return {
      entries: this.cache.size,
      sources: Array.from(this.cache.values()).map(c => c.sourceId)
    };
  }

  /**
   * Invalidate cache for a specific source
   */
  invalidate(sourceId: string): void {
    this.cache.delete(sourceId);
  }

  /**
   * Invalidate all caches
   */
  invalidateAll(): void {
    this.cache.clear();
  }
}

/**
 * Utility function to compute content hash for deduplication
 */
export function computeContentHash(content: string): string {
  return crypto.createHash('sha256')
    .update(content.toLowerCase().replace(/\s+/g, ' ').trim())
    .digest('hex');
}

/**
 * Utility function to normalize text for comparison
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

/**
 * Interface for configuration that supports versioning
 */
export interface VersionedConfig {
  version: string;
  lastUpdated: string;
  etag?: string;
}

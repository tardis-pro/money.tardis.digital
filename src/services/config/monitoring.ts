/**
 * Configuration Health Monitoring Service
 * Tracks fetch success/failure rates, latency, and data freshness for all configuration sources
 */

import { getSectorLoader } from './sector-loader.js';
import { getEntityLoader } from './entity-loader.js';
import { getDeduplicationService } from '../deduplication.js';

export interface SourceHealth {
  sourceId: string;
  sourceName: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastFetched: string | null;
  fetchLatencyMs: number | null;
  fetchSuccess: boolean;
  consecutiveFailures: number;
  dataFreshnessMinutes: number | null;
  recordCount: number | null;
}

export interface ConfigurationHealthSummary {
  overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  checkedAt: string;
  sources: SourceHealth[];
  recommendations: string[];
}

interface FetchHistoryEntry {
  timestamp: number;
  success: boolean;
  latencyMs: number;
  recordCount?: number;
}

// In-memory fetch history (replace with Redis in production)
class FetchHistoryStore {
  private store: Map<string, FetchHistoryEntry[]> = new Map();
  private readonly MAX_HISTORY = 100;

  record(sourceId: string, entry: FetchHistoryEntry): void {
    const history = this.store.get(sourceId) || [];
    history.push(entry);
    if (history.length > this.MAX_HISTORY) {
      history.shift();
    }
    this.store.set(sourceId, history);
  }

  getHistory(sourceId: string): FetchHistoryEntry[] {
    return this.store.get(sourceId) || [];
  }

  getRecent(sourceId: string, minutes: number): FetchHistoryEntry[] {
    const cutoff = Date.now() - minutes * 60 * 1000;
    return this.getHistory(sourceId).filter(e => e.timestamp > cutoff);
  }

  getSuccessRate(sourceId: string, minutes: number = 60): number {
    const recent = this.getRecent(sourceId, minutes);
    if (recent.length === 0) return 0;
    const successes = recent.filter(e => e.success).length;
    return successes / recent.length;
  }

  getAverageLatency(sourceId: string, minutes: number = 60): number {
    const recent = this.getRecent(sourceId, minutes);
    if (recent.length === 0) return 0;
    const total = recent.reduce((sum, e) => sum + e.latencyMs, 0);
    return total / recent.length;
  }

  getConsecutiveFailures(sourceId: string): number {
    const history = this.getHistory(sourceId);
    if (history.length === 0) return 0;
    
    let consecutive = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      if (!entry || entry.success) break;
      consecutive++;
    }
    return consecutive;
  }
}

/**
 * Configuration Health Monitor
 */
export class ConfigurationHealthMonitor {
  private historyStore = new FetchHistoryStore();
  private checkIntervalMs = 300000; // 5 minutes

  constructor(private checkIntervalMinutes: number = 5) {
    this.checkIntervalMs = checkIntervalMinutes * 60 * 1000;
  }

  async checkHealth(): Promise<ConfigurationHealthSummary> {
    const sources: SourceHealth[] = [];

    // Check sector loader
    const sectorHealth = await this.checkSectorLoader();
    sources.push(sectorHealth);

    // Check entity loader
    const entityHealth = await this.checkEntityLoader();
    sources.push(entityHealth);

    // Check deduplication service
    const dedupHealth = this.checkDeduplicationService();
    sources.push(dedupHealth);

    // Determine overall status
    const hasUnhealthy = sources.some(s => s.status === 'unhealthy');
    const hasDegraded = sources.some(s => s.status === 'degraded');
    const overallStatus = hasUnhealthy ? 'unhealthy' : hasDegraded ? 'degraded' : 'healthy';

    // Generate recommendations
    const recommendations = this.generateRecommendations(sources);

    return {
      overallStatus,
      checkedAt: new Date().toISOString(),
      sources,
      recommendations
    };
  }

  private async checkSectorLoader(): Promise<SourceHealth> {
    const sourceId = 'nse-industry-classification';
    const sourceName = 'NSE Industry Classification';

    try {
      const startTime = Date.now();
      const loader = getSectorLoader();
      const result = await loader.load();
      const latencyMs = Date.now() - startTime;

      // Record success
      this.historyStore.record(sourceId, {
        timestamp: Date.now(),
        success: true,
        latencyMs,
        recordCount: result.data.sectors.length
      });

      // Calculate freshness
      const lastUpdated = new Date(result.data.lastUpdated);
      const freshnessMinutes = (Date.now() - lastUpdated.getTime()) / 1000 / 60;

      return {
        sourceId,
        sourceName,
        status: 'healthy',
        lastFetched: new Date().toISOString(),
        fetchLatencyMs: latencyMs,
        fetchSuccess: true,
        consecutiveFailures: 0,
        dataFreshnessMinutes: freshnessMinutes,
        recordCount: result.data.sectors.length
      };
    } catch (error) {
      // Record failure
      this.historyStore.record(sourceId, {
        timestamp: Date.now(),
        success: false,
        latencyMs: Date.now() - Date.now() // Will be overwritten
      });

      const consecutiveFailures = this.historyStore.getConsecutiveFailures(sourceId);
      const successRate = this.historyStore.getSuccessRate(sourceId);

      return {
        sourceId,
        sourceName,
        status: consecutiveFailures >= 3 ? 'unhealthy' : 'degraded',
        lastFetched: null,
        fetchLatencyMs: null,
        fetchSuccess: false,
        consecutiveFailures,
        dataFreshnessMinutes: null,
        recordCount: null
      };
    }
  }

  private async checkEntityLoader(): Promise<SourceHealth> {
    const sourceId = 'screener-api';
    const sourceName = 'Screener.in API';

    try {
      const startTime = Date.now();
      const loader = getEntityLoader();
      const result = await loader.load();
      const latencyMs = Date.now() - startTime;

      // Record success
      this.historyStore.record(sourceId, {
        timestamp: Date.now(),
        success: true,
        latencyMs,
        recordCount: result.data.size
      });

      return {
        sourceId,
        sourceName,
        status: 'healthy',
        lastFetched: new Date().toISOString(),
        fetchLatencyMs: latencyMs,
        fetchSuccess: true,
        consecutiveFailures: 0,
        dataFreshnessMinutes: null,
        recordCount: result.data.size
      };
    } catch (error) {
      this.historyStore.record(sourceId, {
        timestamp: Date.now(),
        success: false,
        latencyMs: 0
      });

      const consecutiveFailures = this.historyStore.getConsecutiveFailures(sourceId);

      return {
        sourceId,
        sourceName,
        status: consecutiveFailures >= 3 ? 'unhealthy' : 'degraded',
        lastFetched: null,
        fetchLatencyMs: null,
        fetchSuccess: false,
        consecutiveFailures,
        dataFreshnessMinutes: null,
        recordCount: null
      };
    }
  }

  private checkDeduplicationService(): SourceHealth {
    const sourceId = 'deduplication-store';
    const sourceName = 'Deduplication Service';

    try {
      const service = getDeduplicationService();
      const stats = service.getStats();

      return {
        sourceId,
        sourceName,
        status: 'healthy',
        lastFetched: new Date().toISOString(),
        fetchLatencyMs: 1,
        fetchSuccess: true,
        consecutiveFailures: 0,
        dataFreshnessMinutes: null,
        recordCount: stats.content.size + stats.fuzzy.size + stats.semantic.size
      };
    } catch (error) {
      return {
        sourceId,
        sourceName,
        status: 'unhealthy',
        lastFetched: null,
        fetchLatencyMs: null,
        fetchSuccess: false,
        consecutiveFailures: 1,
        dataFreshnessMinutes: null,
        recordCount: null
      };
    }
  }

  private generateRecommendations(sources: SourceHealth[]): string[] {
    const recommendations: string[] = [];

    for (const source of sources) {
      if (source.status === 'unhealthy') {
        recommendations.push(
          `[${source.sourceName}] is unhealthy with ${source.consecutiveFailures} consecutive failures. ` +
          `Check network connectivity and API availability.`
        );
      }

      if (source.status === 'degraded') {
        if (source.fetchLatencyMs && source.fetchLatencyMs > 10000) {
          recommendations.push(
            `[${source.sourceName}] has high latency (${source.fetchLatencyMs}ms). ` +
            `Consider increasing cache TTL or implementing request batching.`
          );
        }

        if (source.dataFreshnessMinutes && source.dataFreshnessMinutes > 1440) {
          recommendations.push(
            `[${source.sourceName}] data is over ${Math.round(source.dataFreshnessMinutes / 60)} hours old. ` +
            `Force refresh or check source update frequency.`
          );
        }
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('All configuration sources are healthy.');
    }

    return recommendations;
  }

  /**
   * Get detailed history for a specific source
   */
  getSourceHistory(sourceId: string, minutes: number = 60): FetchHistoryEntry[] {
    return this.historyStore.getRecent(sourceId, minutes);
  }

  /**
   * Get success rate for a specific source
   */
  getSourceSuccessRate(sourceId: string, minutes: number = 60): number {
    return this.historyStore.getSuccessRate(sourceId, minutes);
  }
}

// Singleton instance
let monitorInstance: ConfigurationHealthMonitor | null = null;

export function getConfigurationHealthMonitor(): ConfigurationHealthMonitor {
  if (!monitorInstance) {
    monitorInstance = new ConfigurationHealthMonitor();
  }
  return monitorInstance;
}

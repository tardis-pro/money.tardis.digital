/**
 * Entity Metadata Loader
 * Fetches company metadata from Screener.in and NSE for dynamic entity mapping
 */

import { BaseConfigurationLoader, ConfigurationSource, normalizeText } from './base-loader.js';
import { MIT_UNIVERSE as VALIDATED_MIT_UNIVERSE } from '../mit/universe-loader.js';

interface UniverseTicker { ticker: string; name: string; sector: string; }
const MIT_UNIVERSE: UniverseTicker[] = VALIDATED_MIT_UNIVERSE.map((row) => ({
  ticker: row.ticker,
  name: row.name,
  sector: row.sector,
}));

export interface EntityMetadata {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  isGovernmentOwned: boolean;
  governmentOwnershipPct?: number | null;
  ministries: string[];
  subsidiaries: string[];
  keywords: string[];
  listingDate: string;
  isin: string;
  lastUpdated: string;
}

export interface EntityBatchResult {
  entities: EntityMetadata[];
  failed: string[];
  cached: string[];
  loadedFromSource: string;
}

// Screener.in API response types
interface ScreenerCompanyResponse {
  name: string;
  industry: string;
  sector: string;
  govt_holding_percent?: number;
  parent_company?: string;
  subsidiaries?: string[];
  isin: string;
  listing_date: string;
  description?: string;
}

interface EntityCacheEntry {
  data: EntityMetadata;
  timestamp: number;
  source: 'screener' | 'nse' | 'fallback';
}

// PSU Ministry mapping for common Indian PSUs
const PSU_MINISTRY_MAP: Record<string, string[]> = {
  'HAL': ['Ministry of Defence'],
  'BEL': ['Ministry of Defence'],
  'IRCTC': ['Ministry of Railways'],
  'IRFC': ['Ministry of Railways'],
  'NTPC': ['Ministry of Power'],
  'PFC': ['Ministry of Power'],
  'RVNL': ['Ministry of Railways'],
  'SBIN': ['Ministry of Finance', 'RBI'],
  'HDFCBANK': [],
  'LT': []
};

// Screener.in API Source
// --- Rate-limiting helpers (inline, no external deps) ---

/** Simple chunked concurrency limiter — processes items in batches of `limit`. */
async function withConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<unknown>
): Promise<void> {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += limit) {
    chunks.push(items.slice(i, i + limit));
  }
  for (const chunk of chunks) {
    await Promise.all(chunk.map(fn));
  }
}

/** Retry with exponential backoff + jitter (1s, 2s, 4s base delays). */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
      console.warn(`[rate-limit] entity-loader retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms`);
      await new Promise<void>(r => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

class ScreenerEntitySource implements ConfigurationSource<Map<string, EntityMetadata>> {
  id = 'screener-api';
  name = 'Screener.in API';
  priority = 0;
  cacheTtlSeconds = 43200; // 12 hours

  private readonly searchUrl = 'https://www.screener.in/api/company/search';
  private readonly knownTickers: string[] = MIT_UNIVERSE.map(t => t.ticker);

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.searchUrl}/?q=HAL`, {
        method: 'GET',
        headers: {
          'user-agent': 'Mozilla/5.0',
          accept: 'application/json,text/plain,*/*'
        },
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) {
        return false;
      }
      const payload = await response.json();
      return Array.isArray(payload);
    } catch {
      return false;
    }
  }

  async fetch(): Promise<Map<string, EntityMetadata>> {
    const entities = new Map<string, EntityMetadata>();

    await withConcurrency(this.knownTickers, 5, async (ticker) => {
      const fallback = FALLBACK_ENTITIES.get(ticker);
      try {
        const entity = await withRetry(() => this.fetchEntityFromSearch(ticker, fallback ?? null));
        entities.set(ticker, entity);
      } catch (error) {
        if (fallback) {
          entities.set(ticker, { ...fallback, lastUpdated: new Date().toISOString() });
        }
        console.warn(`Failed to fetch entity ${ticker}: ${error}`);
      }
      // Jittered per-ticker delay to respect API rate limits
      await this.sleep(400 + Math.random() * 200);
    });

    return entities;
  }
  private async fetchEntityFromSearch(ticker: string, fallback: EntityMetadata | null): Promise<EntityMetadata> {
    const response = await fetch(`${this.searchUrl}/?q=${encodeURIComponent(ticker)}`, {
      method: 'GET',
      headers: {
        'user-agent': 'Mozilla/5.0',
        accept: 'application/json,text/plain,*/*'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (response.status === 429) {
      console.warn(`[rate-limit] 429 received from Screener search for ${ticker}`);
      throw new Error('rate-limit-429');
    }

    if (!response.ok) {
      if (fallback) {
        return { ...fallback, lastUpdated: new Date().toISOString() };
      }
      throw new Error(`Search failed with status ${response.status}`);
    }

    const results = await response.json() as Array<{ name?: string; sector?: string; url?: string }>;
    const direct = results.find((row) => (row.url ?? '').toUpperCase().includes(`/${ticker}/`));
    const row = direct ?? results[0] ?? null;
    if (!row) {
      if (fallback) {
        return { ...fallback, lastUpdated: new Date().toISOString() };
      }
      throw new Error('No metadata returned from Screener search');
    }

    const companyName = row.name ?? fallback?.companyName ?? ticker;
    const industry = row.sector ?? fallback?.industry ?? 'Unknown';
    const governmentOwnershipPct = fallback?.governmentOwnershipPct ?? null;

    const keywords = this.extractKeywords('', companyName);

    return {
      ticker,
      companyName,
      sector: this.mapToPolicySector(industry),
      industry,
      isGovernmentOwned: (governmentOwnershipPct ?? 0) > 50 || (PSU_MINISTRY_MAP[ticker]?.length ?? 0) > 0,
      governmentOwnershipPct,
      ministries: PSU_MINISTRY_MAP[ticker] || [],
      subsidiaries: fallback?.subsidiaries ?? [],
      keywords,
      listingDate: fallback?.listingDate ?? '',
      isin: fallback?.isin ?? '',
      lastUpdated: new Date().toISOString(),
    };
  }

  private transformScreenerData(ticker: string, data: ScreenerCompanyResponse): EntityMetadata {
    const keywords = this.extractKeywords(data.description || '', data.name);

    return {
      ticker,
      companyName: data.name,
      sector: this.mapToPolicySector(data.industry),
      industry: data.industry,
      isGovernmentOwned: (data.govt_holding_percent || 0) > 50,
      governmentOwnershipPct: data.govt_holding_percent ?? null,
      ministries: PSU_MINISTRY_MAP[ticker] || [],
      subsidiaries: data.subsidiaries || [],
      keywords,
      listingDate: data.listing_date,
      isin: data.isin,
      lastUpdated: new Date().toISOString()
    };
  }

  private extractKeywords(description: string, companyName: string): string[] {
    const keywords = new Set<string>();

    // Add company name words
    companyName.split(' ').forEach(word => {
      if (word.length > 3) keywords.add(word.toLowerCase());
    });

    // Extract key terms from description
    const descriptionLower = description.toLowerCase();
    const keyTerms = [
      'defense', 'railway', 'power', 'banking', 'finance', 'infrastructure',
      'construction', 'engineering', 'telecom', 'steel', 'cement',
      'aircraft', 'electronics', 'thermal', 'renewable'
    ];

    keyTerms.forEach(term => {
      if (descriptionLower.includes(term)) {
        keywords.add(term);
      }
    });

    return Array.from(keywords).slice(0, 15); // Limit to 15 keywords
  }

  private mapToPolicySector(industry: string): string {
    const industryLower = industry.toLowerCase();
    
    if (industryLower.match(/defense|aerospace|aircraft/)) return 'defense';
    if (industryLower.match(/rail|transport|logistics/)) return 'railways';
    if (industryLower.match(/power|electric|energy|thermal/)) return 'power';
    if (industryLower.match(/bank|financial|insurance/)) return 'bfsi';
    if (industryLower.match(/construction|engineering|infrastructure|cement/)) return 'infra';
    
    return 'broad-market';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Fallback entity data
const RICH_FALLBACK_ENTRIES: Map<string, EntityMetadata> = new Map([
  ['HAL', {
    ticker: 'HAL',
    companyName: 'Hindustan Aeronautics Ltd',
    sector: 'defense',
    industry: 'Aerospace & Defense',
    isGovernmentOwned: true,
    governmentOwnershipPct: 51,
    ministries: ['Ministry of Defence'],
    subsidiaries: [],
    keywords: ['defense', 'aerospace', 'aircraft', 'hal'],
    listingDate: '1993-06-08',
    isin: 'INE066F01012',
    lastUpdated: '2024-01-01T00:00:00.000Z'
  }],
  ['BEL', {
    ticker: 'BEL',
    companyName: 'Bharat Electronics Ltd',
    sector: 'defense',
    industry: 'Aerospace & Defense',
    isGovernmentOwned: true,
    governmentOwnershipPct: 56,
    ministries: ['Ministry of Defence'],
    subsidiaries: [],
    keywords: ['defense', 'electronics', 'radar', 'bel'],
    listingDate: '1993-07-14',
    isin: 'INE263A01016',
    lastUpdated: '2024-01-01T00:00:00.000Z'
  }],
  ['IRCTC', {
    ticker: 'IRCTC',
    companyName: 'IRCTC Ltd',
    sector: 'railways',
    industry: 'Transportation',
    isGovernmentOwned: true,
    governmentOwnershipPct: 70,
    ministries: ['Ministry of Railways'],
    subsidiaries: [],
    keywords: ['railway', 'irctc', 'ticketing', 'travel'],
    listingDate: '2019-10-14',
    isin: 'INE053A01029',
    lastUpdated: '2024-01-01T00:00:00.000Z'
  }],
  ['IRFC', {
    ticker: 'IRFC',
    companyName: 'Indian Railway Finance Corp',
    sector: 'railways',
    industry: 'Financial Services',
    isGovernmentOwned: true,
    governmentOwnershipPct: 100,
    ministries: ['Ministry of Railways'],
    subsidiaries: [],
    keywords: ['railway', 'irfc', 'finance', 'leasing'],
    listingDate: '2021-01-27',
    isin: 'INE053A01011',
    lastUpdated: '2024-01-01T00:00:00.000Z'
  }],
  ['NTPC', {
    ticker: 'NTPC',
    companyName: 'NTPC Ltd',
    sector: 'power',
    industry: 'Power Generation',
    isGovernmentOwned: true,
    governmentOwnershipPct: 51,
    ministries: ['Ministry of Power'],
    subsidiaries: [],
    keywords: ['power', 'ntpc', 'thermal', 'electricity'],
    listingDate: '1999-11-05',
    isin: 'INE733E01010',
    lastUpdated: '2024-01-01T00:00:00.000Z'
  }],
  ['PFC', {
    ticker: 'PFC',
    companyName: 'Power Finance Corp',
    sector: 'power',
    industry: 'Financial Services',
    isGovernmentOwned: true,
    governmentOwnershipPct: 100,
    ministries: ['Ministry of Power'],
    subsidiaries: [],
    keywords: ['power', 'pfc', 'finance', 'transmission'],
    listingDate: '2006-10-20',
    isin: 'INE809E01014',
    lastUpdated: '2024-01-01T00:00:00.000Z'
  }],
  ['SBIN', {
    ticker: 'SBIN',
    companyName: 'State Bank of India',
    sector: 'bfsi',
    industry: 'Banking',
    isGovernmentOwned: true,
    governmentOwnershipPct: 57,
    ministries: ['Ministry of Finance'],
    subsidiaries: [],
    keywords: ['bank', 'sbi', 'banking', 'rbi'],
    listingDate: '1995-03-24',
    isin: 'INE062A01020',
    lastUpdated: '2024-01-01T00:00:00.000Z'
  }],
  ['HDFCBANK', {
    ticker: 'HDFCBANK',
    companyName: 'HDFC Bank Ltd',
    sector: 'bfsi',
    industry: 'Banking',
    isGovernmentOwned: false,
    ministries: [],
    subsidiaries: [],
    keywords: ['bank', 'hdfc', 'banking', 'credit'],
    listingDate: '1999-06-03',
    isin: 'INE040A01034',
    lastUpdated: '2024-01-01T00:00:00.000Z'
  }],
  ['LT', {
    ticker: 'LT',
    companyName: 'Larsen & Toubro Ltd',
    sector: 'infra',
    industry: 'Engineering & Construction',
    isGovernmentOwned: false,
    ministries: [],
    subsidiaries: [],
    keywords: ['infrastructure', 'lt', 'engineering', 'construction', 'epc'],
    listingDate: '1946-01-11',
    isin: 'INE018A01030',
    lastUpdated: '2024-01-01T00:00:00.000Z'
  }],
  ['RVNL', {
    ticker: 'RVNL',
    companyName: 'Rail Vikas Nigam Ltd',
    sector: 'infra',
    industry: 'Engineering & Construction',
    isGovernmentOwned: true,
    governmentOwnershipPct: 100,
    ministries: ['Ministry of Railways'],
    subsidiaries: [],
    keywords: ['railway', 'rvnl', 'infrastructure', 'construction'],
    listingDate: '2019-07-26',
    isin: 'INE294G01021',
    lastUpdated: '2024-01-01T00:00:00.000Z'
  }]
]);

function buildFallbackEntities(): Map<string, EntityMetadata> {
  const map = new Map<string, EntityMetadata>();
  for (const u of MIT_UNIVERSE) {
    map.set(u.ticker, {
      ticker: u.ticker,
      companyName: u.name,
      sector: u.sector,
      industry: u.sector,
      isGovernmentOwned: false,
      governmentOwnershipPct: null,
      ministries: PSU_MINISTRY_MAP[u.ticker] ?? [],
      subsidiaries: [],
      keywords: [u.ticker.toLowerCase(), ...u.name.toLowerCase().split(' ').filter(w => w.length > 3)],
      listingDate: '',
      isin: '',
      lastUpdated: new Date().toISOString(),
    });
  }
  // Overlay the rich existing entries (they have better metadata)
  RICH_FALLBACK_ENTRIES.forEach((v, k) => map.set(k, v));
  return map;
}

const FALLBACK_ENTITIES = buildFallbackEntities();

/**
 * Loader for entity metadata with Screener.in as primary source
 */
export class EntityMetadataLoader extends BaseConfigurationLoader<Map<string, EntityMetadata>> {
  private instanceCache: Map<string, EntityCacheEntry> = new Map();

  constructor() {
    super('entity-metadata', 43200);
    this.addSource(new ScreenerEntitySource());
  }

  protected validateData(data: Map<string, EntityMetadata>): boolean {
    return data instanceof Map && data.size > 0;
  }

  protected loadFallback(): Promise<Map<string, EntityMetadata> | null> {
    return Promise.resolve(FALLBACK_ENTITIES);
  }

  /**
   * Get metadata for a specific ticker
   */
  async getEntity(ticker: string): Promise<EntityMetadata | null> {
    const result = await this.load();
    return result.data.get(ticker.toUpperCase()) || null;
  }

  /**
   * Get metadata for multiple tickers
   */
  async getEntities(tickers: string[]): Promise<EntityMetadata[]> {
    const result = await this.load();
    return tickers
      .map(t => result.data.get(t.toUpperCase()))
      .filter((e): e is EntityMetadata => e !== undefined);
  }

  /**
   * Get all entities
   */
  async getAllEntities(): Promise<EntityMetadata[]> {
    const result = await this.load();
    return Array.from(result.data.values());
  }

  /**
   * Get all entities with source info (live vs fallback)
   */
  async getAllEntitiesWithSource(): Promise<{ entities: EntityMetadata[]; source: 'live' | 'fallback' }> {
    const result = await this.load();
    const source = result.sourceId === 'fallback' ? 'fallback' : 'live';
    return {
      entities: Array.from(result.data.values()),
      source,
    };
  }

  /**
   * Find entities matching keywords
   */
  async findByKeywords(text: string): Promise<EntityMetadata[]> {
    const result = await this.load();
    const normalizedText = normalizeText(text);
    const matches: Array<{ entity: EntityMetadata; score: number }> = [];

    for (const entity of result.data.values()) {
      const score = this.calculateKeywordMatch(normalizedText, entity);
      if (score > 0) {
        matches.push({ entity, score });
      }
    }

    return matches
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(m => m.entity);
  }

  /**
   * Get entities by policy sector
   */
  async getEntitiesBySector(sector: string): Promise<EntityMetadata[]> {
    const result = await this.load();
    return Array.from(result.data.values())
      .filter(e => e.sector === sector);
  }

  /**
   * Get government-owned entities
   */
  async getGovernmentEntities(): Promise<EntityMetadata[]> {
    const result = await this.load();
    return Array.from(result.data.values())
      .filter(e => e.isGovernmentOwned);
  }

  private calculateKeywordMatch(text: string, entity: EntityMetadata): number {
    let score = 0;
    const normalizedEntityName = normalizeText(entity.companyName);
    const normalizedKeywords = entity.keywords.map(k => normalizeText(k));

    // Check ticker match
    if (text.includes(entity.ticker.toLowerCase())) {
      score += 10;
    }

    // Check company name
    if (normalizedEntityName.includes(text) || text.includes(normalizedEntityName)) {
      score += 5;
    }

    // Check keywords
    for (const keyword of normalizedKeywords) {
      if (text.includes(keyword) || keyword.includes(text)) {
        score += 2;
      }
    }

    return score;
  }

  /**
   * Get universe coverage report (total vs cached vs fallback)
   */
  async getCoverageReport(): Promise<{ total: number; cached: number; fallback: number }> {
    const result = await this.load();
    return {
      total: MIT_UNIVERSE.length,
      cached: result.data.size,
      fallback: result.sourceId === 'fallback' ? result.data.size : 0,
    };
  }
}

// Singleton instance
let entityLoaderInstance: EntityMetadataLoader | null = null;

export function getEntityLoader(): EntityMetadataLoader {
  if (!entityLoaderInstance) {
    entityLoaderInstance = new EntityMetadataLoader();
  }
  return entityLoaderInstance;
}

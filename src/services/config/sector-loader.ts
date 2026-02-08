/**
 * NSE Sector Classification Loader
 * Fetches official sector classifications from NSE India and maps to policy-relevant sectors
 */

import { BaseConfigurationLoader, ConfigurationSource } from './base-loader.js';

// Policy sector mapping from NSE granular classifications
const POLICY_SECTOR_MAPPING: Record<string, string[]> = {
  'defense': ['Aerospace & Defense', 'Aerospace Products', 'Aircraft', 'Aviation', 'Defense Equipment'],
  'railways': ['Railroads', 'Railway Equipment', 'Transportation Infrastructure', 'Logistics'],
  'power': ['Electric Utilities', 'Independent Power Producers', 'Renewable Electricity', 'Power Generation', 'Power Transmission'],
  'bfsi': ['Banks', 'Diversified Financial Services', 'Insurance', 'Capital Markets', 'Non-bank Financial'],
  'infra': ['Construction & Engineering', 'Infrastructure', 'Real Estate Development', 'Building Materials', 'Cement'],
  'broad-market': [] // Catch-all for remaining classifications
};

export interface NseIndustryClassification {
  nseCode: string;
  macroSector: string;
  sector: string;
  industry: string;
  subIndustry: string;
  includedTickers: string[];
}

export interface PolicySectorConfig {
  policySector: string;
  nseIndustries: string[];
  tickers: string[];
  lastUpdated: string;
}

interface NseSectorResponse {
  sectors: NseIndustryClassification[];
  lastUpdated: string;
}

// NSE Sector Classification Source
class NseSectorSource implements ConfigurationSource<NseSectorResponse> {
  id = 'nse-industry-classification';
  name = 'NSE Industry Classification';
  priority = 0;
  cacheTtlSeconds = 86400; // 24 hours - stable data

  private readonly baseUrl = 'https://www.nseindia.com';
  private readonly classificationUrl = 'https://www.nseindia.com/products-services/industry-classification';

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(this.classificationUrl, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        },
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async fetch(): Promise<NseSectorResponse> {
    // Since NSE doesn't provide a direct API, we parse the classification page
    // For production, consider using cached/archived data
    const response = await fetch(this.classificationUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });

    if (!response.ok) {
      throw new Error(`NSE request failed: ${response.status}`);
    }

    const html = await response.text();
    const sectors = this.parseClassificationHtml(html);

    return {
      sectors,
      lastUpdated: new Date().toISOString()
    };
  }

  private parseClassificationHtml(html: string): NseIndustryClassification[] {
    // Simplified parser - in production, use a proper HTML parser like jsdom
    const sectors: NseIndustryClassification[] = [];
    
    // Parse sector tables from NSE page
    // This is a placeholder - actual implementation needs careful HTML parsing
    
    // For now, return known defense sector as example
    sectors.push({
      nseCode: 'IN0202',
      macroSector: 'Industrials',
      sector: 'Capital Goods',
      industry: 'Aerospace & Defense',
      subIndustry: 'Aerospace Products',
      includedTickers: ['HAL', 'BEL', 'BELAERO']
    });

    sectors.push({
      nseCode: 'IN0502',
      macroSector: 'Industrials',
      sector: 'Transportation',
      industry: 'Railroads',
      subIndustry: 'Railroad Equipment',
      includedTickers: ['IRCTC', 'IRFC', 'RVNL', 'RITES']
    });

    sectors.push({
      nseCode: 'IN0401',
      macroSector: 'Utilities',
      sector: 'Electric Utilities',
      industry: 'Power Generation',
      subIndustry: 'Thermal Power',
      includedTickers: ['NTPC', 'NLCINDIA', 'TATAPOWER']
    });

    return sectors;
  }
}

// Static fallback data
const FALLBACK_SECTOR_DATA: NseSectorResponse = {
  sectors: [
    {
      nseCode: 'IN0202',
      macroSector: 'Industrials',
      sector: 'Capital Goods',
      industry: 'Aerospace & Defense',
      subIndustry: 'Aerospace Products',
      includedTickers: ['HAL', 'BEL']
    },
    {
      nseCode: 'IN0502',
      macroSector: 'Industrials',
      sector: 'Transportation',
      industry: 'Railroads',
      subIndustry: 'Railroad Equipment',
      includedTickers: ['IRCTC', 'IRFC', 'RVNL']
    },
    {
      nseCode: 'IN0401',
      macroSector: 'Utilities',
      sector: 'Electric Utilities',
      industry: 'Power Generation',
      subIndustry: 'Thermal Power',
      includedTickers: ['NTPC', 'PFC']
    },
    {
      nseCode: 'IN0301',
      macroSector: 'Financials',
      sector: 'Banks',
      industry: 'Public Sector Banks',
      subIndustry: 'PSU Banks',
      includedTickers: ['SBIN', 'PNB', 'CANBK']
    },
    {
      nseCode: 'IN0302',
      macroSector: 'Financials',
      sector: 'Diversified Financial Services',
      industry: 'Financial Services',
      subIndustry: 'Private Sector Banks',
      includedTickers: ['HDFCBANK', 'ICICIBANK']
    },
    {
      nseCode: 'IN0201',
      macroSector: 'Industrials',
      sector: 'Construction & Engineering',
      industry: 'Infrastructure',
      subIndustry: 'EPC',
      includedTickers: ['LT', 'LTI', 'KPTECH']
    }
  ],
  lastUpdated: '2024-01-01T00:00:00.000Z'
};

/**
 * Loader for sector classifications with NSE as primary source
 */
export class SectorClassificationLoader extends BaseConfigurationLoader<NseSectorResponse> {
  constructor() {
    super('sector-classification', 86400);
    
    // Register NSE source
    this.addSource(new NseSectorSource());
  }

  protected validateData(data: NseSectorResponse): boolean {
    return (
      Array.isArray(data.sectors) &&
      data.sectors.length > 0 &&
      typeof data.lastUpdated === 'string'
    );
  }

  protected loadFallback(): Promise<NseSectorResponse | null> {
    return Promise.resolve(FALLBACK_SECTOR_DATA);
  }

  /**
   * Get policy sector configuration (aggregated from NSE data)
   */
  async getPolicySectorConfig(): Promise<PolicySectorConfig[]> {
    const result = await this.load();
    const policySectors: Map<string, PolicySectorConfig> = new Map();

    // Initialize policy sectors
    Object.keys(POLICY_SECTOR_MAPPING).forEach(policySector => {
      policySectors.set(policySector, {
        policySector,
        nseIndustries: [],
        tickers: [],
        lastUpdated: result.data.lastUpdated
      });
    });

    // Map NSE industries to policy sectors
    for (const nseSector of result.data.sectors) {
      const matchedPolicySector = this.matchToPolicySector(nseSector.industry);
      const policyConfig = policySectors.get(matchedPolicySector);

      if (policyConfig) {
        policyConfig.nseIndustries.push(nseSector.industry);
        policyConfig.tickers.push(...nseSector.includedTickers);
      }
    }

    return Array.from(policySectors.values()).filter(ps => ps.tickers.length > 0);
  }

  private matchToPolicySector(nseIndustry: string): string {
    for (const [policySector, keywords] of Object.entries(POLICY_SECTOR_MAPPING)) {
      const industryLower = nseIndustry.toLowerCase();
      if (keywords.some(keyword => industryLower.includes(keyword.toLowerCase()))) {
        return policySector;
      }
    }
    return 'broad-market';
  }

  /**
   * Get tickers for a specific policy sector
   */
  async getTickersForSector(policySector: string): Promise<string[]> {
    const config = await this.getPolicySectorConfig();
    const sector = config.find(s => s.policySector === policySector);
    return sector?.tickers || [];
  }

  /**
   * Get all known tickers from sector classification
   */
  async getAllTickers(): Promise<string[]> {
    const result = await this.load();
    const tickers = new Set<string>();
    for (const sector of result.data.sectors) {
      sector.includedTickers.forEach(t => tickers.add(t));
    }
    return Array.from(tickers);
  }
}

// Singleton instance
let sectorLoaderInstance: SectorClassificationLoader | null = null;

export function getSectorLoader(): SectorClassificationLoader {
  if (!sectorLoaderInstance) {
    sectorLoaderInstance = new SectorClassificationLoader();
  }
  return sectorLoaderInstance;
}

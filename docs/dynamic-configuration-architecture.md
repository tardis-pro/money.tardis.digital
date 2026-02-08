# India Policy Signal Terminal - Dynamic Configuration Architecture

## Executive Summary

This document outlines a comprehensive architecture for transforming the India Policy Signal Terminal from hardcoded JSON configurations to a dynamic, data-driven system connected to real Indian financial and government data sources. The architecture prioritizes practical implementation with specific APIs, realistic data source integration, and a phased approach that maintains system stability throughout the transition.

The core insight driving this design is that Indian markets have rich, accessible data ecosystems—from NSE's official industry classifications to RBI's statistical databases to the Central Public Procurement Portal. Rather than maintaining static seed data, we can fetch, validate, and enrich configurations programmatically while preserving fallback mechanisms for reliability.

Key components include:
- A unified Configuration Loader Service that abstracts data source access
- Specific API integrations for NSE sector data, RBI policy events, CPPP tender data, and screener.in fundamentals
- Multi-layer deduplication combining content hashing, semantic similarity, and temporal windows
- A progressive migration path that keeps the system operational during transition

---

## 1. Architecture Overview

### 1.1 Current System Analysis

The existing system relies on four hardcoded JSON files that drive core functionality:

**Entity Map (`entity-map.json`)**: Contains 10 PSUs and private companies with ticker symbols, sector classifications, ministry mappings, and keyword lexicons. This file powers the entity linking service that connects news events to tradable securities.

**Supply Chain Graph (`supply-chain.json`)**: Defines 8 directed relationships between companies (e.g., HAL→BEL for defense electronics, IRFC→RVNL for rail financing) with confidence scores, lag estimates, and business group classifications. This data feeds the supply chain propagation algorithm.

**Notable Events (`notable-events.json`)**: Seeds 8 historical events (budget announcements, RBI rate changes, defense procurement updates) that provide training data and calibration points for the system.

**Source Registry (`sources.json`)**: Configures 6 data sources including PIB, RBI, NSE, CPPP, Business Line, and Screeni-py with polling intervals, reliability tiers, and parser types.

The tight coupling between these files and the services that consume them creates maintenance overhead, limits scalability, and prevents real-time updates based on market conditions.

### 1.2 Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    DYNAMIC CONFIGURATION LAYER                          │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐│
│  │  Config      │  │  Config      │  │  Config      │  │  Config      ││
│  │  Loader      │  │  Loader      │  │  Loader      │  │  Loader      ││
│  │  Service     │  │  Service     │  │  Service     │  │  Service     ││
│  │  (Sectors)   │  │  (Entities)  │  │  (Supply     │  │  (Events)    ││
│  │              │  │              │  │   Chain)     │  │              ││
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘│
│         │                 │                 │                 │        │
│         ▼                 ▼                 ▼                 ▼        │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │              Configuration Cache & Validator                   │     │
│  │              (Redis-backed with TTL, schema validation)        │     │
│  └─────────────────────────────┬─────────────────────────────────┘     │
│                                │                                         │
│                                ▼                                         │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │              Unified Configuration API                         │     │
│  │              (REST + WebSocket for real-time updates)          │     │
│  └───────────────────────────────────────────────────────────────┘     │
│                                │                                         │
│         ┌──────────────────────┼──────────────────────┐                 │
│         ▼                      ▼                      ▼                 │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐             │
│  │ Entity      │      │ Supply      │      │ Event       │             │
│  │ Linker      │      │ Chain       │      │ Classifier  │             │
│  │ Service     │      │ Service     │      │             │             │
│  └─────────────┘      └─────────────┘      └─────────────┘             │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Design Principles

**Principle 1: Fail Gracefully**: Every configuration loader must handle source failures by falling back to cached or static data. The system should never crash due to a downstream API timeout.

**Principle 2: Incremental Updates**: Configuration changes propagate gradually. New tickers, sectors, or relationships are added alongside existing ones before deprecated entries are removed.

**Principle 3: Source Truth with Local Override**: Primary data comes from authoritative sources, but operators can manually override any value for special cases (e.g., unlisted subsidiaries, confidential relationships).

**Principle 4: Temporal Awareness**: Configurations have effective dates. Supply chain relationships from 2022 may differ from 2024; the system must support historical snapshots.

---

## 2. Data Source Integration

### 2.1 Sector Classification (NSE Industry Classification)

**Current State**: Hardcoded 6 sectors (defense, railways, power, bfsi, infra, broad-market) with manual keyword mappings.

**Recommended Source**: NSE India Industry Classification System

**API/Endpoint Details**:

The NSE provides industry classification data through multiple channels:

1. **NSE India Website Industry Classification Page**
   - URL: https://www.nseindia.com/products-services/industry-classification
   - Type: HTML page with structured tables
   - Update Frequency: Quarterly with index rebalancing
   - Data: Hierarchical sector→industry→sub-industry classification for all listed companies

2. **NSE Indices Industry Classification PDF (Official)**
   - URL: https://nsearchives.nseindia.com/web/sites/default/files/inline-files/NSE Indices_Industry Classification Structure-2022-03.pdf
   - Type: PDF document with complete classification hierarchy
   - Contains: GICS-aligned 4-level hierarchy (Macro Sector → Sector → Industry → Sub-Industry)
   - Example codes: IN01 (Commodities) → IN0101 (Chemicals) → IN010101 (Chemicals & Petrochemicals) → IN010101001 (Commodity Chemicals)

3. **NSE Corporate Announcements API**
   - URL: https://www.nseindia.com/companies-listing/corporate-filings-announcements
   - Type: HTML with structured data, requires cookie-based access
   - Provides: Real-time announcements including sector changes, business restructuring

**Implementation Strategy**:

```typescript
interface SectorClassification {
  nseCode: string;           // e.g., "IN010101"
  gicsCode?: string;         // GICS equivalent if available
  macroSector: string;       // e.g., "Commodities"
  sector: string;            // e.g., "Chemicals"
  industry: string;          // e.g., "Chemicals & Petrochemicals"
  subIndustry: string;       // e.g., "Commodity Chemicals"
  includedTickers: string[]; // NSE-listed companies in this classification
}

class SectorClassificationLoader {
  private cache: SectorClassification[];
  private lastFetched: Date | null = null;
  private readonly CACHE_TTL_HOURS = 24;

  async load(): Promise<SectorClassification[]> {
    // Check cache validity
    if (this.cache && this.lastFetched && 
        Date.now() - this.lastFetched.getTime() < this.CACHE_TTL_HOURS * 3600000) {
      return this.cache;
    }

    // Primary: Fetch from NSE industry classification page
    try {
      const nseData = await this.fetchNseIndustryClassification();
      this.cache = this.transformNseToPolicySectors(nseData);
      this.lastFetched = new Date();
      return this.cache;
    } catch (error) {
      // Fallback: Use cached PDF data
      return this.loadFromPdfCache();
    }
  }

  private transformNseToPolicySectors(nseData: any[]): SectorClassification[] {
    // Map NSE's granular classification to policy-relevant aggregations
    const policySectorMapping: Record<string, string[]> = {
      'defense': ['Aerospace & Defense', 'Aerospace Products', 'Aircraft'],
      'railways': ['Railroads', 'Railway Equipment', 'Transportation Infrastructure'],
      'power': ['Electric Utilities', 'Independent Power Producers', 'Renewable Electricity'],
      'bfsi': ['Banks', 'Diversified Financial Services', 'Insurance'],
      'infra': ['Construction & Engineering', 'Infrastructure', 'Real Estate Development'],
      'broad-market': [] // Catch-all for remaining
    };

    // Return enriched classification with policy sector mapping
    return nseData.map(nse => ({
      ...nse,
      policySectors: this.mapToPolicySectors(nse.industry, policySectorMapping)
    }));
  }
}
```

**Data Refresh Cadence**: Daily with 24-hour TTL on cached data. Force refresh on index rebalancing announcements.

### 2.2 Entity/Ticker Metadata

**Current State**: 10 hardcoded tickers with manually maintained sector, ministry, and keyword mappings.

**Recommended Sources**:

1. **Screener.in API (Primary)**
   - URL: https://www.screener.in/api/1/company/{ticker}/
   - Type: REST API (unofficial but stable)
   - Provides: Company fundamentals, sector classification, government ownership percentage, subsidiaries
   - Rate Limits: ~60 requests/minute recommended
   - Example: https://www.screener.in/api/1/company/HAL/

2. **NSE India Corporate Data (Official)**
   - URL: https://www.nseindia.com/companies-listing/corporate-filings-announcements
   - Type: HTML with structured tables
   - Provides: Real-time disclosures, sector changes, board meetings, financial results
   - Authentication: Requires session cookie for full access

3. **Moneycontrol API (via Python Library)**
   - Library: `moneycontrol-api` (PyPI)
   - Type: Python wrapper for Moneycontrol.com
   - Provides: News, fundamentals, sector data
   - Installation: `pip install moneycontrol-api`

4. **BSE India Database (Supplementary)**
   - URL: https://www.bseindia.com/market_data_products.html
   - Type: Paid and free data products
   - Useful for: Cross-referencing NSE data, delisted companies

**Implementation Strategy**:

```typescript
interface EntityMetadata {
  ticker: string;
  companyName: string;
  sector: string;              // From NSE classification
  industry: string;            // More granular
  isGovernmentOwned: boolean;  // >50% government ownership
  governmentOwnershipPct?: number;
  ministries: string[];        // Parent ministries for PSUs
  subsidiaries: string[];      // Related companies
  keywords: string[];          // Auto-extracted from company description
  listings: {
    exchange: 'NSE' | 'BSE';
    listingDate: string;
    isin: string;
  }[];
  lastUpdated: string;
}

class EntityMetadataLoader {
  private readonly SCREENER_BASE = 'https://www.screener.in/api/1/company';
  private readonly cache = new Map<string, { data: EntityMetadata; timestamp: Date }>();

  async loadEntity(ticker: string): Promise<EntityMetadata> {
    // Check cache first
    const cached = this.cache.get(ticker);
    if (cached && this.isCacheValid(cached.timestamp)) {
      return cached.data;
    }

    // Fetch from screener.in (primary)
    try {
      const response = await fetch(`${this.SCREENER_BASE}/${ticker}/`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const screenerData = await response.json();
      
      const metadata = this.transformScreenerData(ticker, screenerData);
      this.cache.set(ticker, { data: metadata, timestamp: new Date() });
      return metadata;
    } catch (error) {
      // Fallback to NSE
      return this.loadFromNse(ticker);
    }
  }

  private transformScreenerData(ticker: string, data: any): EntityMetadata {
    // Transform screener.in response to our schema
    const keywords = this.extractKeywords(data.description || '', data.name || '');
    const isGovernmentOwned = data.govt_holding_percent > 50;
    
    return {
      ticker,
      companyName: data.name,
      sector: this.mapToPolicySector(data.industry),
      industry: data.industry || 'Unknown',
      isGovernmentOwned,
      governmentOwnershipPct: data.govt_holding_percent,
      ministries: this.extractMinistries(data.parent_company, data.name),
      subsidiaries: data.subsidiaries || [],
      keywords,
      listings: [{
        exchange: 'NSE',
        listingDate: data.listing_date,
        isin: data.isin
      }],
      lastUpdated: new Date().toISOString()
    };
  }

  async loadWatchlistEntities(tickers: string[]): Promise<EntityMetadata[]> {
    // Batch load with rate limiting
    const entities: EntityMetadata[] = [];
    for (const ticker of tickers) {
      try {
        const entity = await this.loadEntity(ticker);
        entities.push(entity);
      } catch (error) {
        console.warn(`Failed to load ${ticker}: ${error.message}`);
        // Continue with next ticker on failure
      }
      // Rate limit: 800ms between requests
      await this.sleep(800);
    }
    return entities;
  }
}
```

**Keyword Extraction**: Use NLP to auto-generate keywords from company descriptions instead of manual curation.

### 2.3 Supply Chain Relationships

**Current State**: 8 hardcoded relationships with confidence scores and lag estimates.

**Recommended Sources**:

1. **CPPP eProcure Portal (Primary for Government Contracts)**
   - URL: https://eprocure.gov.in/cppp/latestactivetendersnew/cpppdata
   - Type: HTML with pagination, some endpoints return JSON
   - Provides: Tender notices, contract awards, bidder relationships
   - Key Fields: `bidderName`, `contractNumber`, `awardValue`, `workDescription`
   - Integration: Scrape contract award notices to infer supplier relationships

2. **GeM (Government eMarketplace)**
   - URL: https://gem.gov.in/
   - Type: Web portal with search API
   - Provides: Product categories, vendor relationships, order volumes
   - Useful for: Understanding PSUs' customer/supplier patterns

3. **NSE/BSE Announcements (Contract Announcements)**
   - URL: https://www.nseindia.com/companies-listing/corporate-filings-announcements
   - Type: HTML
   - Look for: "Contract Execution", "Order Book Update", "JV Agreement" announcements

4. **Annual Reports & Filings (SEC/NSE Disclosures)**
   - Source: Annual reports submitted to NSE/BSE
   - Location: https://www.nseindia.com/companies-listing/corporate-filings-announcements-xbrl
   - Provides: Segment information, related party transactions, significant contracts

**Implementation Strategy**:

```typescript
interface SupplyChainRelationship {
  fromTicker: string;
  toTicker: string;
  channel: string;              // e.g., "defense-electronics", "rail-financing"
  confidence: number;           // 0-1 based on evidence strength
  lagDays: number;              // Typical propagation lag
  evidenceType: 'tender' | 'announcement' | 'filing' | 'manual';
  evidenceCount: number;        // Number of supporting data points
  firstDetected: string;
  lastUpdated: string;
}

class SupplyChainRelationshipLoader {
  private cpppBaseUrl = 'https://eprocure.gov.in/cppp';
  
  async discoverRelationships(entities: string[]): Promise<SupplyChainRelationship[]> {
    const relationships: SupplyChainRelationship[] = [];

    // Phase 1: Extract from CPPP contract awards
    const cpppRelationships = await this.scrapeCpppContracts(entities);
    relationships.push(...cpppRelationships);

    // Phase 2: Parse NSE announcements for relationship mentions
    const announcementRelationships = await this.parseAnnouncements(entities);
    relationships.push(...announcementRelationships);

    // Phase 3: Cross-reference with existing hardcoded relationships
    const validatedRelationships = this.crossReferenceWithExisting(relationships);

    return validatedRelationships;
  }

  private async scrapeCpppContracts(entities: string[]): Promise<SupplyChainRelationship[]> {
    const relationships: SupplyChainRelationship[] = [];
    
    // Search CPPP for contracts involving our entities
    for (const entity of entities) {
      try {
        // CPPP doesn't have a public API, so we scrape the tender search results
        const searchUrl = `${this.cpppBaseUrl}/searchTender?bidderName=${entity}`;
        const html = await this.fetchWithRetry(searchUrl);
        const contracts = this.parseCpppHtml(html);
        
        for (const contract of contracts) {
          // Look for other known entities as bidders
          for (const otherEntity of entities) {
            if (otherEntity !== entity && contract.bidders.includes(otherEntity)) {
              relationships.push({
                fromTicker: entity,      // Supplier
                toTicker: otherEntity,   // Customer (or vice versa)
                channel: this.categorizeChannel(contract.workDescription),
                confidence: this.calculateConfidence(contract),
                lagDays: this.estimateLag(contract),
                evidenceType: 'tender',
                evidenceCount: 1,
                firstDetected: contract.awardDate,
                lastUpdated: new Date().toISOString()
              });
            }
          }
        }
      } catch (error) {
        console.warn(`CPPP scrape failed for ${entity}: ${error.message}`);
      }
    }

    return this.aggregateRelationships(relationships);
  }

  private categorizeChannel(workDescription: string): string {
    const desc = workDescription.toLowerCase();
    if (desc.match(/rail|track| signaling/)) return 'rail-infrastructure';
    if (desc.match(/power|electric|transmission/)) return 'power-equipment';
    if (desc.match(/defense|army|aircraft|radar/)) return 'defense-electronics';
    if (desc.match(/construction|building|epc/)) return 'construction-services';
    return 'general-services';
  }

  private calculateConfidence(contract: any): number {
    // Higher confidence for larger contracts, multiple awards, recurring relationships
    let confidence = 0.5; // Base confidence
    if (contract.contractValue > 100000000) confidence += 0.2;
    if (contract.evidenceCount > 1) confidence += 0.15;
    if (contract.recurring) confidence += 0.15;
    return Math.min(1, confidence);
  }
}
```

**Relationship Confidence Calculation**:

| Evidence Type | Weight | Notes |
|--------------|--------|-------|
| Direct contract award (CPPP) | 0.35 | Strongest evidence |
| NSE announcement of contract | 0.25 | Verified disclosure |
| Annual report segment data | 0.20 | Official filing |
| Related party transaction | 0.15 | Financial disclosure |
| News article | 0.10 | Weakest but useful |

**Lag Estimation**: Default to 1 day for intra-PSU relationships, 2-3 days for cross-sector, 5+ days for complex infrastructure projects.

### 2.4 Notable Events (Policy Calendar)

**Current State**: 8 seeded historical events used for training and calibration.

**Recommended Sources**:

1. **RBI Data Releases Calendar**
   - URL: https://www.rbi.org.in/scripts/statistics.aspx
   - Type: HTML with structured data
   - Provides: Monetary policy dates, economic data release schedule
   - Key Events: MPC meetings (bi-monthly), CPI releases, GDP data

2. **India Budget Portal**
   - URL: https://www.indiabudget.gov.in/
   - Type: HTML + PDFs
   - Provides: Budget documents, expenditure allocations, sector-wise spending
   - Key Dates: Union Budget (Feb 1), Interim Budget (when applicable)

3. **PIB Press Releases**
   - URL: https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=1
   - Type: RSS feed (already integrated)
   - Provides: Government announcements, policy updates, cabinet decisions

4. **Open Budgets India**
   - URL: https://openbudgetsindia.org/
   - Type: Structured data portal
   - Provides: Budget data in CSV/Excel formats, historical comparisons

5. **Ministry Websites**
   - MoD: https://mod.gov.in/
   - MoR: https://indianrailways.gov.in/
   - MoP: https://powermin.gov.in/

**Implementation Strategy**:

```typescript
interface PolicyEvent {
  id: string;
  title: string;
  description: string;
  eventType: 'budget' | 'rbi-circular' | 'tender' | 'regulation' | 'announcement';
  scheduledDate: string;        // Expected date (may have year component)
  recurrence?: 'annual' | 'quarterly' | 'monthly' | 'ad-hoc';
  affectedSectors: string[];    // Policy sectors likely impacted
  affectedTickers: string[];    // Specific tickers from entity map
  sourceUrl: string;
  importance: 'high' | 'medium' | 'low';
}

class PolicyEventLoader {
  private rbiCalendarUrl = 'https://www.rbi.org.in/scripts/monetarypolicy.aspx';
  private budgetUrl = 'https://www.indiabudget.gov.in/';
  private pibRssUrl = 'https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=1';

  async loadUpcomingEvents(months: number = 12): Promise<PolicyEvent[]> {
    const events: PolicyEvent[] = [];

    // Fetch RBI monetary policy calendar
    const rbiEvents = await this.scrapeRbiCalendar();
    events.push(...rbiEvents);

    // Fetch budget dates
    const budgetEvents = await this.getBudgetCalendar();
    events.push(...budgetEvents);

    // Get PIB announcements for current period
    const pibEvents = await this.scrapePibRecent();
    events.push(...pibEvents);

    return this.enrichWithAffectedEntities(events);
  }

  private async scrapeRbiCalendar(): Promise<PolicyEvent[]> {
    // RBI publishes MPC meeting dates for the year
    const currentYear = new Date().getFullYear();
    const events: PolicyEvent[] = [];

    // MPC meetings are typically in April, June, August, October, December
    const mpcMonths = [4, 6, 8, 10, 12];
    
    for (const month of mpcMonths) {
      const firstWeekDay = this.getFirstWorkingDayOfMonth(currentYear, month);
      events.push({
        id: `rbi-mpc-${currentYear}-${month}`,
        title: `RBI Monetary Policy Committee Meeting ${month}/${currentYear}`,
        description: 'Bi-monthly monetary policy review and rate decision',
        eventType: 'rbi-circular',
        scheduledDate: firstWeekDay,
        recurrence: 'quarterly',
        affectedSectors: ['bfsi', 'broad-market'],
        affectedTickers: ['SBIN', 'HDFCBANK'],
        sourceUrl: 'https://www.rbi.org.in/scripts/monetarypolicy.aspx',
        importance: 'high'
      });
    }

    return events;
  }

  private async getBudgetCalendar(): Promise<PolicyEvent[]> {
    const currentYear = new Date().getFullYear();
    
    return [{
      id: `union-budget-${currentYear}`,
      title: `Union Budget ${currentYear}-${currentYear + 1}`,
      description: 'Annual budget presentation with sector-wise allocations',
      eventType: 'budget',
      scheduledDate: `${currentYear}-02-01`, // Traditional budget date
      recurrence: 'annual',
      affectedSectors: ['defense', 'railways', 'power', 'infra', 'bfsi'],
      affectedTickers: ['HAL', 'BEL', 'IRCTC', 'IRFC', 'NTPC', 'PFC', 'LT', 'RVNL'],
      sourceUrl: 'https://www.indiabudget.gov.in/',
      importance: 'high'
    }];
  }

  private enrichWithAffectedEntities(events: PolicyEvent[]): PolicyEvent[] {
    // Cross-reference with entity map to auto-populate affected tickers
    // This is a simplification; in production, you'd use the EntityMetadataLoader
    
    const sectorToTickers: Record<string, string[]> = {
      'defense': ['HAL', 'BEL'],
      'railways': ['IRCTC', 'IRFC', 'RVNL'],
      'power': ['NTPC', 'PFC'],
      'bfsi': ['SBIN', 'HDFCBANK'],
      'infra': ['LT', 'RVNL']
    };

    return events.map(event => ({
      ...event,
      affectedTickers: event.affectedSectors.flatMap(s => sectorToTickers[s] || [])
    }));
  }
}
```

### 2.5 Source Registry Expansion

**Current State**: 6 configured sources with manual reliability tiers.

**Recommended Additions**:

1. **National Data Registry (NDR) - Ministry of Finance**
   - URL: https://www.data.gov.in/ (search for Finance sector)
   - Type: API-based data access
   - Provides: Government financial data, PSUs performance

2. **SEBI Circulars**
   - URL: https://www.sebi.gov.in/legal/circulars.html
   - Type: HTML + PDF
   - Provides: Regulatory changes affecting listed companies

3. **Commodity-specific Sources**
   - Power Ministry: https://powermin.gov.in/
   - Defence Procurement Portal: https://mod.gov.in/dod/

**Enhanced Source Registry Schema**:

```typescript
interface SourceRegistryItem {
  id: string;
  name: string;
  url: string;
  format: 'rss' | 'xml' | 'html' | 'pdf' | 'json';
  parserType: 'rss' | 'xml' | 'html' | 'pdf-ocr' | 'screenipy';
  pollingIntervalSeconds: number;
  reliabilityTier: 'high' | 'medium' | 'low';
  licenseTag: string;
  enabled: boolean;
  // New fields for dynamic configuration
  apiEndpoint?: string;           // For JSON APIs
  authRequired?: boolean;         // Cookie/session needed
  rateLimitRpm?: number;          // Requests per minute limit
  lastSuccessfulFetch?: string;   // ISO timestamp
  fetchErrorCount?: number;       // Consecutive errors
  dataCategories?: string[];      // ['policy', 'tender', 'circular']
}

class DynamicSourceRegistry {
  private sources: Map<string, SourceRegistryItem> = new Map();
  private fetchHistory: Map<string, string[]> = new Map(); // sourceId -> [timestamps]

  async loadSources(): Promise<SourceRegistryItem[]> {
    // Load from persistent storage first
    const storedSources = await this.loadFromStorage();
    
    // Update reliability tiers based on fetch history
    for (const source of storedSources) {
      const history = this.fetchHistory.get(source.id) || [];
      if (this.calculateFailureRate(history) > 0.2) {
        source.reliabilityTier = this.downgradeTier(source.reliabilityTier);
      }
    }

    return storedSources;
  }

  private calculateFailureRate(history: string[]): number {
    if (history.length === 0) return 0;
    const recent = history.slice(-100); // Last 100 fetches
    const failed = recent.filter(ts => ts.startsWith('ERROR:')).length;
    return failed / recent.length;
  }
}
```

---

## 3. Deduplication Strategy

### 3.1 Multi-Layer Deduplication Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    DEDUPLICATION PIPELINE                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                 │
│  │  Content    │    │   Fuzzy     │    │  Semantic   │                 │
│  │   Hash      │───▶│  Matching   │───▶│  Similarity │                 │
│  │  (Exact)    │    │ (Levenshtein)   │  (Embeddings)│                 │
│  └─────────────┘    └─────────────┘    └─────────────┘                 │
│         │                  │                  │                        │
│         ▼                  ▼                  ▼                        │
│  ┌─────────────────────────────────────────────────────┐              │
│  │              Deduplication Decision Engine          │              │
│  │  • Time-window rules (24h dedup window)             │              │
│  │  • Source priority (RBI > PIB > News)               │              │
│  │  • Confidence thresholds (0.85 for exact match)     │              │
│  └─────────────────────────────────────────────────────┘              │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────┐              │
│  │              Deduplication Store                    │              │
│  │  • Redis-backed bloom filter for fast lookup        │              │
│  │  • PostgreSQL for detailed duplicate tracking       │              │
│  └─────────────────────────────────────────────────────┘              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Layer 1: Content Hash Deduplication (Exact Match)

**Algorithm**: SHA-256 hash of normalized content

```typescript
interface ContentHash {
  hash: string;           // SHA-256 of normalized text
  sourceId: string;
  artifactId: string;
  publishedAt: string;
  title: string;
  contentLength: number;
}

class ContentHashDeduplicator {
  private bloomFilter: BloomFilter; // Redis-backed
  private hashStore: Map<string, ContentHash>; // In-memory with persistence

  async checkDuplicate(content: string, sourceId: string): Promise<{
    isDuplicate: boolean;
    existingArtifactId?: string;
    similarity?: number;
  }> {
    // Normalize content for consistent hashing
    const normalized = this.normalizeContent(content);
    const hash = this.computeHash(normalized);

    // Fast check with bloom filter
    if (!this.bloomFilter.test(hash)) {
      return { isDuplicate: false };
    }

    // Exact match found - retrieve details
    const existing = this.hashStore.get(hash);
    if (existing && existing.sourceId === sourceId) {
      return {
        isDuplicate: true,
        existingArtifactId: existing.artifactId,
        similarity: 1.0
      };
    }

    return { isDuplicate: false };
  }

  private normalizeContent(content: string): string {
    return content
      .toLowerCase()
      .replace(/\s+/g, ' ')          // Normalize whitespace
      .replace(/[^\w\s]/g, '')       // Remove punctuation
      .trim();
  }

  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}
```

### 3.3 Layer 2: Fuzzy Matching (Near-Duplicate Detection)

**Algorithm**: Locality-Sensitive Hashing (LSH) with MinHash for efficiency

```typescript
interface FuzzyMatchCandidate {
  artifactId: string;
  title: string;
  content: string;
  jaccardSimilarity: number;
  levenshteinDistance: number;
}

class FuzzyDeduplicator {
  private minHashIndex: Map<number, string[]> = new Map(); // Bucket -> [artifactIds]
  private readonly NUM_BANDS = 10;
  private readonly SIMILARITY_THRESHOLD = 0.85;

  async findDuplicates(artifact: ParsedDocument): Promise<FuzzyMatchCandidate[]> {
    const candidates: FuzzyMatchCandidate[] = [];
    const minHash = this.computeMinHash(artifact.bodyText);

    // Find candidates in same LSH bands
    const candidateIds = new Set<string>();
    for (const [band, signature] of minHash.entries()) {
      const bandKey = this.hashSignature(signature);
      const bandCandidates = this.minHashIndex.get(bandKey) || [];
      bandCandidates.forEach(id => candidateIds.add(id));
    }

    // Compute actual similarity for candidates
    for (const candidateId of candidateIds) {
      const candidate = await this.getArtifact(candidateId);
      const similarity = this.computeJaccardSimilarity(artifact.bodyText, candidate.bodyText);
      
      if (similarity >= this.SIMILARITY_THRESHOLD) {
        candidates.push({
          artifactId: candidateId,
          title: candidate.title,
          content: candidate.bodyText,
          jaccardSimilarity: similarity,
          levenshteinDistance: this.levenshtein(artifact.bodyText, candidate.bodyText)
        });
      }
    }

    return candidates.sort((a, b) => b.jaccardSimilarity - a.jaccardSimilarity);
  }

  private computeMinHash(text: string): Map<number, number[]> {
    // MinHash for Jaccard similarity estimation
    // Returns: Map<bandIndex, [signature1, signature2, ...]>
    const shingles = this.generateShingles(text, 3); // 3-grams
    const minHashes: Map<number, number[]> = new Map();

    for (let band = 0; band < this.NUM_BANDS; band++) {
      const signatures: number[] = [];
      for (let i = 0; i < 20; i++) { // 20 permutations per band
        let minHashValue = Infinity;
        for (const shingle of shingles) {
          const hash = this.hashShingle(shingle, i);
          if (hash < minHashValue) {
            minHashValue = hash;
          }
        }
        signatures.push(minHashValue);
      }
      minHashes.set(band, signatures);
    }

    return minHashes;
  }
}
```

### 3.4 Layer 3: Semantic Similarity (Embedding-Based)

**Algorithm**: Sentence embeddings with cosine similarity

```typescript
interface SemanticMatch {
  artifactId: string;
  embedding: number[];
  cosineSimilarity: number;
  semanticDistance: number;
}

class SemanticDeduplicator {
  private embeddingModel: SentenceTransformer; // e.g., 'all-MiniLM-L6-v2'
  private vectorStore: FaissIndex; // Or pgvector in PostgreSQL
  private readonly SIMILARITY_THRESHOLD = 0.92;

  async findSemanticDuplicates(artifact: ParsedDocument): Promise<SemanticMatch[]> {
    // Generate embedding for new artifact
    const embedding = await this.embeddingModel.encode([
      artifact.title,
      artifact.summary
    ]);

    // Query vector store for similar embeddings
    const results = await this.vectorStore.search(embedding, k = 10);

    // Filter by similarity threshold
    return results
      .filter(r => r.similarity >= this.SIMILARITY_THRESHOLD)
      .map(r => ({
        artifactId: r.id,
        embedding: r.vector,
        cosineSimilarity: r.similarity,
        semanticDistance: 1 - r.similarity
      }));
  }
}
```

### 3.5 Time-Window and Source Priority Rules

```typescript
interface DeduplicationRule {
  type: 'content' | 'fuzzy' | 'semantic';
  threshold: number;        // Similarity threshold (0-1)
  timeWindowHours: number;  // Only consider duplicates within this window
  sourcePriority: string[]; // Higher priority sources win ties
}

const DEFAULT_DEDUPLICATION_RULES: DeduplicationRule[] = [
  {
    type: 'content',
    threshold: 1.0,           // Exact match only
    timeWindowHours: 24,      // Within 24 hours
    sourcePriority: ['rbi_circulars', 'pib_press', 'nse_announcements', 'cppp_tenders', 'businessline_rss']
  },
  {
    type: 'fuzzy',
    threshold: 0.85,          // 85% Jaccard similarity
    timeWindowHours: 72,      // Within 3 days
    sourcePriority: ['rbi_circulars', 'pib_press', 'nse_announcements', 'cppp_tenders']
  },
  {
    type: 'semantic',
    threshold: 0.92,          // 92% semantic similarity
    timeWindowHours: 168,     // Within 1 week
    sourcePriority: ['pib_press', 'rbi_circulars', 'nse_announcements']
  }
];

class DeduplicationEngine {
  private contentDeduplicator: ContentHashDeduplicator;
  private fuzzyDeduplicator: FuzzyDeduplicator;
  private semanticDeduplicator: SemanticDeduplicator;

  async deduplicate(artifact: ParsedDocument): Promise<DeduplicationResult> {
    const results: DeduplicationResult[] = [];

    // Layer 1: Content hash (fastest, most reliable)
    const contentMatch = await this.contentDeduplicator.checkDuplicate(
      artifact.bodyText, 
      artifact.sourceId
    );
    if (contentMatch.isDuplicate) {
      return {
        isDuplicate: true,
        duplicateType: 'exact',
        existingArtifactId: contentMatch.existingArtifactId,
        confidence: 1.0
      };
    }

    // Layer 2: Fuzzy matching
    const fuzzyMatches = await this.fuzzyDeduplicator.findDuplicates(artifact);
    if (fuzzyMatches.length > 0) {
      const bestMatch = fuzzyMatches[0];
      return {
        isDuplicate: true,
        duplicateType: 'fuzzy',
        existingArtifactId: bestMatch.artifactId,
        confidence: bestMatch.jaccardSimilarity,
        matchedTitle: bestMatch.title
      };
    }

    // Layer 3: Semantic similarity
    const semanticMatches = await this.semanticDeduplicator.findSemanticDuplicates(artifact);
    if (semanticMatches.length > 0) {
      const bestMatch = semanticMatches[0];
      return {
        isDuplicate: true,
        duplicateType: 'semantic',
        existingArtifactId: bestMatch.artifactId,
        confidence: bestMatch.cosineSimilarity,
        matchedTitle: (await this.getArtifact(bestMatch.artifactId)).title
      };
    }

    return { isDuplicate: false };
  }
}
```

### 3.6 Deduplication Storage Schema

```sql
-- PostgreSQL schema for deduplication tracking

CREATE TABLE content_hashes (
    id SERIAL PRIMARY KEY,
    hash VARCHAR(64) NOT NULL UNIQUE,
    source_id VARCHAR(64) NOT NULL,
    artifact_id VARCHAR(128) NOT NULL,
    published_at TIMESTAMP WITH TIME ZONE,
    title TEXT,
    content_length INT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    INDEX idx_hash ON content_hashes(hash);
    INDEX idx_source_published ON content_hashes(source_id, published_at);
);

CREATE TABLE semantic_embeddings (
    id SERIAL PRIMARY KEY,
    artifact_id VARCHAR(128) NOT NULL UNIQUE,
    embedding vector(384),  -- Dimension for all-MiniLM-L6-v2
    title TEXT,
    published_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- pgvector index for fast similarity search
    CREATE INDEX embedding_idx ON semantic_embeddings USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);
);

CREATE TABLE deduplication_log (
    id SERIAL PRIMARY KEY,
    artifact_id VARCHAR(128) NOT NULL,
    duplicate_of_id VARCHAR(128),
    match_type VARCHAR(32),  -- 'exact', 'fuzzy', 'semantic'
    confidence FLOAT,
    rule_applied VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    INDEX idx_artifact ON deduplication_log(artifact_id);
    INDEX idx_duplicate_of ON deduplication_log(duplicate_of_id);
);
```

---

## 4. Implementation Approach

### 4.1 Phased Implementation Plan

**Phase 1: Foundation (Weeks 1-2)**

Objective: Establish the configuration loading infrastructure without disrupting existing functionality.

Tasks:
1. Create `ConfigurationLoaderService` abstract class with fallback chain
2. Implement `NseSectorClassificationLoader` for sector data
3. Add Redis caching layer with 24-hour TTL
4. Create configuration migration scripts

Deliverables:
- `src/services/config/sector-loader.ts` - NSE sector data fetcher
- `src/services/config/entity-loader.ts` - Screener.in entity fetcher
- `src/config/dynamic-config.ts` - Unified configuration API
- Unit tests with mocked external APIs

**Phase 2: Entity Map Enhancement (Weeks 3-4)**

Objective: Replace hardcoded `entity-map.json` with dynamic data from Screener.in and NSE.

Tasks:
1. Implement batch entity loading with rate limiting
2. Create keyword auto-extraction from company descriptions
3. Add ministry mapping from government ownership data
4. Build entity refresh cron job (daily at 2 AM IST)

Migration Strategy:
```typescript
// Dual-read during transition
class EntityLinkerService {
  private dynamicLoader: EntityMetadataLoader;
  private fallbackMap = entityMap; // Current hardcoded data

  async link(event: EventRecord): Promise<LinkedEntity[]> {
    // Try dynamic loader first
    try {
      const entities = await this.dynamicLoader.getEntities();
      return this.matchByKeywords(event, entities);
    } catch (error) {
      // Fallback to hardcoded map
      console.warn('Dynamic loader failed, using fallback');
      return this.matchByKeywords(event, this.fallbackMap);
    }
  }
}
```

**Phase 3: Supply Chain Discovery (Weeks 5-6)**

Objective: Implement CPPP tender scraping and NSE announcement parsing for supply chain relationships.

Tasks:
1. Build CPPP contract award scraper with pagination
2. Implement relationship extraction from announcements
3. Create confidence scoring algorithm
4. Add relationship visualization endpoint

**Phase 4: Event Calendar Integration (Weeks 7-8)**

Objective: Connect to RBI, Budget, and PIB data for policy events.

Tasks:
1. Build RBI MPC date scraper
2. Integrate Open Budgets India data
3. Create event impact scoring based on historical patterns
4. Add event notification system

**Phase 5: Deduplication Enhancement (Weeks 9-10)**

Objective: Implement multi-layer deduplication with embeddings.

Tasks:
1. Deploy Redis bloom filter for content hashing
2. Integrate sentence-transformers for embeddings
3. Set up pgvector for semantic search
4. Build deduplication analytics dashboard

**Phase 6: Source Registry Dynamic Updates (Weeks 11-12)**

Objective: Make source registry self-maintaining with automatic reliability updates.

Tasks:
1. Implement fetch success/failure tracking
2. Create automatic tier downgrade/upgrade logic
3. Add new source discovery from government portals
4. Build source health dashboard

### 4.2 Priority Ordering

Implementation priority based on impact and feasibility:

| Priority | Component | Effort | Impact | Rationale |
|----------|-----------|--------|--------|-----------|
| P0 | Entity Metadata Loader | 2 weeks | High | Core to entity linking; reliable APIs available |
| P1 | Sector Classification | 1 week | High | Foundation for all classification; NSE has official data |
| P2 | Supply Chain Discovery | 3 weeks | Medium | CPPP scraping is complex but high value |
| P3 | Policy Event Calendar | 2 weeks | Medium | Improves event prediction; sources are well-structured |
| P4 | Deduplication (L2-L3) | 2 weeks | High | Quality improvement; clear algorithms |
| P5 | Dynamic Source Registry | 2 weeks | Low | Nice-to-have operational efficiency |

### 4.3 Error Handling and Fallback

```typescript
interface ConfigurationSource {
  name: string;
  priority: number; // 0 = highest
  fetch(): Promise<any>;
  isAvailable(): boolean;
}

class ConfigurationFallbackChain {
  private sources: ConfigurationSource[] = [];

  async loadWithFallback(configType: 'entity' | 'sector' | 'supply-chain' | 'event'): Promise<any> {
    const sources = this.getSourcesForType(configType);
    const errors: Error[] = [];

    for (const source of sources) {
      try {
        if (!source.isAvailable()) {
          console.warn(`Source ${source.name} is not available`);
          continue;
        }

        const data = await source.fetch();
        console.log(`Loaded ${configType} from ${source.name}`);
        return this.validateAndTransform(data, configType);
      } catch (error) {
        console.error(`Failed to load from ${source.name}: ${error.message}`);
        errors.push(error);
      }
    }

    // All sources failed - use hardcoded fallback
    console.warn(`All dynamic sources failed for ${configType}, using fallback`);
    return this.loadHardcodedFallback(configType);
  }

  private loadHardcodedFallback(configType: string): any {
    switch (configType) {
      case 'entity':
        return require('../config/entity-map.json');
      case 'sector':
        return require('../config/sectors.json'); // Create this fallback
      case 'supply-chain':
        return require('../config/supply-chain.json');
      case 'event':
        return require('../config/notable-events.json');
      default:
        throw new Error(`Unknown config type: ${configType}`);
    }
  }
}
```

### 4.4 Monitoring and Observability

```typescript
interface ConfigurationMetrics {
  source: string;
  fetchLatencyMs: number;
  fetchSuccess: boolean;
  dataFreshnessMinutes: number;
  recordCount: number;
  fallbackUsed: boolean;
}

class ConfigurationMetricsCollector {
  private metrics: ConfigurationMetrics[] = [];

  record(metric: ConfigurationMetrics): void {
    this.metrics.push(metric);
    
    // Emit to Prometheus/StatsD
    this.emitToMonitoring(metric);
  }

  getHealthStatus(): ConfigurationHealthStatus {
    const recent = this.metrics.slice(-100);
    const successRate = recent.filter(m => m.fetchSuccess).length / recent.length;
    
    return {
      overallHealth: successRate > 0.9 ? 'healthy' : successRate > 0.7 ? 'degraded' : 'unhealthy',
      sources: this.aggregateBySource(recent),
      lastUpdated: new Date().toISOString()
    };
  }
}
```

---

## 5. Summary Recommendations

### 5.1 Immediate Actions (This Sprint)

1. **Create the Configuration Loader infrastructure** - Build the abstract base class and caching layer before integrating any specific data sources. This ensures proper error handling from day one.

2. **Integrate NSE Industry Classification** - The data is official, well-structured, and GICS-aligned. This replaces the 6 hardcoded sectors with 50+ granular classifications that can be aggregated as needed.

3. **Set up Screener.in integration** - For entity metadata, keywords, and government ownership data. This is the most reliable unofficial API for Indian stocks.

### 5.2 Data Source Summary Table

| Component | Primary Source | Fallback | Refresh Cadence |
|-----------|---------------|----------|-----------------|
| Sectors | NSE Industry Classification (HTML) | Static PDF mapping | Daily |
| Entities | Screener.in API | NSE announcements | Daily |
| Supply Chain | CPPP eProcure (scraping) | NSE contract announcements | Weekly |
| Events | RBI statistics page | Open Budgets India | Daily |
| Sources | Hardcoded + operator edits | N/A | On-change |

### 5.3 Risk Mitigation

| Risk | Mitigation |
|------|------------|
| API rate limits | Implement 800ms delays, use caching aggressively |
| Scraping detection (CPPP) | Use rotating user-agents, cache aggressively |
| Screener.in API changes | Version the API calls, monitor for 404s |
| Data quality issues | Validate schema on load, log validation errors |
| Service downtime | Always maintain hardcoded fallback files |

### 5.4 Success Metrics

- **Entity Coverage**: Increase from 10 tickers to 50+ within 3 months
- **Deduplication Accuracy**: Reduce duplicate signals by 80% with semantic layer
- **Data Freshness**: Supply chain relationships updated within 7 days of contract award
- **System Reliability**: 99.9% uptime for configuration loading with automatic fallback

The architecture transforms the terminal from a static rule-based system to a dynamic, data-driven platform that evolves with the Indian policy and market landscape while maintaining the reliability that production systems require.

import supplyChainMap from "../config/supply-chain.json" with { type: "json" };
import type { Store } from "../store.js";
import type { SupplyChainEdge, SupplyChainGraph, SupplyChainNode } from "../types.js";
import { clamp, nowIso } from "../utils.js";
import { getEntityLoader } from "./config/entity-loader.js";
import type { EntityMetadata } from "./config/entity-loader.js";
import { getScreenerFetcher, type ScreenerFundamentalsData } from "./mit/screener-fundamentals-fetcher.js";
interface EdgeConfig {
  from: string;
  to: string;
  channel: string;
  confidence: number;
  lag: number;
  businessGroupFrom: string;
  businessGroupTo: string;
}

const configuredEdges = supplyChainMap as EdgeConfig[];

const ALPHA_BY_RESOLUTION: Record<SupplyChainEdge["temporalResolution"], number> = {
  intraday: 0.82,
  "1D": 1,
  "1W": 1.14,
};

function entityByTicker(entities: EntityMetadata[]): Map<string, EntityMetadata> {
  return new Map(entities.map((entity) => [entity.ticker, entity]));
}

function businessGroupFor(ticker: string, edgeMap: EdgeConfig[]): string {
  const forward = edgeMap.find((edge) => edge.from === ticker)?.businessGroupFrom;
  if (forward) {
    return forward;
  }
  const backward = edgeMap.find((edge) => edge.to === ticker)?.businessGroupTo;
  if (backward) {
    return backward;
  }
  return "Independent";
}

function directedEdgeKey(edge: Pick<SupplyChainEdge, "from" | "to" | "relation">): string {
  return `${edge.from}->${edge.to}:${edge.relation}`;
}

function htsPropagation(
  confidence: number,
  fromImportance: number,
  toImportance: number,
  lag: number,
  resolution: SupplyChainEdge["temporalResolution"],
  sameGroupBoost: number,
): number {
  const alpha = ALPHA_BY_RESOLUTION[resolution];
  const beta = 1 / Math.max(1, lag);
  const eta = Math.exp(-0.28 * lag);
  const signalStrength = Math.sqrt(fromImportance * toImportance);
  const score = alpha * Math.pow(confidence * signalStrength, beta) * eta * sameGroupBoost;
  return clamp(score, 0, 1);
}

/** Node economics derived from real fundamentals data */
interface NodeEconomics {
  production: number;
  demand: number;
  imports: number;
  exports: number;
  surplus: number;
  dataSource: 'live' | 'cached' | 'fallback';
  asOf: string;
}

/**
 * Extract node economics from Screener fundamentals data.
 * Maps financial metrics to supply chain node economics:
 * - production: latest annual revenue (in crores)
 * - demand: revenue * (1 + revenueGrowth) for forward estimate
 * - surplus: free cash flow (from fcfHistory)
 * - imports/exports: derived from surplus sign (negative surplus = imports needed)
 */
function extractEconomicsFromFundamentals(
  fundamentals: ScreenerFundamentalsData | null
): NodeEconomics {
  const fallbackAsOf = nowIso();
  
  if (!fundamentals) {
    // No fundamentals available - use explicit fallback with zeros
    return {
      production: 0,
      demand: 0,
      imports: 0,
      exports: 0,
      surplus: 0,
      dataSource: 'fallback',
      asOf: fallbackAsOf,
    };
  }
  
  // Get latest revenue from history (sorted by FY)
  const revenueHistory = [...fundamentals.revenueHistory].sort((a, b) => b.fy.localeCompare(a.fy));
  const latestRevenue = revenueHistory[0]?.value ?? 0;
  
  // Calculate revenue growth for demand estimation
  const prevRevenue = revenueHistory[1]?.value;
  const revenueGrowth = prevRevenue !== undefined && prevRevenue > 0 
    ? (latestRevenue - prevRevenue) / prevRevenue 
    : 0;
  
  // Demand is forward-looking estimate based on growth
  const demand = latestRevenue * (1 + revenueGrowth);
  
  // Get latest FCF from history
  const fcfHistory = [...fundamentals.fcfHistory].sort((a, b) => b.fy.localeCompare(a.fy));
  const latestFcf = fcfHistory[0]?.value ?? 0;
  
  // Production is current revenue, surplus is FCF
  const production = latestRevenue;
  const surplus = latestFcf;
  
  // Imports when FCF is negative (company needs external funding/supply)
  // Exports when FCF is positive (company generates excess cash)
  const imports = surplus < 0 ? Math.abs(surplus) : 0;
  const exports = surplus > 0 ? surplus : 0;
  
  // Determine data source based on fetch time
  const fetchTime = new Date(fundamentals.fetchedAt).getTime();
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const dataSource: 'live' | 'cached' | 'fallback' = fetchTime > oneHourAgo ? 'live' : 'cached';
  
  return {
    production: Number(production.toFixed(2)),
    demand: Number(demand.toFixed(2)),
    imports: Number(imports.toFixed(2)),
    exports: Number(exports.toFixed(2)),
    surplus: Number(surplus.toFixed(2)),
    dataSource,
    asOf: fundamentals.fetchedAt,
  };
}

export class SupplyChainGraphService {
  private entityLoader = getEntityLoader();

  constructor(private readonly store: Store) {}

  async buildGraph(watchlistId?: string): Promise<SupplyChainGraph> {
    const state = await this.store.read();
    
    // Load entities dynamically
    const { entities } = await this.entityLoader.getAllEntitiesWithSource();
    const entityLookup = entityByTicker(entities);
    const tickers = new Set<string>();

    if (watchlistId) {
      const watchlist = state.watchlists.find((entry) => entry.id === watchlistId);
      for (const ticker of watchlist?.tickers ?? []) {
        tickers.add(ticker);
      }
    } else {
      for (const signal of state.signals.slice(0, 80)) {
        for (const linked of signal.linkedEntities) {
          tickers.add(linked.ticker);
        }
      }
      if (tickers.size === 0) {
        // Fallback to all known entities
        for (const entity of entities) {
          tickers.add(entity.ticker);
      }
      }
    }

    const recentSignalScores = new Map<string, number>();
    for (const signal of state.signals.slice(0, 120)) {
      for (const linked of signal.linkedEntities) {
        if (!tickers.has(linked.ticker)) {
          continue;
        }
        const current = recentSignalScores.get(linked.ticker) ?? 0;
        recentSignalScores.set(linked.ticker, current + signal.score * linked.confidence);
      }
    }

    const baseNodes = Array.from(tickers)
      .filter((ticker) => entityLookup.has(ticker))
      .map((ticker) => {
        const entity = entityLookup.get(ticker);
        if (!entity) {
          throw new Error(`Unknown ticker ${ticker}`);
        }
        const rawImportance = recentSignalScores.get(ticker) ?? 0.4;
        return {
          ticker,
          sector: entity.sector,
          ministry: entity.ministries[0] || null,
          businessGroup: businessGroupFor(ticker, configuredEdges),
          importance: clamp(rawImportance, 0.2, 1),
        };
      });

    // Fetch fundamentals for all tickers to get real economics data
    const fetcher = getScreenerFetcher();
    const tickerList = baseNodes.map((n) => n.ticker);
    console.log(`[supply-chain] Fetching fundamentals for ${tickerList.length} tickers...`);
    
    const fundamentalsResult = await fetcher.fetchTickers(tickerList);
    const fundamentalsMap = new Map<string, ScreenerFundamentalsData | null>();
    
    for (const f of fundamentalsResult.success) {
      fundamentalsMap.set(f.ticker, f);
    }
    for (const failed of fundamentalsResult.failed) {
      fundamentalsMap.set(failed.ticker.toUpperCase(), null);
      console.warn(`[supply-chain] Failed to fetch fundamentals for ${failed.ticker}: ${failed.error}`);
    }
    
    // Track overall data source for the graph
    const liveCount = fundamentalsResult.success.filter((f) => {
      const fetchTime = new Date(f.fetchedAt).getTime();
      return fetchTime > Date.now() - 60 * 60 * 1000;
    }).length;
    const graphDataSource: 'live' | 'cached' | 'fallback' = 
      liveCount === tickerList.length ? 'live' :
      fundamentalsResult.success.length > 0 ? 'cached' : 
      'fallback';

    const nodeMap = new Map(baseNodes.map((node) => [node.ticker, node]));
    const directEdges: SupplyChainEdge[] = [];
    for (const edge of configuredEdges) {
      if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) {
        continue;
      }
      const fromNode = nodeMap.get(edge.from);
      const toNode = nodeMap.get(edge.to);
      if (!fromNode || !toNode) {
        continue;
      }
      const sameGroupBoost = fromNode.businessGroup === toNode.businessGroup ? 1.14 : 1;
      directEdges.push({
        from: edge.from,
        to: edge.to,
        relation: "direct",
        channel: edge.channel,
        lag: edge.lag,
        temporalResolution: edge.lag <= 1 ? "intraday" : edge.lag <= 2 ? "1D" : "1W",
        confidence: edge.confidence,
        propagationScore: htsPropagation(
          edge.confidence,
          fromNode.importance,
          toNode.importance,
          edge.lag,
          edge.lag <= 1 ? "intraday" : edge.lag <= 2 ? "1D" : "1W",
          sameGroupBoost,
        ),
      });
    }

    const outgoing = new Map<string, SupplyChainEdge[]>();
    for (const edge of directEdges) {
      const list = outgoing.get(edge.from) ?? [];
      list.push(edge);
      outgoing.set(edge.from, list);
    }

    const indirectEdges: SupplyChainEdge[] = [];
    const seen = new Set<string>();
    for (const first of directEdges) {
      const next = outgoing.get(first.to) ?? [];
      for (const second of next) {
        if (first.from === second.to || first.to === second.to || first.from === second.from) {
          continue;
        }
        const fromNode = nodeMap.get(first.from);
        const toNode = nodeMap.get(second.to);
        if (!fromNode || !toNode) {
          continue;
        }
        const relation: SupplyChainEdge = {
          from: first.from,
          to: second.to,
          relation: "indirect",
          channel: `${first.channel} -> ${second.channel}`,
          lag: first.lag + second.lag,
          temporalResolution: "1W",
          confidence: clamp(first.confidence * second.confidence * 0.87, 0, 1),
          propagationScore: htsPropagation(
            first.confidence * second.confidence,
            fromNode.importance,
            toNode.importance,
            first.lag + second.lag,
            "1W",
            fromNode.businessGroup === toNode.businessGroup ? 1.12 : 1,
          ),
        };
        const key = directedEdgeKey(relation);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        indirectEdges.push(relation);
      }
    }

    const edges = [...directEdges, ...indirectEdges]
      .filter((edge) => edge.propagationScore >= 0.25)
      .sort((a, b) => b.propagationScore - a.propagationScore)
      .slice(0, 80);

    const nodes: SupplyChainNode[] = baseNodes
      .map((node) => {
        // Get fundamentals for this ticker and extract real economics
        const fundamentals = fundamentalsMap.get(node.ticker) ?? null;
        const economics = extractEconomicsFromFundamentals(fundamentals);
        
        return {
          ...node,
          production: economics.production,
          demand: economics.demand,
          imports: economics.imports,
          exports: economics.exports,
          surplus: economics.surplus,
          dataSource: economics.dataSource,
          asOf: economics.asOf,
        };
      })
      .sort((a, b) => b.importance - a.importance);

    return {
      generatedAt: nowIso(),
      nodes,
      edges,
      dataSource: graphDataSource,
    };
  }
}

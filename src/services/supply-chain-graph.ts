import entityMap from "../config/entity-map.json" with { type: "json" };
import supplyChainMap from "../config/supply-chain.json" with { type: "json" };
import type { Store } from "../store.js";
import type { SupplyChainEdge, SupplyChainGraph, SupplyChainNode } from "../types.js";
import { clamp, nowIso } from "../utils.js";

interface EntityConfig {
  ticker: string;
  sector: string;
  ministry: string | null;
}

interface EdgeConfig {
  from: string;
  to: string;
  channel: string;
  confidence: number;
  lag: number;
  businessGroupFrom: string;
  businessGroupTo: string;
}

const entities = entityMap as EntityConfig[];
const configuredEdges = supplyChainMap as EdgeConfig[];

const ALPHA_BY_RESOLUTION: Record<SupplyChainEdge["temporalResolution"], number> = {
  intraday: 0.82,
  "1D": 1,
  "1W": 1.14,
};

function entityByTicker(): Map<string, EntityConfig> {
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

export class SupplyChainGraphService {
  constructor(private readonly store: Store) {}

  async buildGraph(watchlistId?: string): Promise<SupplyChainGraph> {
    const state = await this.store.read();
    const entityLookup = entityByTicker();
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
          ministry: entity.ministry,
          businessGroup: businessGroupFor(ticker, configuredEdges),
          importance: clamp(rawImportance, 0.2, 1),
        };
      });

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

    const incoming = new Map<string, number>();
    const outgoingScore = new Map<string, number>();
    for (const edge of edges) {
      const score = edge.propagationScore * edge.confidence;
      incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + score);
      outgoingScore.set(edge.from, (outgoingScore.get(edge.from) ?? 0) + score);
    }

    const nodes: SupplyChainNode[] = baseNodes
      .map((node) => {
        const out = outgoingScore.get(node.ticker) ?? 0;
        const inc = incoming.get(node.ticker) ?? 0;
        const production = node.importance * 120 + out * 85;
        const demand = node.importance * 82 + inc * 90;
        const surplus = production - demand;
        return {
          ...node,
          production: Number(production.toFixed(2)),
          demand: Number(demand.toFixed(2)),
          imports: Number((surplus < 0 ? Math.abs(surplus) : 0).toFixed(2)),
          exports: Number((surplus > 0 ? surplus : 0).toFixed(2)),
          surplus: Number(surplus.toFixed(2)),
        };
      })
      .sort((a, b) => b.importance - a.importance);

    return {
      generatedAt: nowIso(),
      nodes,
      edges,
    };
  }
}

import { z } from "zod";
import type { Store } from "../store.js";
import type { RiskPolicy, RiskSnapshot } from "../types.js";
import { makeId, nowIso } from "../utils.js";

const riskPolicySchema = z.object({
  portfolioId: z.string().min(1).max(64),
  maxSingleNameWeight: z.number().min(0).max(1),
  maxSectorWeight: z.number().min(0).max(1),
  maxDrawdownPct: z.number().min(0).max(1),
  minLiquidityScore: z.number().min(0).max(1),
});

export type CreateRiskPolicyInput = z.infer<typeof riskPolicySchema>;

export class RiskService {
  constructor(private readonly store: Store) {}

  async savePolicy(input: CreateRiskPolicyInput): Promise<RiskPolicy> {
    const parsed = riskPolicySchema.parse(input);
    return this.store.transaction((state) => {
      const portfolio = state.portfolios.find((item) => item.id === parsed.portfolioId);
      if (!portfolio) {
        throw new Error(`Unknown portfolio ${parsed.portfolioId}`);
      }
      const now = nowIso();
      const existing = state.riskPolicies.find((item) => item.portfolioId === parsed.portfolioId);
      if (existing) {
        existing.maxSingleNameWeight = parsed.maxSingleNameWeight;
        existing.maxSectorWeight = parsed.maxSectorWeight;
        existing.maxDrawdownPct = parsed.maxDrawdownPct;
        existing.minLiquidityScore = parsed.minLiquidityScore;
        existing.updatedAt = now;
        return existing;
      }
      const policy: RiskPolicy = {
        id: makeId("riskpol"),
        portfolioId: parsed.portfolioId,
        maxSingleNameWeight: parsed.maxSingleNameWeight,
        maxSectorWeight: parsed.maxSectorWeight,
        maxDrawdownPct: parsed.maxDrawdownPct,
        minLiquidityScore: parsed.minLiquidityScore,
        createdAt: now,
        updatedAt: now,
      };
      state.riskPolicies.push(policy);
      return policy;
    });
  }

  async snapshot(portfolioId: string): Promise<RiskSnapshot> {
    return this.store.transaction((state) => {
      const portfolio = state.portfolios.find((item) => item.id === portfolioId);
      if (!portfolio) {
        throw new Error(`Unknown portfolio ${portfolioId}`);
      }
      const policy = state.riskPolicies.find((item) => item.portfolioId === portfolioId);
      if (!policy) {
        throw new Error(`Missing risk policy for portfolio ${portfolioId}`);
      }

      const totalMarketValue = portfolio.positions.reduce((sum, row) => sum + row.quantity * row.marketPrice, 0);
      const weights = portfolio.positions.map((row) => (totalMarketValue > 0 ? (row.quantity * row.marketPrice) / totalMarketValue : 0));
      const maxWeight = weights.length > 0 ? Math.max(...weights) : 0;
      const concentrationScore = Number(maxWeight.toFixed(4));

      const drawdownSeries = portfolio.positions.map((row) => (row.avgPrice - row.marketPrice) / row.avgPrice);
      const drawdownProxyPct = drawdownSeries.length > 0
        ? Number(Math.max(0, ...drawdownSeries).toFixed(4))
        : 0;

      const liquidityProxyScore = Number((1 - concentrationScore * 0.5).toFixed(4));

      const breachReasons: string[] = [];
      if (concentrationScore > policy.maxSingleNameWeight) {
        breachReasons.push(`Single-name concentration ${concentrationScore} exceeds ${policy.maxSingleNameWeight}`);
      }
      if (drawdownProxyPct > policy.maxDrawdownPct) {
        breachReasons.push(`Drawdown proxy ${drawdownProxyPct} exceeds ${policy.maxDrawdownPct}`);
      }
      if (liquidityProxyScore < policy.minLiquidityScore) {
        breachReasons.push(`Liquidity proxy ${liquidityProxyScore} below ${policy.minLiquidityScore}`);
      }

      const snapshot: RiskSnapshot = {
        id: makeId("risksnap"),
        portfolioId,
        concentrationScore,
        drawdownProxyPct,
        liquidityProxyScore,
        breached: breachReasons.length > 0,
        breachReasons,
        createdAt: nowIso(),
      };
      state.riskSnapshots.push(snapshot);
      if (state.riskSnapshots.length > 5000) {
        state.riskSnapshots = state.riskSnapshots.slice(-5000);
      }
      return snapshot;
    });
  }

  async snapshots(portfolioId: string, limit: number = 50): Promise<RiskSnapshot[]> {
    const state = await this.store.read();
    return state.riskSnapshots
      .filter((item) => item.portfolioId === portfolioId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}

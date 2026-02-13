import { z } from "zod";
import type { Store } from "../store.js";
import type { AlertDispatchRecord, AlertQualitySnapshot, AlertRuleConfig } from "../types.js";
import { makeId, nowIso } from "../utils.js";
import type { HeroScore } from "./mit/hero-analyst.js";

const ruleSchema = z.object({
  name: z.string().min(2).max(80),
  watchlistId: z.string().min(1).max(64).nullable(),
  minScore: z.number().min(0).max(1),
  severity: z.enum(["low", "medium", "high"]),
  cooldownMinutes: z.number().int().min(1).max(240),
  escalationMinutes: z.number().int().min(1).max(1_440),
  suppressionWindowMinutes: z.number().int().min(0).max(1_440),
  channels: z.array(z.enum(["terminal", "email", "webhook", "telegram"])).min(1).max(3),
  ownerUserId: z.string().min(1).max(64),
});

export type CreateAlertRuleInput = z.infer<typeof ruleSchema>;

export function formatHeroBrief(hero: HeroScore, scannedCount: number, validCount: number, portfolioCapital: number): string {
  const plan = hero.candidate.entryExitPlan;
  const riskAmount = (plan.stopLossPct * plan.buyZoneHigh) / 100 * portfolioCapital;
  const riskPct = plan.stopLossPct * 100;

  return `🧠 Safe Choice Bot Analysis
Scanned ${scannedCount} stocks. Found ${validCount} valid breakouts.

🏆 HERO PICK: ${hero.symbol}
Score: ${hero.totalScore}/100
Why: ${hero.narrative}
Metrics: Beta ${hero.metrics.beta.toFixed(2)} | Trend Stability ${(hero.metrics.r2 * 100).toFixed(0)}%

Trade Details:
Buy @ ${plan.buyZoneHigh.toFixed(0)} | Stop @ ${plan.stopLoss.toFixed(0)} | Target @ ${plan.firstTarget.toFixed(0)}
Risk: ₹${riskAmount.toFixed(0)} (${riskPct.toFixed(1)}% of capital)

[ EXECUTE HERO TRADE ]   [ PASS ]`;
}

export class AlertOrchestratorService {
  constructor(private readonly store: Store) {}

  async saveRule(input: CreateAlertRuleInput): Promise<AlertRuleConfig> {
    const parsed = ruleSchema.parse(input);
    return this.store.transaction((state) => {
      const now = nowIso();
      const row: AlertRuleConfig = {
        id: makeId("alrule"),
        name: parsed.name,
        watchlistId: parsed.watchlistId,
        minScore: parsed.minScore,
        severity: parsed.severity,
        cooldownMinutes: parsed.cooldownMinutes,
        escalationMinutes: parsed.escalationMinutes,
        suppressionWindowMinutes: parsed.suppressionWindowMinutes,
        channels: parsed.channels,
        ownerUserId: parsed.ownerUserId,
        createdAt: now,
        updatedAt: now,
      };
      state.alertRules.push(row);
      return row;
    });
  }

  async listRules(): Promise<AlertRuleConfig[]> {
    const state = await this.store.read();
    return [...state.alertRules].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async routeAlerts(limit: number = 100): Promise<AlertDispatchRecord[]> {
    return this.store.transaction((state) => {
      const rules = [...state.alertRules];
      const alerts = [...state.alerts]
        .sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt))
        .slice(0, limit);

      const dispatches: AlertDispatchRecord[] = [];
      for (const alert of alerts) {
        const signal = state.signals.find((item) => item.id === alert.signalId);
        if (!signal) {
          continue;
        }
        for (const rule of rules) {
          if (signal.score < rule.minScore || alert.severity !== rule.severity) {
            continue;
          }
          const recentForRule = state.alertDispatches
            .filter((item) => item.ruleId === rule.id && item.alertId === alert.id)
            .sort((a, b) => b.dispatchedAt.localeCompare(a.dispatchedAt))[0];
          for (const channel of rule.channels) {
            let status: AlertDispatchRecord["status"] = "delivered";
            let reason = "Delivered by matching rule";
            if (recentForRule) {
              const sinceLast = Date.now() - Date.parse(recentForRule.dispatchedAt);
              const cooldownMs = rule.cooldownMinutes * 60_000;
              if (sinceLast < cooldownMs) {
                status = "suppressed";
                reason = `Suppressed by cooldown (${rule.cooldownMinutes}m)`;
              }
            }
            if (status === "delivered" && alert.severity === "high") {
              const sinceAlert = Date.now() - Date.parse(alert.triggeredAt);
              if (sinceAlert > rule.escalationMinutes * 60_000) {
                status = "escalated";
                reason = `Escalated after ${rule.escalationMinutes}m`;
              }
            }
            const row: AlertDispatchRecord = {
              id: makeId("dispatch"),
              alertId: alert.id,
              ruleId: rule.id,
              userId: rule.ownerUserId,
              channel,
              status,
              reason,
              dispatchedAt: nowIso(),
            };
            state.alertDispatches.push(row);
            dispatches.push(row);
          }
        }
      }

      if (state.alertDispatches.length > 10_000) {
        state.alertDispatches = state.alertDispatches.slice(-10_000);
      }
      return dispatches;
    });
  }

  async quality(): Promise<AlertQualitySnapshot> {
    const state = await this.store.read();
    const dispatches = state.alertDispatches;
    const suppressed = dispatches.filter((item) => item.status === "suppressed").length;
    const escalated = dispatches.filter((item) => item.status === "escalated").length;

    const alertsBySignal = new Map<string, number>();
    for (const alert of state.alerts) {
      alertsBySignal.set(alert.signalId, (alertsBySignal.get(alert.signalId) ?? 0) + 1);
    }
    const duplicates = [...alertsBySignal.values()].filter((count) => count > 1).reduce((sum, count) => sum + (count - 1), 0);
    const duplicateRate = state.alerts.length > 0 ? duplicates / state.alerts.length : 0;

    return {
      generatedAt: nowIso(),
      totalAlerts: state.alerts.length,
      dispatches: dispatches.length,
      suppressed,
      escalated,
      duplicateRate: Number(duplicateRate.toFixed(4)),
      avgDispatchPerAlert: state.alerts.length > 0 ? Number((dispatches.length / state.alerts.length).toFixed(2)) : 0,
    };
  }
}

import type { AlertRecord, SignalRecord } from "../types.js";
import { makeId, nowIso } from "../utils.js";

const COOLDOWN_MS = 5 * 60 * 1000;

export class AlertService {
  shouldAlert(signal: SignalRecord, existingAlerts: AlertRecord[]): { create: boolean; severity: AlertRecord["severity"]; reason: string } {
    const lastAlert = existingAlerts
      .filter((item) => item.signalId === signal.id)
      .sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt))[0];

    if (lastAlert) {
      const elapsed = Date.now() - Date.parse(lastAlert.triggeredAt);
      if (elapsed < COOLDOWN_MS) {
        return {
          create: false,
          severity: "low",
          reason: "Suppressed by cooldown",
        };
      }
    }

    if (signal.score < 0.5) {
      return {
        create: false,
        severity: "low",
        reason: "Score below threshold",
      };
    }

    const severity = signal.score >= 0.8 ? "high" : signal.score >= 0.65 ? "medium" : "low";
    return {
      create: true,
      severity,
      reason: `Triggered on score ${(signal.score * 100).toFixed(1)}%`,
    };
  }

  makeAlert(signalId: string, severity: AlertRecord["severity"], reason: string): AlertRecord {
    return {
      id: makeId("alert"),
      signalId,
      severity,
      reason,
      triggeredAt: nowIso(),
    };
  }
}

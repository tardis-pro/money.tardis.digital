import type { Store } from "../store.js";
import type { EntityLinkDiagnostics } from "../types.js";

export class EntityLinkDiagnosticsService {
  constructor(private readonly store: Store) {}

  async summary(limit: number = 10): Promise<EntityLinkDiagnostics> {
    const state = await this.store.read();
    const totalSignals = state.signals.length;
    const signalsWithEntities = state.signals.filter((signal) => signal.linkedEntities.length > 0).length;
    const coverageRatio = totalSignals > 0 ? signalsWithEntities / totalSignals : 0;

    let confidenceSum = 0;
    let confidenceCount = 0;
    const map = new Map<string, { count: number; confidenceSum: number; reasons: Set<string> }>();

    for (const signal of state.signals) {
      for (const link of signal.linkedEntities) {
        confidenceSum += link.confidence;
        confidenceCount += 1;
        const current = map.get(link.ticker) ?? { count: 0, confidenceSum: 0, reasons: new Set<string>() };
        current.count += 1;
        current.confidenceSum += link.confidence;
        current.reasons.add(link.linkReason);
        map.set(link.ticker, current);
      }
    }

    const topEntityLinks = [...map.entries()]
      .map(([ticker, values]) => ({
        ticker,
        count: values.count,
        avgConfidence: values.count > 0 ? Number((values.confidenceSum / values.count).toFixed(4)) : 0,
        reasons: [...values.reasons].slice(0, 3),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    return {
      totalSignals,
      signalsWithEntities,
      coverageRatio,
      averageEntityConfidence: confidenceCount > 0 ? Number((confidenceSum / confidenceCount).toFixed(4)) : 0,
      topEntityLinks,
    };
  }
}

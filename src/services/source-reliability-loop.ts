import type { Store } from "../store.js";
import type { ReliabilityTier } from "../types.js";

function downgrade(tier: ReliabilityTier): ReliabilityTier {
  if (tier === "high") {
    return "medium";
  }
  if (tier === "medium") {
    return "low";
  }
  return "low";
}

export interface ReliabilityReviewAction {
  sourceId: string;
  fromTier: ReliabilityTier;
  toTier: ReliabilityTier;
  quarantined: boolean;
  validatedCount: number;
  noiseRatio: number;
}

export interface ReliabilityReviewReport {
  reviewedSources: number;
  actions: ReliabilityReviewAction[];
}

export class SourceReliabilityLoopService {
  constructor(private readonly store: Store) {}

  async runReview(): Promise<ReliabilityReviewReport> {
    const report = await this.store.transaction((state) => {
      const signalToSource = new Map<string, string>(state.signals.map((signal) => [signal.id, signal.sourceId]));
      const bySource = new Map<string, { validatedCount: number; noisyCount: number }>();

      for (const item of state.feedback) {
        if (item.reviewState !== "validated") {
          continue;
        }
        const sourceId = signalToSource.get(item.signalId);
        if (!sourceId) {
          continue;
        }
        const current = bySource.get(sourceId) ?? { validatedCount: 0, noisyCount: 0 };
        current.validatedCount += 1;
        if (item.label === "noise" || item.label === "wrong-direction" || item.label === "wrong-mapping") {
          current.noisyCount += 1;
        }
        bySource.set(sourceId, current);
      }

      const actions: ReliabilityReviewAction[] = [];
      for (const source of state.sources) {
        const stats = bySource.get(source.id);
        if (!stats || stats.validatedCount < 3) {
          continue;
        }
        const noiseRatio = stats.noisyCount / stats.validatedCount;
        if (noiseRatio < 0.5) {
          continue;
        }

        const fromTier = source.reliabilityTier;
        const toTier = downgrade(fromTier);
        source.reliabilityTier = toTier;

        const quarantined = noiseRatio >= 0.75;
        if (quarantined) {
          source.enabled = false;
        }

        actions.push({
          sourceId: source.id,
          fromTier,
          toTier,
          quarantined,
          validatedCount: stats.validatedCount,
          noiseRatio,
        });
      }

      return {
        reviewedSources: state.sources.length,
        actions,
      };
    });

    return report;
  }
}

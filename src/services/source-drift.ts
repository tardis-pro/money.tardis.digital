import type { Store } from "../store.js";
import type { SourceDriftEntry } from "../types.js";
import { clamp } from "../utils.js";

function artifactAgeSeconds(latestArtifactAt: string | null): number | null {
  if (!latestArtifactAt) {
    return null;
  }
  const parsed = Date.parse(latestArtifactAt);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.floor((Date.now() - parsed) / 1000));
}

export class SourceDriftService {
  constructor(private readonly store: Store) {}

  async detect(): Promise<SourceDriftEntry[]> {
    const state = await this.store.read();
    return state.sources
      .map((source) => {
        const sourceArtifacts = state.artifacts.filter((artifact) => artifact.sourceId === source.id);
        const sourceEvents = state.events.filter((event) => event.sourceId === source.id);
        const latestArtifactAt = [...sourceArtifacts].sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))[0]?.fetchedAt ?? null;
        const ageSeconds = artifactAgeSeconds(latestArtifactAt);
        const staleThreshold = source.pollingIntervalSeconds * 6;
        const stale = ageSeconds !== null ? ageSeconds > staleThreshold : true;

        const lowConfidence = sourceEvents.filter((event) => event.confidence < 0.55).length;
        const lowConfidenceRatio = sourceEvents.length > 0 ? lowConfidence / sourceEvents.length : 0;

        const fallbackArtifacts = sourceEvents.filter((event) => event.summary.includes("fallback payload")).length;
        const fallbackArtifactRatio = sourceEvents.length > 0 ? fallbackArtifacts / sourceEvents.length : 0;

        const freshnessPenalty = stale ? 0.45 : 0;
        const confidencePenalty = lowConfidenceRatio * 0.35;
        const fallbackPenalty = fallbackArtifactRatio * 0.45;
        const driftScore = clamp(freshnessPenalty + confidencePenalty + fallbackPenalty, 0, 1);

        const reasons: string[] = [];
        if (stale) {
          reasons.push(`Stale source feed (age ${ageSeconds ?? "unknown"}s > threshold ${staleThreshold}s)`);
        }
        if (lowConfidenceRatio >= 0.35) {
          reasons.push(`Low-confidence events ratio ${(lowConfidenceRatio * 100).toFixed(1)}%`);
        }
        if (fallbackArtifactRatio >= 0.2) {
          reasons.push(`Fallback payload ratio ${(fallbackArtifactRatio * 100).toFixed(1)}%`);
        }

        return {
          sourceId: source.id,
          sourceName: source.name,
          reliabilityTier: source.reliabilityTier,
          pollingIntervalSeconds: source.pollingIntervalSeconds,
          latestArtifactAt,
          ageSeconds,
          stale,
          lowConfidenceRatio,
          fallbackArtifactRatio,
          driftScore,
          reasons,
        } satisfies SourceDriftEntry;
      })
      .sort((a, b) => b.driftScore - a.driftScore);
  }
}

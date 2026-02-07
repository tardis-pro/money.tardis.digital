import type { Store } from "../store.js";
import type { BackfillDashboard, BackfillDuplicateEntry, BackfillReconciliationReport } from "../types.js";
import { nowIso } from "../utils.js";

function toMs(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class BackfillControlService {
  constructor(private readonly store: Store) {}

  async dashboard(): Promise<BackfillDashboard> {
    const state = await this.store.read();
    const runningRuns = state.backfillRuns.filter((item) => item.status === "running").length;
    const completedRuns = state.backfillRuns.filter((item) => item.status === "completed").length;
    const failedRuns = state.backfillRuns.filter((item) => item.status === "failed").length;

    let completedDurations = 0;
    let completedDurationCount = 0;
    for (const run of state.backfillRuns) {
      if (run.status !== "completed" || !run.completedAt) {
        continue;
      }
      const started = toMs(run.startedAt);
      const completed = toMs(run.completedAt);
      if (started === null || completed === null || completed < started) {
        continue;
      }
      completedDurations += completed - started;
      completedDurationCount += 1;
    }

    const latestRunStartedAt = [...state.backfillRuns]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]?.startedAt ?? null;

    return {
      totalRuns: state.backfillRuns.length,
      runningRuns,
      completedRuns,
      failedRuns,
      totalSeededSignals: state.backfillRuns.reduce((sum, item) => sum + item.seededSignals, 0),
      totalSkippedDuplicates: state.backfillRuns.reduce((sum, item) => sum + item.skippedDuplicates, 0),
      avgRunDurationMs: completedDurationCount > 0 ? Math.round(completedDurations / completedDurationCount) : 0,
      latestRunStartedAt,
    };
  }

  async reconcile(limit: number = 100): Promise<BackfillReconciliationReport> {
    const state = await this.store.read();
    const groups = new Map<string, BackfillDuplicateEntry>();
    for (const artifact of state.artifacts) {
      const groupKey = `${artifact.sourceId}:${artifact.contentHash}`;
      const current = groups.get(groupKey) ?? {
        sourceId: artifact.sourceId,
        contentHash: artifact.contentHash,
        duplicateCount: 0,
        artifactIds: [],
      };
      current.duplicateCount += 1;
      current.artifactIds.push(artifact.id);
      groups.set(groupKey, current);
    }

    const duplicates = [...groups.values()]
      .filter((item) => item.duplicateCount > 1)
      .sort((a, b) => b.duplicateCount - a.duplicateCount)
      .slice(0, limit);

    const bySourceMap = new Map<string, { duplicateGroups: number; duplicateArtifacts: number }>();
    let totalDuplicateArtifacts = 0;
    for (const duplicate of duplicates) {
      const duplicateArtifacts = duplicate.duplicateCount - 1;
      totalDuplicateArtifacts += duplicateArtifacts;
      const current = bySourceMap.get(duplicate.sourceId) ?? { duplicateGroups: 0, duplicateArtifacts: 0 };
      current.duplicateGroups += 1;
      current.duplicateArtifacts += duplicateArtifacts;
      bySourceMap.set(duplicate.sourceId, current);
    }

    return {
      generatedAt: nowIso(),
      totalArtifacts: state.artifacts.length,
      duplicateGroups: duplicates.length,
      totalDuplicateArtifacts,
      bySource: [...bySourceMap.entries()].map(([sourceId, metrics]) => ({
        sourceId,
        duplicateGroups: metrics.duplicateGroups,
        duplicateArtifacts: metrics.duplicateArtifacts,
      })),
      duplicates,
    };
  }
}

import type { Store } from "../store.js";
import type { DataQualityIssue } from "../types.js";
import { makeId, nowIso } from "../utils.js";

export class DataQualityService {
  constructor(private readonly store: Store) {}

  async report(
    sourceId: string,
    stage: DataQualityIssue["stage"],
    details: string,
    artifactId: string | null,
  ): Promise<DataQualityIssue> {
    return this.store.transaction((state) => {
      const issue: DataQualityIssue = {
        id: makeId("dq"),
        sourceId,
        stage,
        artifactId,
        details,
        status: "open",
        detectedAt: nowIso(),
        resolvedAt: null,
      };
      state.dataQualityIssues.push(issue);
      return issue;
    });
  }

  async resolve(issueId: string): Promise<DataQualityIssue> {
    return this.store.transaction((state) => {
      const issue = state.dataQualityIssues.find((item) => item.id === issueId);
      if (!issue) {
        throw new Error(`Unknown data quality issue ${issueId}`);
      }
      issue.status = "resolved";
      issue.resolvedAt = nowIso();
      return issue;
    });
  }

  async list(): Promise<DataQualityIssue[]> {
    const state = await this.store.read();
    return [...state.dataQualityIssues].sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  }
}

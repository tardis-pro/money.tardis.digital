import { z } from "zod";
import type { Store } from "../store.js";
import type { ProgramRecord } from "../types.js";
import { makeId, nowIso } from "../utils.js";

const scorecardSchema = z.object({
  desk: z.string().min(2).max(80),
  latencyScore: z.number().min(0).max(1),
  trustScore: z.number().min(0).max(1),
  utilityScore: z.number().min(0).max(1),
  reviewer: z.string().min(1).max(64),
});

const defectSchema = z.object({
  title: z.string().min(3).max(140),
  severity: z.enum(["critical", "high", "medium", "low"]),
  status: z.enum(["open", "in-progress", "resolved"]),
  owner: z.string().min(1).max(64),
});

export class PilotService {
  constructor(private readonly store: Store) {}

  private push(kind: ProgramRecord["kind"], key: string, payload: ProgramRecord["payload"]): Promise<ProgramRecord> {
    return this.store.transaction((state) => {
      const now = nowIso();
      const row: ProgramRecord = {
        id: makeId("prog"),
        kind,
        key,
        payload,
        createdAt: now,
        updatedAt: now,
      };
      state.programRecords.push(row);
      return row;
    });
  }

  async addScorecard(input: unknown): Promise<ProgramRecord> {
    const parsed = scorecardSchema.parse(input);
    return this.push("pilot-scorecard", `${parsed.desk}:${Date.now()}`, {
      desk: parsed.desk,
      latencyScore: parsed.latencyScore,
      trustScore: parsed.trustScore,
      utilityScore: parsed.utilityScore,
      reviewer: parsed.reviewer,
    });
  }

  async addDefect(input: unknown): Promise<ProgramRecord> {
    const parsed = defectSchema.parse(input);
    return this.push("defect", `${parsed.title}:${Date.now()}`, {
      title: parsed.title,
      severity: parsed.severity,
      status: parsed.status,
      owner: parsed.owner,
    });
  }

  async list(kind: ProgramRecord["kind"], limit: number = 200): Promise<ProgramRecord[]> {
    const state = await this.store.read();
    return state.programRecords
      .filter((row) => row.kind === kind)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async readiness(): Promise<{
    generatedAt: string;
    scorecards: number;
    avgLatencyScore: number;
    avgTrustScore: number;
    avgUtilityScore: number;
    openCriticalDefects: number;
    launchReady: boolean;
  }> {
    const state = await this.store.read();
    const scorecards = state.programRecords.filter((row) => row.kind === "pilot-scorecard");
    const defects = state.programRecords.filter((row) => row.kind === "defect");

    const avg = (key: "latencyScore" | "trustScore" | "utilityScore"): number => {
      if (scorecards.length === 0) {
        return 0;
      }
      const total = scorecards.reduce((sum, row) => sum + (typeof row.payload[key] === "number" ? row.payload[key] : 0), 0);
      return Number((total / scorecards.length).toFixed(4));
    };

    const openCriticalDefects = defects.filter(
      (row) => row.payload.severity === "critical" && row.payload.status !== "resolved",
    ).length;
    const launchReady = scorecards.length > 0 && avg("trustScore") >= 0.7 && openCriticalDefects === 0;

    return {
      generatedAt: nowIso(),
      scorecards: scorecards.length,
      avgLatencyScore: avg("latencyScore"),
      avgTrustScore: avg("trustScore"),
      avgUtilityScore: avg("utilityScore"),
      openCriticalDefects,
      launchReady,
    };
  }
}

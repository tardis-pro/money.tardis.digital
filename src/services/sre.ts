import { z } from "zod";
import type { Store } from "../store.js";
import type { ProgramRecord } from "../types.js";
import { makeId, nowIso } from "../utils.js";

const sloSchema = z.object({
  subsystem: z.string().min(2).max(80),
  uptimeTarget: z.number().min(0).max(1),
  p95LatencyMsTarget: z.number().int().positive().max(60_000),
  errorBudgetPct: z.number().min(0).max(1),
  owner: z.string().min(1).max(64),
});

const chaosSchema = z.object({
  scenario: z.string().min(3).max(200),
  result: z.enum(["pass", "fail"]),
  mttrMinutes: z.number().int().min(0).max(10_000),
  owner: z.string().min(1).max(64),
});

export class SreService {
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

  async addSloBudget(input: unknown): Promise<ProgramRecord> {
    const parsed = sloSchema.parse(input);
    return this.push("slo-budget", `${parsed.subsystem}:${Date.now()}`, {
      subsystem: parsed.subsystem,
      uptimeTarget: parsed.uptimeTarget,
      p95LatencyMsTarget: parsed.p95LatencyMsTarget,
      errorBudgetPct: parsed.errorBudgetPct,
      owner: parsed.owner,
    });
  }

  async addChaosDrill(input: unknown): Promise<ProgramRecord> {
    const parsed = chaosSchema.parse(input);
    return this.push("chaos-drill", `${parsed.scenario}:${Date.now()}`, {
      scenario: parsed.scenario,
      result: parsed.result,
      mttrMinutes: parsed.mttrMinutes,
      owner: parsed.owner,
    });
  }

  async list(kind: ProgramRecord["kind"], limit: number = 100): Promise<ProgramRecord[]> {
    const state = await this.store.read();
    return state.programRecords
      .filter((row) => row.kind === kind)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async status(): Promise<{
    generatedAt: string;
    sloCount: number;
    chaosDrills: number;
    chaosPassRate: number;
    avgMttrMinutes: number;
  }> {
    const state = await this.store.read();
    const slos = state.programRecords.filter((row) => row.kind === "slo-budget");
    const drills = state.programRecords.filter((row) => row.kind === "chaos-drill");
    const passCount = drills.filter((row) => row.payload.result === "pass").length;
    const mttrs = drills
      .map((row) => (typeof row.payload.mttrMinutes === "number" ? row.payload.mttrMinutes : null))
      .filter((value): value is number => value !== null);
    return {
      generatedAt: nowIso(),
      sloCount: slos.length,
      chaosDrills: drills.length,
      chaosPassRate: drills.length > 0 ? Number((passCount / drills.length).toFixed(4)) : 1,
      avgMttrMinutes: mttrs.length > 0 ? Number((mttrs.reduce((s, v) => s + v, 0) / mttrs.length).toFixed(2)) : 0,
    };
  }
}

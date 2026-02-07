import { z } from "zod";
import type { Store } from "../store.js";
import type { ProgramRecord } from "../types.js";
import { makeId, nowIso } from "../utils.js";

const macroSchema = z.object({
  userId: z.string().min(1).max(64),
  name: z.string().min(2).max(80),
  commands: z.array(z.string().min(1).max(120)).min(1).max(20),
  reversible: z.boolean(),
});

const presetSchema = z.object({
  role: z.enum(["viewer", "analyst", "operator", "admin"]),
  name: z.string().min(2).max(80),
  routes: z.array(z.string().min(1).max(40)).min(1).max(20),
});

const onboardingSchema = z.object({
  userId: z.string().min(1).max(64),
  completedSteps: z.number().int().min(0).max(50),
  totalSteps: z.number().int().min(1).max(50),
  sessionMinutes: z.number().int().min(0).max(10_000),
});

export class PersonalizationService {
  constructor(private readonly store: Store) {}

  private upsert(kind: ProgramRecord["kind"], key: string, payload: ProgramRecord["payload"]): Promise<ProgramRecord> {
    return this.store.transaction((state) => {
      const now = nowIso();
      const existing = state.programRecords.find((row) => row.kind === kind && row.key === key);
      if (existing) {
        existing.payload = payload;
        existing.updatedAt = now;
        return existing;
      }
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

  async saveMacro(input: unknown): Promise<ProgramRecord> {
    const parsed = macroSchema.parse(input);
    return this.upsert("macro", `${parsed.userId}:${parsed.name}`, {
      userId: parsed.userId,
      name: parsed.name,
      commands: parsed.commands,
      reversible: parsed.reversible,
    });
  }

  async savePreset(input: unknown): Promise<ProgramRecord> {
    const parsed = presetSchema.parse(input);
    return this.upsert("workspace-preset", `${parsed.role}:${parsed.name}`, {
      role: parsed.role,
      name: parsed.name,
      routes: parsed.routes,
    });
  }

  async recordOnboarding(input: unknown): Promise<ProgramRecord> {
    const parsed = onboardingSchema.parse(input);
    const completionRate = parsed.completedSteps / parsed.totalSteps;
    return this.upsert("onboarding-metric", parsed.userId, {
      userId: parsed.userId,
      completedSteps: parsed.completedSteps,
      totalSteps: parsed.totalSteps,
      completionRate: Number(completionRate.toFixed(4)),
      sessionMinutes: parsed.sessionMinutes,
    });
  }

  async list(kind: ProgramRecord["kind"], limit: number = 100): Promise<ProgramRecord[]> {
    const state = await this.store.read();
    return state.programRecords
      .filter((row) => row.kind === kind)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async adoption(): Promise<{
    generatedAt: string;
    macros: number;
    presets: number;
    onboardingUsers: number;
    avgCompletionRate: number;
  }> {
    const state = await this.store.read();
    const macros = state.programRecords.filter((row) => row.kind === "macro");
    const presets = state.programRecords.filter((row) => row.kind === "workspace-preset");
    const onboarding = state.programRecords.filter((row) => row.kind === "onboarding-metric");
    const avgCompletionRate = onboarding.length > 0
      ? onboarding.reduce((sum, row) => sum + (typeof row.payload.completionRate === "number" ? row.payload.completionRate : 0), 0) / onboarding.length
      : 0;
    return {
      generatedAt: nowIso(),
      macros: macros.length,
      presets: presets.length,
      onboardingUsers: onboarding.length,
      avgCompletionRate: Number(avgCompletionRate.toFixed(4)),
    };
  }
}

import { z } from "zod";
import type { Store } from "../store.js";
import type { ProgramRecord } from "../types.js";
import { makeId, nowIso } from "../utils.js";

const checklistSchema = z.object({
  item: z.string().min(3).max(160),
  owner: z.string().min(1).max(64),
  completed: z.boolean(),
  rollbackReady: z.boolean(),
});

const cadenceSchema = z.object({
  meeting: z.string().min(2).max(120),
  frequency: z.enum(["daily", "weekly", "bi-weekly", "monthly"]),
  owner: z.string().min(1).max(64),
  scope: z.string().min(3).max(300),
});

export class LaunchService {
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

  async addChecklistItem(input: unknown): Promise<ProgramRecord> {
    const parsed = checklistSchema.parse(input);
    return this.push("launch-checklist", `${parsed.item}:${Date.now()}`, {
      item: parsed.item,
      owner: parsed.owner,
      completed: parsed.completed,
      rollbackReady: parsed.rollbackReady,
    });
  }

  async addCadence(input: unknown): Promise<ProgramRecord> {
    const parsed = cadenceSchema.parse(input);
    return this.push("ops-cadence", `${parsed.meeting}:${Date.now()}`, {
      meeting: parsed.meeting,
      frequency: parsed.frequency,
      owner: parsed.owner,
      scope: parsed.scope,
    });
  }

  async list(kind: ProgramRecord["kind"], limit: number = 200): Promise<ProgramRecord[]> {
    const state = await this.store.read();
    return state.programRecords
      .filter((row) => row.kind === kind)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async launchStatus(): Promise<{
    generatedAt: string;
    checklistItems: number;
    completedItems: number;
    rollbackReadyItems: number;
    cadenceItems: number;
    gateEReady: boolean;
  }> {
    const state = await this.store.read();
    const checklist = state.programRecords.filter((row) => row.kind === "launch-checklist");
    const cadence = state.programRecords.filter((row) => row.kind === "ops-cadence");
    const completedItems = checklist.filter((row) => row.payload.completed === true).length;
    const rollbackReadyItems = checklist.filter((row) => row.payload.rollbackReady === true).length;
    const gateEReady = checklist.length > 0 && completedItems === checklist.length && rollbackReadyItems === checklist.length;
    return {
      generatedAt: nowIso(),
      checklistItems: checklist.length,
      completedItems,
      rollbackReadyItems,
      cadenceItems: cadence.length,
      gateEReady,
    };
  }
}

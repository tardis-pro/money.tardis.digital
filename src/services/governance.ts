import { z } from "zod";
import type { Store } from "../store.js";
import type { GovernanceChangeRecord } from "../types.js";
import { makeId, nowIso } from "../utils.js";

const governanceChangeSchema = z.object({
  category: z.enum(["source", "model", "pipeline"]),
  actor: z.string().min(1),
  summary: z.string().min(3).max(1_000),
  rollbackReady: z.boolean(),
});

export type GovernanceChangeInput = z.infer<typeof governanceChangeSchema>;

export class GovernanceService {
  constructor(private readonly store: Store) {}

  async log(input: GovernanceChangeInput): Promise<GovernanceChangeRecord> {
    const parsed = governanceChangeSchema.parse(input);
    return this.store.transaction((state) => {
      const record: GovernanceChangeRecord = {
        id: makeId("gov"),
        category: parsed.category,
        actor: parsed.actor,
        summary: parsed.summary,
        rollbackReady: parsed.rollbackReady,
        createdAt: nowIso(),
      };
      state.governanceChanges.push(record);
      return record;
    });
  }

  async list(): Promise<GovernanceChangeRecord[]> {
    const state = await this.store.read();
    return [...state.governanceChanges].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

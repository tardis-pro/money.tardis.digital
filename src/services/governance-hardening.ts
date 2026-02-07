import { z } from "zod";
import type { Store } from "../store.js";
import type { ProgramRecord } from "../types.js";
import { makeId, nowIso } from "../utils.js";

const releaseGateSchema = z.object({
  gateName: z.string().min(2).max(80),
  actor: z.string().min(1).max(64),
  checks: z.array(z.string().min(2).max(120)).min(1).max(20),
});

const runbookSchema = z.object({
  name: z.string().min(2).max(120),
  severity: z.enum(["sev1", "sev2", "sev3"]),
  steps: z.array(z.string().min(4).max(400)).min(2).max(20),
  owner: z.string().min(1).max(64),
});

export class GovernanceHardeningService {
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

  async saveReleaseGate(input: unknown): Promise<ProgramRecord> {
    const parsed = releaseGateSchema.parse(input);
    const state = await this.store.read();
    const entitlementExceptions = state.accessAudits.filter((row) => !row.allowed).length;
    const openDataQuality = state.dataQualityIssues.filter((row) => row.status === "open").length;
    const payload: ProgramRecord["payload"] = {
      gateName: parsed.gateName,
      actor: parsed.actor,
      checks: parsed.checks,
      entitlementExceptions,
      openDataQuality,
      pass: entitlementExceptions === 0 && openDataQuality === 0,
    };
    return this.upsert("release-gate", parsed.gateName, payload);
  }

  async saveRunbook(input: unknown): Promise<ProgramRecord> {
    const parsed = runbookSchema.parse(input);
    return this.upsert("incident-runbook", parsed.name, {
      name: parsed.name,
      severity: parsed.severity,
      steps: parsed.steps,
      owner: parsed.owner,
    });
  }

  async policyChecks(): Promise<{
    generatedAt: string;
    entitlementExceptions: number;
    openDataQualityIssues: number;
    unresolvedGovernanceChanges: number;
    pass: boolean;
  }> {
    const state = await this.store.read();
    const entitlementExceptions = state.accessAudits.filter((row) => !row.allowed).length;
    const openDataQualityIssues = state.dataQualityIssues.filter((row) => row.status === "open").length;
    const unresolvedGovernanceChanges = state.governanceChanges.filter((row) => !row.rollbackReady).length;
    return {
      generatedAt: nowIso(),
      entitlementExceptions,
      openDataQualityIssues,
      unresolvedGovernanceChanges,
      pass: entitlementExceptions === 0 && openDataQualityIssues === 0 && unresolvedGovernanceChanges === 0,
    };
  }

  async list(kind: ProgramRecord["kind"], limit: number = 100): Promise<ProgramRecord[]> {
    const state = await this.store.read();
    return state.programRecords
      .filter((row) => row.kind === kind)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }
}

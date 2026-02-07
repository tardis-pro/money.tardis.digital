import { z } from "zod";
import type { Store } from "../store.js";
import type { ProgramRecord } from "../types.js";
import { makeId, nowIso } from "../utils.js";

const notebookSchema = z.object({
  page: z.string().min(1).max(80),
  title: z.string().min(2).max(120),
  content: z.string().min(5).max(20_000),
  author: z.string().min(1).max(64),
});

const templateSchema = z.object({
  name: z.string().min(2).max(120),
  command: z.string().min(2).max(500),
  owner: z.string().min(1).max(64),
});

const commentSchema = z.object({
  artifactId: z.string().min(1).max(120),
  comment: z.string().min(2).max(2_000),
  author: z.string().min(1).max(64),
});

export class ResearchService {
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

  async saveNotebook(input: unknown): Promise<ProgramRecord> {
    const parsed = notebookSchema.parse(input);
    return this.upsert("notebook", `${parsed.page}:${parsed.title}`, {
      page: parsed.page,
      title: parsed.title,
      content: parsed.content,
      author: parsed.author,
    });
  }

  async saveQueryTemplate(input: unknown): Promise<ProgramRecord> {
    const parsed = templateSchema.parse(input);
    return this.upsert("query-template", parsed.name, {
      name: parsed.name,
      command: parsed.command,
      owner: parsed.owner,
    });
  }

  async addComment(input: unknown): Promise<ProgramRecord> {
    const parsed = commentSchema.parse(input);
    return this.upsert("comment", `${parsed.artifactId}:${parsed.author}`, {
      artifactId: parsed.artifactId,
      comment: parsed.comment,
      author: parsed.author,
    });
  }

  async evidencePack(signalId: string): Promise<ProgramRecord> {
    const state = await this.store.read();
    const signal = state.signals.find((item) => item.id === signalId);
    if (!signal) {
      throw new Error(`Unknown signal ${signalId}`);
    }
    const payload: ProgramRecord["payload"] = {
      signalId,
      title: signal.event.title,
      summary: signal.event.summary,
      evidenceSnippet: signal.event.evidenceSnippet,
      score: Number(signal.score.toFixed(4)),
      confidence: Number(signal.impact.confidence.toFixed(4)),
    };
    return this.upsert("evidence-pack", signalId, payload);
  }

  async list(kind: ProgramRecord["kind"], limit: number = 100): Promise<ProgramRecord[]> {
    const state = await this.store.read();
    return state.programRecords
      .filter((row) => row.kind === kind)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }
}

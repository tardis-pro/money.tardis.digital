import { z } from "zod";
import type { SourceRegistryItem } from "../types.js";
import type { Store } from "../store.js";

const sourceSchema = z.object({
  id: z.string().min(2),
  name: z.string().min(2),
  url: z.string().url(),
  format: z.enum(["rss", "xml", "html", "pdf", "screenipy"]),
  parserType: z.enum(["rss", "xml", "html", "pdf-ocr", "screenipy"]),
  pollingIntervalSeconds: z.number().int().positive(),
  reliabilityTier: z.enum(["high", "medium", "low"]),
  licenseTag: z.string().min(1),
  enabled: z.boolean(),
});

export type CreateSourceInput = z.infer<typeof sourceSchema>;

export class SourceRegistryService {
  constructor(private readonly store: Store) {}

  async list(): Promise<SourceRegistryItem[]> {
    const state = await this.store.read();
    return state.sources;
  }

  async add(input: CreateSourceInput): Promise<SourceRegistryItem> {
    const parsed = sourceSchema.parse(input);
    return this.store.transaction((state) => {
      const existing = state.sources.find((source) => source.id === parsed.id);
      if (existing) {
        throw new Error(`Source already exists: ${parsed.id}`);
      }
      state.sources.push(parsed);
      return parsed;
    });
  }

  async updateReliability(sourceId: string, tier: SourceRegistryItem["reliabilityTier"]): Promise<void> {
    await this.store.transaction((state) => {
      const source = state.sources.find((entry) => entry.id === sourceId);
      if (!source) {
        throw new Error(`Unknown source: ${sourceId}`);
      }
      source.reliabilityTier = tier;
    });
  }

  async setEnabled(sourceId: string, enabled: boolean): Promise<SourceRegistryItem> {
    return this.store.transaction((state) => {
      const source = state.sources.find((entry) => entry.id === sourceId);
      if (!source) {
        throw new Error(`Unknown source: ${sourceId}`);
      }
      source.enabled = enabled;
      return source;
    });
  }
}

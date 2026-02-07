import { z } from "zod";
import type { Store } from "../store.js";
import type { ChartAnnotation, ChartTemplate } from "../types.js";
import { makeId, nowIso } from "../utils.js";

const chartTemplateSchema = z.object({
  name: z.string().min(2).max(80),
  ticker: z.string().min(1).max(24),
  timeframe: z.enum(["intraday", "1D", "1W"]),
  overlays: z.array(z.string().min(1).max(40)).max(12),
  studies: z.array(z.string().min(1).max(40)).max(12),
});

export type CreateChartTemplateInput = z.infer<typeof chartTemplateSchema>;

export class ChartingService {
  constructor(private readonly store: Store) {}

  async saveTemplate(input: CreateChartTemplateInput): Promise<ChartTemplate> {
    const parsed = chartTemplateSchema.parse(input);
    return this.store.transaction((state) => {
      const now = nowIso();
      const template: ChartTemplate = {
        id: makeId("chart"),
        name: parsed.name,
        ticker: parsed.ticker.toUpperCase(),
        timeframe: parsed.timeframe,
        overlays: parsed.overlays,
        studies: parsed.studies,
        createdAt: now,
        updatedAt: now,
      };
      state.chartTemplates.push(template);
      return template;
    });
  }

  async templates(): Promise<ChartTemplate[]> {
    const state = await this.store.read();
    return [...state.chartTemplates].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async annotations(ticker: string, limit: number = 25): Promise<ChartAnnotation[]> {
    const tickerUpper = ticker.trim().toUpperCase();
    if (!tickerUpper) {
      return [];
    }
    const state = await this.store.read();
    return state.signals
      .filter((signal) => signal.linkedEntities.some((entity) => entity.ticker === tickerUpper))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((signal) => ({
        signalId: signal.id,
        ticker: tickerUpper,
        at: signal.createdAt,
        title: signal.event.title,
        score: Number(signal.score.toFixed(4)),
        direction: signal.impact.direction,
        confidence: Number(signal.impact.confidence.toFixed(4)),
      }));
  }
}

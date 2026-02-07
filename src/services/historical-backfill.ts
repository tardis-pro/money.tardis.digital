import { writeFile } from "node:fs/promises";
import entityMap from "../config/entity-map.json" with { type: "json" };
import notableEvents from "../config/notable-events.json" with { type: "json" };
import type {
  AlertRecord,
  AuditRecord,
  BackfillRunRecord,
  EventRecord,
  LinkedEntity,
  RawArtifact,
  SignalRecord,
  SourceRegistryItem,
} from "../types.js";
import type { Store } from "../store.js";
import { makeId, nowIso, sha256 } from "../utils.js";
import { AlertService } from "./alerts.js";
import { ImpactScorerService } from "./impact-scorer.js";
import { PredictionService } from "./prediction.js";

interface NotableEventSeed {
  id: string;
  title: string;
  summary: string;
  publishedAt: string;
  eventType: EventRecord["eventType"];
  sourceUrl: string;
  tickers: string[];
}

interface EntityMapEntry {
  ticker: string;
  sector: string;
  ministry: string | null;
}

export interface HistoricalBackfillInput {
  from?: string;
  to?: string;
  tickers?: string[];
  limit?: number;
  offset?: number;
  batchSize?: number;
}

export interface HistoricalBackfillResult {
  runId: string;
  status: BackfillRunRecord["status"];
  hasMore: boolean;
  nextOffset: number;
  loadedSeeds: number;
  seededSignals: number;
  createdAlerts: number;
  skippedDuplicates: number;
}

const DEFAULT_SOURCE_ID = "notable_events_catalog";

function parseIso(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return date;
}

function computeFinalScore(signal: SignalRecord): number {
  const directionBoost = signal.impact.direction === "positive" ? 0.08 : signal.impact.direction === "negative" ? 0.06 : 0;
  return Math.min(
    1,
    signal.impact.confidence * 0.35 +
      signal.impact.magnitude * 0.25 +
      signal.prediction.calibratedConfidence * 0.3 +
      directionBoost,
  );
}

function normalizedTickers(input?: string[]): string[] {
  return (input ?? []).map((item) => item.trim().toUpperCase()).filter((item) => item.length > 0);
}

export class HistoricalBackfillService {
  private readonly impactScorer = new ImpactScorerService();
  private readonly predictionService = new PredictionService();
  private readonly alertService = new AlertService();
  private readonly entityLookup = new Map<string, EntityMapEntry>((entityMap as EntityMapEntry[]).map((item) => [item.ticker, item]));
  private readonly seeds = notableEvents as NotableEventSeed[];

  constructor(private readonly store: Store) {}

  private ensureSource(stateSources: SourceRegistryItem[]): SourceRegistryItem {
    const existing = stateSources.find((item) => item.id === DEFAULT_SOURCE_ID);
    if (existing) {
      return existing;
    }

    const source: SourceRegistryItem = {
      id: DEFAULT_SOURCE_ID,
      name: "Historical Notable Events Catalog",
      url: "https://www.data.gov.in/",
      format: "html",
      parserType: "html",
      pollingIntervalSeconds: 86_400,
      reliabilityTier: "high",
      licenseTag: "curated-catalog",
      enabled: true,
    };
    stateSources.push(source);
    return source;
  }

  private linksForTickers(tickers: string[], eventTitle: string): LinkedEntity[] {
    if (tickers.length === 0) {
      return [
        {
          ticker: "NIFTY50",
          sector: "broad-market",
          ministry: null,
          linkReason: "Catalog event without explicit ticker mapping",
          confidence: 0.45,
        },
      ];
    }

    return tickers.map((ticker) => {
      const mapped = this.entityLookup.get(ticker);
      return {
        ticker,
        sector: mapped?.sector ?? "unknown",
        ministry: mapped?.ministry ?? null,
        linkReason: `Curated notable event mapping for ${eventTitle}`,
        confidence: mapped ? 0.9 : 0.72,
      } satisfies LinkedEntity;
    });
  }

  private makeAudit(signal: SignalRecord, artifact: RawArtifact): AuditRecord {
    return {
      id: makeId("audit"),
      signalId: signal.id,
      sourceUrl: artifact.sourceUrl,
      sourceHash: artifact.contentHash,
      parserVersion: artifact.parserVersion,
      modelVersion: signal.prediction.modelVersion,
      featureSnapshot: signal.impact.featureSnapshot,
      createdAt: signal.createdAt,
    };
  }

  async run(input: HistoricalBackfillInput): Promise<HistoricalBackfillResult> {
    const from = input.from ? parseIso(input.from) : new Date("2000-01-01T00:00:00.000Z");
    const to = input.to ? parseIso(input.to) : new Date("2100-01-01T00:00:00.000Z");
    if (to < from) {
      throw new Error("Invalid backfill range: 'to' must be greater than or equal to 'from'.");
    }
    const tickerFilter = new Set(normalizedTickers(input.tickers));
    const offset = Math.max(0, input.offset ?? 0);
    const runId = makeId("backfill");
    const startedAt = nowIso();

    await this.store.transaction((state) => {
      const run: BackfillRunRecord = {
        id: runId,
        kind: "notable",
        status: "running",
        from: from.toISOString(),
        to: to.toISOString(),
        tickers: [...tickerFilter],
        limit: input.limit ?? this.seeds.length,
        offset,
        batchSize: input.batchSize ?? input.limit ?? this.seeds.length,
        nextOffset: offset,
        hasMore: false,
        loadedSeeds: 0,
        seededSignals: 0,
        createdAlerts: 0,
        skippedDuplicates: 0,
        startedAt,
        completedAt: null,
        error: null,
      };
      state.backfillRuns.push(run);
    });

    const matchingSeeds = this.seeds
      .filter((seed) => {
        const eventAt = parseIso(seed.publishedAt);
        if (eventAt < from || eventAt > to) {
          return false;
        }
        if (tickerFilter.size === 0) {
          return true;
        }
        return seed.tickers.some((ticker) => tickerFilter.has(ticker));
      });
    const batchSize = Math.max(1, input.batchSize ?? input.limit ?? matchingSeeds.length);
    const selectedSeeds = matchingSeeds.slice(offset, offset + batchSize);
    const nextOffset = offset + selectedSeeds.length;
    const hasMore = nextOffset < matchingSeeds.length;

    const bodyWrites: Array<{ bodyPath: string; body: string }> = [];

    try {
      const result = await this.store.transaction((state) => {
        const source = this.ensureSource(state.sources);
        let seededSignals = 0;
        let createdAlerts = 0;
        let skippedDuplicates = 0;

        for (const seed of selectedSeeds) {
        const body = `${seed.title}. ${seed.summary}`;
        const contentHash = sha256(`${seed.id}:${seed.publishedAt}:${body}`);
        const duplicate = state.artifacts.find(
          (artifact) => artifact.sourceId === source.id && artifact.contentHash === contentHash,
        );
        if (duplicate) {
          skippedDuplicates += 1;
          continue;
        }

        const artifactId = makeId("artifact");
        const artifact: RawArtifact = {
          id: artifactId,
          sourceId: source.id,
          sourceUrl: seed.sourceUrl,
          fetchedAt: seed.publishedAt,
          contentHash,
          parserVersion: "parser-v1",
          modelVersion: "predictor-v1",
          contentType: "text/plain",
          bodyPath: `${this.store.getArtifactsDir()}/${artifactId}.txt`,
          metadata: {
            sourceName: source.name,
            parserType: source.parserType,
            catalogSeedId: seed.id,
          },
        };
        state.artifacts.push(artifact);
        bodyWrites.push({ bodyPath: artifact.bodyPath, body });

        const event: EventRecord = {
          id: makeId("event"),
          artifactId: artifact.id,
          sourceId: source.id,
          eventType: seed.eventType,
          title: seed.title,
          summary: seed.summary,
          evidenceSnippet: seed.summary.slice(0, 220),
          publishedAt: seed.publishedAt,
          noveltyScore: 0.78,
          confidence: 0.83,
        };
        state.events.push(event);

        const linkedEntities = this.linksForTickers(seed.tickers, seed.title);
        const impact = this.impactScorer.score(event, linkedEntities, source);
        const prediction = this.predictionService.predict(impact);
        const signal: SignalRecord = {
          id: makeId("signal"),
          createdAt: seed.publishedAt,
          sourceId: source.id,
          event,
          linkedEntities,
          impact,
          prediction,
          score: 0,
          status: "active",
        };
        signal.score = computeFinalScore(signal);
        state.signals.push(signal);
        state.audits.push(this.makeAudit(signal, artifact));

        const decision = this.alertService.shouldAlert(signal, state.alerts);
        if (decision.create) {
          const alert: AlertRecord = this.alertService.makeAlert(signal.id, decision.severity, decision.reason);
          alert.triggeredAt = seed.publishedAt;
          state.alerts.push(alert);
          createdAlerts += 1;
        }

        seededSignals += 1;
        }

        return {
          runId,
          status: "completed",
          hasMore,
          nextOffset,
          loadedSeeds: selectedSeeds.length,
          seededSignals,
          createdAlerts,
          skippedDuplicates,
        } satisfies HistoricalBackfillResult;
      });

      await Promise.all(bodyWrites.map((item) => writeFile(item.bodyPath, item.body, "utf8")));
      await this.store.transaction((state) => {
        const run = state.backfillRuns.find((item) => item.id === runId);
        if (!run) {
          return;
        }
        run.status = "completed";
        run.completedAt = nowIso();
        run.hasMore = result.hasMore;
        run.nextOffset = result.nextOffset;
        run.loadedSeeds = result.loadedSeeds;
        run.seededSignals = result.seededSignals;
        run.createdAlerts = result.createdAlerts;
        run.skippedDuplicates = result.skippedDuplicates;
        run.error = null;
      });
      return result;
    } catch (error) {
      await this.store.transaction((state) => {
        const run = state.backfillRuns.find((item) => item.id === runId);
        if (!run) {
          return;
        }
        run.status = "failed";
        run.completedAt = nowIso();
        run.error = error instanceof Error ? error.message : String(error);
      });
      throw error;
    }
  }
}

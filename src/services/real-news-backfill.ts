import { writeFile } from "node:fs/promises";
import type { AlertRecord, BackfillRunRecord, EventRecord, RawArtifact, SignalRecord, SourceRegistryItem } from "../types.js";
import type { Store } from "../store.js";
import { makeId, nowIso, sha256 } from "../utils.js";
import { AlertService } from "./alerts.js";
import { EntityLinkerService } from "./entity-linker.js";
import { ImpactScorerService } from "./impact-scorer.js";
import { PredictionService } from "./prediction.js";

const REAL_SOURCE_ID = "gdelt_policy_news";

export interface RealNewsBackfillInput {
  from?: string;
  to?: string;
  query?: string;
  offset?: number;
  batchSize?: number;
  persist?: boolean;
}

export interface RealNewsBackfillResult {
  runId: string;
  status: BackfillRunRecord["status"];
  persisted: boolean;
  hasMore: boolean;
  nextOffset: number;
  loadedSeeds: number;
  seededSignals: number;
  createdAlerts: number;
  skippedDuplicates: number;
}

interface GdeltArticle {
  url: string;
  title?: string;
  seendate?: string;
  socialimage?: string;
  domain?: string;
  language?: string;
}

interface GdeltResponse {
  articles?: GdeltArticle[];
}

function parseIso(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return date;
}

function toGdeltDate(value: Date): string {
  const yyyy = String(value.getUTCFullYear());
  const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(value.getUTCDate()).padStart(2, "0");
  const hh = String(value.getUTCHours()).padStart(2, "0");
  const mi = String(value.getUTCMinutes()).padStart(2, "0");
  const ss = String(value.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}${hh}${mi}${ss}`;
}

function inferEventType(title: string): EventRecord["eventType"] {
  const text = title.toLowerCase();
  if (/(tender|rfp|bid|procurement|eprocure)/.test(text)) return "tender";
  if (/(circular|notification|directive|gazette)/.test(text)) return "circular";
  if (/(tax|gst|duty|cess|levy)/.test(text)) return "tax";
  if (/(incentive|subsidy|pli|rebate)/.test(text)) return "incentive";
  if (/(ban|restrict|prohibit|suspend)/.test(text)) return "ban";
  if (/(compliance|filing|disclosure|regulation)/.test(text)) return "compliance";
  if (/(capex|capacity|plant|infrastructure|project)/.test(text)) return "capex";
  if (/(policy|framework|guideline|cabinet|rbi|sebi|nse)/.test(text)) return "policy";
  return "news";
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

export class RealNewsBackfillService {
  private readonly alertService = new AlertService();
  private readonly entityLinker = new EntityLinkerService();
  private readonly impactScorer = new ImpactScorerService();
  private readonly predictionService = new PredictionService();

  constructor(private readonly store: Store) {}

  private ensureSource(stateSources: SourceRegistryItem[]): SourceRegistryItem {
    const existing = stateSources.find((item) => item.id === REAL_SOURCE_ID);
    if (existing) {
      return existing;
    }

    const source: SourceRegistryItem = {
      id: REAL_SOURCE_ID,
      name: "GDELT India Policy and Tender News",
      url: "https://api.gdeltproject.org/api/v2/doc/doc",
      format: "html",
      parserType: "html",
      pollingIntervalSeconds: 1800,
      reliabilityTier: "medium",
      licenseTag: "gdelt-open-data",
      enabled: true,
    };
    stateSources.push(source);
    return source;
  }

  private async fetchArticles(input: Required<Pick<RealNewsBackfillInput, "from" | "to" | "offset" | "batchSize" | "query">>): Promise<GdeltArticle[]> {
    const from = toGdeltDate(parseIso(input.from));
    const to = toGdeltDate(parseIso(input.to));
    const query = encodeURIComponent(input.query);
    const url =
      `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}` +
      `&mode=ArtList&format=json&maxrecords=${input.batchSize}&startrecord=${input.offset}` +
      `&startdatetime=${from}&enddatetime=${to}&sort=DateAsc`;

    const response = await fetch(url, {
      headers: { "user-agent": "india-policy-signal-terminal/1.0" },
    });
    if (!response.ok) {
      throw new Error(`GDELT request failed: ${response.status}`);
    }
    const parsed = (await response.json()) as GdeltResponse;
    return parsed.articles ?? [];
  }

  async run(input: RealNewsBackfillInput): Promise<RealNewsBackfillResult> {
    const now = new Date();
    const defaultFrom = new Date(Date.UTC(now.getUTCFullYear() - 2, now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const from = input.from ?? defaultFrom.toISOString();
    const to = input.to ?? now.toISOString();
    if (parseIso(to) < parseIso(from)) {
      throw new Error("Invalid backfill range: 'to' must be greater than or equal to 'from'.");
    }
    const offset = Math.max(0, input.offset ?? 0);
    const batchSize = Math.min(250, Math.max(10, input.batchSize ?? 100));
    const query = input.query ?? "(india OR indian) AND (policy OR tender OR rbi OR nse OR sebi OR gst OR ministry)";
    const persist = input.persist ?? true;

    const articles = await this.fetchArticles({ from, to, offset, batchSize, query });
    const hasMore = articles.length >= batchSize;
    const nextOffset = offset + articles.length;

    if (!persist) {
      return {
        runId: "dry-run",
        status: "completed",
        persisted: false,
        hasMore,
        nextOffset,
        loadedSeeds: articles.length,
        seededSignals: articles.length,
        createdAlerts: 0,
        skippedDuplicates: 0,
      };
    }

    const runId = makeId("backfill");
    const startedAt = nowIso();

    await this.store.transaction((state) => {
      state.backfillRuns.push({
        id: runId,
        kind: "real",
        status: "running",
        from,
        to,
        tickers: [],
        limit: batchSize,
        offset,
        batchSize,
        nextOffset: offset,
        hasMore: false,
        loadedSeeds: 0,
        seededSignals: 0,
        createdAlerts: 0,
        skippedDuplicates: 0,
        startedAt,
        completedAt: null,
        error: null,
      });
    });

    const bodyWrites: Array<{ bodyPath: string; body: string }> = [];

    try {
      const result = await this.store.transaction((state) => {
        const source = this.ensureSource(state.sources);
        let seededSignals = 0;
        let createdAlerts = 0;
        let skippedDuplicates = 0;

        for (const article of articles) {
          const title = (article.title ?? "Untitled article").trim();
          const summary = [title, article.domain ?? "", article.language ?? ""].filter((part) => part.length > 0).join(" | ");
          let publishedAt = nowIso();
          if (article.seendate) {
            const d = new Date(article.seendate);
            publishedAt = Number.isNaN(d.getTime()) ? nowIso() : d.toISOString();
          }
          const body = `${title}. ${article.url}`;
          const contentHash = sha256(`${article.url}|${title}|${publishedAt}`);

          const duplicate = state.artifacts.find((artifact) => artifact.sourceId === source.id && artifact.contentHash === contentHash);
          if (duplicate) {
            skippedDuplicates += 1;
            continue;
          }

          const artifactId = makeId("artifact");
          const artifact: RawArtifact = {
            id: artifactId,
            sourceId: source.id,
            sourceUrl: article.url,
            fetchedAt: nowIso(),
            contentHash,
            parserVersion: "parser-v1",
            modelVersion: "predictor-v1",
            contentType: "text/plain",
            bodyPath: `${this.store.getArtifactsDir()}/${artifactId}.txt`,
            metadata: {
              sourceName: source.name,
              parserType: source.parserType,
              domain: article.domain ?? "unknown",
            },
          };
          state.artifacts.push(artifact);
          bodyWrites.push({ bodyPath: artifact.bodyPath, body });

          const event: EventRecord = {
            id: makeId("event"),
            artifactId: artifact.id,
            sourceId: source.id,
            eventType: inferEventType(title),
            title,
            summary,
            evidenceSnippet: title.slice(0, 220),
            publishedAt,
            noveltyScore: 0.7,
            confidence: 0.72,
          };
          state.events.push(event);

          const linkedEntities = this.entityLinker.link(event);
          const impact = this.impactScorer.score(event, linkedEntities, source);
          const prediction = this.predictionService.predict(impact);
          const signal: SignalRecord = {
            id: makeId("signal"),
            createdAt: publishedAt,
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

          const decision = this.alertService.shouldAlert(signal, state.alerts);
          if (decision.create) {
            const alert: AlertRecord = this.alertService.makeAlert(signal.id, decision.severity, decision.reason);
            alert.triggeredAt = publishedAt;
            state.alerts.push(alert);
            createdAlerts += 1;
          }

          seededSignals += 1;
        }

        return {
          runId,
          status: "completed",
          persisted: true,
          hasMore,
          nextOffset,
          loadedSeeds: articles.length,
          seededSignals,
          createdAlerts,
          skippedDuplicates,
        } satisfies RealNewsBackfillResult;
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

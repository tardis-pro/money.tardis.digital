import type { AuditRecord, ParsedDocument, RawArtifact, SignalRecord, SourceRegistryItem } from "../types.js";
import type { Store } from "../store.js";
import { makeId, nowIso } from "../utils.js";
import { AlertService } from "./alerts.js";
import { ClassifierService } from "./classifier.js";
import { DataQualityService } from "./data-quality.js";
import { EntityLinkerService } from "./entity-linker.js";
import { ImpactScorerService } from "./impact-scorer.js";
import { IngestionService } from "./ingestion.js";
import { ParserService } from "./parser.js";
import { PredictionService } from "./prediction.js";

export interface PipelineRunResult {
  ingested: number;
  producedSignals: number;
  alertsCreated: number;
  sourcesProcessed: number;
}

export class SignalPipelineService {
  private readonly ingestionService: IngestionService;
  private readonly parserService: ParserService;
  private readonly classifierService: ClassifierService;
  private readonly entityLinkerService: EntityLinkerService;
  private readonly impactScorerService: ImpactScorerService;
  private readonly predictionService: PredictionService;
  private readonly alertService: AlertService;
  private readonly dataQualityService: DataQualityService;

  constructor(private readonly store: Store) {
    this.ingestionService = new IngestionService(store);
    this.parserService = new ParserService();
    this.classifierService = new ClassifierService();
    this.entityLinkerService = new EntityLinkerService();
    this.impactScorerService = new ImpactScorerService();
    this.predictionService = new PredictionService();
    this.alertService = new AlertService();
    this.dataQualityService = new DataQualityService(store);
  }

  private computeFinalScore(signal: SignalRecord): number {
    const directionBoost = signal.impact.direction === "positive" ? 0.08 : signal.impact.direction === "negative" ? 0.06 : 0;
    return Math.min(
      1,
      signal.impact.confidence * 0.35 +
        signal.impact.magnitude * 0.25 +
        signal.prediction.calibratedConfidence * 0.3 +
        directionBoost,
    );
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
      createdAt: nowIso(),
    };
  }

  async run(sourceId?: string): Promise<PipelineRunResult> {
    const state = await this.store.read();
    const targetSources = sourceId
      ? state.sources.filter((source) => source.id === sourceId)
      : state.sources.filter((source) => source.enabled);
    const sourceMap = new Map<string, SourceRegistryItem>(targetSources.map((source) => [source.id, source]));

    const artifacts = sourceId
      ? [await this.ingestionService.ingestSource(sourceMap.get(sourceId) as SourceRegistryItem)].filter(
          (item): item is RawArtifact => item !== null,
        )
      : await this.ingestionService.ingestAll();

    let producedSignals = 0;
    let alertsCreated = 0;

    for (const artifact of artifacts) {
      const freshState = await this.store.read();
      const source = freshState.sources.find((entry) => entry.id === artifact.sourceId);
      if (!source) {
        continue;
      }
      let parsed: ParsedDocument;
      try {
        parsed = await this.parserService.parse(artifact, source);
      } catch (error) {
        await this.dataQualityService.report(
          source.id,
          "parsing",
          error instanceof Error ? error.message : String(error),
          artifact.id,
        );
        continue;
      }
      const event = this.classifierService.classify(artifact, source, parsed);
      const linkedEntities = this.entityLinkerService.link(event);
      const impact = this.impactScorerService.score(event, linkedEntities, source);
      const prediction = this.predictionService.predict(impact);

      await this.store.transaction((draft) => {
        draft.events.push(event);
        const signal: SignalRecord = {
          id: makeId("signal"),
          createdAt: nowIso(),
          sourceId: source.id,
          event,
          linkedEntities,
          impact,
          prediction,
          score: 0,
          status: "active",
        };
        signal.score = this.computeFinalScore(signal);
        draft.signals.push(signal);

        const audit = this.makeAudit(signal, artifact);
        draft.audits.push(audit);

        const decision = this.alertService.shouldAlert(signal, draft.alerts);
        if (decision.create) {
          draft.alerts.push(this.alertService.makeAlert(signal.id, decision.severity, decision.reason));
          alertsCreated += 1;
        }

        producedSignals += 1;
      });
    }

    return {
      ingested: artifacts.length,
      producedSignals,
      alertsCreated,
      sourcesProcessed: targetSources.length,
    };
  }
}

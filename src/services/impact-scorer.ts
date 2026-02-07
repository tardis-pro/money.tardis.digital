import type { Direction, EventRecord, Horizon, ImpactAssessment, LinkedEntity, SourceRegistryItem } from "../types.js";
import { clamp } from "../utils.js";

const positiveWords = ["approve", "award", "incentive", "subsidy", "growth", "expansion", "order win"];
const negativeWords = ["ban", "penalty", "restrict", "delay", "cancel", "decline", "default"];

function directionFromText(text: string): Direction {
  const lower = text.toLowerCase();
  const positiveHits = positiveWords.filter((word) => lower.includes(word)).length;
  const negativeHits = negativeWords.filter((word) => lower.includes(word)).length;
  if (positiveHits > negativeHits) {
    return "positive";
  }
  if (negativeHits > positiveHits) {
    return "negative";
  }
  return "neutral";
}

function horizonForEvent(eventType: EventRecord["eventType"]): Horizon {
  if (eventType === "tender" || eventType === "news") {
    return "intraday";
  }
  if (eventType === "policy" || eventType === "tax" || eventType === "circular") {
    return "1D";
  }
  return "1W";
}

function tierWeight(tier: SourceRegistryItem["reliabilityTier"]): number {
  if (tier === "high") {
    return 1;
  }
  if (tier === "medium") {
    return 0.7;
  }
  return 0.45;
}

export class ImpactScorerService {
  score(event: EventRecord, entities: LinkedEntity[], source: SourceRegistryItem): ImpactAssessment {
    const text = `${event.title} ${event.summary} ${event.evidenceSnippet}`;
    const direction = directionFromText(text);
    const horizon = horizonForEvent(event.eventType);
    const entityStrength = entities.reduce((sum, item) => sum + item.confidence, 0) / entities.length;
    const sourceWeight = tierWeight(source.reliabilityTier);

    const magnitude = clamp(0.25 + event.noveltyScore * 0.35 + entityStrength * 0.25 + sourceWeight * 0.15, 0, 1);
    const confidence = clamp(
      0.35 + event.confidence * 0.35 + entityStrength * 0.2 + (sourceWeight - 0.4) * 0.2,
      0,
      1,
    );

    const rationale = [
      `Event type ${event.eventType} implies ${horizon} horizon`,
      `Source reliability tier ${source.reliabilityTier} adjusted confidence`,
      `Entity-link confidence average ${(entityStrength * 100).toFixed(1)}%`,
    ];

    return {
      direction,
      horizon,
      magnitude,
      confidence,
      rationale,
      featureSnapshot: {
        eventType: event.eventType,
        noveltyScore: Number(event.noveltyScore.toFixed(4)),
        sourceTier: source.reliabilityTier,
        entityStrength: Number(entityStrength.toFixed(4)),
        sourceWeight: Number(sourceWeight.toFixed(4)),
      },
    };
  }
}

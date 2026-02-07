import type { EventRecord, EventType, ParsedDocument, RawArtifact, SourceRegistryItem } from "../types.js";
import { makeId } from "../utils.js";

const eventKeywords: Record<EventType, string[]> = {
  policy: ["policy", "scheme", "guideline", "framework", "cabinet"],
  tax: ["tax", "gst", "duty", "cess", "levy"],
  tender: ["tender", "bid", "rfp", "procurement", "eprocure"],
  circular: ["circular", "notification", "directive", "gazette"],
  compliance: ["compliance", "filing", "disclosure", "regulation"],
  capex: ["capex", "capacity", "plant", "infrastructure", "project"],
  ban: ["ban", "restrict", "prohibit", "suspend"],
  incentive: ["incentive", "subsidy", "pli", "rebate"],
  news: ["update", "report", "news", "interview"],
};

function scoreText(text: string, words: string[]): number {
  const lower = text.toLowerCase();
  return words.reduce((sum, word) => (lower.includes(word) ? sum + 1 : sum), 0);
}

export class ClassifierService {
  classify(artifact: RawArtifact, source: SourceRegistryItem, parsed: ParsedDocument): EventRecord {
    const targetText = `${parsed.title} ${parsed.summary} ${parsed.bodyText}`;

    let bestType: EventType = "news";
    let bestScore = -1;

    for (const [type, keywords] of Object.entries(eventKeywords) as Array<[EventType, string[]]>) {
      const score = scoreText(targetText, keywords);
      if (score > bestScore) {
        bestType = type;
        bestScore = score;
      }
    }

    const noveltyScore = Math.min(1, Math.max(0.1, parsed.summary.length / 300));
    const confidence = Math.min(0.98, Math.max(0.4, 0.45 + bestScore * 0.08));

    return {
      id: makeId("event"),
      artifactId: artifact.id,
      sourceId: source.id,
      eventType: bestType,
      title: parsed.title,
      summary: parsed.summary,
      evidenceSnippet: parsed.evidenceSnippet,
      publishedAt: parsed.publishedAt,
      noveltyScore,
      confidence,
    };
  }
}

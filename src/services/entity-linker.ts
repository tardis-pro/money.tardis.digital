import type { EventRecord, LinkedEntity } from "../types.js";
import entityMap from "../config/entity-map.json" with { type: "json" };

interface EntityMapEntry {
  ticker: string;
  sector: string;
  ministry: string | null;
  keywords: string[];
}

const entries = entityMap as EntityMapEntry[];

function keywordMatches(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.reduce((count, keyword) => (lower.includes(keyword.toLowerCase()) ? count + 1 : count), 0);
}

export class EntityLinkerService {
  link(event: EventRecord): LinkedEntity[] {
    const target = `${event.title} ${event.summary} ${event.evidenceSnippet}`;

    const links = entries
      .map((entry) => {
        const matches = keywordMatches(target, entry.keywords);
        if (matches === 0) {
          return null;
        }
        const confidence = Math.min(0.97, 0.5 + matches * 0.12);
        const link: LinkedEntity = {
          ticker: entry.ticker,
          sector: entry.sector,
          ministry: entry.ministry,
          linkReason: `Matched ${matches} keyword(s) from sector lexicon`,
          confidence,
        };
        return link;
      })
      .filter((value): value is LinkedEntity => value !== null)
      .sort((a, b) => b.confidence - a.confidence);

    if (links.length > 0) {
      return links.slice(0, 4);
    }

    return [
      {
        ticker: "NIFTY50",
        sector: "broad-market",
        ministry: null,
        linkReason: "No strong match; broad market fallback",
        confidence: 0.42,
      },
    ];
  }
}

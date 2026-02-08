import type { EventRecord, LinkedEntity } from "../types.js";
import { getEntityLoader } from "./config/entity-loader.js";
import { normalizeText } from "./config/base-loader.js";

export class EntityLinkerService {
  private entityLoader = getEntityLoader();

  async link(event: EventRecord): Promise<LinkedEntity[]> {
    const target = normalizeText(`${event.title} ${event.summary} ${event.evidenceSnippet}`);

    try {
      // Try dynamic loader first
      const entities = await this.entityLoader.getAllEntities();
      
      const links = entities
        .map((entity) => {
          const matches = this.countKeywordMatches(target, entity.keywords);
          if (matches === 0) {
            return null;
          }
          const confidence = Math.min(0.97, 0.5 + matches * 0.12);
          const link: LinkedEntity = {
            ticker: entity.ticker,
            sector: entity.sector,
            ministry: entity.ministries[0] || null,
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
    } catch (error) {
      console.warn('Entity linker: Dynamic loader failed, using fallback mechanism');
    }

    // Fallback to broad market
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

  private countKeywordMatches(text: string, keywords: string[]): number {
    return keywords.reduce((count, keyword) => {
      const normalizedKeyword = normalizeText(keyword);
      return text.includes(normalizedKeyword) ? count + 1 : count;
    }, 0);
  }
}

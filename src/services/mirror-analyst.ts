/**
 * Mirror Analyst — LLM-powered signal classification via MiniMax Anthropic-compatible API.
 *
 * Enhances the keyword-based classifier with structured AI analysis:
 * headline, summary, entities, narrative, impact score, and bias detection.
 *
 * Gracefully degrades: if the API key is missing or the call fails,
 * returns null and the pipeline continues with the rule-based classifier.
 */

import type { EventRecord, LinkedEntity, ParsedDocument, SourceRegistryItem } from "../types.js";

const MINIMAX_URL = "https://api.minimax.io/anthropic/v1/messages";
const FETCH_TIMEOUT_MS = 30_000;
const MAX_INPUT_CHARS = 6_000;

export interface MirrorAnalysis {
  headline: string;
  summary: string;
  entities: {
    people: string[];
    organizations: string[];
    countries: string[];
    cities: string[];
  };
  narrative: {
    id: string;
    title: string;
  };
  impact: number;
  bias: "left" | "right" | "neutral" | "nationalist";
  eventType: string;
  confidence: number;
}

const SYSTEM_PROMPT = `You are Mirror, a senior news intelligence editor focused on India policy, markets, and geopolitics.
Analyze the provided article content and output valid JSON only. No markdown. No introductory text.

Tasks:
1. Headline: Write a neutral, journalistic headline (max 15 words).
2. Summary: Write a dense 2-sentence summary of what happened.
3. Entities: Extract key people, organizations, countries, and cities mentioned.
4. Narrative: Identify the broader ongoing narrative this event belongs to.
   - id: snake_case_id (e.g., "rbi_rate_cycle_2025", "india_defense_procurement")
   - title: Human-readable narrative title
5. Impact: Score 1-10 (10 = global historical significance, 1 = minor local news).
6. Bias: Detect bias direction in the source (left/right/neutral/nationalist).
7. EventType: Classify as one of: policy, tax, tender, circular, compliance, capex, ban, incentive, news.
8. Confidence: Your confidence in this analysis (0.0 to 1.0).

Output format (JSON only):
{
  "headline": "...",
  "summary": "...",
  "entities": { "people": [], "organizations": [], "countries": [], "cities": [] },
  "narrative": { "id": "...", "title": "..." },
  "impact": 5,
  "bias": "neutral",
  "eventType": "policy",
  "confidence": 0.85
}`;

export class MirrorAnalystService {
  private readonly apiKey: string | null;
  private readonly model: string;

  constructor() {
    this.apiKey = process.env.MINIMAX_API_KEY?.trim() || null;
    this.model = process.env.MINIMAX_MODEL?.trim() || "minimax/Minimax-m2.5";
  }

  isConfigured(): boolean {
    return this.apiKey !== null && this.apiKey.length > 0;
  }

  /**
   * Analyze a parsed document using the MiniMax LLM.
   * Returns null if the service is not configured or the call fails.
   */
  async analyze(
    parsed: ParsedDocument,
    source: SourceRegistryItem,
  ): Promise<MirrorAnalysis | null> {
    if (!this.isConfigured()) {
      return null;
    }

    const content = this.buildPrompt(parsed, source);

    try {
      const response = await this.callApi(content);
      return this.parseResponse(response);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[mirror-analyst] Analysis failed: ${msg}`);
      return null;
    }
  }

  /**
   * Enhance an existing EventRecord with Mirror analysis.
   * Updates event type, confidence, and returns enriched entities.
   */
  enrichEvent(
    event: EventRecord,
    analysis: MirrorAnalysis,
  ): { event: EventRecord; extraEntities: LinkedEntity[] } {
    const enriched: EventRecord = {
      ...event,
      title: analysis.headline,
      summary: analysis.summary,
      confidence: Math.max(event.confidence, analysis.confidence),
      eventType: isValidEventType(analysis.eventType) ? analysis.eventType : event.eventType,
    };

    const extraEntities: LinkedEntity[] = analysis.entities.organizations
      .slice(0, 3)
      .map((org) => ({
        ticker: org.toUpperCase().replace(/\s+/g, ""),
        sector: "unknown",
        ministry: null,
        linkReason: `Mirror AI identified organization: ${org}`,
        confidence: analysis.confidence * 0.8,
      }));

    return { event: enriched, extraEntities };
  }

  private buildPrompt(parsed: ParsedDocument, source: SourceRegistryItem): string {
    const body = parsed.bodyText.slice(0, MAX_INPUT_CHARS);
    return [
      `Source: ${source.name} (${source.reliabilityTier} reliability)`,
      `Title: ${parsed.title}`,
      `Published: ${parsed.publishedAt ?? "unknown"}`,
      `Language: ${parsed.languageHint}`,
      "",
      "--- Article Content ---",
      body,
      "--- End Content ---",
      "",
      "Analyze this article and return JSON only.",
    ].join("\n");
  }

  private async callApi(userContent: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(MINIMAX_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userContent }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`MiniMax API ${response.status}: ${text.slice(0, 200)}`);
      }

      const payload = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };

      const text = payload.content?.find((block) => block.type === "text")?.text;
      if (!text) {
        throw new Error("MiniMax API returned no text content");
      }

      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  private parseResponse(raw: string): MirrorAnalysis {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      throw new Error(`Failed to parse Mirror response as JSON: ${cleaned.slice(0, 200)}`);
    }

    const entities = (parsed.entities ?? {}) as Record<string, unknown>;
    const narrative = (parsed.narrative ?? {}) as Record<string, unknown>;

    return {
      headline: String(parsed.headline ?? ""),
      summary: String(parsed.summary ?? ""),
      entities: {
        people: toStringArray(entities.people),
        organizations: toStringArray(entities.organizations),
        countries: toStringArray(entities.countries),
        cities: toStringArray(entities.cities),
      },
      narrative: {
        id: String(narrative.id ?? "unknown"),
        title: String(narrative.title ?? "Unknown narrative"),
      },
      impact: clampInt(Number(parsed.impact ?? 5), 1, 10),
      bias: parseBias(parsed.bias),
      eventType: String(parsed.eventType ?? "news"),
      confidence: clampFloat(Number(parsed.confidence ?? 0.5), 0, 1),
    };
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function parseBias(value: unknown): MirrorAnalysis["bias"] {
  const valid = ["left", "right", "neutral", "nationalist"] as const;
  const str = String(value ?? "neutral").toLowerCase();
  return valid.includes(str as typeof valid[number]) ? (str as MirrorAnalysis["bias"]) : "neutral";
}

function isValidEventType(value: string): value is EventRecord["eventType"] {
  const types = ["policy", "tax", "tender", "circular", "compliance", "capex", "ban", "incentive", "news"];
  return types.includes(value);
}

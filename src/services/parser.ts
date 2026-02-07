import { readFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";
import type { ParsedDocument, RawArtifact, SourceRegistryItem } from "../types.js";
import { normalizeWhitespace } from "../utils.js";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  trimValues: true,
});

function detectLanguage(text: string): ParsedDocument["languageHint"] {
  const hasDevanagari = /[\u0900-\u097F]/.test(text);
  const hasLatin = /[A-Za-z]/.test(text);
  if (hasDevanagari && hasLatin) {
    return "mixed";
  }
  if (hasDevanagari) {
    return "hi";
  }
  if (hasLatin) {
    return "en";
  }
  return "unknown";
}

function firstSnippet(text: string, max: number = 220): string {
  const normalized = normalizeWhitespace(text);
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 3)}...`;
}

function parseRss(body: string): { title: string; summary: string; bodyText: string; publishedAt: string | null } {
  try {
    const json = xmlParser.parse(body) as {
      rss?: { channel?: { item?: Array<{ title?: string; description?: string; pubDate?: string }> | { title?: string; description?: string; pubDate?: string } } };
      feed?: { entry?: Array<{ title?: string; summary?: string; updated?: string }> | { title?: string; summary?: string; updated?: string } };
    };
    const rssItem = Array.isArray(json.rss?.channel?.item)
      ? json.rss?.channel?.item[0]
      : json.rss?.channel?.item;
    if (rssItem) {
      const title = normalizeWhitespace(rssItem.title ?? "Untitled RSS item");
      const summary = normalizeWhitespace(rssItem.description ?? title);
      return {
        title,
        summary,
        bodyText: summary,
        publishedAt: rssItem.pubDate ?? null,
      };
    }
    const atomItem = Array.isArray(json.feed?.entry) ? json.feed?.entry[0] : json.feed?.entry;
    if (atomItem) {
      const title = normalizeWhitespace(atomItem.title ?? "Untitled Atom entry");
      const summary = normalizeWhitespace(atomItem.summary ?? title);
      return {
        title,
        summary,
        bodyText: summary,
        publishedAt: atomItem.updated ?? null,
      };
    }
  } catch {
    // fall through to plain parser
  }
  const fallback = firstSnippet(body, 400);
  return {
    title: fallback.slice(0, 80) || "RSS update",
    summary: fallback,
    bodyText: fallback,
    publishedAt: null,
  };
}

function parseHtml(body: string): { title: string; summary: string; bodyText: string } {
  const text = normalizeWhitespace(body.replace(/<[^>]+>/g, " "));
  const summary = firstSnippet(text, 300);
  const title = firstSnippet(text, 100);
  return {
    title: title || "HTML update",
    summary,
    bodyText: text,
  };
}

function parsePdfOcr(body: string): { title: string; summary: string; bodyText: string } {
  const normalized = normalizeWhitespace(body);
  const summary = firstSnippet(normalized, 300);
  return {
    title: summary.slice(0, 100) || "PDF document",
    summary,
    bodyText: normalized,
  };
}

function parseScreeniPy(body: string): { title: string; summary: string; bodyText: string } {
  try {
    const rows = JSON.parse(body) as Array<Record<string, string>>;
    if (rows.length === 0) {
      return {
        title: "Screeni-py scan",
        summary: "No symbols returned from Screeni-py.",
        bodyText: "No symbols returned from Screeni-py.",
      };
    }

    const symbols = rows.slice(0, 8).map((row) => row.Stock ?? row.stock ?? "UNKNOWN").join(", ");
    const summary = `Screeni-py returned ${rows.length} symbols. Top results: ${symbols}.`;
    return {
      title: `Screeni-py scan (${rows.length})`,
      summary,
      bodyText: `${summary} Raw payload: ${JSON.stringify(rows.slice(0, 20))}`,
    };
  } catch {
    const fallback = firstSnippet(body, 400);
    return {
      title: "Screeni-py payload",
      summary: fallback,
      bodyText: fallback,
    };
  }
}

export class ParserService {
  async parse(artifact: RawArtifact, source: SourceRegistryItem): Promise<ParsedDocument> {
    const rawBody = await readFile(artifact.bodyPath, "utf8");

    let parsedTitle = "Untitled";
    let parsedSummary = "";
    let bodyText = "";
    let publishedAt: string | null = null;

    if (source.parserType === "rss" || source.parserType === "xml") {
      const parsed = parseRss(rawBody);
      parsedTitle = parsed.title;
      parsedSummary = parsed.summary;
      bodyText = parsed.bodyText;
      publishedAt = parsed.publishedAt;
    } else if (source.parserType === "html") {
      const parsed = parseHtml(rawBody);
      parsedTitle = parsed.title;
      parsedSummary = parsed.summary;
      bodyText = parsed.bodyText;
    } else if (source.parserType === "screenipy") {
      const parsed = parseScreeniPy(rawBody);
      parsedTitle = parsed.title;
      parsedSummary = parsed.summary;
      bodyText = parsed.bodyText;
    } else {
      const parsed = parsePdfOcr(rawBody);
      parsedTitle = parsed.title;
      parsedSummary = parsed.summary;
      bodyText = parsed.bodyText;
    }

    return {
      artifactId: artifact.id,
      title: parsedTitle,
      summary: parsedSummary,
      bodyText,
      publishedAt,
      languageHint: detectLanguage(bodyText),
      evidenceSnippet: firstSnippet(bodyText),
    };
  }
}

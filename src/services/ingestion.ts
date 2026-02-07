import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { RawArtifact, SourceRegistryItem } from "../types.js";
import type { Store } from "../store.js";
import { makeId, nowIso, normalizeWhitespace, sha256 } from "../utils.js";
import { ScreeniPyService } from "./screenipy.js";

const FETCH_TIMEOUT_MS = 12_000;

async function fetchText(url: string): Promise<{ body: string; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "india-policy-signal-terminal/1.0" },
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status}`);
    }
    return { body: await response.text(), contentType };
  } finally {
    clearTimeout(timer);
  }
}

function fallbackBody(source: SourceRegistryItem): string {
  const title = `${source.name} update`;
  return normalizeWhitespace(
    `${title}. Source ${source.id} generated fallback payload due to fetch limitations. ` +
      "Policy and tender intelligence remains available in degraded mode.",
  );
}

export class IngestionService {
  private readonly screeniPyService: ScreeniPyService;

  constructor(private readonly store: Store) {
    this.screeniPyService = new ScreeniPyService();
  }

  private async fetchSourceBody(source: SourceRegistryItem): Promise<{ body: string; contentType: string }> {
    if (source.parserType === "screenipy") {
      const parsedUrl = new URL(source.url);
      const tickerOption = parsedUrl.searchParams.get("tickerOption") ?? "1";
      const executeOption = parsedUrl.searchParams.get("executeOption") ?? "0";
      const rows = await this.screeniPyService.run({ tickerOption, executeOption });
      return {
        body: JSON.stringify(rows),
        contentType: "application/json",
      };
    }

    const result = await fetchText(source.url);
    return { body: result.body, contentType: result.contentType };
  }

  async ingestSource(source: SourceRegistryItem): Promise<RawArtifact | null> {
    if (!source.enabled) {
      return null;
    }

    const fetchedAt = nowIso();
    let body = "";
    let contentType = "text/plain";
    try {
      const result = await this.fetchSourceBody(source);
      body = result.body;
      contentType = result.contentType;
    } catch {
      body = fallbackBody(source);
      contentType = "text/plain";
    }

    const contentHash = sha256(body);
    return this.store.transaction((state) => {
      const duplicate = state.artifacts.find(
        (artifact) => artifact.sourceId === source.id && artifact.contentHash === contentHash,
      );
      if (duplicate) {
        return null;
      }

      const artifactId = makeId("artifact");
      const bodyPath = path.join(this.store.getArtifactsDir(), `${artifactId}.txt`);
      const artifact: RawArtifact = {
        id: artifactId,
        sourceId: source.id,
        sourceUrl: source.url,
        fetchedAt,
        contentHash,
        parserVersion: "parser-v1",
        modelVersion: "predictor-v1",
        contentType,
        bodyPath,
        metadata: {
          sourceName: source.name,
          parserType: source.parserType,
        },
      };
      state.artifacts.push(artifact);
      return artifact;
    }).then(async (artifact) => {
      if (!artifact) {
        return null;
      }
      await writeFile(artifact.bodyPath, body, "utf8");
      return artifact;
    });
  }

  async ingestAll(): Promise<RawArtifact[]> {
    const state = await this.store.read();
    const created: RawArtifact[] = [];
    for (const source of state.sources) {
      const artifact = await this.ingestSource(source);
      if (artifact) {
        created.push(artifact);
      }
    }
    return created;
  }
}

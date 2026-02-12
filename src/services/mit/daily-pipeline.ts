import type {
  CompositeScore,
  FundamentalSnapshot,
  MitDailyRunResult,
  MitState,
  MitWatchlistIdea,
  TechnicalSnapshot,
} from "../../mit-types.js";
import { detectMarketTone } from "./sentiment-overlay.js";

export interface PipelineBuildInput {
  state: MitState;
  technicals: Record<string, TechnicalSnapshot>;
  fundamentals: Record<string, FundamentalSnapshot>;
  scores: Record<string, CompositeScore>;
  ideas: MitWatchlistIdea[];
  errors?: string[];
}

export function upsertDailyRun(input: PipelineBuildInput): MitDailyRunResult {
  const now = new Date().toISOString();
  const date = now.slice(0, 10);
  const run: MitDailyRunResult = {
    id: `mit-run-${date}`,
    date,
    startedAt: now,
    completedAt: now,
    status: input.errors && input.errors.length > 0 ? "partial" : "success",
    ideas: dedupeIdeas(input.ideas),
    universeSize: Object.keys(input.technicals).length,
    screenedCount: Object.keys(input.scores).length,
    marketTone: detectMarketTone([], input.technicals),
    anomalies: [],
    errors: input.errors ?? [],
  };

  const next = input.state.dailyRuns.filter((item) => item.date !== date);
  next.push(run);
  input.state.dailyRuns = next.slice(-365);
  input.state.marketTone = run.marketTone;
  input.state.technicals = input.technicals;
  input.state.fundamentals = input.fundamentals;
  input.state.compositeScores = input.scores;
  return run;
}

function dedupeIdeas(ideas: MitWatchlistIdea[]): MitWatchlistIdea[] {
  const map = new Map<string, MitWatchlistIdea>();
  for (const idea of ideas) {
    if (!map.has(idea.ticker)) {
      map.set(idea.ticker, idea);
      continue;
    }
    const current = map.get(idea.ticker);
    if (!current) {
      map.set(idea.ticker, idea);
      continue;
    }
    if (idea.feed === "quant" && current.feed !== "quant") {
      map.set(idea.ticker, idea);
    }
  }
  return [...map.values()].slice(0, 8);
}

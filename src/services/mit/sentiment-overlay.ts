import type { Direction, SignalRecord } from "../../types.js";
import type { MitMarketTone, TechnicalSnapshot } from "../../mit-types.js";

export function detectMarketTone(
  recentSignals: SignalRecord[],
  technicals: Record<string, TechnicalSnapshot>,
): MitMarketTone {
  const toneFromSignals = toneFromDirections(recentSignals.map((item) => item.impact.direction));
  const toneFromBreadth = toneFromTechnicals(technicals);
  if (toneFromBreadth === "risk-off") {
    return "risk-off";
  }
  if (toneFromSignals === "risk-on") {
    return "risk-on";
  }
  if (toneFromSignals === "risk-off") {
    return "risk-off";
  }
  return "neutral";
}

export function governanceFlagsForTicker(input: {
  ticker: string;
  signals: SignalRecord[];
  promoterPledgePct: number | null;
  promoterPledgePrevPct?: number | null;
}): string[] {
  const flags: string[] = [];
  const tickerUpper = input.ticker.toUpperCase();
  const linkedSignals = input.signals.filter((signal) => signal.linkedEntities.some((e) => e.ticker === tickerUpper));

  if (linkedSignals.some((signal) => /auditor\s+resig/i.test(signal.event.title + " " + signal.event.summary))) {
    flags.push("auditor-resignation");
  }
  if (input.promoterPledgePct !== null && input.promoterPledgePct > 20) {
    flags.push("promoter-pledge-high");
  }
  if (
    input.promoterPledgePct !== null
    && input.promoterPledgePrevPct !== undefined
    && input.promoterPledgePrevPct !== null
    && input.promoterPledgePct - input.promoterPledgePrevPct > 5
  ) {
    flags.push("promoter-pledge-surge");
  }
  if (
    linkedSignals.some(
      (signal) => /sebi/i.test(signal.event.title + " " + signal.event.summary)
        && /(order|penalty|ban|action|compliance)/i.test(signal.event.title + " " + signal.event.summary),
    )
  ) {
    flags.push("sebi-action");
  }
  return flags;
}

function toneFromDirections(directions: Direction[]): MitMarketTone {
  if (directions.length === 0) {
    return "neutral";
  }
  const positive = directions.filter((d) => d === "positive").length / directions.length;
  const negative = directions.filter((d) => d === "negative").length / directions.length;
  if (negative > 0.6) {
    return "risk-off";
  }
  if (positive > 0.6) {
    return "risk-on";
  }
  return "neutral";
}

function toneFromTechnicals(technicals: Record<string, TechnicalSnapshot>): MitMarketTone {
  const entries = Object.values(technicals);
  if (entries.length === 0) {
    return "neutral";
  }
  const below50 = entries.length > 0
    ? entries.filter((item) => item.latestClose < (item.dma50 ?? Number.POSITIVE_INFINITY)).length / entries.length
    : 0;
  if (below50 > 0.6) {
    return "risk-off";
  }
  return "neutral";
}

import type { MitPosition, TechnicalSnapshot } from "../../mit-types.js";

const TRAILING_ACTIVATION_GAIN_PCT = 0.15;
const DEFAULT_TRAIL_PCT = 0.08;

export function updateTrailingStop(position: MitPosition, currentPrice: number, technicals: TechnicalSnapshot): MitPosition {
  position.maxPriceSinceEntry = Math.max(position.maxPriceSinceEntry, currentPrice);
  position.minPriceSinceEntry = Math.min(position.minPriceSinceEntry, currentPrice);

  const gainPct = position.entryPrice > 0
    ? (position.maxPriceSinceEntry - position.entryPrice) / position.entryPrice
    : 0;
  const rsiOverbought = technicals.rsi14 !== null && technicals.rsi14 > 70;
  if (!position.trailingActive && (gainPct >= TRAILING_ACTIVATION_GAIN_PCT || rsiOverbought)) {
    position.trailingActive = true;
  }

  if (position.trailingActive) {
    const newTrail = position.maxPriceSinceEntry * (1 - DEFAULT_TRAIL_PCT);
    const prev = position.trailingStop ?? 0;
    position.trailingStop = Math.max(prev, newTrail, position.stopLoss);
  }
  return position;
}

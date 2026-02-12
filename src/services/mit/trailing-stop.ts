import type { MitPosition, TechnicalSnapshot } from "../../mit-types.js";

export function updateTrailingStop(position: MitPosition, currentPrice: number, technicals: TechnicalSnapshot): MitPosition {
  position.maxPriceSinceEntry = Math.max(position.maxPriceSinceEntry, currentPrice);
  position.minPriceSinceEntry = Math.min(position.minPriceSinceEntry, currentPrice);

  const gainPct = position.entryPrice > 0 ? (currentPrice - position.entryPrice) / position.entryPrice : 0;
  const rsiOverbought = technicals.rsi14 !== null && technicals.rsi14 > 70;
  if (!position.trailingActive && (gainPct >= 0.15 || rsiOverbought)) {
    position.trailingActive = true;
  }

  if (position.trailingActive) {
    const trailPct = 0.08;
    const newTrail = position.maxPriceSinceEntry * (1 - trailPct);
    const prev = position.trailingStop ?? 0;
    position.trailingStop = Math.max(prev, newTrail, position.stopLoss);
  }
  return position;
}

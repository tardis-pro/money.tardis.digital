import type { MitPosition, TechnicalSnapshot } from "../../mit-types.js";

export function updateTrailingStop(position: MitPosition, currentPrice: number, technicals: TechnicalSnapshot): MitPosition {
  position.maxPriceSinceEntry = Math.max(position.maxPriceSinceEntry, currentPrice);
  position.minPriceSinceEntry = Math.min(position.minPriceSinceEntry, currentPrice);

  const denominator = position.firstTarget - position.entryPrice;
  const progress = denominator > 0 ? (currentPrice - position.entryPrice) / denominator : 0;
  const rsiOverbought = technicals.rsi14 !== null && technicals.rsi14 > 70;
  if (!position.trailingActive && (progress >= 0.75 || rsiOverbought)) {
    position.trailingActive = true;
  }

  if (position.trailingActive) {
    const basePct = 0.06;
    const minPct = 0.03;
    const tightening = Math.max(0, Math.min(1, progress));
    const trailPct = basePct - (basePct - minPct) * tightening;
    const newTrail = position.maxPriceSinceEntry * (1 - trailPct);
    const prev = position.trailingStop ?? 0;
    position.trailingStop = Math.max(prev, newTrail, position.stopLoss);
  }
  return position;
}

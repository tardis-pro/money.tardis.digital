import type { MitPortfolioState, MitSettings, SizingResult } from "../../mit-types.js";

export function sizePosition(
  settings: MitSettings,
  portfolio: MitPortfolioState,
  entryPrice: number,
  stopLoss: number,
  customAllocPct?: number,
  requestedQty?: number,
): SizingResult {
  const allocPctRaw = customAllocPct ?? settings.allocPct;
  const allocPct = Number.isFinite(allocPctRaw) ? Math.min(1, Math.max(0.01, allocPctRaw)) : settings.allocPct;
  const allocatedAmount = settings.capital * allocPct;
  const fromAllocation = Math.floor(allocatedAmount / entryPrice);
  const units = requestedQty !== undefined ? Math.max(0, Math.floor(requestedQty)) : fromAllocation;
  const cost = units * entryPrice;
  const deployed = portfolio.positions.reduce((sum, p) => sum + p.qty * p.currentPrice, 0);

  if (units <= 0) {
    return {
      approved: false,
      rejectionReason: "Entry price exceeds allocation",
      allocatedAmount,
      units,
      entryPrice,
      stopLoss,
      projectedRiskAmount: 0,
    };
  }
  if (portfolio.cash < cost) {
    return {
      approved: false,
      rejectionReason: "Insufficient cash",
      allocatedAmount,
      units,
      entryPrice,
      stopLoss,
      projectedRiskAmount: units * Math.max(0, entryPrice - stopLoss),
    };
  }
  if (portfolio.cash - cost < settings.capital * settings.pauseCashPct) {
    return {
      approved: false,
      rejectionReason: "Would breach pause threshold",
      allocatedAmount,
      units,
      entryPrice,
      stopLoss,
      projectedRiskAmount: units * Math.max(0, entryPrice - stopLoss),
    };
  }
  if ((deployed + cost) / settings.capital > settings.maxDeployedPct) {
    return {
      approved: false,
      rejectionReason: "Would exceed max deployed",
      allocatedAmount,
      units,
      entryPrice,
      stopLoss,
      projectedRiskAmount: units * Math.max(0, entryPrice - stopLoss),
    };
  }
  return {
    approved: true,
    rejectionReason: null,
    allocatedAmount,
    units,
    entryPrice,
    stopLoss,
    projectedRiskAmount: units * Math.max(0, entryPrice - stopLoss),
  };
}

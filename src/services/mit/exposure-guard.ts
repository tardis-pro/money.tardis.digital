import type { GuardStatus, MitPortfolioState } from "../../mit-types.js";

export function checkGuard(portfolio: MitPortfolioState): GuardStatus {
  const capital = portfolio.settings.capital;
  const deployed = portfolio.positions.reduce((sum, p) => sum + p.qty * p.currentPrice, 0);
  const cashPct = capital > 0 ? portfolio.cash / capital : 0;
  const deployedPct = capital > 0 ? deployed / capital : 0;

  const reasons: string[] = [];
  const warnings: string[] = [];
  if (cashPct < portfolio.settings.pauseCashPct) {
    reasons.push(`Cash ${(cashPct * 100).toFixed(1)}% below threshold`);
  }
  if (deployedPct > portfolio.settings.maxDeployedPct) {
    reasons.push(`Deployed ${(deployedPct * 100).toFixed(1)}% above max`);
  }
  if (deployedPct > 0.85) {
    warnings.push("High deployment level");
  }

  const suggestedSells = portfolio.positions
    .filter((p) => p.status === "open")
    .map((p) => ({ ticker: p.ticker, pctToTarget: (p.firstTarget - p.currentPrice) / p.firstTarget }))
    .filter((p) => p.pctToTarget < 0.1)
    .sort((a, b) => a.pctToTarget - b.pctToTarget)
    .map((p) => p.ticker);

  return {
    canTrade: reasons.length === 0,
    paused: cashPct < portfolio.settings.pauseCashPct,
    cashPct,
    deployedPct,
    reasons,
    warnings,
    suggestedSells,
  };
}

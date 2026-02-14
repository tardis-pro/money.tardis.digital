import type { MitEquityPoint, MitPortfolioState, MitPosition, MitSellIndicator, TechnicalSnapshot } from "../../mit-types.js";
import { updateTrailingStop } from "./trailing-stop.js";

export interface PnlRefreshOptions {
  technicalsByTicker: Record<string, TechnicalSnapshot>;
  maxHorizonDays: number;
}

export function refreshPortfolioPnl(
  portfolio: MitPortfolioState,
  latestPriceByTicker: Record<string, number>,
  options: PnlRefreshOptions,
): { portfolio: MitPortfolioState; indicators: Array<{ positionId: string; indicators: MitSellIndicator[] }> } {
  const indicators: Array<{ positionId: string; indicators: MitSellIndicator[] }> = [];
  let unrealized = 0;
  let realized = portfolio.closedTrades.reduce((sum, trade) => sum + trade.realizedPnl, 0);

  for (const position of portfolio.positions) {
    const cmp = latestPriceByTicker[position.ticker] ?? position.currentPrice;
    position.currentPrice = cmp;
    position.unrealizedPnl = round2(position.qty * (cmp - position.entryPrice));
    position.unrealizedPnlPct = position.entryPrice > 0 ? ((cmp - position.entryPrice) / position.entryPrice) * 100 : 0;
    unrealized += position.unrealizedPnl;

    const technicals = options.technicalsByTicker[position.ticker];
    if (technicals) {
      updateTrailingStop(position, cmp, technicals);
    }

    const active = detectIndicators(position, technicals, options.maxHorizonDays);
    position.activeSellIndicators = active;
    if (active.length > 0) {
      indicators.push({ positionId: position.id, indicators: active });
    }
    position.updatedAt = new Date().toISOString();
  }

  const deployed = portfolio.positions.reduce((sum, p) => sum + p.qty * p.currentPrice, 0);
  const equity = portfolio.cash + deployed;
  portfolio.peakEquity = Math.max(portfolio.peakEquity, equity);
  const drawdown = portfolio.peakEquity > 0 ? (portfolio.peakEquity - equity) / portfolio.peakEquity : 0;
  portfolio.maxDrawdownPct = Math.max(portfolio.maxDrawdownPct, drawdown);

  const point: MitEquityPoint = {
    date: new Date().toISOString().slice(0, 10),
    equity,
    cash: portfolio.cash,
    deployed,
    unrealizedPnl: unrealized,
    realizedPnlCumulative: realized,
  };
  portfolio.equityCurve = [...portfolio.equityCurve.filter((p) => p.date !== point.date), point].slice(-365);
  portfolio.paused = portfolio.cash < portfolio.settings.capital * portfolio.settings.pauseCashPct;
  return { portfolio, indicators };
}

function detectIndicators(
  position: MitPosition,
  technicals: TechnicalSnapshot | undefined,
  maxHorizonDays: number,
): MitSellIndicator[] {
  const list: MitSellIndicator[] = [];
  if (position.currentPrice >= position.firstTarget * 0.97) {
    list.push("near-target");
  }
  const days = holdDays(position.entryDate);
  if (days >= Math.floor(maxHorizonDays * 0.9)) {
    list.push("time-exit");
  }
  const stop = position.trailingActive && position.trailingStop !== null ? position.trailingStop : position.stopLoss;
  if (position.currentPrice <= stop) {
    list.push("stop-breach");
  }
  if (technicals && technicals.dma50 !== null && technicals.atr14 !== null && position.currentPrice < technicals.dma50) {
    list.push("momentum-decay");
  }
  return list;
}

function holdDays(entryDate: string): number {
  const start = Date.parse(entryDate);
  if (!Number.isFinite(start)) {
    return 0;
  }
  return Math.max(0, Math.floor((Date.now() - start) / (24 * 60 * 60 * 1000)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

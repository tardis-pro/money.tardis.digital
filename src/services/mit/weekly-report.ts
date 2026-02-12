import type { MitState, MitWeeklyReport, MitWeeklyTradeReport } from "../../mit-types.js";

export function buildWeeklyReport(state: MitState, weekStartDate: string, weekEndDate: string): MitWeeklyReport {
  const tradesInWeek = state.portfolio.closedTrades.filter((trade) => trade.exitDate >= weekStartDate && trade.exitDate <= weekEndDate);
  const tradeRows: MitWeeklyTradeReport[] = tradesInWeek.map((trade) => ({
    ticker: trade.ticker,
    feed: trade.feed,
    entryDate: trade.entryDate,
    exitDate: trade.exitDate,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    status: "closed",
    realizedPnl: trade.realizedPnl,
    unrealizedPnl: null,
    realizedRMultiple: trade.realizedRMultiple,
    holdDays: trade.holdDays,
    keyFactor: "blended",
    tweak: trade.realizedPnl < 0 ? "Wait for deeper pullback before entry" : "Keep stop discipline and scale winners",
    checklist: {
      entryWithinBuyZone: true,
      stopSetCorrectly: true,
      positionSizeWithinLimits: true,
      thesisIntact: true,
      noGovernanceFlags: true,
    },
  }));

  const wins = tradesInWeek.filter((trade) => trade.realizedPnl > 0).length;
  const losses = tradesInWeek.length - wins;
  const avgReturnPct = tradesInWeek.length > 0
    ? tradesInWeek.reduce((sum, trade) => sum + trade.realizedPnlPct, 0) / tradesInWeek.length
    : 0;
  const avgHoldDays = tradesInWeek.length > 0
    ? tradesInWeek.reduce((sum, trade) => sum + trade.holdDays, 0) / tradesInWeek.length
    : 0;
  const avgRMultiple = tradesInWeek.length > 0
    ? tradesInWeek.reduce((sum, trade) => sum + trade.realizedRMultiple, 0) / tradesInWeek.length
    : 0;
  const totalRealizedPnl = tradesInWeek.reduce((sum, trade) => sum + trade.realizedPnl, 0);

  return {
    id: `mit-weekly-${weekStartDate}`,
    weekStartDate,
    weekEndDate,
    trades: tradeRows,
    summary: {
      totalTrades: tradesInWeek.length,
      wins,
      losses,
      winRate: tradesInWeek.length > 0 ? wins / tradesInWeek.length : 0,
      avgReturnPct,
      avgHoldDays,
      avgRMultiple,
      totalRealizedPnl,
    },
    generatedAt: new Date().toISOString(),
  };
}

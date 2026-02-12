import type { MitMonthlyReport, MitState } from "../../mit-types.js";

export function buildMonthlyReport(state: MitState, month: string): MitMonthlyReport {
  const closed = state.portfolio.closedTrades.filter((trade) => trade.exitDate.startsWith(month));
  const nt = closed.filter((trade) => trade.feed === "nt-lite");
  const q = closed.filter((trade) => trade.feed === "quant");
  const openUnrealized = state.portfolio.positions.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);

  return {
    id: `mit-monthly-${month}`,
    month,
    ntLiteStats: stats(nt),
    quantStats: stats(q),
    combinedStats: {
      totalTrades: closed.length,
      winRate: closed.length > 0 ? closed.filter((trade) => trade.realizedPnl > 0).length / closed.length : 0,
      avgReturnPct: closed.length > 0 ? closed.reduce((sum, trade) => sum + trade.realizedPnlPct, 0) / closed.length : 0,
      avgHoldDays: closed.length > 0 ? closed.reduce((sum, trade) => sum + trade.holdDays, 0) / closed.length : 0,
      totalRealizedPnl: closed.reduce((sum, trade) => sum + trade.realizedPnl, 0),
      totalUnrealizedPnl: openUnrealized,
    },
    generatedAt: new Date().toISOString(),
  };
}

function stats(trades: Array<{ realizedPnl: number; realizedPnlPct: number; holdDays: number; realizedRMultiple: number }>): {
  trades: number;
  winRate: number;
  avgReturnPct: number;
  avgHoldDays: number;
  avgRMultiple: number;
  totalPnl: number;
} {
  return {
    trades: trades.length,
    winRate: trades.length > 0 ? trades.filter((trade) => trade.realizedPnl > 0).length / trades.length : 0,
    avgReturnPct: trades.length > 0 ? trades.reduce((sum, trade) => sum + trade.realizedPnlPct, 0) / trades.length : 0,
    avgHoldDays: trades.length > 0 ? trades.reduce((sum, trade) => sum + trade.holdDays, 0) / trades.length : 0,
    avgRMultiple: trades.length > 0 ? trades.reduce((sum, trade) => sum + trade.realizedRMultiple, 0) / trades.length : 0,
    totalPnl: trades.reduce((sum, trade) => sum + trade.realizedPnl, 0),
  };
}

import type { MitState } from "../../mit-types.js";

export function holdingsCsv(state: MitState): string {
  const rows = ["symbol,feed,entry_price,entry_date,qty,stop,target,status"];
  for (const p of state.portfolio.positions) {
    rows.push([
      csvCell(p.ticker),
      csvCell(p.feed),
      csvCell(p.entryPrice.toFixed(2)),
      csvCell(p.entryDate),
      csvCell(String(p.qty)),
      csvCell(p.stopLoss.toFixed(2)),
      csvCell(p.firstTarget.toFixed(2)),
      csvCell(p.status),
    ].join(","));
  }
  return `${rows.join("\n")}\n`;
}

export function closedTradesCsv(state: MitState): string {
  const rows = ["ticker,feed,entry_date,exit_date,qty,entry_price,exit_price,realized_pnl,realized_r"];
  for (const t of state.portfolio.closedTrades) {
    rows.push([
      csvCell(t.ticker),
      csvCell(t.feed),
      csvCell(t.entryDate),
      csvCell(t.exitDate),
      csvCell(String(t.qty)),
      csvCell(t.entryPrice.toFixed(2)),
      csvCell(t.exitPrice.toFixed(2)),
      csvCell(t.realizedPnl.toFixed(2)),
      csvCell(t.realizedRMultiple.toFixed(2)),
    ].join(","));
  }
  return `${rows.join("\n")}\n`;
}

function csvCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

import type { FundamentalSnapshot } from "../../mit-types.js";

export function computePeerMedianPEBySector(
  universe: Array<{ ticker: string; sector: string }>,
  fundamentalsByTicker: Record<string, FundamentalSnapshot>,
): Record<string, number> {
  const grouped = new Map<string, number[]>();
  for (const row of universe) {
    const snapshot = fundamentalsByTicker[row.ticker];
    if (!snapshot || snapshot.pe === null || snapshot.pe <= 0) {
      continue;
    }
    const list = grouped.get(row.sector) ?? [];
    list.push(snapshot.pe);
    grouped.set(row.sector, list);
  }

  const out: Record<string, number> = {};
  for (const [sector, values] of grouped.entries()) {
    if (values.length < 5) {
      continue;
    }
    out[sector] = median(values);
  }
  return out;
}

export function peerMedianForTicker(
  ticker: string,
  universe: Array<{ ticker: string; sector: string }>,
  peerMedianPE: Record<string, number>,
): number | null {
  const row = universe.find((item) => item.ticker === ticker);
  if (!row) {
    return null;
  }
  return peerMedianPE[row.sector] ?? null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (left === undefined || right === undefined) {
    return sorted[mid] ?? 0;
  }
  return sorted.length % 2 === 0 ? (left + right) / 2 : right;
}

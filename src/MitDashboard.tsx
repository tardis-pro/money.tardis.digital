import React, { useCallback, useEffect, useMemo, useState } from "react";
import htm from "htm/dist/htm.mjs";

const html = htm.bind(React.createElement as (...args: unknown[]) => React.ReactElement);

interface MitDashboardProps {
  userId: string;
}

async function fetchMit(path: string, userId: string, options?: RequestInit) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "x-user-id": userId,
      ...options?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${path}`);
  }
  return response.json();
}

export function MitDashboard({ userId }: MitDashboardProps) {
  const [portfolio, setPortfolio] = useState<any>(null);
  const [ideas, setIdeas] = useState<any[]>([]);
  const [guard, setGuard] = useState<any>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      const [p, i, g] = await Promise.all([
        fetchMit("/api/mit/portfolio", userId),
        fetchMit("/api/mit/daily-ideas", userId).catch(() => []),
        fetchMit("/api/mit/guard", userId),
      ]);
      setPortfolio(p);
      setIdeas(Array.isArray(i) ? i : []);
      setGuard(g);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [userId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);

  const runPipeline = useCallback(async () => {
    setRunning(true);
    try {
      await fetchMit("/api/mit/pipeline/run", userId, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [load, userId]);

  const metrics = useMemo(() => {
    if (!portfolio) {
      return { cash: 0, deployed: 0, equity: 0, unrealized: 0, realized: 0, dd: 0, winRate: null };
    }
    return {
      cash: portfolio.cash ?? 0,
      deployed: portfolio.deployed ?? 0,
      equity: portfolio.equity ?? 0,
      unrealized: portfolio.unrealizedPnl ?? 0,
      realized: portfolio.realizedPnlCumulative ?? 0,
      dd: portfolio.maxDrawdownPct ?? 0,
      winRate: portfolio.winRate,
    };
  }, [portfolio]);

  return html`
    <div className="space-y-4">
      <div className="border border-term-border rounded bg-term-panel p-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-term-bright">MIT Trading Dashboard</div>
          <div className="text-xs text-term-muted">NT LITE + Quant swing system</div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick=${runPipeline}
            disabled=${running}
            className="px-3 py-1 text-xs border border-accent-green/40 text-accent-green rounded disabled:opacity-50"
          >${running ? "RUNNING" : "RUN PIPELINE"}</button>
          <button
            type="button"
            onClick=${load}
            className="px-3 py-1 text-xs border border-term-border text-term-muted rounded"
          >REFRESH</button>
        </div>
      </div>

      ${error ? html`<div className="border border-accent-red/30 bg-accent-red-dim text-accent-red text-xs rounded px-3 py-2">${error}</div>` : null}

      <div className="grid gap-3 md:grid-cols-4">
        ${[
          ["Cash", formatInr(metrics.cash)],
          ["Deployed", formatInr(metrics.deployed)],
          ["Equity", formatInr(metrics.equity)],
          ["Drawdown", `${(metrics.dd * 100).toFixed(1)}%`],
        ].map((item) => html`
          <div className="border border-term-border rounded bg-term-panel px-3 py-2">
            <div className="text-2xs uppercase tracking-widest text-term-muted">${item[0]}</div>
            <div className="font-mono text-base text-term-bright">${item[1]}</div>
          </div>
        `)}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 border border-term-border rounded bg-term-panel">
          <div className="px-4 py-3 border-b border-term-border text-sm font-semibold text-term-bright">Daily Ideas</div>
          <div className="p-3 grid gap-3 md:grid-cols-2">
            ${ideas.length === 0
              ? html`<div className="text-xs text-term-muted">No ideas yet. Run pipeline.</div>`
              : ideas.map((idea) => html`
                <div className="border border-term-border rounded bg-term-surface p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-sm font-semibold text-term-bright">${idea.ticker}</div>
                    <span className="text-2xs font-mono text-accent-green">${idea.feed}</span>
                  </div>
                  <div className="text-xs text-term-muted mb-2">${idea.momentumLabel ?? ""}</div>
                  <div className="text-2xs text-term-text">Entry ${formatInr(idea.entryExitPlan?.buyZoneLow ?? 0)} - ${formatInr(idea.entryExitPlan?.buyZoneHigh ?? 0)}</div>
                  <div className="text-2xs text-term-text">Stop ${formatInr(idea.entryExitPlan?.stopLoss ?? 0)} | Target ${formatInr(idea.entryExitPlan?.firstTarget ?? 0)}</div>
                </div>
              `)}
          </div>
        </div>

        <div className="border border-term-border rounded bg-term-panel">
          <div className="px-4 py-3 border-b border-term-border text-sm font-semibold text-term-bright">Guard</div>
          <div className="p-3 space-y-2 text-xs">
            <div className="text-term-text">Can Trade: <span className=${guard?.canTrade ? "text-accent-green" : "text-accent-red"}>${String(guard?.canTrade ?? false)}</span></div>
            <div className="text-term-text">Cash %: ${((guard?.cashPct ?? 0) * 100).toFixed(1)}%</div>
            <div className="text-term-text">Deployed %: ${((guard?.deployedPct ?? 0) * 100).toFixed(1)}%</div>
            ${(guard?.reasons ?? []).map((r: string) => html`<div className="text-accent-red">- ${r}</div>`)}
            ${(guard?.warnings ?? []).map((w: string) => html`<div className="text-accent-amber">- ${w}</div>`)}
          </div>
        </div>
      </div>

      <div className="border border-term-border rounded bg-term-panel">
        <div className="px-4 py-3 border-b border-term-border text-sm font-semibold text-term-bright">Open Positions</div>
        <div className="p-3">
          ${(portfolio?.positions ?? []).length === 0
            ? html`<div className="text-xs text-term-muted">No open positions</div>`
            : html`
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-term-muted border-b border-term-border">
                      <th className="py-2 text-left">Ticker</th>
                      <th className="py-2 text-right">Qty</th>
                      <th className="py-2 text-right">Entry</th>
                      <th className="py-2 text-right">CMP</th>
                      <th className="py-2 text-right">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(portfolio?.positions ?? []).map((p: any) => html`
                      <tr className="border-b border-term-border/50">
                        <td className="py-2 text-term-bright">${p.ticker}</td>
                        <td className="py-2 text-right">${p.qty}</td>
                        <td className="py-2 text-right">${formatInr(p.entryPrice)}</td>
                        <td className="py-2 text-right">${formatInr(p.currentPrice)}</td>
                        <td className=${`py-2 text-right ${p.unrealizedPnl >= 0 ? "text-accent-green" : "text-accent-red"}`}>${formatInr(p.unrealizedPnl)}</td>
                      </tr>
                    `)}
                  </tbody>
                </table>
              </div>
            `}
        </div>
      </div>
    </div>
  `;
}

function formatInr(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs < 1000) return `${sign}₹${abs.toFixed(0)}`;
  if (abs < 100000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
  if (abs < 10000000) return `${sign}₹${(abs / 100000).toFixed(1)}L`;
  return `${sign}₹${(abs / 10000000).toFixed(1)}Cr`;
}

import React, { useCallback, useEffect, useMemo, useState } from "react";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const htm: any = (await import("htm")).default;
const html = htm.bind(React.createElement);

interface MitDashboardProps {
  userId: string;
}

async function fetchMit(path: string, userId: string, options?: RequestInit) {
  const response = await fetch(path, {
    ...options,
    headers: { "x-user-id": userId, ...options?.headers },
  });
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  return response.json();
}

// === INR Formatter (Blueprint Section 9: compact lakhs/crores notation) ===
function formatInr(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs < 1000) return `${sign}₹${abs.toFixed(0)}`;
  if (abs < 100000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
  if (abs < 10000000) return `${sign}₹${(abs / 100000).toFixed(1)}L`;
  return `${sign}₹${(abs / 10000000).toFixed(1)}Cr`;
}

function formatInrFull(value: number): string {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pctStr(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function colorForPnl(value: number): string {
  return value > 0 ? "text-accent-green" : value < 0 ? "text-accent-red" : "text-term-muted";
}

// === Top Bar (Blueprint Section 9: Cash%, Deployed%, Equity, P&L, DD, Win-rate, R:R) ===
function MitTopBar({ portfolio }: { portfolio: any }) {
  if (!portfolio) return null;
  const capital = portfolio.settings?.capital ?? 200000;
  const cashPct = capital > 0 ? portfolio.cash / capital : 0;
  const deployedPct = portfolio.deployedPct ?? 0;
  const cumPnl = (portfolio.unrealizedPnl ?? 0) + (portfolio.realizedPnlCumulative ?? 0);
  const cumPnlPct = capital > 0 ? cumPnl / capital : 0;
  const dd = portfolio.maxDrawdownPct ?? 0;
  const wr = portfolio.winRate;
  const wins = portfolio.closedTrades?.filter((t: any) => t.realizedPnl > 0).length ?? 0;
  const total = portfolio.closedTrades?.length ?? 0;
  const avgR = portfolio.avgRMultiple;

  const cashColor = cashPct > 0.3 ? "text-accent-green" : cashPct > 0.1 ? "text-amber-400" : "text-accent-red";
  const ddColor = dd < 0.05 ? "text-accent-green" : dd < 0.1 ? "text-amber-400" : "text-accent-red";
  const wrColor = wr === null ? "text-term-muted" : wr > 0.6 ? "text-accent-green" : wr > 0.4 ? "text-amber-400" : "text-accent-red";

  const cells = [
    { label: "CASH", value: pctStr(cashPct), sub: formatInr(portfolio.cash ?? 0), color: cashColor },
    { label: "DEPLOYED", value: pctStr(deployedPct), sub: formatInr(portfolio.deployed ?? 0), color: "text-term-bright" },
    { label: "EQUITY", value: formatInr(portfolio.equity ?? 0), sub: "", color: "text-term-bright" },
    { label: "CUM P&L", value: formatInr(cumPnl), sub: `${cumPnlPct >= 0 ? "+" : ""}${(cumPnlPct * 100).toFixed(1)}%`, color: colorForPnl(cumPnl) },
    { label: "MAX DD", value: `-${(dd * 100).toFixed(1)}%`, sub: "", color: ddColor },
    { label: "WIN RATE", value: wr !== null ? `${(wr * 100).toFixed(0)}%` : "N/A", sub: total >= 5 ? `${wins}/${total}` : total > 0 ? `${wins}/${total} (low n)` : "", color: wrColor },
    { label: "AVG R:R", value: avgR !== null ? `${avgR.toFixed(1)}:1` : "N/A", sub: "", color: "text-term-bright" },
  ];

  return html`
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-px bg-term-border rounded overflow-hidden">
      ${cells.map((c) => html`
        <div className="bg-term-panel px-3 py-2 min-w-0">
          <div className="text-2xs uppercase tracking-widest text-term-muted truncate">${c.label}</div>
          <div className="font-mono text-sm ${c.color} truncate">${c.value}</div>
          ${c.sub ? html`<div className="text-2xs text-term-muted font-mono truncate">${c.sub}</div>` : null}
        </div>
      `)}
    </div>
  `;
}

// === Sentiment Banner ===
function MitSentimentBanner({ tone }: { tone: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    "risk-off": { bg: "bg-red-950/40 border-accent-red/30", text: "text-accent-red", label: "RISK-OFF — Narrowed buy zones, prefer defensives" },
    "risk-on": { bg: "bg-green-950/40 border-accent-green/30", text: "text-accent-green", label: "RISK-ON — Breakout entries allowed, tighter stops" },
    neutral: { bg: "bg-term-panel border-term-border", text: "text-term-muted", label: "NEUTRAL — Standard parameters" },
  };
  const fallback = { bg: "bg-term-panel border-term-border", text: "text-term-muted", label: "NEUTRAL — Standard parameters" };
  const c = config[tone] ?? fallback;
  return html`
    <div className="border ${c.bg} rounded px-3 py-1.5 flex items-center gap-2">
      <span className="w-2 h-2 rounded-full ${tone === "risk-off" ? "bg-accent-red" : tone === "risk-on" ? "bg-accent-green" : "bg-term-muted"}"></span>
      <span className="text-xs font-mono ${c.text}">${c.label}</span>
    </div>
  `;
}

// === Idea Card (Blueprint Section 9: Buy-Zone bar, Stop, Target, thesis, score) ===
function MitIdeaCard({ idea }: { idea: any }) {
  const p = idea.entryExitPlan ?? {};
  const isAvoid = idea.isAvoid;
  const borderColor = isAvoid ? "border-accent-red/40" : idea.feed === "quant" ? "border-blue-500/30" : "border-accent-green/30";
  const feedChip = isAvoid
    ? html`<span className="text-2xs font-mono px-1.5 py-0.5 rounded bg-red-950/60 text-accent-red">AVOID</span>`
    : html`<span className="text-2xs font-mono px-1.5 py-0.5 rounded ${idea.feed === "quant" ? "bg-blue-950/60 text-blue-400" : "bg-green-950/60 text-accent-green"}">${idea.feed === "quant" ? "QUANT" : "NT LITE"}</span>`;

  if (isAvoid) {
    return html`
      <div className="border ${borderColor} rounded bg-term-surface p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-term-bright">${idea.ticker}</div>
          ${feedChip}
        </div>
        ${(idea.risks ?? []).map((r: string) => html`<div className="text-xs text-accent-red mb-1">- ${r}</div>`)}
        ${idea.avoidReason ? html`<div className="text-2xs text-term-muted mt-1">Reason: ${idea.avoidReason}</div>` : null}
      </div>
    `;
  }

  const buyLow = p.buyZoneLow ?? 0;
  const buyHigh = p.buyZoneHigh ?? 0;
  const stop = p.stopLoss ?? 0;
  const target = p.firstTarget ?? 0;
  const cmp = idea.technicals?.latestClose ?? 0;
  const score = idea.compositeScore?.total ?? 0;
  const rr = p.rMultiple ?? 0;
  const targetPct = p.firstTargetPct ? `+${(p.firstTargetPct * 100).toFixed(1)}%` : "";

  // Buy zone bar: position of CMP within buy zone
  const zoneWidth = buyHigh - buyLow || 1;
  const fillPct = Math.max(0, Math.min(100, ((cmp - buyLow) / zoneWidth) * 100));

  return html`
    <div className="border ${borderColor} rounded bg-term-surface p-3">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          ${feedChip}
          <span className="text-sm font-semibold text-term-bright">${idea.ticker}</span>
        </div>
        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-term-panel text-term-bright">${score}</span>
      </div>

      ${(idea.thesis ?? []).slice(0, 3).map((t: string) => html`<div className="text-2xs text-term-text mb-0.5">· ${t}</div>`)}

      <div className="mt-2 mb-1">
        <div className="flex justify-between text-2xs text-term-muted mb-0.5">
          <span>${formatInrFull(buyLow)}</span>
          <span>CMP ${formatInrFull(cmp)}</span>
          <span>${formatInrFull(buyHigh)}</span>
        </div>
        <div className="h-1.5 bg-term-panel rounded-full overflow-hidden">
          <div className="h-full bg-accent-green/60 rounded-full" style=${{ width: `${fillPct}%` }}></div>
        </div>
        <div className="text-2xs text-term-muted mt-0.5">BUY ZONE | STOP ${formatInrFull(stop)}</div>
      </div>

      <div className="flex justify-between text-xs mt-1">
        <span className="text-term-text">TARGET ${formatInrFull(target)} <span className="text-accent-green">${targetPct}</span></span>
        <span className="text-term-muted">R:R ${rr.toFixed(1)}:1</span>
      </div>

      <div className="text-2xs text-term-muted mt-1 font-mono">${idea.momentumLabel ?? ""}</div>
    </div>
  `;
}

// === Holdings Card (Blueprint Section 9: progress bar stop→target, status indicators) ===
function MitHoldingCard({ position: p }: { position: any }) {
  const pnlPct = p.unrealizedPnlPct ?? 0;
  const parsedEntryDate = p.entryDate ? Date.parse(p.entryDate) : NaN;
  const daysHeld = Number.isFinite(parsedEntryDate)
    ? Math.floor((Date.now() - parsedEntryDate) / 86400000)
    : 0;
  const stop = p.trailingActive ? (p.trailingStop ?? p.stopLoss) : p.stopLoss;
  const target = p.firstTarget;
  const range = target - stop;
  const progressPct = range > 0 ? Math.max(0, Math.min(100, ((p.currentPrice - stop) / range) * 100)) : 0;

  const statusLabel = p.currentPrice <= stop ? "[STOP]"
    : p.currentPrice >= target ? "[TARGET]"
    : p.trailingActive ? "[TRAIL]"
    : "[OPEN]";
  const statusColor = p.currentPrice <= stop ? "text-accent-red"
    : p.currentPrice >= target ? "text-accent-green"
    : p.trailingActive ? "text-blue-400"
    : "text-amber-400";

  const barColor = p.currentPrice <= stop ? "bg-accent-red" : progressPct > 75 ? "bg-accent-green" : "bg-blue-400";

  return html`
    <div className="border border-term-border rounded bg-term-surface p-3">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-term-bright">${p.ticker}</span>
          <span className="text-2xs font-mono px-1 py-0.5 rounded bg-term-panel text-term-muted">${p.feed === "quant" ? "Q" : "NT"}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xs text-term-muted">${daysHeld}d</span>
          <span className="text-2xs font-mono font-bold ${statusColor}">${statusLabel}</span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 text-2xs mb-2">
        <div><span className="text-term-muted">Entry</span> <span className="text-term-text font-mono">${formatInrFull(p.entryPrice)}</span></div>
        <div><span className="text-term-muted">CMP</span> <span className="text-term-text font-mono">${formatInrFull(p.currentPrice)}</span></div>
        <div><span className="text-term-muted">Qty</span> <span className="text-term-text font-mono">${p.qty}</span></div>
        <div><span className="text-term-muted">P&L</span> <span className="${colorForPnl(p.unrealizedPnl)} font-mono">${formatInr(p.unrealizedPnl)}</span></div>
      </div>

      <div className="mb-1">
        <div className="flex justify-between text-2xs text-term-muted mb-0.5">
          <span>STOP ${formatInrFull(stop)}</span>
          <span>TARGET ${formatInrFull(target)}</span>
        </div>
        <div className="h-1.5 bg-term-panel rounded-full overflow-hidden">
          <div className="h-full ${barColor} rounded-full transition-all" style=${{ width: `${progressPct}%` }}></div>
        </div>
      </div>

      <div className="flex justify-between text-2xs">
        <span className="${colorForPnl(pnlPct)} font-mono">${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%</span>
        ${p.trailingActive ? html`<span className="text-blue-400 font-mono">Trail @ ${formatInrFull(p.trailingStop ?? 0)}</span>` : null}
      </div>
    </div>
  `;
}

// === Sell Indicators Panel ===
function MitSellIndicators({ positions }: { positions: any[] }) {
  const withIndicators = positions.filter((p: any) => (p.activeSellIndicators ?? []).length > 0);
  if (withIndicators.length === 0) return null;

  const indicatorLabel: Record<string, { text: string; color: string }> = {
    "near-target": { text: "NEAR TARGET", color: "bg-green-950/60 text-accent-green" },
    "rsi-rollover": { text: "RSI ROLLOVER", color: "bg-amber-950/60 text-amber-400" },
    "time-exit": { text: "TIME EXIT", color: "bg-amber-950/60 text-amber-400" },
    "stop-breach": { text: "STOP BREACH", color: "bg-red-950/60 text-accent-red" },
    "momentum-decay": { text: "MTM DECAY", color: "bg-red-950/60 text-accent-red" },
  };

  return html`
    <div className="border border-amber-500/30 rounded bg-term-panel">
      <div className="px-4 py-2 border-b border-term-border text-xs font-semibold text-amber-400">Sell Indicators Active</div>
      <div className="p-3 space-y-2">
        ${withIndicators.map((p: any) => html`
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono text-term-bright">${p.ticker}</span>
            <div className="flex gap-1">
              ${(p.activeSellIndicators ?? []).map((ind: string) => {
                const cfg = indicatorLabel[ind] ?? { text: ind, color: "bg-term-panel text-term-muted" };
                return html`<span className="text-2xs px-1.5 py-0.5 rounded font-mono ${cfg.color}">${cfg.text}</span>`;
              })}
            </div>
            <span className="${colorForPnl(p.unrealizedPnl)} font-mono">${formatInr(p.unrealizedPnl)}</span>
          </div>
        `)}
      </div>
    </div>
  `;
}

// === Main Dashboard ===
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

  const marketTone = useMemo(() => {
    const latestRun = ideas.length > 0 ? "neutral" : "neutral";
    // Derive from guard or portfolio state
    return guard?.paused ? "risk-off" : latestRun;
  }, [ideas, guard]);

  const buyIdeas = useMemo(() => ideas.filter((i: any) => !i.isAvoid), [ideas]);
  const avoidIdeas = useMemo(() => ideas.filter((i: any) => i.isAvoid), [ideas]);
  const positions = portfolio?.positions ?? [];

  return html`
    <div className="space-y-3">
      ${/* Header */null}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-term-bright">MIT Trading Dashboard</div>
          <div className="text-2xs text-term-muted">NT LITE + Quant | ${formatInr(portfolio?.settings?.capital ?? 200000)} capital</div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick=${runPipeline}
            disabled=${running}
            className="px-3 py-1.5 text-xs border border-accent-green/40 text-accent-green rounded hover:bg-accent-green/10 disabled:opacity-50 transition-colors"
          >${running ? "RUNNING..." : "RUN PIPELINE"}</button>
          <button
            type="button"
            onClick=${load}
            className="px-3 py-1.5 text-xs border border-term-border text-term-muted rounded hover:bg-term-surface transition-colors"
          >REFRESH</button>
        </div>
      </div>

      ${error ? html`<div className="border border-accent-red/30 bg-red-950/20 text-accent-red text-xs rounded px-3 py-2">${error}</div>` : null}

      ${/* Top Bar Metrics */null}
      <${MitTopBar} portfolio=${portfolio} />

      ${/* Sentiment Banner */null}
      <${MitSentimentBanner} tone=${marketTone} />

      ${/* Sell Indicators (only shown when active) */null}
      <${MitSellIndicators} positions=${positions} />

      ${/* Guard warnings */null}
      ${guard && !guard.canTrade ? html`
        <div className="border border-accent-red/30 bg-red-950/20 rounded px-3 py-2">
          <div className="text-xs font-semibold text-accent-red mb-1">Trading Paused</div>
          ${(guard.reasons ?? []).map((r: string) => html`<div className="text-2xs text-accent-red">- ${r}</div>`)}
          ${(guard.suggestedSells ?? []).length > 0 ? html`
            <div className="text-2xs text-term-muted mt-1">Consider exits: ${guard.suggestedSells.join(", ")}</div>
          ` : null}
        </div>
      ` : null}

      ${/* Main Content: Ideas + Holdings */null}
      <div className="grid gap-3 xl:grid-cols-3">
        ${/* Watchlist Ideas */null}
        <div className="xl:col-span-2 space-y-3">
          <div className="border border-term-border rounded bg-term-panel">
            <div className="px-4 py-2 border-b border-term-border flex items-center justify-between">
              <span className="text-xs font-semibold text-term-bright">Daily Ideas</span>
              <span className="text-2xs text-term-muted">${buyIdeas.length} buy${avoidIdeas.length > 0 ? ` + ${avoidIdeas.length} avoid` : ""}</span>
            </div>
            <div className="p-3 grid gap-3 md:grid-cols-2">
              ${buyIdeas.length === 0 && avoidIdeas.length === 0
                ? html`<div className="text-xs text-term-muted col-span-2">No ideas yet. Run the pipeline.</div>`
                : html`
                  ${buyIdeas.map((idea: any) => html`<${MitIdeaCard} idea=${idea} />`)}
                  ${avoidIdeas.map((idea: any) => html`<${MitIdeaCard} idea=${idea} />`)}
                `}
            </div>
          </div>

          ${/* Holdings */null}
          <div className="border border-term-border rounded bg-term-panel">
            <div className="px-4 py-2 border-b border-term-border flex items-center justify-between">
              <span className="text-xs font-semibold text-term-bright">Open Positions</span>
              <span className="text-2xs text-term-muted">${positions.length} positions</span>
            </div>
            <div className="p-3">
              ${positions.length === 0
                ? html`<div className="text-xs text-term-muted">No open positions</div>`
                : html`<div className="grid gap-3 md:grid-cols-2">${positions.map((p: any) => html`<${MitHoldingCard} position=${p} />`)}</div>`}
            </div>
          </div>
        </div>

        ${/* Sidebar: Guard + Closed Trades Summary */null}
        <div className="space-y-3">
          <div className="border border-term-border rounded bg-term-panel">
            <div className="px-4 py-2 border-b border-term-border text-xs font-semibold text-term-bright">Exposure Guard</div>
            <div className="p-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-term-muted">Can Trade</span>
                <span className="${guard?.canTrade ? "text-accent-green" : "text-accent-red"} font-mono">${String(guard?.canTrade ?? false).toUpperCase()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-term-muted">Cash</span>
                <span className="text-term-text font-mono">${pctStr(guard?.cashPct ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-term-muted">Deployed</span>
                <span className="text-term-text font-mono">${pctStr(guard?.deployedPct ?? 0)}</span>
              </div>
              ${(guard?.warnings ?? []).map((w: string) => html`<div className="text-amber-400 text-2xs">- ${w}</div>`)}
            </div>
          </div>

          <div className="border border-term-border rounded bg-term-panel">
            <div className="px-4 py-2 border-b border-term-border text-xs font-semibold text-term-bright">Closed Trades</div>
            <div className="p-3 space-y-1 text-xs">
              ${(portfolio?.closedTrades ?? []).length === 0
                ? html`<div className="text-term-muted">No closed trades</div>`
                : (portfolio?.closedTrades ?? []).slice(-5).reverse().map((t: any) => html`
                  <div className="flex justify-between font-mono">
                    <span className="text-term-text">${t.ticker}</span>
                    <span className="${colorForPnl(t.realizedPnl)}">${formatInr(t.realizedPnl)} (${t.realizedRMultiple >= 0 ? "+" : ""}${t.realizedRMultiple.toFixed(1)}R)</span>
                  </div>
                `)}
            </div>
          </div>

          <div className="border border-term-border rounded bg-term-panel">
            <div className="px-4 py-2 border-b border-term-border text-xs font-semibold text-term-bright">Export</div>
            <div className="p-3 flex flex-col gap-1">
              <a href="/api/mit/export/holdings.csv" className="text-2xs text-blue-400 hover:underline">Holdings CSV</a>
              <a href="/api/mit/export/trades.csv" className="text-2xs text-blue-400 hover:underline">Trades CSV</a>
              <a href="/api/mit/export/watchlist.csv" className="text-2xs text-blue-400 hover:underline">Watchlist CSV</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

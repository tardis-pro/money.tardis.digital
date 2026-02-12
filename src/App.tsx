import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sankey,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import htm from "htm/dist/htm.mjs";
import { MitDashboard } from "./MitDashboard.js";

const html = htm.bind(React.createElement as (...args: unknown[]) => React.ReactElement);

const USERS = [
  { id: "demo-analyst", label: "Analyst", role: "analyst" },
  { id: "demo-viewer", label: "Viewer", role: "viewer" },
  { id: "demo-admin", label: "Admin", role: "admin" },
  { id: "mit-trader", label: "MIT Trader", role: "operator" },
] as const;

let activeUserId = "mit-trader";

async function fetchJSON(url: string, options?: RequestInit) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "x-user-id": activeUserId,
      ...options?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${url}`);
  }
  return response.json();
}

function num(value: number, decimals = 1) {
  return value.toFixed(decimals);
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function severityColor(severity: string) {
  if (severity === "high") return "#ff6b6b";
  if (severity === "medium") return "#ffb224";
  return "#5b9aff";
}

function severityBg(severity: string) {
  if (severity === "high") return "border-accent-red/30 bg-accent-red-dim";
  if (severity === "medium") return "border-accent-amber/30 bg-accent-amber-dim";
  return "border-accent-blue/30 bg-accent-blue-dim";
}

function directionStyle(direction: string) {
  if (direction === "positive") return { color: "#00e599", label: "BULL" };
  if (direction === "negative") return { color: "#ff6b6b", label: "BEAR" };
  return { color: "#5b9aff", label: "NEUT" };
}

interface Signal {
  id: string;
  score: number;
  createdAt: string;
  event: { title: string; evidenceSnippet: string };
  impact: { direction: string; horizon: string; confidence: number };
  linkedEntities: Array<{ ticker: string; confidence: number }>;
}
interface HeatmapItem { sector: string; weightedScore: number; signalCount: number }
interface Alert { severity: string; triggeredAt: string; reason: string }
interface Outcomes { total: number; hitRate: number; averageReturn: number }
interface SupplyGraph {
  nodes: Array<{ ticker: string; sector: string; production?: number; demand?: number; imports?: number; exports?: number; surplus?: number }>;
  edges: Array<{ from: string; to: string; relation: string; lag: number; confidence: number; propagationScore: number; channel: string }>;
}
interface CommandLog { route: string; latencyMs: number; input: string; status: string; errorMessage?: string }
interface Watchlist { name: string; tickers: string[] }

const TABS = [
  { id: "overview", label: "OVW", full: "Overview" },
  { id: "signals", label: "SIG", full: "Signals" },
  { id: "heatmap", label: "HMP", full: "Heatmap" },
  { id: "alerts", label: "ALT", full: "Alerts" },
  { id: "supply-chain", label: "SCG", full: "Supply Chain" },
  { id: "watchlists", label: "WCH", full: "Watchlists" },
  { id: "mit", label: "MIT", full: "MIT Trading" },
] as const;

function StatCell({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return html`
    <div className="border-r border-term-border last:border-r-0 px-4 py-3">
      <div className="text-2xs uppercase tracking-widest text-term-muted font-medium mb-1">${label}</div>
      <div className="font-mono text-lg font-semibold" style=${{ color: accent || "#e8eef5" }}>${value}</div>
      ${sub ? html`<div className="text-2xs text-term-muted mt-0.5">${sub}</div>` : null}
    </div>
  `;
}

export function App() {
  const [userId, setUserId] = useState("mit-trader");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [commandInput, setCommandInput] = useState("");
  const [commandStatus, setCommandStatus] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [signals, setSignals] = useState<Signal[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapItem[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [outcomes, setOutcomes] = useState<Outcomes>({ total: 0, hitRate: 0, averageReturn: 0 });
  const [supplyGraph, setSupplyGraph] = useState<SupplyGraph>({ nodes: [], edges: [] });
  const [commandLogs, setCommandLogs] = useState<CommandLog[]>([]);
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const switchUser = useCallback((id: string) => {
    activeUserId = id;
    setUserId(id);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setError("");
      const [signalsData, heatmapData, alertsData, outcomeData, supplyData, commandData, watchlistData] =
        await Promise.all([
          fetchJSON("/api/signals?limit=40"),
          fetchJSON("/api/heatmap"),
          fetchJSON("/api/alerts"),
          fetchJSON("/api/outcomes/summary"),
          fetchJSON("/api/supply-chain-graph"),
          fetchJSON("/api/terminal/commands?limit=12"),
          fetchJSON("/api/watchlists"),
        ]);
      setSignals(signalsData);
      setHeatmap(heatmapData);
      setAlerts(alertsData);
      setOutcomes(outcomeData);
      setSupplyGraph(supplyData);
      setCommandLogs(commandData);
      setWatchlists(watchlistData);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const runPipeline = useCallback(async () => {
    try {
      setRunning(true);
      await fetchJSON("/api/ingest/run", { method: "POST" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [refresh]);

  const runCommand = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const response = await fetchJSON("/api/terminal/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: commandInput }),
      });
      if (response.status === "error") {
        setCommandStatus(response.errorMessage || "ERR");
        return;
      }
      setCommandStatus(`${response.route} ${response.latencyMs}ms`);
      setActiveTab(response.route);
      setCommandInput("");
      const latest = await fetchJSON("/api/terminal/commands?limit=12");
      setCommandLogs(latest);
    } catch (err) {
      setCommandStatus(err instanceof Error ? err.message : String(err));
    }
  }, [commandInput]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 12000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setActiveTab("overview"); return; }
      if (event.key === "k" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        (document.getElementById("cmd-input") as HTMLInputElement)?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (activeTab !== "overview") {
      document.getElementById(`panel-${activeTab}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [activeTab]);

  // Derived data
  const timelineData = useMemo(() =>
    [...signals].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((s, i) => ({
      idx: i + 1,
      score: Number((s.score * 100).toFixed(1)),
      confidence: Number((s.impact.confidence * 100).toFixed(1)),
      title: s.event.title,
    })),
  [signals]);

  const sectorData = useMemo(() =>
    heatmap.slice(0, 8).map((item) => ({
      sector: item.sector,
      score: Number((item.weightedScore * 100).toFixed(1)),
      signals: item.signalCount,
    })),
  [heatmap]);

  const alertData = useMemo(() => {
    const g = { high: 0, medium: 0, low: 0 };
    for (const a of alerts.slice(0, 100)) g[a.severity as keyof typeof g] = (g[a.severity as keyof typeof g] ?? 0) + 1;
    return [
      { name: "Critical", value: g.high, color: "#ff6b6b" },
      { name: "Warning", value: g.medium, color: "#ffb224" },
      { name: "Info", value: g.low, color: "#5b9aff" },
    ];
  }, [alerts]);

  const supplySankeyData = useMemo(() => {
    const nodes = (supplyGraph.nodes ?? []).slice(0, 12).map((n) => ({ name: `${n.ticker} (${n.sector})` }));
    const nodeIdx = new Map(nodes.map((n, i) => [n.name.split(" ")[0], i]));
    const links = (supplyGraph.edges ?? [])
      .filter((e) => nodeIdx.has(e.from) && nodeIdx.has(e.to))
      .slice(0, 22)
      .map((e) => ({
        source: nodeIdx.get(e.from), target: nodeIdx.get(e.to),
        value: Math.max(1, Math.round(e.propagationScore * 100)),
        relation: e.relation, confidence: e.confidence, score: e.propagationScore,
      }))
      .filter((e) => Number.isInteger(e.source) && Number.isInteger(e.target));
    return { nodes, links };
  }, [supplyGraph]);

  const supplyRows = useMemo(() =>
    (supplyGraph.nodes ?? []).slice(0, 10).map((n) => ({
      ticker: n.ticker, production: n.production ?? 0, demand: n.demand ?? 0,
      imports: n.imports ?? 0, exports: n.exports ?? 0, surplus: n.surplus ?? 0,
    })),
  [supplyGraph]);

  const graphStats = useMemo(() => {
    const edges = supplyGraph.edges ?? [];
    const direct = edges.filter((e) => e.relation === "direct").length;
    const avgConf = edges.length > 0 ? edges.reduce((s, e) => s + e.confidence, 0) / edges.length : 0;
    return { nodes: (supplyGraph.nodes ?? []).length, edges: edges.length, direct, indirect: edges.length - direct, avgConf };
  }, [supplyGraph]);

  const currentUser = USERS.find((u) => u.id === userId) ?? USERS[0];

  const tooltipStyle = { background: "#0d1117", border: "1px solid #1e2832", borderRadius: 4, fontSize: 11 };

  // ─── RENDER ───────────────────────────────────────────────

  return html`
    <div className="flex flex-col min-h-screen">

      ${/* ── TOP BAR ── */ ""}
      <header className="sticky top-0 z-30 border-b border-term-border bg-term-bg/95 backdrop-blur-sm">
        <div className="mx-auto max-w-[1600px] px-4 flex items-center justify-between h-11">

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-accent-green live-dot" />
              <span className="font-mono text-xs font-semibold tracking-wider text-accent-green">IPST</span>
            </div>
            <div className="h-4 w-px bg-term-border" />
            <span className="text-xs text-term-muted hidden sm:inline">India Policy Signal Terminal</span>
          </div>

          <nav className="flex items-center gap-0.5">
            ${TABS.map((tab) => html`
              <button
                key=${tab.id}
                type="button"
                onClick=${() => setActiveTab(tab.id)}
                className=${`px-3 py-1.5 text-xs font-mono font-medium tracking-wide transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? "border-accent-green text-accent-green"
                    : "border-transparent text-term-muted hover:text-term-text"
                }`}
              >
                <span className="hidden sm:inline">${tab.full}</span>
                <span className="sm:hidden">${tab.label}</span>
              </button>
            `)}
          </nav>

          <div className="flex items-center gap-3">
            <select
              value=${userId}
              onChange=${(e: React.ChangeEvent<HTMLSelectElement>) => switchUser(e.target.value)}
              className="bg-term-surface border border-term-border rounded px-2 py-1 text-xs font-mono text-term-text outline-none focus:border-accent-green/50 cursor-pointer"
            >
              ${USERS.map((u) => html`<option key=${u.id} value=${u.id}>${u.label} (${u.role})</option>`)}
            </select>
            ${lastUpdate ? html`
              <span className="text-2xs font-mono text-term-muted hidden lg:inline">
                ${lastUpdate.toLocaleTimeString()}
              </span>
            ` : null}
          </div>

        </div>
      </header>

      ${/* ── COMMAND BAR ── */ ""}
      <div className="border-b border-term-border bg-term-panel">
        <div className="mx-auto max-w-[1600px] px-4 flex items-center gap-3 h-10">
          <span className="font-mono text-2xs text-accent-green">></span>
          <form onSubmit=${runCommand} className="flex-1 flex items-center gap-2">
            <input
              id="cmd-input"
              value=${commandInput}
              onInput=${(e: React.ChangeEvent<HTMLInputElement>) => setCommandInput(e.target.value)}
              placeholder="signals | heatmap | alerts | supply | watchlists | system"
              className="flex-1 bg-transparent text-xs font-mono text-term-bright outline-none placeholder:text-term-muted/50"
            />
            <span className="text-2xs font-mono text-term-muted">${commandStatus || "Ctrl+K"}</span>
          </form>
          <div className="h-4 w-px bg-term-border" />
          <button
            type="button"
            onClick=${runPipeline}
            disabled=${running}
            className="px-3 py-1 text-2xs font-mono font-semibold uppercase tracking-widest border rounded transition-colors disabled:opacity-40 ${
              running
                ? "border-accent-amber/40 text-accent-amber bg-accent-amber-dim"
                : "border-accent-green/40 text-accent-green bg-accent-green-dim hover:bg-accent-green/20"
            }"
          >
            ${running ? "RUNNING" : "INGEST"}
          </button>
          <button
            type="button"
            onClick=${refresh}
            className="px-3 py-1 text-2xs font-mono font-semibold uppercase tracking-widest border border-term-border text-term-muted rounded hover:text-term-text hover:border-term-border-hi transition-colors"
          >
            REFRESH
          </button>
        </div>
      </div>

      ${/* ── ERROR BAR ── */ ""}
      <${AnimatePresence}>
        ${error ? html`
          <${motion.div}
            initial=${{ height: 0, opacity: 0 }}
            animate=${{ height: "auto", opacity: 1 }}
            exit=${{ height: 0, opacity: 0 }}
            className="border-b border-accent-red/30 bg-accent-red-dim px-4 overflow-hidden"
          >
            <div className="mx-auto max-w-[1600px] py-2 text-xs font-mono text-accent-red flex items-center gap-2">
              <span className="font-semibold">ERR</span>
              <span className="text-accent-red/80">${error}</span>
            </div>
          </${motion.div}>
        ` : null}
      </${AnimatePresence}>

      ${/* ── MAIN CONTENT ── */ ""}
      <main className="flex-1 mx-auto max-w-[1600px] w-full px-4 py-4 space-y-4">

        ${activeTab === "mit" ? html`
          <div id="panel-mit">
            <${MitDashboard} userId=${userId} />
          </div>
        ` : null}

        ${/* ── STAT STRIP ── */ ""}
        <${motion.div}
          initial=${{ opacity: 0, y: 8 }}
          animate=${{ opacity: 1, y: 0 }}
          transition=${{ duration: 0.3 }}
          className="border border-term-border rounded bg-term-panel flex overflow-x-auto"
        >
          <${StatCell} label="Signals" value=${signals.length} accent="#00e599" />
          <${StatCell} label="Sectors" value=${heatmap.length} />
          <${StatCell} label="Alerts" value=${alerts.length} accent=${alerts.some((a) => a.severity === "high") ? "#ff6b6b" : "#ffb224"} />
          <${StatCell} label="Graph Edges" value=${graphStats.edges} />
          <${StatCell} label="Hit Rate" value=${pct(outcomes.hitRate ?? 0)} accent="#00e599" />
          <${StatCell} label="Avg Return" value=${pct(outcomes.averageReturn ?? 0)} accent=${(outcomes.averageReturn ?? 0) >= 0 ? "#00e599" : "#ff6b6b"} />
        </${motion.div}>

        ${/* ── ROW 1: SIGNAL CHART + ALERT MIX ── */ ""}
        <div className="grid gap-4 xl:grid-cols-3" id="panel-signals">
          <${motion.div}
            initial=${{ opacity: 0, y: 12 }}
            animate=${{ opacity: 1, y: 0 }}
            transition=${{ delay: 0.05 }}
            className="xl:col-span-2 border border-term-border rounded bg-term-panel"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-term-border">
              <h2 className="text-sm font-semibold text-term-bright">Signal Momentum</h2>
              <span className="text-2xs font-mono text-term-muted">SCORE vs CONFIDENCE</span>
            </div>
            <div className="h-72 px-2 py-2">
              <${ResponsiveContainer} width="100%" height="100%">
                <${AreaChart} data=${timelineData} margin=${{ top: 8, right: 12, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00e599" stopOpacity=${0.3} />
                      <stop offset="95%" stopColor="#00e599" stopOpacity=${0.02} />
                    </linearGradient>
                  </defs>
                  <${CartesianGrid} strokeDasharray="3 3" stroke="#1e2832" />
                  <${XAxis} dataKey="idx" stroke="#4a5d73" tick=${{ fontSize: 10 }} />
                  <${YAxis} stroke="#4a5d73" tick=${{ fontSize: 10 }} />
                  <${Tooltip} contentStyle=${tooltipStyle} labelStyle=${{ color: "#c9d6e3" }} />
                  <${Area} type="monotone" dataKey="score" stroke="#00e599" fill="url(#sg)" strokeWidth=${1.5} />
                  <${Area} type="monotone" dataKey="confidence" stroke="#5b9aff" fillOpacity=${0} strokeWidth=${1.5} strokeDasharray="4 2" />
                </${AreaChart}>
              </${ResponsiveContainer}>
            </div>
          </${motion.div}>

          <${motion.div}
            initial=${{ opacity: 0, y: 12 }}
            animate=${{ opacity: 1, y: 0 }}
            transition=${{ delay: 0.1 }}
            className="border border-term-border rounded bg-term-panel"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-term-border">
              <h2 className="text-sm font-semibold text-term-bright">Alert Distribution</h2>
              <span className="text-2xs font-mono text-term-muted">LAST 100</span>
            </div>
            <div className="h-72 px-2 py-2">
              <${ResponsiveContainer} width="100%" height="100%">
                <${PieChart}>
                  <${Pie} data=${alertData} innerRadius=${50} outerRadius=${85} dataKey="value" nameKey="name" paddingAngle=${2} stroke="#0d1117" strokeWidth=${2} />
                  <${Tooltip} contentStyle=${tooltipStyle} formatter=${(v: number) => [v, "alerts"]} />
                  <${Legend} wrapperStyle=${{ fontSize: 11 }} />
                </${PieChart}>
              </${ResponsiveContainer}>
            </div>
          </${motion.div}>
        </div>

        ${/* ── ROW 2: HEATMAP + RECENT ALERTS ── */ ""}
        <div className="grid gap-4 xl:grid-cols-3" id="panel-heatmap">
          <${motion.div}
            initial=${{ opacity: 0, y: 12 }}
            animate=${{ opacity: 1, y: 0 }}
            transition=${{ delay: 0.12 }}
            className="xl:col-span-2 border border-term-border rounded bg-term-panel"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-term-border">
              <h2 className="text-sm font-semibold text-term-bright">Sector Heatmap</h2>
              <span className="text-2xs font-mono text-term-muted">WEIGHTED SCORE</span>
            </div>
            <div className="h-72 px-2 py-2">
              <${ResponsiveContainer} width="100%" height="100%">
                <${BarChart} data=${sectorData} margin=${{ top: 8, right: 10, left: -20, bottom: 20 }}>
                  <${CartesianGrid} strokeDasharray="3 3" stroke="#1e2832" />
                  <${XAxis} dataKey="sector" stroke="#4a5d73" angle=${-20} textAnchor="end" interval=${0} tick=${{ fontSize: 10 }} />
                  <${YAxis} stroke="#4a5d73" tick=${{ fontSize: 10 }} />
                  <${Tooltip} contentStyle=${tooltipStyle} formatter=${(v: number, n: string) => [n === "score" ? `${v}%` : v, n]} />
                  <${Bar} dataKey="score" fill="#00e599" radius=${[2, 2, 0, 0]} />
                </${BarChart}>
              </${ResponsiveContainer}>
            </div>
          </${motion.div}>

          <${motion.div}
            initial=${{ opacity: 0, y: 12 }}
            animate=${{ opacity: 1, y: 0 }}
            transition=${{ delay: 0.14 }}
            id="panel-alerts"
            className="border border-term-border rounded bg-term-panel flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-term-border">
              <h2 className="text-sm font-semibold text-term-bright">Recent Alerts</h2>
              <span className="text-2xs font-mono text-term-muted">${alerts.length} TOTAL</span>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 max-h-72">
              ${alerts.slice(0, 12).map((alert) => html`
                <div className="border rounded px-3 py-2 ${severityBg(alert.severity)}">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-2xs font-mono font-bold uppercase tracking-widest" style=${{ color: severityColor(alert.severity) }}>
                      ${alert.severity}
                    </span>
                    <span className="text-2xs font-mono text-term-muted">${new Date(alert.triggeredAt).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-xs text-term-text leading-snug">${alert.reason}</p>
                </div>
              `)}
            </div>
          </${motion.div}>
        </div>

        ${/* ── ROW 3: GRAPH STATS + SUPPLY CHAIN SANKEY ── */ ""}
        <div className="grid gap-4 xl:grid-cols-3" id="panel-supply-chain">
          <${motion.div}
            initial=${{ opacity: 0, y: 12 }}
            animate=${{ opacity: 1, y: 0 }}
            transition=${{ delay: 0.16 }}
            className="xl:col-span-2 border border-term-border rounded bg-term-panel"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-term-border">
              <h2 className="text-sm font-semibold text-term-bright">Supply Chain Propagation</h2>
              <span className="text-2xs font-mono text-term-muted">HTS WEIGHTED</span>
            </div>
            <div className="h-72 px-2 py-2">
              <${ResponsiveContainer} width="100%" height="100%">
                <${Sankey}
                  data=${supplySankeyData}
                  nodePadding=${24}
                  margin=${{ top: 8, right: 20, left: 20, bottom: 8 }}
                  linkCurvature=${0.5}
                >
                  <${Tooltip}
                    contentStyle=${tooltipStyle}
                    formatter=${(_v: number, _n: string, item: { payload?: { relation?: string; confidence?: number } }) => {
                      const p = item?.payload ?? {};
                      return p.relation ? [`${_v}`, `${p.relation} | ${((p.confidence ?? 0) * 100).toFixed(1)}%`] : [_v, "flow"];
                    }}
                  />
                </${Sankey}>
              </${ResponsiveContainer}>
            </div>
          </${motion.div}>

          <${motion.div}
            initial=${{ opacity: 0, y: 12 }}
            animate=${{ opacity: 1, y: 0 }}
            transition=${{ delay: 0.18 }}
            className="border border-term-border rounded bg-term-panel"
          >
            <div className="px-4 py-3 border-b border-term-border">
              <h2 className="text-sm font-semibold text-term-bright">Graph Intelligence</h2>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                ${[
                  { l: "Nodes", v: graphStats.nodes },
                  { l: "Edges", v: graphStats.edges },
                  { l: "Direct", v: graphStats.direct },
                  { l: "Indirect", v: graphStats.indirect },
                ].map((s) => html`
                  <div className="border border-term-border rounded bg-term-surface px-3 py-2">
                    <div className="text-2xs uppercase tracking-widest text-term-muted">${s.l}</div>
                    <div className="font-mono text-lg font-semibold text-term-bright mt-0.5">${s.v}</div>
                  </div>
                `)}
              </div>
              <div className="border border-term-border rounded bg-term-surface px-3 py-2">
                <div className="text-2xs uppercase tracking-widest text-term-muted">Avg Confidence</div>
                <div className="font-mono text-lg font-semibold text-accent-green mt-0.5">${pct(graphStats.avgConf)}</div>
              </div>

              <div className="mt-3 space-y-1.5">
                ${(supplyGraph.edges ?? []).slice(0, 4).map((edge) => html`
                  <div className="border border-term-border rounded bg-term-surface px-3 py-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-2xs font-semibold" style=${{ color: edge.relation === "direct" ? "#00e599" : "#5b9aff" }}>
                        ${edge.from} > ${edge.to}
                      </span>
                      <span className="text-2xs font-mono text-term-muted">${pct(edge.confidence)}</span>
                    </div>
                  </div>
                `)}
              </div>
            </div>
          </${motion.div}>
        </div>

        ${/* ── ROW 4: SUPPLY TABLE ── */ ""}
        <${motion.div}
          initial=${{ opacity: 0, y: 12 }}
          animate=${{ opacity: 1, y: 0 }}
          transition=${{ delay: 0.2 }}
          className="border border-term-border rounded bg-term-panel"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-term-border">
            <h2 className="text-sm font-semibold text-term-bright">Supply Balance</h2>
            <span className="text-2xs font-mono text-term-muted">PRODUCTION vs DEMAND</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-term-border text-term-muted">
                  <th className="px-4 py-2 text-left text-2xs uppercase tracking-widest font-medium">Ticker</th>
                  <th className="px-4 py-2 text-right text-2xs uppercase tracking-widest font-medium">Prod</th>
                  <th className="px-4 py-2 text-right text-2xs uppercase tracking-widest font-medium">Demand</th>
                  <th className="px-4 py-2 text-right text-2xs uppercase tracking-widest font-medium">Import</th>
                  <th className="px-4 py-2 text-right text-2xs uppercase tracking-widest font-medium">Export</th>
                  <th className="px-4 py-2 text-right text-2xs uppercase tracking-widest font-medium">Surplus</th>
                </tr>
              </thead>
              <tbody>
                ${supplyRows.map((r) => html`
                  <tr className="border-b border-term-border/50 hover:bg-term-surface transition-colors">
                    <td className="px-4 py-2 font-semibold text-term-bright">${r.ticker}</td>
                    <td className="px-4 py-2 text-right text-term-text">${num(r.production)}</td>
                    <td className="px-4 py-2 text-right text-term-text">${num(r.demand)}</td>
                    <td className="px-4 py-2 text-right text-accent-amber">${num(r.imports)}</td>
                    <td className="px-4 py-2 text-right text-accent-green">${num(r.exports)}</td>
                    <td className="px-4 py-2 text-right font-semibold ${r.surplus >= 0 ? "text-accent-green" : "text-accent-red"}">${num(r.surplus)}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>
        </${motion.div}>

        ${/* ── ROW 5: WATCHLISTS + TELEMETRY ── */ ""}
        <div className="grid gap-4 lg:grid-cols-2" id="panel-watchlists">
          <${motion.div}
            initial=${{ opacity: 0, y: 12 }}
            animate=${{ opacity: 1, y: 0 }}
            transition=${{ delay: 0.22 }}
            className="border border-term-border rounded bg-term-panel"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-term-border">
              <h2 className="text-sm font-semibold text-term-bright">Watchlists</h2>
              <span className="text-2xs font-mono text-term-muted">${watchlists.length} LISTS</span>
            </div>
            <div className="p-3 space-y-2">
              ${watchlists.map((w) => html`
                <div className="border border-term-border rounded bg-term-surface px-3 py-2">
                  <div className="text-xs font-semibold text-term-bright mb-1">${w.name}</div>
                  <div className="flex flex-wrap gap-1">
                    ${w.tickers.map((t) => html`
                      <span className="px-1.5 py-0.5 text-2xs font-mono border border-accent-green/20 rounded text-accent-green bg-accent-green-dim">${t}</span>
                    `)}
                  </div>
                </div>
              `)}
            </div>
          </${motion.div}>

          <${motion.div}
            initial=${{ opacity: 0, y: 12 }}
            animate=${{ opacity: 1, y: 0 }}
            transition=${{ delay: 0.24 }}
            className="border border-term-border rounded bg-term-panel"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-term-border">
              <h2 className="text-sm font-semibold text-term-bright">Command Telemetry</h2>
              <span className="text-2xs font-mono text-term-muted">LAST 12</span>
            </div>
            <div className="p-3 space-y-1 max-h-72 overflow-y-auto">
              ${commandLogs.map((log) => html`
                <div className="border border-term-border/50 rounded bg-term-surface px-3 py-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-2xs font-semibold uppercase tracking-wider ${log.status === "ok" ? "text-accent-green" : "text-accent-amber"}">${log.route}</span>
                    <span className="text-2xs text-term-muted">${log.input || "-"}</span>
                  </div>
                  <span className="font-mono text-2xs text-term-muted">${log.latencyMs}ms</span>
                </div>
              `)}
            </div>
          </${motion.div}>
        </div>

        ${/* ── ROW 6: TOP SIGNALS GRID ── */ ""}
        <${motion.div}
          initial=${{ opacity: 0, y: 12 }}
          animate=${{ opacity: 1, y: 0 }}
          transition=${{ delay: 0.26 }}
          className="border border-term-border rounded bg-term-panel"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-term-border">
            <h2 className="text-sm font-semibold text-term-bright">Top Explainable Signals</h2>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-accent-green live-dot" />
              <span className="text-2xs font-mono text-term-muted">LIVE 12s</span>
            </div>
          </div>
          <div className="p-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            ${(loading ? [] : signals.slice(0, 9)).map((signal, i) => {
              const dir = directionStyle(signal.impact.direction);
              return html`
                <${motion.div}
                  key=${signal.id}
                  initial=${{ opacity: 0, y: 10 }}
                  animate=${{ opacity: 1, y: 0 }}
                  transition=${{ delay: 0.03 * i }}
                  className="border border-term-border rounded bg-term-surface p-3 hover:border-term-border-hi transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="text-xs font-semibold text-term-bright leading-snug flex-1">${signal.event.title}</h3>
                    <span className="font-mono text-xs font-bold shrink-0" style=${{ color: dir.color }}>${pct(signal.score)}</span>
                  </div>

                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-1.5 py-0.5 text-2xs font-mono font-bold rounded" style=${{ color: dir.color, background: dir.color + "18", border: `1px solid ${dir.color}40` }}>
                      ${dir.label}
                    </span>
                    <span className="text-2xs font-mono text-term-muted">${signal.impact.horizon}</span>
                    <span className="text-2xs font-mono text-term-muted">conf ${pct(signal.impact.confidence)}</span>
                  </div>

                  <p className="text-2xs text-term-muted leading-relaxed line-clamp-2 mb-2">${signal.event.evidenceSnippet}</p>

                  <div className="flex flex-wrap gap-1">
                    ${signal.linkedEntities.slice(0, 3).map((entity) => html`
                      <span className="px-1.5 py-0.5 text-2xs font-mono border border-term-border rounded text-term-text">${entity.ticker} <span className="text-term-muted">${pct(entity.confidence)}</span></span>
                    `)}
                  </div>
                </${motion.div}>
              `;
            })}
          </div>
        </${motion.div}>

      </main>

      ${/* ── FOOTER ── */ ""}
      <footer className="border-t border-term-border py-2 px-4">
        <div className="mx-auto max-w-[1600px] flex items-center justify-between text-2xs font-mono text-term-muted">
          <span>IPST v1.0 | PostgreSQL + TimescaleDB</span>
          <span>${currentUser.label} (${currentUser.role}) | ${signals.length} signals | ${alerts.length} alerts</span>
        </div>
      </footer>

    </div>
  `;
}

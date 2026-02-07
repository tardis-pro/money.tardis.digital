import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

const html = htm.bind(React.createElement as (...args: unknown[]) => React.ReactElement);

async function fetchJSON(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return response.json();
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function severityColor(severity: string) {
  if (severity === "high") return "#ff9666";
  if (severity === "medium") return "#ffd369";
  return "#7ab8ff";
}

function signalColor(direction: string) {
  if (direction === "positive") return "text-emerald-300";
  if (direction === "negative") return "text-orange-300";
  return "text-slate-300";
}

function relationColor(relation: string) {
  return relation === "direct" ? "#3dd6b5" : "#7ab8ff";
}

const COMMAND_HINTS = ["signals", "heatmap", "alerts", "supply", "watchlists", "system", "overview"];

const ROUTE_PANELS = [
  { id: "overview", label: "Overview", target: "route-system" },
  { id: "signals", label: "Signals", target: "route-signals" },
  { id: "heatmap", label: "Heatmap", target: "route-heatmap" },
  { id: "alerts", label: "Alerts", target: "route-alerts" },
  { id: "supply-chain", label: "Supply Graph", target: "route-supply-chain" },
  { id: "watchlists", label: "Watchlists", target: "route-watchlists" },
  { id: "system", label: "System", target: "route-system" },
] as const;

function panelClass(route: string, activeRoute: string, baseClass: string) {
  const isActive = route === activeRoute;
  return `${baseClass} ${isActive ? "ring-1 ring-teal-300/50" : ""}`.trim();
}

interface Signal {
  id: string;
  score: number;
  createdAt: string;
  event: {
    title: string;
    evidenceSnippet: string;
  };
  impact: {
    direction: string;
    horizon: string;
    confidence: number;
  };
  linkedEntities: Array<{ ticker: string; confidence: number }>;
}

interface HeatmapItem {
  sector: string;
  weightedScore: number;
  signalCount: number;
}

interface Alert {
  severity: string;
  triggeredAt: string;
  reason: string;
}

interface Outcomes {
  total: number;
  hitRate: number;
  averageReturn: number;
}

interface SupplyGraph {
  nodes: Array<{
    ticker: string;
    sector: string;
    production?: number;
    demand?: number;
    imports?: number;
    exports?: number;
    surplus?: number;
  }>;
  edges: Array<{
    from: string;
    to: string;
    relation: string;
    lag: number;
    confidence: number;
    propagationScore: number;
    channel: string;
  }>;
}

interface CommandLog {
  route: string;
  latencyMs: number;
  input: string;
  status: string;
  errorMessage?: string;
}

interface Watchlist {
  name: string;
  tickers: string[];
}

export function App() {
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [commandInput, setCommandInput] = useState("");
  const [commandStatus, setCommandStatus] = useState("");
  const [activeRoute, setActiveRoute] = useState("overview");
  const [signals, setSignals] = useState<Signal[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapItem[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [outcomes, setOutcomes] = useState<Outcomes>({ total: 0, hitRate: 0, averageReturn: 0 });
  const [supplyGraph, setSupplyGraph] = useState<SupplyGraph>({ nodes: [], edges: [] });
  const [commandLogs, setCommandLogs] = useState<CommandLog[]>([]);
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);

  const refresh = async () => {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const runPipeline = async () => {
    try {
      setRunning(true);
      await fetchJSON("/api/ingest/run", { method: "POST" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const runCommand = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const response = await fetchJSON("/api/terminal/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: commandInput }),
      });
      if (response.status === "error") {
        setCommandStatus(response.errorMessage || "Command failed");
        return;
      }
      setCommandStatus(`Route: ${response.route} (${response.latencyMs}ms)`);
      setActiveRoute(response.route);
      setCommandInput("");
      const latest = await fetchJSON("/api/terminal/commands?limit=12");
      setCommandLogs(latest);
    } catch (err) {
      setCommandStatus(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 12000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveRoute("overview");
        return;
      }
      if (event.key === "k" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        const commandBox = document.getElementById("terminal-command-input");
        if (commandBox) {
          (commandBox as HTMLInputElement).focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (activeRoute === "overview") {
      return;
    }
    const target = document.getElementById(`route-${activeRoute}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [activeRoute]);

  const timelineData = useMemo(() => {
    return [...signals]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((signal, index) => ({
        idx: index + 1,
        score: Number((signal.score * 100).toFixed(1)),
        confidence: Number((signal.impact.confidence * 100).toFixed(1)),
        title: signal.event.title,
      }));
  }, [signals]);

  const sectorData = useMemo(() => {
    return heatmap.slice(0, 8).map((item) => ({
      sector: item.sector,
      score: Number((item.weightedScore * 100).toFixed(1)),
      signals: item.signalCount,
    }));
  }, [heatmap]);

  const alertData = useMemo(() => {
    const groups = { high: 0, medium: 0, low: 0 };
    for (const alert of alerts.slice(0, 100)) {
      groups[alert.severity as keyof typeof groups] = (groups[alert.severity as keyof typeof groups] ?? 0) + 1;
    }
    return [
      { name: "High", value: groups.high, color: severityColor("high") },
      { name: "Medium", value: groups.medium, color: severityColor("medium") },
      { name: "Low", value: groups.low, color: severityColor("low") },
    ];
  }, [alerts]);

  const supplySankeyData = useMemo(() => {
    const nodes = (supplyGraph.nodes ?? []).slice(0, 12).map((node) => ({
      name: `${node.ticker} (${node.sector})`,
    }));
    const nodeIndex = new Map(nodes.map((node, index) => [node.name.split(" ")[0], index]));
    const links = (supplyGraph.edges ?? [])
      .filter((edge) => nodeIndex.has(edge.from) && nodeIndex.has(edge.to))
      .slice(0, 22)
      .map((edge) => ({
        source: nodeIndex.get(edge.from),
        target: nodeIndex.get(edge.to),
        value: Math.max(1, Math.round(edge.propagationScore * 100)),
        relation: edge.relation,
        confidence: edge.confidence,
        score: edge.propagationScore,
      }))
      .filter((edge) => Number.isInteger(edge.source) && Number.isInteger(edge.target));

    return {
      nodes,
      links,
    };
  }, [supplyGraph]);

  const supplyFlowRows = useMemo(() => {
    return (supplyGraph.nodes ?? [])
      .slice(0, 10)
      .map((node) => ({
        ticker: node.ticker,
        production: node.production ?? 0,
        demand: node.demand ?? 0,
        imports: node.imports ?? 0,
        exports: node.exports ?? 0,
        surplus: node.surplus ?? 0,
      }));
  }, [supplyGraph]);

  const graphInsights = useMemo(() => {
    const nodes = supplyGraph.nodes ?? [];
    const edges = supplyGraph.edges ?? [];
    const relationMix = edges.reduce(
      (acc, edge) => {
        if (edge.relation === "direct") {
          acc.direct += 1;
        } else {
          acc.indirect += 1;
        }
        return acc;
      },
      { direct: 0, indirect: 0 },
    );
    const avgConfidence =
      edges.length > 0
        ? edges.reduce((sum, edge) => sum + edge.confidence, 0) / edges.length
        : 0;
    return {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      direct: relationMix.direct,
      indirect: relationMix.indirect,
      avgConfidence,
    };
  }, [supplyGraph]);

  const jumpToRoute = (targetId: string, route: string) => {
    setActiveRoute(route);
    const target = document.getElementById(targetId);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return html`
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <nav className="sticky top-2 z-20 mb-4 rounded-2xl border border-slate-200/10 bg-slate-950/70 p-2 backdrop-blur">
        <div className="flex flex-wrap gap-2">
          ${ROUTE_PANELS.map(
            (panel) => html`
              <button
                type="button"
                onClick=${() => jumpToRoute(panel.target, panel.id)}
                className=${`rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wide transition ${
                  activeRoute === panel.id
                    ? "border border-teal-300/50 bg-teal-400/20 text-teal-100"
                    : "border border-slate-400/30 bg-slate-800/40 text-slate-200 hover:bg-slate-700/40"
                }`}
              >
                ${panel.label}
              </button>
            `,
          )}
        </div>
      </nav>
      <${motion.section}
        initial=${{ opacity: 0, y: 20 }}
        animate=${{ opacity: 1, y: 0 }}
        transition=${{ duration: 0.45 }}
        id="route-system"
        className=${panelClass("system", activeRoute, "rounded-3xl border border-teal-200/15 bg-steel/75 p-6 shadow-glow backdrop-blur")}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-display text-sm uppercase tracking-[0.24em] text-teal-300/80">India Macro-Market Intelligence</p>
            <h1 className="mt-2 font-display text-2xl text-white sm:text-3xl">Policy + Tender + News Signal Terminal</h1>
            <p className="mt-2 max-w-3xl text-sm text-cloud">
              Explainable signals, confidence-ranked alerts, paper-trading feedback loops, and auditable provenance.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick=${runPipeline}
              disabled=${running}
              className="rounded-xl border border-teal-300/40 bg-teal-400/10 px-4 py-2 text-sm font-semibold text-teal-200 transition hover:bg-teal-400/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ${running ? "Running..." : "Run Pipeline"}
            </button>
            <button
              type="button"
              onClick=${refresh}
              className="rounded-xl border border-slate-300/30 bg-slate-300/5 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-200/10"
            >
              Refresh
            </button>
          </div>
        </div>

        ${error
          ? html`<div className="mt-4 rounded-xl border border-red-300/40 bg-red-950/30 px-4 py-2 text-sm text-red-200">${error}</div>`
          : null}

        <form onSubmit=${runCommand} className="mt-4 rounded-2xl border border-teal-200/20 bg-slate-950/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-xs uppercase tracking-[0.2em] text-teal-200/80">Command</span>
            <input
              id="terminal-command-input"
              value=${commandInput}
              onInput=${(event: React.ChangeEvent<HTMLInputElement>) => setCommandInput(event.target.value)}
              placeholder="Type command: signals, heatmap, alerts, supply, watchlists, system"
              className="min-w-[260px] flex-1 rounded-lg border border-slate-400/30 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-300/70"
            />
            <button
              type="submit"
              className="rounded-lg border border-teal-300/40 bg-teal-400/10 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-teal-100 hover:bg-teal-400/20"
            >
              Go
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-cloud">
            <span>Shortcuts: Ctrl/Cmd + K focus, Esc reset</span>
            <span>${commandStatus || `Hints: ${COMMAND_HINTS.join(" | ")}`}</span>
          </div>
        </form>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/10 bg-slate-900/50 p-4">
            <p className="text-xs uppercase tracking-wider text-cloud">Signals tracked</p>
            <p className="mt-1 text-2xl font-semibold text-white">${signals.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/10 bg-slate-900/50 p-4">
            <p className="text-xs uppercase tracking-wider text-cloud">Active sectors</p>
            <p className="mt-1 text-2xl font-semibold text-white">${heatmap.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/10 bg-slate-900/50 p-4">
            <p className="text-xs uppercase tracking-wider text-cloud">Supply-chain edges</p>
            <p className="mt-1 text-2xl font-semibold text-white">${(supplyGraph.edges ?? []).length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/10 bg-slate-900/50 p-4">
            <p className="text-xs uppercase tracking-wider text-cloud">Outcome hit-rate</p>
            <p className="mt-1 text-2xl font-semibold text-white">${pct(outcomes.hitRate ?? 0)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/10 bg-slate-900/50 p-4">
            <p className="text-xs uppercase tracking-wider text-cloud">Avg realized return</p>
            <p className="mt-1 text-2xl font-semibold text-white">${pct(outcomes.averageReturn ?? 0)}</p>
          </div>
        </div>
      </${motion.section}>

      <section className="mt-6 grid gap-4 xl:grid-cols-3">
        <${motion.article}
          initial=${{ opacity: 0, y: 18 }}
          animate=${{ opacity: 1, y: 0 }}
          transition=${{ delay: 0.1 }}
          id="route-signals"
          className=${panelClass("signals", activeRoute, "rounded-3xl border border-slate-200/10 bg-steel/60 p-4 xl:col-span-2")}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg text-white">Signal Momentum</h2>
            <span className="text-xs text-cloud">scores vs confidence</span>
          </div>
          <div className="h-72">
            <${ResponsiveContainer} width="100%" height="100%">
              <${AreaChart} data=${timelineData} margin=${{ top: 10, right: 16, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3dd6b5" stopOpacity=${0.45} />
                    <stop offset="95%" stopColor="#3dd6b5" stopOpacity=${0.02} />
                  </linearGradient>
                </defs>
                <${CartesianGrid} strokeDasharray="3 3" stroke="#25304a" />
                <${XAxis} dataKey="idx" stroke="#9fb4d5" />
                <${YAxis} stroke="#9fb4d5" />
                <${Tooltip}
                  contentStyle=${{ background: "#0f172a", border: "1px solid #334155", borderRadius: 12 }}
                  labelStyle=${{ color: "#e2e8f0" }}
                />
                <${Legend} />
                <${Area} type="monotone" dataKey="score" stroke="#3dd6b5" fill="url(#scoreGradient)" strokeWidth=${2} />
                <${Area} type="monotone" dataKey="confidence" stroke="#7ab8ff" fillOpacity=${0} strokeWidth=${2} />
              </${AreaChart}>
            </${ResponsiveContainer}>
          </div>
        </${motion.article}>

        <${motion.article}
          initial=${{ opacity: 0, y: 18 }}
          animate=${{ opacity: 1, y: 0 }}
          transition=${{ delay: 0.14 }}
          className="rounded-3xl border border-slate-200/10 bg-steel/60 p-4"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg text-white">Alert Mix</h2>
            <span className="text-xs text-cloud">last 100 alerts</span>
          </div>
          <div className="h-72">
            <${ResponsiveContainer} width="100%" height="100%">
              <${PieChart}>
                <${Pie} data=${alertData} innerRadius=${58} outerRadius=${94} dataKey="value" nameKey="name" paddingAngle=${3}>
                  ${alertData.map(
                    (item) => html`<${Cell} key=${item.name} fill=${item.color} />`,
                  )}
                </${Pie}>
                <${Tooltip}
                  contentStyle=${{ background: "#0f172a", border: "1px solid #334155", borderRadius: 12 }}
                  formatter=${(value: number) => [value, "alerts"]}
                />
                <${Legend} />
              </${PieChart}>
            </${ResponsiveContainer}>
          </div>
        </${motion.article}>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-3">
        <${motion.article}
          initial=${{ opacity: 0, y: 18 }}
          animate=${{ opacity: 1, y: 0 }}
          transition=${{ delay: 0.18 }}
          id="route-heatmap"
          className=${panelClass("heatmap", activeRoute, "rounded-3xl border border-slate-200/10 bg-steel/60 p-4 xl:col-span-2")}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg text-white">Sector Heatmap</h2>
            <span className="text-xs text-cloud">weighted score by sector</span>
          </div>
          <div className="h-72">
            <${ResponsiveContainer} width="100%" height="100%">
              <${BarChart} data=${sectorData} margin=${{ top: 8, right: 10, left: -20, bottom: 20 }}>
                <${CartesianGrid} strokeDasharray="3 3" stroke="#25304a" />
                <${XAxis} dataKey="sector" stroke="#9fb4d5" angle=${-20} textAnchor="end" interval=${0} />
                <${YAxis} stroke="#9fb4d5" />
                <${Tooltip}
                  contentStyle=${{ background: "#0f172a", border: "1px solid #334155", borderRadius: 12 }}
                  formatter=${(value: number, name: string) => [name === "score" ? `${value}%` : value, name]}
                />
                <${Bar} dataKey="score" fill="#3dd6b5" radius=${[8, 8, 0, 0]} />
              </${BarChart}>
            </${ResponsiveContainer}>
          </div>
        </${motion.article}>

        <${motion.article}
          initial=${{ opacity: 0, y: 18 }}
          animate=${{ opacity: 1, y: 0 }}
          transition=${{ delay: 0.22 }}
          id="route-alerts"
          className=${panelClass("alerts", activeRoute, "rounded-3xl border border-slate-200/10 bg-steel/60 p-4")}
        >
          <h2 className="font-display text-lg text-white">Recent Alerts</h2>
          <div className="mt-3 space-y-2">
            ${alerts.slice(0, 7).map(
              (alert) => html`
                <div className="rounded-xl border border-slate-200/10 bg-slate-900/40 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold" style=${{ color: severityColor(alert.severity) }}>
                      ${alert.severity.toUpperCase()}
                    </span>
                    <span className="text-xs text-cloud">${new Date(alert.triggeredAt).toLocaleTimeString()}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-200">${alert.reason}</p>
                </div>
              `,
            )}
          </div>
        </${motion.article}>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <article className="rounded-3xl border border-slate-200/10 bg-steel/60 p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg text-white">Graph Intelligence</h2>
            <span className="text-xs text-cloud">FalkorDB-ready model</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-slate-200/10 bg-slate-900/50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-cloud">Nodes</p>
              <p className="mt-1 text-xl font-semibold text-white">${graphInsights.nodeCount}</p>
            </div>
            <div className="rounded-xl border border-slate-200/10 bg-slate-900/50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-cloud">Edges</p>
              <p className="mt-1 text-xl font-semibold text-white">${graphInsights.edgeCount}</p>
            </div>
            <div className="rounded-xl border border-slate-200/10 bg-slate-900/50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-cloud">Direct/Indirect</p>
              <p className="mt-1 text-xl font-semibold text-white">${graphInsights.direct}/${graphInsights.indirect}</p>
            </div>
            <div className="rounded-xl border border-slate-200/10 bg-slate-900/50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-cloud">Avg confidence</p>
              <p className="mt-1 text-xl font-semibold text-white">${pct(graphInsights.avgConfidence)}</p>
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-emerald-300/25 bg-emerald-900/20 p-3 text-xs text-emerald-100">
            FalkorDB fit: store each ticker/sector as nodes, and propagation as weighted edges for low-latency k-hop impact traversal.
          </div>
        </article>
        <article className="rounded-3xl border border-slate-200/10 bg-steel/60 p-4">
          <h2 className="font-display text-lg text-white">Operator Flow</h2>
          <div className="mt-3 space-y-2 text-xs text-slate-200">
            <div className="rounded-xl border border-slate-200/10 bg-slate-900/50 p-2">1. Run backfill for 2y window</div>
            <div className="rounded-xl border border-slate-200/10 bg-slate-900/50 p-2">2. Reconcile duplicates and drift</div>
            <div className="rounded-xl border border-slate-200/10 bg-slate-900/50 p-2">3. Calibrate anomalies and alerts</div>
            <div className="rounded-xl border border-slate-200/10 bg-slate-900/50 p-2">4. Review graph propagation hotspots</div>
          </div>
        </article>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-3">
        <${motion.article}
          initial=${{ opacity: 0, y: 18 }}
          animate=${{ opacity: 1, y: 0 }}
          transition=${{ delay: 0.16 }}
          id="route-supply-chain"
          className=${panelClass("supply-chain", activeRoute, "rounded-3xl border border-slate-200/10 bg-steel/60 p-4 xl:col-span-2")}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg text-white">Supply Chain Graph (Direct + Indirect)</h2>
            <span className="text-xs text-cloud">HTS propagation score weighted links</span>
          </div>
          <div className="h-72">
            <${ResponsiveContainer} width="100%" height="100%">
              <${Sankey}
                data=${supplySankeyData}
                nodePadding=${24}
                margin=${{ top: 8, right: 20, left: 20, bottom: 8 }}
                linkCurvature=${0.5}
              >
                <${Tooltip}
                  contentStyle=${{ background: "#0f172a", border: "1px solid #334155", borderRadius: 12 }}
                  formatter=${(_value: number, _name: string, item: { payload?: { relation?: string; confidence?: number } }) => {
                    const payload = item?.payload ?? {};
                    if (payload.relation) {
                      return [`${_value}`, `${payload.relation} | confidence ${((payload.confidence ?? 0) * 100).toFixed(1)}%`];
                    }
                    return [_value, "flow"];
                  }}
                />
              </${Sankey}>
            </${ResponsiveContainer}>
          </div>
        </${motion.article}>

        <${motion.article}
          initial=${{ opacity: 0, y: 18 }}
          animate=${{ opacity: 1, y: 0 }}
          transition=${{ delay: 0.2 }}
          className="rounded-3xl border border-slate-200/10 bg-steel/60 p-4"
        >
          <h2 className="font-display text-lg text-white">Propagation Links</h2>
          <div className="mt-3 space-y-2">
            ${(supplyGraph.edges ?? []).slice(0, 8).map(
              (edge) => html`
                <div className="rounded-xl border border-slate-200/10 bg-slate-900/40 px-3 py-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold" style=${{ color: relationColor(edge.relation) }}>${edge.relation.toUpperCase()}</span>
                    <span className="text-cloud">lag ${edge.lag} | ${(edge.confidence * 100).toFixed(1)}%</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-200">${edge.from} -> ${edge.to}</p>
                  <p className="mt-1 text-[11px] text-cloud">${edge.channel} | score ${edge.propagationScore.toFixed(2)}</p>
                </div>
              `,
            )}
          </div>
        </${motion.article}>
      </section>

      <section className="mt-4 rounded-3xl border border-slate-200/10 bg-steel/60 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg text-white">Supply Balance (Cities-Style)</h2>
          <span className="text-xs text-cloud">production vs demand, imports and surplus</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-slate-600/30 text-cloud">
                <th className="px-2 py-1 text-left">Ticker</th>
                <th className="px-2 py-1 text-right">Production</th>
                <th className="px-2 py-1 text-right">Demand</th>
                <th className="px-2 py-1 text-right">Imports</th>
                <th className="px-2 py-1 text-right">Exports</th>
                <th className="px-2 py-1 text-right">Surplus</th>
              </tr>
            </thead>
            <tbody>
              ${supplyFlowRows.map(
                (row) => html`
                  <tr className="border-b border-slate-700/30 text-slate-100">
                    <td className="px-2 py-1 font-semibold">${row.ticker}</td>
                    <td className="px-2 py-1 text-right">${row.production.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right">${row.demand.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right text-orange-300">${row.imports.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right text-emerald-300">${row.exports.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right ${row.surplus >= 0 ? "text-emerald-300" : "text-orange-300"}">
                      ${row.surplus.toFixed(1)}
                    </td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section id="route-watchlists" className=${panelClass("watchlists", activeRoute, "mt-4 grid gap-4 rounded-3xl border border-slate-200/10 bg-steel/60 p-4 lg:grid-cols-2")}>
        <article className="rounded-2xl border border-slate-200/10 bg-slate-900/40 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-lg text-white">Watchlists</h2>
            <span className="text-xs text-cloud">route target: watchlists</span>
          </div>
          <div className="space-y-2 text-sm text-slate-100">
            ${watchlists.map(
              (watchlist) => html`
                <div className="rounded-xl border border-slate-200/10 px-3 py-2">
                  <p className="font-semibold">${watchlist.name}</p>
                  <p className="mt-1 text-xs text-cloud">${watchlist.tickers.join(", ")}</p>
                </div>
              `,
            )}
          </div>
        </article>
        <article className="rounded-2xl border border-slate-200/10 bg-slate-900/40 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-lg text-white">Command Telemetry</h2>
            <span className="text-xs text-cloud">latest 12 executions</span>
          </div>
          <div className="space-y-2 text-xs">
            ${commandLogs.map(
              (log) => html`
                <div className="rounded-xl border border-slate-200/10 px-3 py-2">
                  <div className="flex items-center justify-between text-cloud">
                    <span className="uppercase tracking-wider">${log.route}</span>
                    <span>${log.latencyMs}ms</span>
                  </div>
                  <p className="mt-1 text-slate-100">${log.input || "<empty>"}</p>
                  <p className="mt-1 text-cloud">${log.status}${log.errorMessage ? ` | ${log.errorMessage}` : ""}</p>
                </div>
              `,
            )}
          </div>
        </article>
      </section>

      <section className="mt-4 rounded-3xl border border-slate-200/10 bg-steel/60 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg text-white">Top Explainable Signals</h2>
          <span className="text-xs text-cloud">auto-refreshed every 12s</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          ${(loading ? [] : signals.slice(0, 9)).map(
            (signal, index) => html`
              <${motion.article}
                key=${signal.id}
                initial=${{ opacity: 0, y: 16 }}
                animate=${{ opacity: 1, y: 0 }}
                transition=${{ delay: 0.05 * index }}
                className="rounded-2xl border border-slate-200/10 bg-slate-900/45 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white">${signal.event.title}</h3>
                  <span className="rounded-lg bg-teal-300/10 px-2 py-1 text-xs font-semibold text-teal-200">${pct(signal.score)}</span>
                </div>
                <p className="mt-2 text-xs ${signalColor(signal.impact.direction)}">
                  ${signal.impact.direction.toUpperCase()} | ${signal.impact.horizon} | confidence ${pct(signal.impact.confidence)}
                </p>
                <p className="mt-2 line-clamp-3 text-xs text-cloud">${signal.event.evidenceSnippet}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  ${signal.linkedEntities.slice(0, 3).map(
                    (entity) => html`
                      <span className="rounded-full border border-slate-200/20 px-2 py-0.5 text-[11px] text-slate-200">
                        ${entity.ticker} ${pct(entity.confidence)}
                      </span>
                    `,
                  )}
                </div>
              </${motion.article}>
            `,
          )}
        </div>
      </section>
    </main>
  `;
}

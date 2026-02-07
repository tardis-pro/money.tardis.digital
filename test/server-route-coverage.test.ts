import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const q1CoverageRoutes: Array<{ method: "get" | "post"; path: string; route: string }> = [
  { method: "get", path: "/api/sources", route: "system" },
  { method: "post", path: "/api/sources", route: "system" },
  { method: "post", path: "/api/sources/:sourceId/reliability", route: "system" },
  { method: "post", path: "/api/sources/:sourceId/enabled", route: "system" },
  { method: "post", path: "/api/ingest/run", route: "system" },
  { method: "get", path: "/api/supply-chain-graph", route: "supply-chain" },
  { method: "get", path: "/api/alerts", route: "alerts" },
  { method: "get", path: "/api/audit/:signalId", route: "signals" },
  { method: "get", path: "/api/feedback", route: "signals" },
  { method: "post", path: "/api/feedback", route: "signals" },
  { method: "post", path: "/api/feedback/:feedbackId/review", route: "system" },
  { method: "post", path: "/api/reliability/review", route: "system" },
  { method: "get", path: "/api/data-quality", route: "system" },
  { method: "post", path: "/api/data-quality/:issueId/resolve", route: "system" },
  { method: "post", path: "/api/outcomes", route: "signals" },
  { method: "get", path: "/api/outcomes/summary", route: "signals" },
  { method: "get", path: "/api/governance", route: "system" },
  { method: "post", path: "/api/governance", route: "system" },
  { method: "post", path: "/api/learning/recalibrate", route: "system" },
  { method: "post", path: "/api/screenipy/run", route: "system" },
  { method: "post", path: "/api/model/train", route: "system" },
  { method: "post", path: "/api/backfill/notable", route: "system" },
  { method: "post", path: "/api/backfill/notable/preview", route: "system" },
  { method: "post", path: "/api/backfill/real", route: "system" },
  { method: "get", path: "/api/backfill/runs", route: "system" },
  { method: "post", path: "/api/anomalies/correlate", route: "system" },
  { method: "get", path: "/api/system/status", route: "system" },
  { method: "get", path: "/api/backfill/sources", route: "system" },
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("Q1 reliability routes enforce entitlement checks", async () => {
  const serverPath = path.join(process.cwd(), "src/server.ts");
  const source = await readFile(serverPath, "utf8");

  for (const route of q1CoverageRoutes) {
    const routePattern = new RegExp(
      `app\\.${route.method}\\("${escapeRegex(route.path)}",[\\s\\S]*?const access = await ensureRouteAccess\\(request, reply, "${route.route}"\\);`,
      "m",
    );
    assert.match(source, routePattern, `${route.method.toUpperCase()} ${route.path} must enforce ${route.route} access`);
  }
});

test("route coverage audit endpoint is exposed", async () => {
  const serverPath = path.join(process.cwd(), "src/server.ts");
  const source = await readFile(serverPath, "utf8");
  assert.match(source, /app\.get\("\/api\/system\/route-coverage", async \(request, reply\) => \{/m);
});

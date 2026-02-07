const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  const text = await response.text();
  const parsed = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${text}`);
  }
  return parsed;
}

async function main() {
  const preview = await request("/api/backfill/notable/preview", {
    method: "POST",
    body: JSON.stringify({ from: "2022-01-01T00:00:00.000Z", to: "2025-12-31T23:59:59.000Z", batchSize: 3 }),
  });
  const backfill = await request("/api/backfill/notable", {
    method: "POST",
    body: JSON.stringify({ from: "2022-01-01T00:00:00.000Z", to: "2025-12-31T23:59:59.000Z", batchSize: 3 }),
  });
  const runs = await request("/api/backfill/runs?limit=5");
  const correlation = await request("/api/anomalies/correlate", {
    method: "POST",
    body: JSON.stringify({
      ticker: "SBIN",
      windowSize: 6,
      zThreshold: 2,
      lookbackHours: 240,
      requireEvents: true,
      observations: [
        { at: "2024-12-05T10:00:00.000Z", close: 100 },
        { at: "2024-12-06T10:00:00.000Z", close: 99.7 },
        { at: "2024-12-07T10:00:00.000Z", close: 99.8 },
        { at: "2024-12-08T10:00:00.000Z", close: 99.6 },
        { at: "2024-12-09T10:00:00.000Z", close: 99.7 },
        { at: "2024-12-10T10:00:00.000Z", close: 99.6 },
        { at: "2024-12-11T10:00:00.000Z", close: 99.5 },
        { at: "2024-12-12T10:00:00.000Z", close: 106.8 },
      ],
    }),
  });

  console.log(
    JSON.stringify(
      {
        preview,
        backfill,
        latestRun: Array.isArray(runs) ? runs[0] ?? null : runs,
        correlationSummary: {
          anomalies: correlation?.anomalies?.length ?? 0,
          anomaliesWithEvents: correlation?.anomaliesWithEvents ?? 0,
          totalEventLinks: correlation?.totalEventLinks ?? 0,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

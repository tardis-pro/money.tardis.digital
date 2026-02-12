-- Seed sample fundamental data for NIFTY 50 stocks
-- This creates realistic test data for validating the pipeline

INSERT INTO policy_signal.fundamentals (id, payload)
VALUES
(
  'RELIANCE',
  '{
    "ticker": "RELIANCE",
    "fetchedAt": "2026-02-12T00:00:00Z",
    "source": "manual",
    "revenueHistory": [
      {"fy": "FY21", "value": 539238},
      {"fy": "FY22", "value": 599568},
      {"fy": "FY23", "value": 697292},
      {"fy": "FY24", "value": 791015},
      {"fy": "FY25", "value": 873053}
    ],
    "epsHistory": [
      {"fy": "FY21", "value": 59.2},
      {"fy": "FY22", "value": 69.8},
      {"fy": "FY23", "value": 90.1},
      {"fy": "FY24", "value": 106.4},
      {"fy": "FY25", "value": 118.7}
    ],
    "opmHistory": [
      {"fy": "FY21", "value": 15.2},
      {"fy": "FY22", "value": 16.8},
      {"fy": "FY23", "value": 18.1},
      {"fy": "FY24", "value": 19.2},
      {"fy": "FY25", "value": 19.8}
    ],
    "debtToEquity": 0.42,
    "interestCoverage": 8.5,
    "roce": 14.2,
    "roe": 13.8,
    "fcfHistory": [
      {"fy": "FY21", "value": 45234},
      {"fy": "FY22", "value": 52123},
      {"fy": "FY23", "value": 68123},
      {"fy": "FY24", "value": 79234},
      {"fy": "FY25", "value": 85123}
    ],
    "pe": 22.4,
    "peg": 1.12,
    "marketCap": 1892345,
    "promoterHoldingPct": 49.14,
    "promoterPledgePct": 0,
    "auditorRemarks": "clean",
    "revenueCAGR_3y": 15.8,
    "revenueCAGR_5y": 14.2,
    "epsCAGR_3y": 21.4,
    "epsCAGR_5y": 18.9
  }'
),
(
  'TCS',
  '{
    "ticker": "TCS",
    "fetchedAt": "2026-02-12T00:00:00Z",
    "source": "manual",
    "revenueHistory": [
      {"fy": "FY21", "value": 125543},
      {"fy": "FY22", "value": 157097},
      {"fy": "FY23", "value": 182893},
      {"fy": "FY24", "value": 195344},
      {"fy": "FY25", "value": 212453}
    ],
    "epsHistory": [
      {"fy": "FY21", "value": 71.4},
      {"fy": "FY22", "value": 99.2},
      {"fy": "FY23", "value": 118.4},
      {"fy": "FY24", "value": 128.7},
      {"fy": "FY25", "value": 142.3}
    ],
    "opmHistory": [
      {"fy": "FY21", "value": 26.8},
      {"fy": "FY22", "value": 28.9},
      {"fy": "FY23", "value": 29.2},
      {"fy": "FY24", "value": 28.5},
      {"fy": "FY25", "value": 29.1}
    ],
    "debtToEquity": 0.08,
    "interestCoverage": 45.2,
    "roce": 42.8,
    "roe": 45.2,
    "fcfHistory": [
      {"fy": "FY21", "value": 28345},
      {"fy": "FY22", "value": 42123},
      {"fy": "FY23", "value": 49234},
      {"fy": "FY24", "value": 52123},
      {"fy": "FY25", "value": 58234}
    ],
    "pe": 28.5,
    "peg": 2.34,
    "marketCap": 1234567,
    "promoterHoldingPct": 72.32,
    "promoterPledgePct": 0,
    "auditorRemarks": "clean",
    "revenueCAGR_3y": 11.2,
    "revenueCAGR_5y": 11.8,
    "epsCAGR_3y": 19.8,
    "epsCAGR_5y": 18.2
  }'
),
(
  'HDFCBANK',
  '{
    "ticker": "HDFCBANK",
    "fetchedAt": "2026-02-12T00:00:00Z",
    "source": "manual",
    "revenueHistory": [
      {"fy": "FY21", "value": 156789},
      {"fy": "FY22", "value": 185234},
      {"fy": "FY23", "value": 212456},
      {"fy": "FY24", "value": 241234},
      {"fy": "FY25", "value": 275123}
    ],
    "epsHistory": [
      {"fy": "FY21", "value": 42.8},
      {"fy": "FY22", "value": 52.3},
      {"fy": "FY23", "value": 61.4},
      {"fy": "FY24", "value": 72.8},
      {"fy": "FY25", "value": 84.2}
    ],
    "opmHistory": [
      {"fy": "FY21", "value": 45.2},
      {"fy": "FY22", "value": 47.8},
      {"fy": "FY23", "value": 48.9},
      {"fy": "FY24", "value": 49.2},
      {"fy": "FY25", "value": 50.1}
    ],
    "debtToEquity": 1.24,
    "interestCoverage": 4.8,
    "roce": 18.4,
    "roe": 19.2,
    "fcfHistory": [
      {"fy": "FY21", "value": 42345},
      {"fy": "FY22", "value": 52123},
      {"fy": "FY23", "value": 61234},
      {"fy": "FY24", "value": 73234},
      {"fy": "FY25", "value": 85234}
    ],
    "pe": 21.2,
    "peg": 1.45,
    "marketCap": 892345,
    "promoterHoldingPct": 26.8,
    "promoterPledgePct": 0,
    "auditorRemarks": "clean",
    "revenueCAGR_3y": 18.4,
    "revenueCAGR_5y": 15.2,
    "epsCAGR_3y": 25.2,
    "epsCAGR_5y": 18.4
  }'
),
(
  'INFY',
  '{
    "ticker": "INFY",
    "fetchedAt": "2026-02-12T00:00:00Z",
    "source": "manual",
    "revenueHistory": [
      {"fy": "FY21", "value": 102673},
      {"fy": "FY22", "value": 133834},
      {"fy": "FY23", "value": 153670},
      {"fy": "FY24", "value": 162348},
      {"fy": "FY25", "value": 185234}
    ],
    "epsHistory": [
      {"fy": "FY21", "value": 38.4},
      {"fy": "FY22", "value": 54.2},
      {"fy": "FY23", "value": 62.8},
      {"fy": "FY24", "value": 68.4},
      {"fy": "FY25", "value": 78.2}
    ],
    "opmHistory": [
      {"fy": "FY21", "value": 24.8},
      {"fy": "FY22", "value": 27.2},
      {"fy": "FY23", "value": 28.4},
      {"fy": "FY24", "value": 27.8},
      {"fy": "FY25", "value": 28.9}
    ],
    "debtToEquity": 0.05,
    "interestCoverage": 62.4,
    "roce": 35.2,
    "roe": 32.8,
    "fcfHistory": [
      {"fy": "FY21", "value": 21234},
      {"fy": "FY22", "value": 32123},
      {"fy": "FY23", "value": 40234},
      {"fy": "FY24", "value": 45234},
      {"fy": "FY25", "value": 52123}
    ],
    "pe": 26.8,
    "peg": 2.12,
    "marketCap": 782345,
    "promoterHoldingPct": 13.2,
    "promoterPledgePct": 0,
    "auditorRemarks": "clean",
    "revenueCAGR_3y": 13.8,
    "revenueCAGR_5y": 12.4,
    "epsCAGR_3y": 19.2,
    "epsCAGR_5y": 17.8
  }'
),
(
  'SBIN',
  '{
    "ticker": "SBIN",
    "fetchedAt": "2026-02-12T00:00:00Z",
    "source": "manual",
    "revenueHistory": [
      {"fy": "FY21", "value": 312456},
      {"fy": "FY22", "value": 352345},
      {"fy": "FY23", "value": 412345},
      {"fy": "FY24", "value": 482345},
      {"fy": "FY25", "value": 542123}
    ],
    "epsHistory": [
      {"fy": "FY21", "value": 18.4},
      {"fy": "FY22", "value": 24.8},
      {"fy": "FY23", "value": 34.2},
      {"fy": "FY24", "value": 45.8},
      {"fy": "FY25", "value": 58.4}
    ],
    "opmHistory": [
      {"fy": "FY21", "value": 38.2},
      {"fy": "FY22", "value": 42.4},
      {"fy": "FY23", "value": 45.8},
      {"fy": "FY24", "value": 48.2},
      {"fy": "FY25", "value": 50.1}
    ],
    "debtToEquity": 1.45,
    "interestCoverage": 3.8,
    "roce": 14.8,
    "roe": 16.2,
    "fcfHistory": [
      {"fy": "FY21", "value": 28234},
      {"fy": "FY22", "value": 35234},
      {"fy": "FY23", "value": 48234},
      {"fy": "FY24", "value": 58234},
      {"fy": "FY25", "value": 69234}
    ],
    "pe": 14.2,
    "peg": 0.85,
    "marketCap": 582345,
    "promoterHoldingPct": 56.4,
    "promoterPledgePct": 0,
    "auditorRemarks": "clean",
    "revenueCAGR_3y": 19.8,
    "revenueCAGR_5y": 15.2,
    "epsCAGR_3y": 42.8,
    "epsCAGR_5y": 32.4
  }'
)
ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload;

-- Verify
SELECT id, payload->>'ticker' as ticker, (payload->>'marketCap')::numeric as marketcap_cr
FROM policy_signal.fundamentals
ORDER BY marketcap_cr DESC
LIMIT 10;

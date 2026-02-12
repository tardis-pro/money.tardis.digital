-- Seed demo users for MIT Trading System
-- Run this against your policy_signal database

INSERT INTO user_profiles (id, display_name, role, source_entitlements, route_entitlements, created_at, updated_at)
VALUES
(
  'demo-analyst',
  'Demo Analyst',
  'analyst',
  '["pib_press", "rbi_circulars", "nse_announcements", "cppp_tenders", "businessline_rss"]',
  '["overview", "signals", "heatmap", "alerts", "supply-chain", "watchlists", "mit", "system"]',
  NOW(),
  NOW()
),
(
  'demo-viewer',
  'Demo Viewer',
  'viewer',
  '["businessline_rss"]',
  '["overview", "signals", "heatmap", "alerts", "supply-chain", "watchlists", "mit", "system"]',
  NOW(),
  NOW()
),
(
  'demo-admin',
  'Demo Admin',
  'admin',
  '["*"]',
  '["overview", "signals", "heatmap", "alerts", "supply-chain", "watchlists", "mit", "system"]',
  NOW(),
  NOW()
),
(
  'mit-trader',
  'MIT Trader',
  'operator',
  '["*"]',
  '["mit"]',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  source_entitlements = EXCLUDED.source_entitlements,
  route_entitlements = EXCLUDED.route_entitlements,
  updated_at = NOW();

-- Apply after starting containers:
-- cat scripts/seed-demo-users.sql | docker exec -i policy-signal-timescaledb psql -U postgres -d policy_signal

-- Seed demo users for MIT Trading System
-- Run after starting the app (tables are auto-created via PostgresStore.init())

-- Insert into policy_signal.user_profiles table (jsonb payload format)
INSERT INTO policy_signal.user_profiles (id, payload)
VALUES
(
  'demo-analyst',
  '{"id":"demo-analyst","displayName":"Demo Analyst","role":"analyst","sourceEntitlements":["pib_press","rbi_circulars","nse_announcements","cppp_tenders","businessline_rss"],"routeEntitlements":["overview","signals","heatmap","alerts","supply-chain","watchlists","mit","system"],"createdAt":"2026-02-12T00:00:00Z","updatedAt":"2026-02-12T00:00:00Z"}'
),
(
  'demo-viewer',
  '{"id":"demo-viewer","displayName":"Demo Viewer","role":"viewer","sourceEntitlements":["businessline_rss"],"routeEntitlements":["overview","signals","heatmap","alerts","supply-chain","watchlists","mit","system"],"createdAt":"2026-02-12T00:00:00Z","updatedAt":"2026-02-12T00:00:00Z"}'
),
(
  'demo-admin',
  '{"id":"demo-admin","displayName":"Demo Admin","role":"admin","sourceEntitlements":["*"],"routeEntitlements":["overview","signals","heatmap","alerts","supply-chain","watchlists","mit","system"],"createdAt":"2026-02-12T00:00:00Z","updatedAt":"2026-02-12T00:00:00Z"}'
),
(
  'mit-trader',
  '{"id":"mit-trader","displayName":"MIT Trader","role":"operator","sourceEntitlements":["*"],"routeEntitlements":["mit"],"createdAt":"2026-02-12T00:00:00Z","updatedAt":"2026-02-12T00:00:00Z"}'
)
ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload;

-- Verify
SELECT id, payload->>'displayName' as display_name, payload->>'role' as role FROM policy_signal.user_profiles;

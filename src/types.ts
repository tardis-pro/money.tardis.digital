export type SourceFormat = "rss" | "xml" | "html" | "pdf" | "screenipy";

export type ParserType = "rss" | "xml" | "html" | "pdf-ocr" | "screenipy";

export type ReliabilityTier = "high" | "medium" | "low";

export interface SourceRegistryItem {
  id: string;
  name: string;
  url: string;
  format: SourceFormat;
  parserType: ParserType;
  pollingIntervalSeconds: number;
  reliabilityTier: ReliabilityTier;
  licenseTag: string;
  enabled: boolean;
}

export interface RawArtifact {
  id: string;
  sourceId: string;
  sourceUrl: string;
  fetchedAt: string;
  contentHash: string;
  parserVersion: string;
  modelVersion: string;
  contentType: string;
  bodyPath: string;
  metadata: Record<string, string>;
}

export interface ParsedDocument {
  artifactId: string;
  title: string;
  summary: string;
  bodyText: string;
  publishedAt: string | null;
  languageHint: "en" | "hi" | "mixed" | "unknown";
  evidenceSnippet: string;
}

export type EventType =
  | "policy"
  | "tax"
  | "tender"
  | "circular"
  | "compliance"
  | "capex"
  | "ban"
  | "incentive"
  | "news";

export interface EventRecord {
  id: string;
  artifactId: string;
  sourceId: string;
  eventType: EventType;
  title: string;
  summary: string;
  evidenceSnippet: string;
  publishedAt: string | null;
  noveltyScore: number;
  confidence: number;
}

export interface LinkedEntity {
  ticker: string;
  sector: string;
  ministry: string | null;
  linkReason: string;
  confidence: number;
}

export type Direction = "positive" | "negative" | "neutral";
export type Horizon = "intraday" | "1D" | "1W";

export interface ImpactAssessment {
  direction: Direction;
  horizon: Horizon;
  magnitude: number;
  confidence: number;
  rationale: string[];
  featureSnapshot: Record<string, number | string>;
}

export interface Prediction {
  probabilityUp: number;
  probabilityDown: number;
  calibratedConfidence: number;
  modelVersion: string;
}

export interface SignalRecord {
  id: string;
  createdAt: string;
  sourceId: string;
  event: EventRecord;
  linkedEntities: LinkedEntity[];
  impact: ImpactAssessment;
  prediction: Prediction;
  score: number;
  status: "active" | "suppressed";
}

export type FeedbackLabel =
  | "useful"
  | "noise"
  | "wrong-mapping"
  | "wrong-direction";

export type ReviewState = "pending" | "validated" | "rejected";

export interface FeedbackRecord {
  id: string;
  signalId: string;
  label: FeedbackLabel;
  notes: string;
  reviewState: ReviewState;
  createdAt: string;
}

export interface AlertRecord {
  id: string;
  signalId: string;
  severity: "low" | "medium" | "high";
  reason: string;
  triggeredAt: string;
}

export interface AuditRecord {
  id: string;
  signalId: string;
  sourceUrl: string;
  sourceHash: string;
  parserVersion: string;
  modelVersion: string;
  featureSnapshot: Record<string, number | string>;
  createdAt: string;
}

export interface DataQualityIssue {
  id: string;
  sourceId: string;
  stage: "ingestion" | "parsing";
  artifactId: string | null;
  details: string;
  status: "open" | "resolved";
  detectedAt: string;
  resolvedAt: string | null;
}

export interface OutcomeRecord {
  id: string;
  signalId: string;
  horizon: Horizon;
  predictedDirection: Direction;
  realizedReturn: number;
  realizedDirection: Direction;
  matched: boolean;
  evaluatedAt: string;
}

export interface GovernanceChangeRecord {
  id: string;
  category: "source" | "model" | "pipeline";
  actor: string;
  summary: string;
  rollbackReady: boolean;
  createdAt: string;
}

export type TerminalRoute =
  | "overview"
  | "signals"
  | "heatmap"
  | "alerts"
  | "supply-chain"
  | "watchlists"
  | "system";

export interface CommandLogRecord {
  id: string;
  input: string;
  normalizedInput: string;
  route: TerminalRoute;
  status: "success" | "error";
  latencyMs: number;
  errorMessage: string | null;
  executedAt: string;
}

export type UserRole = "viewer" | "analyst" | "operator" | "admin";

export interface UserProfile {
  id: string;
  displayName: string;
  role: UserRole;
  sourceEntitlements: string[];
  routeEntitlements: TerminalRoute[];
  createdAt: string;
  updatedAt: string;
}

export interface AccessAuditRecord {
  id: string;
  userId: string;
  role: UserRole;
  action: string;
  resource: string;
  allowed: boolean;
  reason: string;
  createdAt: string;
}

export interface StreamEventRecord {
  id: string;
  type:
    | "pipeline.run.completed"
    | "command.executed"
    | "governance.changed"
    | "identity.denied"
    | "identity.updated";
  publishedAt: string;
  sequence: number;
  payload: Record<string, string | number | boolean | null>;
}

export interface BackfillRunRecord {
  id: string;
  kind: "notable";
  status: "running" | "completed" | "failed";
  from: string;
  to: string;
  tickers: string[];
  limit: number;
  offset: number;
  batchSize: number;
  nextOffset: number;
  hasMore: boolean;
  loadedSeeds: number;
  seededSignals: number;
  createdAlerts: number;
  skippedDuplicates: number;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface SectorHeatmapEntry {
  sector: string;
  signalCount: number;
  weightedScore: number;
}

export interface Watchlist {
  id: string;
  name: string;
  tickers: string[];
  createdAt: string;
}

export interface SupplyChainNode {
  ticker: string;
  sector: string;
  businessGroup: string;
  ministry: string | null;
  importance: number;
  production: number;
  demand: number;
  imports: number;
  exports: number;
  surplus: number;
}

export type SupplyChainRelation = "direct" | "indirect";

export interface SupplyChainEdge {
  from: string;
  to: string;
  relation: SupplyChainRelation;
  channel: string;
  lag: number;
  temporalResolution: "intraday" | "1D" | "1W";
  confidence: number;
  propagationScore: number;
}

export interface SupplyChainGraph {
  generatedAt: string;
  nodes: SupplyChainNode[];
  edges: SupplyChainEdge[];
}

export interface BackfillDashboard {
  totalRuns: number;
  runningRuns: number;
  completedRuns: number;
  failedRuns: number;
  totalSeededSignals: number;
  totalSkippedDuplicates: number;
  avgRunDurationMs: number;
  latestRunStartedAt: string | null;
}

export interface BackfillDuplicateEntry {
  sourceId: string;
  contentHash: string;
  duplicateCount: number;
  artifactIds: string[];
}

export interface BackfillReconciliationReport {
  generatedAt: string;
  totalArtifacts: number;
  duplicateGroups: number;
  totalDuplicateArtifacts: number;
  bySource: Array<{
    sourceId: string;
    duplicateGroups: number;
    duplicateArtifacts: number;
  }>;
  duplicates: BackfillDuplicateEntry[];
}

export interface SourceDriftEntry {
  sourceId: string;
  sourceName: string;
  reliabilityTier: ReliabilityTier;
  pollingIntervalSeconds: number;
  latestArtifactAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  lowConfidenceRatio: number;
  fallbackArtifactRatio: number;
  driftScore: number;
  reasons: string[];
}

export interface MarketSnapshotEntry {
  ticker: string;
  sector: string;
  latestPrice: number;
  adjustedPrice: number;
  adjustmentFactor: number;
  dayChangePct: number;
  breadthSignalScore: number;
  updatedAt: string;
}

export interface EntityLinkDiagnostics {
  totalSignals: number;
  signalsWithEntities: number;
  coverageRatio: number;
  averageEntityConfidence: number;
  topEntityLinks: Array<{
    ticker: string;
    count: number;
    avgConfidence: number;
    reasons: string[];
  }>;
}

export interface ChartTemplate {
  id: string;
  name: string;
  ticker: string;
  timeframe: "intraday" | "1D" | "1W";
  overlays: string[];
  studies: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ChartAnnotation {
  signalId: string;
  ticker: string;
  at: string;
  title: string;
  score: number;
  direction: Direction;
  confidence: number;
}

export interface ScreenDefinition {
  id: string;
  name: string;
  filters: {
    minSignalScore: number;
    sectors: string[];
    minLiquidityScore: number;
    policyTags: string[];
  };
  scheduleCron: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScreenRun {
  id: string;
  screenId: string;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "completed" | "failed";
  resultCount: number;
  topTickers: string[];
  error: string | null;
}

export interface DiscoveryChangeRecord {
  id: string;
  screenId: string;
  runId: string;
  ticker: string;
  rank: number;
  reason: string;
  score: number;
  createdAt: string;
}

export interface AlertRuleConfig {
  id: string;
  name: string;
  watchlistId: string | null;
  minScore: number;
  severity: AlertRecord["severity"];
  cooldownMinutes: number;
  escalationMinutes: number;
  suppressionWindowMinutes: number;
  channels: Array<"terminal" | "email" | "webhook">;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertDispatchRecord {
  id: string;
  alertId: string;
  ruleId: string;
  userId: string;
  channel: "terminal" | "email" | "webhook";
  status: "delivered" | "suppressed" | "escalated";
  reason: string;
  dispatchedAt: string;
}

export interface AlertQualitySnapshot {
  generatedAt: string;
  totalAlerts: number;
  dispatches: number;
  suppressed: number;
  escalated: number;
  duplicateRate: number;
  avgDispatchPerAlert: number;
}

export interface PortfolioPosition {
  ticker: string;
  quantity: number;
  avgPrice: number;
  marketPrice: number;
}

export interface PortfolioRecord {
  id: string;
  name: string;
  positions: PortfolioPosition[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioBookmark {
  id: string;
  portfolioId: string;
  name: string;
  shockPct: number;
  notes: string;
  createdAt: string;
}

export interface PortfolioExposureSummary {
  portfolioId: string;
  totalMarketValue: number;
  sectorExposure: Array<{
    sector: string;
    marketValue: number;
    weight: number;
  }>;
  policySensitivityScore: number;
}

export interface PortfolioAttributionRow {
  portfolioId: string;
  ticker: string;
  pnl: number;
  latestSignalScore: number;
  eventTitle: string | null;
}

export interface RiskPolicy {
  id: string;
  portfolioId: string;
  maxSingleNameWeight: number;
  maxSectorWeight: number;
  maxDrawdownPct: number;
  minLiquidityScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface RiskSnapshot {
  id: string;
  portfolioId: string;
  concentrationScore: number;
  drawdownProxyPct: number;
  liquidityProxyScore: number;
  breached: boolean;
  breachReasons: string[];
  createdAt: string;
}

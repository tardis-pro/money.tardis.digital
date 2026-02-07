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

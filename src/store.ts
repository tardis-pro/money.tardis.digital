import path from "node:path";
import type {
  AccessAuditRecord,
  AlertDispatchRecord,
  AlertRuleConfig,
  AlertRecord,
  AuditRecord,
  ChartTemplate,
  CommandLogRecord,
  DataQualityIssue,
  DiscoveryChangeRecord,
  EventRecord,
  FeedbackRecord,
  GovernanceChangeRecord,
  BackfillRunRecord,
  OutcomeRecord,
  RawArtifact,
  ScreenDefinition,
  ScreenRun,
  SignalRecord,
  SourceRegistryItem,
  StreamEventRecord,
  UserProfile,
  Watchlist,
} from "./types.js";
import { ensureDir, readJsonFile, writeJsonFile } from "./utils.js";

export interface StateStore {
  sources: SourceRegistryItem[];
  artifacts: RawArtifact[];
  events: EventRecord[];
  signals: SignalRecord[];
  alerts: AlertRecord[];
  feedback: FeedbackRecord[];
  audits: AuditRecord[];
  dataQualityIssues: DataQualityIssue[];
  outcomes: OutcomeRecord[];
  governanceChanges: GovernanceChangeRecord[];
  backfillRuns: BackfillRunRecord[];
  watchlists: Watchlist[];
  commandLogs: CommandLogRecord[];
  userProfiles: UserProfile[];
  accessAudits: AccessAuditRecord[];
  streamEvents: StreamEventRecord[];
  streamSequence: number;
  chartTemplates: ChartTemplate[];
  screens: ScreenDefinition[];
  screenRuns: ScreenRun[];
  discoveryChanges: DiscoveryChangeRecord[];
  alertRules: AlertRuleConfig[];
  alertDispatches: AlertDispatchRecord[];
}

export interface Store {
  init(): Promise<void>;
  getArtifactsDir(): string;
  read(): Promise<StateStore>;
  write(state: StateStore): Promise<void>;
  transaction<T>(fn: (state: StateStore) => T): Promise<T>;
}

function makeDefaultState(): StateStore {
  return {
    sources: [],
    artifacts: [],
    events: [],
    signals: [],
    alerts: [],
    feedback: [],
    audits: [],
    dataQualityIssues: [],
    outcomes: [],
    governanceChanges: [],
    backfillRuns: [],
    watchlists: [],
    commandLogs: [],
    userProfiles: [],
    accessAudits: [],
    streamEvents: [],
    streamSequence: 0,
    chartTemplates: [],
    screens: [],
    screenRuns: [],
    discoveryChanges: [],
    alertRules: [],
    alertDispatches: [],
  };
}

function defaultUserProfiles(at: string): UserProfile[] {
  return [
    {
      id: "demo-viewer",
      displayName: "Demo Viewer",
      role: "viewer",
      sourceEntitlements: ["businessline_rss"],
      routeEntitlements: ["overview", "signals", "heatmap", "alerts", "supply-chain", "watchlists", "system"],
      createdAt: at,
      updatedAt: at,
    },
    {
      id: "demo-analyst",
      displayName: "Demo Analyst",
      role: "analyst",
      sourceEntitlements: ["pib_press", "rbi_circulars", "nse_announcements", "cppp_tenders", "businessline_rss"],
      routeEntitlements: ["overview", "signals", "heatmap", "alerts", "supply-chain", "watchlists", "system"],
      createdAt: at,
      updatedAt: at,
    },
    {
      id: "demo-admin",
      displayName: "Demo Admin",
      role: "admin",
      sourceEntitlements: ["*"],
      routeEntitlements: ["overview", "signals", "heatmap", "alerts", "supply-chain", "watchlists", "system"],
      createdAt: at,
      updatedAt: at,
    },
  ];
}

export class JsonStore implements Store {
  private readonly dataDir: string;
  private readonly stateFile: string;
  private readonly artifactsDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.dataDir = path.join(baseDir, "data");
    this.stateFile = path.join(this.dataDir, "state.json");
    this.artifactsDir = path.join(this.dataDir, "artifacts");
  }

  async init(): Promise<void> {
    await ensureDir(this.dataDir);
    await ensureDir(this.artifactsDir);
    const existing = await this.read();
    let dirty = false;
    if (existing.sources.length === 0) {
      const seedSources = await readJsonFile<SourceRegistryItem[]>(
        path.join(process.cwd(), "src/config/sources.json"),
        [],
      );
      existing.sources = seedSources;
      existing.watchlists = [
        {
          id: "core-policy",
          name: "Core Policy Movers",
          tickers: ["HAL", "BEL", "IRCTC", "NTPC", "SBIN", "LT"],
          createdAt: new Date().toISOString(),
        },
      ];
      dirty = true;
    }
    if (existing.userProfiles.length === 0) {
      existing.userProfiles = defaultUserProfiles(new Date().toISOString());
      dirty = true;
    }
    if (dirty) {
      await this.write(existing);
    }
  }

  getArtifactsDir(): string {
    return this.artifactsDir;
  }

  async read(): Promise<StateStore> {
    const fallback = makeDefaultState();
    const loaded = await readJsonFile<Partial<StateStore>>(this.stateFile, fallback);
    return {
      ...fallback,
      ...loaded,
      sources: loaded.sources ?? fallback.sources,
      artifacts: loaded.artifacts ?? fallback.artifacts,
      events: loaded.events ?? fallback.events,
      signals: loaded.signals ?? fallback.signals,
      alerts: loaded.alerts ?? fallback.alerts,
      feedback: loaded.feedback ?? fallback.feedback,
      audits: loaded.audits ?? fallback.audits,
      dataQualityIssues: loaded.dataQualityIssues ?? fallback.dataQualityIssues,
      outcomes: loaded.outcomes ?? fallback.outcomes,
      governanceChanges: loaded.governanceChanges ?? fallback.governanceChanges,
      backfillRuns: loaded.backfillRuns ?? fallback.backfillRuns,
      watchlists: loaded.watchlists ?? fallback.watchlists,
      commandLogs: loaded.commandLogs ?? fallback.commandLogs,
      userProfiles: loaded.userProfiles ?? fallback.userProfiles,
      accessAudits: loaded.accessAudits ?? fallback.accessAudits,
      streamEvents: loaded.streamEvents ?? fallback.streamEvents,
      streamSequence: loaded.streamSequence ?? fallback.streamSequence,
      chartTemplates: loaded.chartTemplates ?? fallback.chartTemplates,
      screens: loaded.screens ?? fallback.screens,
      screenRuns: loaded.screenRuns ?? fallback.screenRuns,
      discoveryChanges: loaded.discoveryChanges ?? fallback.discoveryChanges,
      alertRules: loaded.alertRules ?? fallback.alertRules,
      alertDispatches: loaded.alertDispatches ?? fallback.alertDispatches,
    };
  }

  async write(state: StateStore): Promise<void> {
    await writeJsonFile(this.stateFile, state);
  }

  async transaction<T>(fn: (state: StateStore) => T): Promise<T> {
    const state = await this.read();
    const result = fn(state);
    await this.write(state);
    return result;
  }
}

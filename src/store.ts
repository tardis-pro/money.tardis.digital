import path from "node:path";
import type {
  AlertRecord,
  AuditRecord,
  DataQualityIssue,
  EventRecord,
  FeedbackRecord,
  GovernanceChangeRecord,
  BackfillRunRecord,
  OutcomeRecord,
  RawArtifact,
  SignalRecord,
  SourceRegistryItem,
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
  };
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
      await this.write(existing);
    }
  }

  getArtifactsDir(): string {
    return this.artifactsDir;
  }

  async read(): Promise<StateStore> {
    return readJsonFile<StateStore>(this.stateFile, makeDefaultState());
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

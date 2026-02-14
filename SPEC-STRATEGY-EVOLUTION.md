# Strategy Evolution & Simulation System - SPEC.md

## Project: AI-Driven Strategy Discovery, Simulation & Ranking System

**Date**: 2026-02-13  
**Version**: 1.0.0  
**Status**: Planning

---

## 1. Executive Summary

Build an AI-powered system that:
1. Accepts existing trading strategies via natural language
2. Generates 10-100s of strategy variations using AI + genetic algorithms
3. Simulates all strategies safely in sandbox mode
4. Ranks strategies by multi-objective scoring
5. Builds adaptive "rule books" based on context (environment, season, policies)

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER LAYER                                     │
│   NL Query: "Create a momentum strategy based on my RSI strategy"          │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        NL MANAGER AGENT                                     │
│   • Parses NL → Strategy DSL                                               │
│   • Interfaces with LLM for strategy modification                          │
│   • Maintains conversation context                                         │
│   Location: src/services/strategy-ai/manager-agent.ts                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
┌─────────────────────────────────┐   ┌─────────────────────────────────────────┐
│    STRATEGY DSL (Zod)          │   │      STRATEGY GENERATOR                │
│   src/services/strategy-ai/    │   │   src/services/strategy-ai/generator.ts │
│   dsl/                         │   │   • Meta-strategy templates            │
│   • strategy-schema.ts         │   │   • Parameter space exploration        │
│   • signal-definitions.ts     │   │   • Mutation + genetic recombination   │
│   • validation-rules.ts       │   │   • Candidate validation               │
└─────────────────────────────────┘   └─────────────────────────────────────────┘
                    │                                   │
                    │               ┌───────────────────┘
                    │               ▼
                    │   ┌─────────────────────────────────────────┐
                    │   │        SIMULATION SANDBOX               │
                    │   │   src/services/strategy-ai/simulator.ts  │
                    │   │   • Isolated from live trading           │
                    │   │   • Walk-forward validation              │
                    │   │   • Regime-sliced testing                │
                    │   │   • Stress tests                         │
                    │   └─────────────────────────────────────────┘
                    │                       │
                    ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RANKING ENGINE                                      │
│   src/services/strategy-ai/ranker.ts                                       │
│   • Multi-objective scoring (return, drawdown, stability)                │
│   • Global + sector + regime-specific rankings                             │
│   • Confidence bands + robustness diagnostics                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RULEBOOK ENGINE                                     │
│   src/services/strategy-ai/rulebook.ts                                      │
│   • Context → Strategy mapping                                             │
│   • Environment / Season / Policy-aware                                     │
│   • Periodic refresh + explainability                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PERSISTENCE LAYER                                      │
│   src/services/strategy-ai/store.ts                                         │
│   • PostgreSQL + TimescaleDB                                               │
│   • Strategy versions, sim runs, metrics, rankings, rulebook              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Components

### 3.1 NL Manager Agent

**Purpose**: Translate natural language + existing strategies into structured strategy DSL

**Location**: `src/services/strategy-ai/manager-agent.ts`

**Interface**:
```typescript
interface NLManagerAgent {
  // Parse natural language into strategy intent
  parseIntent(query: string): Promise<StrategyIntent>;
  
  // Generate new strategy from intent
  generateStrategy(intent: StrategyIntent): Promise<Strategy>;
  
  // Modify existing strategy based on feedback
  modifyStrategy(strategyId: string, feedback: string): Promise<Strategy>;
  
  // Explain strategy in natural language
  explainStrategy(strategyId: string): Promise<string>;
}
```

### 3.2 Strategy DSL (Zod Schemas)

**Location**: `src/services/strategy-ai/dsl/`

**Core Schema Files**:
| File | Purpose |
|------|---------|
| `strategy-schema.ts` | Core strategy definition |
| `signal-definitions.ts` | Signal types (RSI, MACD, Moving Average, etc.) |
| `filter-definitions.ts` | Universe filters |
| `risk-definitions.ts` | Risk parameters |
| `validation-rules.ts` | Constraint validation |

**Core Types**:
```typescript
// Strategy canonical model
interface Strategy {
  id: string;
  name: string;
  description: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  status: "draft" | "validated" | "simulated" | "ranked" | "production" | "archived";
  
  // Core components
  signals: Signal[];
  filters: Filter[];
  universe: Universe;
  entryRules: Rule[];
  exitRules: Rule[];
  riskParams: RiskParameters;
  
  // Metadata
  tags: string[];
  sector?: string;
  regime?: string;
  parentStrategyId?: string;
  generationMethod: "manual" | "ai-generated" | "mutation" | "crossover";
}

interface Signal {
  id: string;
  type: "rsi" | "macd" | "sma" | "ema" | "atr" | "bollinger" | "volume" | "custom";
  params: Record<string, number | string | boolean>;
  lookback: number;
  conditions: SignalCondition[];
}

interface SignalCondition {
  operator: "gt" | "lt" | "gte" | "lte" | "eq" | "crosses_above" | "crosses_below";
  threshold: number;
  combinedWith?: "and" | "or";
}
```

### 3.3 Strategy Generator

**Location**: `src/services/strategy-ai/generator.ts`

**Generation Methods**:
1. **AI-Guided**: LLM proposes strategy modifications
2. **Random Search**: Parameter space exploration
3. **Mutation**: Modify existing strategy parameters
4. **Crossover**: Combine two strategies

**Template Library**:
```typescript
interface MetaStrategyTemplate {
  id: string;
  name: string;
  category: "trend" | "mean-reversion" | "breakout" | "pairs" | "sector-rotation" | "macro";
  description: string;
  
  // Required signals
  requiredSignals: string[];
  
  // Parameter space (bounds for mutation)
  paramSpaces: Record<string, { min: number; max: number; step: number }>;
  
  // Default configuration
  defaultParams: Record<string, unknown>;
  
  // Constraints
  constraints: Constraint[];
}
```

### 3.4 Simulation Sandbox

**Location**: `src/services/strategy-ai/simulator.ts`

**Features**:
- Isolated from live trading (no broker connectivity)
- Walk-forward validation (rolling windows)
- Regime-sliced testing (bull/bear/sideways)
- Stress tests (parameter perturbation, Monte Carlo)
- Realistic frictions (slippage, fees, borrow costs)

**Output**:
```typescript
interface SimulationResult {
  runId: string;
  strategyId: string;
  startDate: string;
  endDate: string;
  
  // Performance metrics
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  turnover: number;
  
  // Risk metrics
  volatility: number;
  beta: number;
  var95: number;
  
  // Trade log
  trades: Trade[];
  
  // Equity curve (for charting)
  equityCurve: EquityPoint[];
}
```

### 3.5 Ranking Engine

**Location**: `src/services/strategy-ai/ranker.ts`

**Multi-Objective Scoring**:
```typescript
interface RankingScore {
  strategyId: string;
  runId: string;
  
  // Component scores (0-100)
  returnScore: number;
  downsideControlScore: number;
  robustnessScore: number;
  simplicityScore: number;
  executionFeasibilityScore: number;
  
  // Composite score (weighted)
  compositeScore: number;
  
  // Rankings
  globalRank: number;
  sectorRank: number;
  regimeRank: number;
  
  // Confidence
  confidence: number;
  stabilityScore: number;
}
```

### 3.6 Rulebook Engine

**Location**: `src/services/strategy-ai/rulebook.ts`

**Context Features**:
- Market regime (bull/bear/sideways)
- Volatility state (high/medium/low)
- Sector momentum breadth
- Seasonality markers (month, quarter)
- Policy/regulatory flags

**Rulebook Entry**:
```typescript
interface RulebookEntry {
  id: string;
  context: ContextFeatures;
  
  // Eligible strategies
  eligibleStrategyIds: string[];
  
  // Allocation policy
  allocationPolicy: "single-best" | "weighted" | "rotation";
  weights?: Record<string, number>;
  
  // Risk envelope
  maxPositionSize: number;
  maxPortfolioRisk: number;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  confidence: number;
  explanation: string;
}
```

---

## 4. Database Schema

### Core Tables

```sql
-- Strategies table
CREATE TABLE strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  version INTEGER DEFAULT 1,
  status VARCHAR(50) DEFAULT 'draft',
  
  -- JSONB for strategy definition
  definition JSONB NOT NULL,
  
  -- Metadata
  sector VARCHAR(100),
  regime VARCHAR(50),
  tags TEXT[],
  parent_strategy_id UUID REFERENCES strategies(id),
  generation_method VARCHAR(50) DEFAULT 'manual',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Strategy versions (full history)
CREATE TABLE strategy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  definition JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Meta-strategy templates
CREATE TABLE strategy_templates (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  description TEXT,
  required_signals TEXT[] NOT NULL,
  param_spaces JSONB NOT NULL,
  default_params JSONB NOT NULL,
  constraints JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Simulation runs
CREATE TABLE sim_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES strategies(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  regime VARCHAR(50),
  
  -- Results
  metrics JSONB NOT NULL,
  trades JSONB NOT NULL,
  equity_curve JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rankings
CREATE TABLE rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES strategies(id),
  run_id UUID NOT NULL REFERENCES sim_runs(id),
  
  -- Scores
  return_score NUMERIC(5,2),
  downside_control_score NUMERIC(5,2),
  robustness_score NUMERIC(5,2),
  simplicity_score NUMERIC(5,2),
  execution_feasibility_score NUMERIC(5,2),
  composite_score NUMERIC(5,2) NOT NULL,
  
  -- Rankings
  global_rank INTEGER,
  sector_rank INTEGER,
  regime_rank INTEGER,
  
  -- Confidence
  confidence NUMERIC(5,2),
  stability_score NUMERIC(5,2),
  
  ranking_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rulebook entries
CREATE TABLE rulebook_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  context JSONB NOT NULL,
  eligible_strategy_ids UUID[] NOT NULL,
  allocation_policy VARCHAR(50) NOT NULL,
  weights JSONB,
  max_position_size NUMERIC(5,4),
  max_portfolio_risk NUMERIC(5,4),
  confidence NUMERIC(5,2),
  explanation TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Configuration persistence
CREATE TABLE system_config (
  key VARCHAR(255) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_strategies_status ON strategies(status);
CREATE INDEX idx_strategies_sector ON strategies(sector);
CREATE INDEX idx_strategies_parent ON strategies(parent_strategy_id);
CREATE INDEX idx_sim_runs_strategy ON sim_runs(strategy_id);
CREATE INDEX idx_rankings_date ON rankings(ranking_date);
CREATE INDEX idx_rankings_composite ON rankings(composite_score DESC);
```

---

## 5. API Endpoints

### Strategy Management
```
POST   /api/strategies              - Create strategy from NL
GET    /api/strategies              - List strategies
GET    /api/strategies/:id          - Get strategy details
PUT    /api/strategies/:id          - Update strategy
DELETE /api/strategies/:id          - Archive strategy

POST   /api/strategies/:id/generate - Generate variations
POST   /api/strategies/:id/simulate - Run simulation
```

### Templates
```
GET    /api/templates               - List meta-strategy templates
POST   /api/templates               - Create template
GET    /api/templates/:id           - Get template
```

### Simulation
```
GET    /api/sim-runs                - List simulation runs
GET    /api/sim-runs/:id            - Get simulation results
POST   /api/sim-runs/batch          - Run batch simulations
```

### Rankings
```
GET    /api/rankings                - Get current rankings
GET    /api/rankings/global         - Global leaderboard
GET    /api/rankings/sector/:sector - Sector leaderboard
GET    /api/rankings/regime/:regime - Regime leaderboard
```

### Rulebook
```
GET    /api/rulebook                - Get current rulebook
POST   /api/rulebook/refresh        - Rebuild rulebook
GET    /api/rulebook/recommend      - Get strategy recommendation for context
```

---

## 6. Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Strategy DSL (Zod schemas)
- [ ] Strategy validator
- [ ] Configuration persistence layer
- [ ] Basic simulation sandbox interface
- [ ] Strategy Generator foundation with templates

### Phase 2: AI Integration (Week 3-4)
- [ ] NL Manager Agent with LLM integration
- [ ] Template-aware generator
- [ ] Batch simulation pipeline
- [ ] Parameter space exploration

### Phase 3: Ranking (Week 5-6)
- [ ] Multi-objective scoring engine
- [ ] Context tagging
- [ ] Leaderboard UI
- [ ] Persistence hardening

### Phase 4: Rulebook (Week 7-8)
- [ ] Context-aware strategy selection
- [ ] Rulebook UI
- [ ] Monitoring and alerts
- [ ] Explainability features

### Phase 5: Governance (Week 9+)
- [ ] Audit trails
- [ ] Approval workflows
- [ ] Paper-trading bridge
- [ ] Production deployment

---

## 7. Key Technologies

| Component | Technology | Reason |
|-----------|------------|--------|
| Orchestration | TypeScript + Node.js | Existing codebase compatibility |
| AI Layer | OpenAI/Anthropic + structured output | Provider-agnostic wrapper |
| Validation | Zod | Already in use |
| Persistence | PostgreSQL + TimescaleDB | Time-series + relational |
| Vector Store | pgvector | NL retrieval over strategy docs |
| Compute | Python (optional) | Quant libraries |
| Queue | BullMQ | Background jobs |

---

## 8. Challenges & Mitigations

| Challenge | Mitigation |
|-----------|------------|
| Overfitting | Walk-forward validation, holdouts, complexity penalties |
| LLM Hallucination | Strict schema validation + forbidden constructs |
| Compute Cost | Staged filtering, early stopping |
| Data Leakage | Point-in-time datasets, reproducibility |
| Policy Drift | Explicit policy-state features |

---

## 9. File Structure

```
src/services/strategy-ai/
├── index.ts                    # Main exports
├── manager-agent.ts            # NL Manager Agent
├── generator.ts               # Strategy Generator
├── simulator.ts                # Simulation Sandbox
├── ranker.ts                   # Ranking Engine
├── rulebook.ts                 # Rulebook Engine
├── store.ts                    # Persistence Layer
├── types.ts                    # Shared types
├── dsl/
│   ├── index.ts               # DSL exports
│   ├── strategy-schema.ts     # Core strategy schema
│   ├── signal-definitions.ts  # Signal types
│   ├── filter-definitions.ts  # Filter types
│   ├── risk-definitions.ts    # Risk parameters
│   └── validation-rules.ts    # Validation logic
├── templates/
│   ├── index.ts               # Template exports
│   ├── trend.ts               # Trend templates
│   ├── mean-reversion.ts      # Mean reversion templates
│   ├── breakout.ts            # Breakout templates
│   └── sector-rotation.ts     # Sector rotation templates
└── prompts/
    ├── strategy-generation.md # LLM prompts
    ├── strategy-modification.md
    └── explanation.md
```

---

## 10. Acceptance Criteria

1. ✅ Can create strategy from natural language
2. ✅ Can generate 10+ strategy variations automatically
3. ✅ Can run simulations in sandbox without live trading
4. ✅ Rankings update after each simulation batch
5. ✅ Rulebook provides context-aware recommendations
6. ✅ All configurations persist across restarts
7. ✅ System handles 100+ strategies without degradation

---

## 11. Game Theory Based Simulation Experiments

### 11.1 Overview

Beyond traditional backtesting, we need **multi-agent game theory simulations** to understand how strategies interact with each other and with market participants. This adds a competitive/evolutionary dimension to strategy discovery.

### 11.2 Game Theory Experiment Types

#### A. Nash Equilibrium Discovery
**Purpose**: Find strategies that are stable against adversarial opponents

```
Experiment: Find Nash Equilibrium across generated strategies
- Each strategy represents a "player"
- Payoff matrix derived from relative performance
- Run iterative best-response to find equilibrium points
- Output: Set of strategies that are mutually non-exploitable
```

#### B. Evolutionary Competition Simulation
**Purpose**: Simulate how strategies evolve over time through competition

```
Experiment: Evolutionary Market Competition
- Population: Generated strategies + baseline strategies
- Fitness: Risk-adjusted returns over time
- Selection: Top performers survive to next generation
- Mutation: Small parameter variations in survivors
- Crossover: Combine successful strategy components
- Run for N generations
- Output: Evolved strategy population + fitness curves
```

#### C. Zero-Sum Market Games
**Purpose**: Model strategy performance in zero-sum scenarios

```
Experiment: Zero-Sum Arena
- Strategies paired against each other
- When one wins, another loses
- Track exploitability of each strategy
- Find robust strategies that minimize worst-case loss
- Output: Strategy robustness scores
```

#### D. Cooperator-Defector Market Games
**Purpose**: Model collaboration vs competition between strategies

```
Experiment: Market Prisoner's Dilemma
- Strategies can "cooperate" (complementary positions) or "defect" (compete for same signals)
- Model how different strategy types interact
- Find stable cooperative clusters
- Output: Cooperation network + cluster analysis
```

#### E. Signaling Games
**Purpose**: Model how strategies can "signal" to each other

```
Experiment: Strategy Signaling
- Primary strategies send signals (entry/exit signals)
- Secondary strategies observe and react
- Model information asymmetry
- Find strategies that exploit or mask signals
- Output: Signal effectiveness matrix
```

#### F. Mechanism Design
**Purpose**: Design optimal market participation rules

```
Experiment: Market Mechanism Design
- Test different market structures (auction, continuous, dark pool)
- Strategies interact with market design
- Find optimal market conditions for each strategy type
- Output: Recommended market participation rules
```

### 11.3 Game Theory Engine Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      GAME THEORY ENGINE                                    │
│   src/services/strategy-ai/game-theory/                                     │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
│  Nash Equilibrium  │   │   Evolutionary     │   │   Zero-Sum Arena  │
│     Solver          │   │   Simulator        │   │      Solver        │
├─────────────────────┤   ├─────────────────────┤   ├─────────────────────┤
│ • Best response     │   │ • Population mgmt  │   │ • Payoff matrix   │
│ • Fictitious play   │   │ • Selection        │   │ • Exploitability  │
│ • Lemke-Howson      │   │ • Mutation         │   │ • Minimax         │
│ • Support enum      │   │ • Crossover        │   │ • GTO solver      │
└─────────────────────┘   └─────────────────────┘   └─────────────────────┘

┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
│  Signaling Game    │   │  Mechanism Design  │   │   Analysis Engine  │
│      Solver        │   │      Engine         │   │                    │
├─────────────────────┤   ├─────────────────────┤   ├─────────────────────┤
│ • Signal detection │   │ • Market sim        │   │ • Payoff analysis │
│ • Response models  │   │ • Rule testing      │   │ • Equilibrium     │
│ • Info asymmetry   │   │ • Optimization      │   │   detection       │
│ • Bayesian update   │   │ • A/B testing       │   │ • Visualization   │
└─────────────────────┘   └─────────────────────┘   └─────────────────────┘
```

### 11.4 Game Theory Data Models

```typescript
// Game Theory Types
interface GameExperiment {
  id: string;
  name: string;
  type: "nash-equilibrium" | "evolutionary" | "zero-sum" | "cooperator-defector" | "signaling" | "mechanism-design";
  
  // Participants
  strategies: string[]; // Strategy IDs
  baselineStrategies?: string[];
  
  // Configuration
  config: GameConfig;
  
  // Results
  results: GameResult;
  
  createdAt: string;
  completedAt?: string;
}

interface GameConfig {
  // General
  iterations: number;
  populationSize?: number;
  convergenceThreshold?: number;
  
  // Evolutionary
  mutationRate?: number;
  crossoverRate?: number;
  generations?: number;
  selectionMethod?: "tournament" | "roulette" | "rank";
  
  // Zero-Sum
  numSimulations?: number;
  explorationRate?: number;
  
  // Signaling
  signalTypes?: string[];
  observationDelay?: number;
  
  // Mechanism
  marketTypes?: ("auction" | "continuous" | "dark-pool")[];
  liquidityProfiles?: string[];
}

interface GameResult {
  // Equilibrium outcomes
  equilibriumFound: boolean;
  equilibriumStrategies?: string[];
  
  // Evolutionary outcomes
  bestStrategies: { strategyId: string; fitness: number }[];
  fitnessHistory: number[];
  generation: number;
  
  // Zero-Sum outcomes
  payoffMatrix: number[][];
  exploitability: Record<string, number>;
  
  // General metrics
  convergenceProgress: number[];
  runtime: number;
  warnings: string[];
}

// Payoff Matrix
interface PayoffMatrix {
  strategies: string[];
  matrix: number[][]; // [i][j] = payoff to i when playing against j
  symmetric: boolean;
}

// Evolutionary Population
interface EvolutionPopulation {
  generation: number;
  individuals: EvolutionIndividual[];
  bestFitness: number;
  avgFitness: number;
  diversity: number;
}

interface EvolutionIndividual {
  strategyId: string;
  genome: Record<string, number>; // Parameter mutations
  fitness: number;
  parents: string[];
}
```

### 11.5 Game Theory Simulation Integration

The game theory experiments integrate with the existing simulation pipeline:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    INTEGRATED SIMULATION PIPELINE                           │
└─────────────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────┐
                    │  Strategy Pool   │
                    │ (from Generator) │
                    └────────┬─────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
            ▼                ▼                ▼
   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
   │   Backtest │  │   Regime    │  │   Game      │
   │  Simulator │  │   Testing   │  │   Theory    │
   │ (Traditional)│  │ (Sliced)   │  │  Experiments│
   └─────────────┘  └─────────────┘  └─────────────┘
            │                │                │
            └────────────────┼────────────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   Ranker Engine  │
                    │ (All dimensions) │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   Rulebook       │
                    │ (Adaptive)       │
                    └──────────────────┘
```

### 11.6 Game Theory Database Tables

```sql
-- Game theory experiments
CREATE TABLE game_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,
  config JSONB NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  
  -- Results
  results JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Payoff matrices
CREATE TABLE payoff_matrices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID REFERENCES game_experiments(id) ON DELETE CASCADE,
  strategies TEXT[] NOT NULL,
  matrix NUMERIC[][] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Evolutionary population history
CREATE TABLE evolution_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID REFERENCES game_experiments(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  population JSONB NOT NULL,
  best_fitness NUMERIC,
  avg_fitness NUMERIC,
  diversity NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Nash equilibrium results
CREATE TABLE nash_equilibria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID REFERENCES game_experiments(id) ON DELETE CASCADE,
  equilibrium_type VARCHAR(50),
  strategies UUID[],
  supports JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Strategy interaction matrix (for quick lookups)
CREATE TABLE strategy_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_a UUID NOT NULL REFERENCES strategies(id),
  strategy_b UUID NOT NULL REFERENCES strategies(id),
  interaction_type VARCHAR(50) NOT NULL,
  payoff_a NUMERIC,
  payoff_b NUMERIC,
  correlation NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(strategy_a, strategy_b, interaction_type)
);
```

### 11.7 Game Theory API Endpoints

```
# Game Theory Experiments
POST   /api/game-experiments              - Create experiment
GET    /api/game-experiments              - List experiments
GET    /api/game-experiments/:id          - Get experiment results
POST   /api/game-experiments/:id/run     - Run experiment
DELETE /api/game-experiments/:id          - Cancel/delete experiment

# Predefined Experiments
GET    /api/game-experiments/templates    - List experiment templates
POST   /api/game-experiments/from-template - Create from template

# Analysis
GET    /api/strategy-interactions         - Get interaction matrix
GET    /api/equilibrium-analysis          - Analyze equilibrium properties
GET    /api/evolution/:strategyId/history - Get evolution history for strategy
```

### 11.8 Experiment Templates

```typescript
interface GameExperimentTemplate {
  id: string;
  name: string;
  description: string;
  type: GameExperimentType;
  defaultConfig: GameConfig;
  requiredStrategies: number;
  outputMetrics: string[];
}

const EXPERIMENT_TEMPLATES: GameExperimentTemplate[] = [
  {
    id: "nash-population",
    name: "Nash Equilibrium Discovery",
    description: "Find strategies in Nash Equilibrium from generated population",
    type: "nash-equilibrium",
    defaultConfig: {
      iterations: 1000,
      convergenceThreshold: 0.001
    },
    requiredStrategies: 10,
    outputMetrics: ["equilibriumFound", "equilibriumStrategies", "exploitability"]
  },
  {
    id: "evolution-compete",
    name: "Evolutionary Competition",
    description: "Simulate strategies competing over multiple generations",
    type: "evolutionary",
    defaultConfig: {
      populationSize: 50,
      generations: 100,
      mutationRate: 0.1,
      crossoverRate: 0.7,
      selectionMethod: "tournament"
    },
    requiredStrategies: 20,
    outputMetrics: ["bestStrategies", "fitnessHistory", "diversity"]
  },
  {
    id: "zero-sum-arena",
    name: "Zero-Sum Arena",
    description: "Test strategies in head-to-head zero-sum competitions",
    type: "zero-sum",
    defaultConfig: {
      numSimulations: 10000,
      explorationRate: 0.05
    },
    requiredStrategies: 5,
    outputMetrics: ["payoffMatrix", "exploitability", "gtoStrategies"]
  },
  {
    id: "market-dilemma",
    name: "Market Prisoner's Dilemma",
    description: "Model cooperation vs competition between strategies",
    type: "cooperator-defector",
    defaultConfig: {
      iterations: 5000,
      roundsPerGame: 100
    },
    requiredStrategies: 8,
    outputMetrics: ["cooperationRate", "clusters", "stableStrategies"]
  },
  {
    id: "signal-games",
    name: "Strategy Signaling Analysis",
    description: "Analyze how strategies signal and respond to each other",
    type: "signaling",
    defaultConfig: {
      signalTypes: ["entry", "exit", "size"],
      observationDelay: 1
    },
    requiredStrategies: 10,
    outputMetrics: ["signalEffectiveness", "responsePatterns", "informationValue"]
  }
];
```

### 11.9 Output Integration

Game theory results feed into the ranking and rulebook system:

```typescript
interface GameTheoryFeatures {
  // For each strategy, compute:
  
  // Nash Equilibrium features
  isNashEquilibrium: boolean;
  exploitabilityScore: number;
  equilibriumDistance: number;
  
  // Evolutionary features
  evolutionaryFitness: number;
  generationsSurvived: number;
  geneticDiversity: number;
  
  // Zero-Sum features
  gtoScore: number;
  worstCasePayoff: number;
  bestCasePayoff: number;
  
  // Cooperative features
  cooperationAffinity: number; // How well it works with others
  clusterId: number;
  
  // Signaling features
  signalValue: number;
  informationEfficiency: number;
}
```

### 11.10 Implementation Phases (Game Theory)

| Phase | Focus | Deliverables |
|-------|-------|--------------|
| **GT-1** | Foundation | Game theory types, experiment runner skeleton |
| **GT-2** | Nash Equilibrium | Best-response solver, fictitious play, equilibrium detection |
| **GT-3** | Evolutionary Sim | Population management, selection, mutation, crossover |
| **GT-4** | Zero-Sum | Payoff matrix computation, exploitability metrics |
| **GT-5** | Advanced Games | Signaling, mechanism design, cooperator-defector |
| **GT-6** | Integration | Feed GT results into ranker and rulebook |

---

## 12. Complete System Architecture (Final)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           COMPLETE SYSTEM ARCHITECTURE                      │
└─────────────────────────────────────────────────────────────────────────────┘

                                    USER
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    NATURAL LANGUAGE LAYER                                  │
│   "Create a momentum strategy based on RSI that beats the market"          │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      NL MANAGER AGENT                                      │
│   Intent Parsing → Strategy DSL → Generation Request                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
          ┌──────────────────────────┼──────────────────────────┐
          │                          │                          │
          ▼                          ▼                          ▼
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────────┐
│  STRATEGY GENERATOR │  │   TEMPLATE LIBRARY  │  │   GAME THEORY ENGINE    │
│                     │  │                     │  │                         │
│ • AI-Guided         │  │ • Trend             │  │ • Nash Equilibrium      │
│ • Random Search     │  │ • Mean Reversion    │  │ • Evolutionary          │
│ • Mutation          │  │ • Breakout          │  │ • Zero-Sum              │
│ • Crossover         │  │ • Sector Rotation   │  │ • Signaling             │
└─────────────────────┘  └─────────────────────┘  └─────────────────────────┘
          │                          │                          │
          └──────────────────────────┼──────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     STRATEGY VALIDATOR                                     │
│   Type checking, constraint enforcement, forbidden constructs               │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SIMULATION SANDBOX                                    │
│                                                                              │
│   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│   │  Backtest Sim    │  │  Regime Testing │  │  Game Theory Experiments │  │
│   │                  │  │                  │  │                          │  │
│   │ • Walk-forward  │  │ • Bull/Bear/Side │  │ • Nash Equilibrium       │  │
│   │ • Stress tests  │  │ • Vol regime     │  │ • Evolutionary Comp      │  │
│   │ • Monte Carlo   │  │ • Policy periods │  │ • Zero-Sum Arena         │  │
│   └──────────────────┘  └──────────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RANKING ENGINE                                      │
│                                                                              │
│   Multi-Objective Scoring:                                                  │
│   • Return Quality    • Downside Control    • Robustness                   │
│   • Simplicity       • Execution Feasibility • Game Theory Features         │
│                                                                              │
│   Rankings: Global | Sector | Regime | Season | Policy Context             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RULEBOOK ENGINE                                     │
│                                                                              │
│   Context → Strategy Mapping:                                               │
│   • Market Regime + Volatility + Season + Policy                           │
│   → Eligible Strategies + Allocation + Risk Envelope                        │
│                                                                              │
│   Adaptive: Periodic refresh based on fresh simulation data                │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PERSISTENCE LAYER                                     │
│                                                                              │
│   PostgreSQL + TimescaleDB + pgvector                                       │
│   Strategies | Simulations | Rankings | Rulebook | Game Theory             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 13. Acceptance Criteria (Complete)

1. ✅ Can create strategy from natural language
2. ✅ Can generate 10+ strategy variations automatically
3. ✅ Can run simulations in sandbox without live trading
4. ✅ Can run game theory experiments (Nash, Evolutionary, Zero-Sum)
5. ✅ Rankings update after each simulation batch (including GT features)
6. ✅ Rulebook provides context-aware recommendations
7. ✅ All configurations persist across restarts
8. ✅ System handles 100+ strategies without degradation
9. ✅ Game theory features integrated into strategy scoring

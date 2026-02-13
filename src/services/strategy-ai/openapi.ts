const openAPISpec = {
  openapi: "3.0.0",
  info: {
    title: "Strategy AI API",
    version: "1.0.0",
    description:
      "API for creating, simulating, ranking, and experimenting with AI-generated trading strategies.",
  },
  servers: [
    {
      url: "http://localhost:3000",
      description: "Local development server",
    },
    {
      url: "https://api.tardis.digital",
      description: "Production server",
    },
  ],
  tags: [
    { name: "Strategies", description: "Strategy CRUD, generation, and simulation" },
    { name: "Templates", description: "Built-in strategy templates" },
    { name: "Simulation Runs", description: "Single and batch simulation run history" },
    { name: "Rankings", description: "Global and segmented rankings" },
    { name: "Rulebook", description: "Context-aware rulebook and recommendations" },
    { name: "Game Experiments", description: "Game theory experiments on strategies" },
  ],
  paths: {
    "/api/strategies": {
      get: {
        tags: ["Strategies"],
        summary: "List strategies",
        parameters: [
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "sector", in: "query", schema: { type: "string" } },
          { name: "tags", in: "query", schema: { type: "string" }, description: "Comma-separated tags" },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1 } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0 } },
        ],
        responses: {
          "200": {
            description: "Strategies list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    strategies: { type: "array", items: { $ref: "#/components/schemas/Strategy" } },
                    count: { type: "integer" },
                    filters: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
      post: {
        tags: ["Strategies"],
        summary: "Create strategy from natural language prompt",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/StrategyCreate" },
              examples: {
                prompt: {
                  value: {
                    prompt: "Create a medium-risk momentum strategy for IT sector with weekly rebalancing",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Strategy created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    strategy: { $ref: "#/components/schemas/Strategy" },
                    intent: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/strategies/{id}": {
      get: {
        tags: ["Strategies"],
        summary: "Get strategy by id",
        parameters: [{ $ref: "#/components/parameters/StrategyId" }],
        responses: {
          "200": {
            description: "Strategy details",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    strategy: { $ref: "#/components/schemas/Strategy" },
                  },
                  required: ["strategy"],
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
      put: {
        tags: ["Strategies"],
        summary: "Update strategy",
        parameters: [{ $ref: "#/components/parameters/StrategyId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/StrategyUpdate" },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated strategy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { strategy: { $ref: "#/components/schemas/Strategy" } },
                  required: ["strategy"],
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
      delete: {
        tags: ["Strategies"],
        summary: "Archive strategy",
        parameters: [{ $ref: "#/components/parameters/StrategyId" }],
        responses: {
          "200": {
            description: "Archive result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    strategyId: { type: "string", example: "strat-01" },
                    status: { type: "string", example: "archived" },
                  },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/strategies/{id}/generate": {
      post: {
        tags: ["Strategies"],
        summary: "Generate mutated child strategies",
        parameters: [{ $ref: "#/components/parameters/StrategyId" }],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  count: { type: "integer", minimum: 1, example: 10 },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Generated strategies",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    parentStrategyId: { type: "string" },
                    generatedCount: { type: "integer" },
                    strategies: { type: "array", items: { $ref: "#/components/schemas/Strategy" } },
                  },
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/strategies/{id}/simulate": {
      post: {
        tags: ["Strategies"],
        summary: "Run simulation for one strategy",
        parameters: [{ $ref: "#/components/parameters/StrategyId" }],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SimulationConfig" },
            },
          },
        },
        responses: {
          "200": {
            description: "Simulation output and rankings",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    simulation: { $ref: "#/components/schemas/SimulationResult" },
                    simRun: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        strategyId: { type: "string" },
                        startDate: { type: "string", format: "date-time" },
                        endDate: { type: "string", format: "date-time" },
                        metrics: { type: "object", additionalProperties: true },
                        trades: { type: "array", items: { type: "object", additionalProperties: true } },
                        equityCurve: { type: "array", items: { type: "object", additionalProperties: true } },
                        createdAt: { type: "string", format: "date-time" },
                      },
                    },
                    rankings: { type: "array", items: { $ref: "#/components/schemas/RankingScore" } },
                  },
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/templates": {
      get: {
        tags: ["Templates"],
        summary: "List built-in templates",
        responses: {
          "200": {
            description: "Template list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    templates: { type: "array", items: { type: "object", additionalProperties: true } },
                    count: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/templates/{id}": {
      get: {
        tags: ["Templates"],
        summary: "Get template by id",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Template details",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    template: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/sim-runs": {
      get: {
        tags: ["Simulation Runs"],
        summary: "List simulation runs",
        parameters: [{ name: "strategyId", in: "query", schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Simulation run list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    simRuns: { type: "array", items: { type: "object", additionalProperties: true } },
                    count: { type: "integer" },
                  },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/sim-runs/{id}": {
      get: {
        tags: ["Simulation Runs"],
        summary: "Get simulation run by id",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Simulation run",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    simRun: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/sim-runs/batch": {
      post: {
        tags: ["Simulation Runs"],
        summary: "Run batch simulation",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  strategyIds: {
                    type: "array",
                    items: { type: "string" },
                    example: ["strat-01", "strat-02"],
                  },
                  strategyFilter: {
                    type: "object",
                    properties: {
                      status: { type: "string" },
                      sector: { type: "string" },
                      tags: { type: "array", items: { type: "string" } },
                    },
                  },
                  config: { $ref: "#/components/schemas/SimulationConfig" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Batch simulation results",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    totalRequested: { type: "integer" },
                    completed: { type: "integer" },
                    failed: { type: "integer" },
                    simulations: { type: "array", items: { $ref: "#/components/schemas/SimulationResult" } },
                    rankings: { type: "array", items: { $ref: "#/components/schemas/RankingScore" } },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/rankings": {
      get: {
        tags: ["Rankings"],
        summary: "List rankings",
        parameters: [
          { name: "date", in: "query", schema: { type: "string", format: "date" } },
          { name: "sector", in: "query", schema: { type: "string" } },
          { name: "regime", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Ranking list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RankingList" },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/rankings/global": {
      get: {
        tags: ["Rankings"],
        summary: "Get global top rankings",
        parameters: [{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, default: 20 } }],
        responses: {
          "200": {
            description: "Global rankings",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    rankings: { type: "array", items: { $ref: "#/components/schemas/RankingScore" } },
                    count: { type: "integer" },
                  },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/rankings/sector/{sector}": {
      get: {
        tags: ["Rankings"],
        summary: "Get top rankings for sector",
        parameters: [
          { name: "sector", in: "path", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, default: 20 } },
        ],
        responses: {
          "200": {
            description: "Sector rankings",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    sector: { type: "string" },
                    rankings: { type: "array", items: { $ref: "#/components/schemas/RankingScore" } },
                    count: { type: "integer" },
                  },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/rulebook": {
      get: {
        tags: ["Rulebook"],
        summary: "List rulebook entries",
        responses: {
          "200": {
            description: "Rulebook entries",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    entries: { type: "array", items: { $ref: "#/components/schemas/RulebookEntry" } },
                    count: { type: "integer" },
                  },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/rulebook/refresh": {
      post: {
        tags: ["Rulebook"],
        summary: "Rebuild rulebook entries from latest rankings",
        responses: {
          "200": {
            description: "Refresh complete",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    entries: { type: "array", items: { $ref: "#/components/schemas/RulebookEntry" } },
                    count: { type: "integer" },
                  },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/rulebook/recommend": {
      get: {
        tags: ["Rulebook"],
        summary: "Get recommendation for context",
        parameters: [
          {
            name: "marketRegime",
            in: "query",
            schema: { type: "string", enum: ["bull", "bear", "sideways"] },
          },
          {
            name: "volatilityState",
            in: "query",
            schema: { type: "string", enum: ["high", "medium", "low"] },
          },
          { name: "month", in: "query", schema: { type: "integer", minimum: 1, maximum: 12 } },
          { name: "quarter", in: "query", schema: { type: "integer", minimum: 1, maximum: 4 } },
          { name: "dayOfWeek", in: "query", schema: { type: "integer", minimum: 0, maximum: 6 } },
          {
            name: "policyFlags",
            in: "query",
            schema: { type: "string" },
            description: "Comma-separated policy flags",
          },
          {
            name: "sectorMomentum",
            in: "query",
            schema: { type: "string" },
            description: "JSON object string, e.g. {\"it\":0.7,\"energy\":-0.2}",
          },
        ],
        responses: {
          "200": {
            description: "Recommendation",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    recommendation: { $ref: "#/components/schemas/Recommendation" },
                  },
                  required: ["recommendation"],
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/game-experiments": {
      get: {
        tags: ["Game Experiments"],
        summary: "List game experiments",
        responses: {
          "200": {
            description: "Game experiment list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    experiments: { type: "array", items: { $ref: "#/components/schemas/GameExperiment" } },
                    count: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["Game Experiments"],
        summary: "Create a game experiment",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "type", "strategies"],
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  type: {
                    type: "string",
                    enum: ["nash-equilibrium", "evolutionary", "zero-sum", "cooperator-defector", "signaling"],
                  },
                  strategies: { type: "array", minItems: 1, items: { type: "string" } },
                  baselineStrategies: { type: "array", items: { type: "string" } },
                  config: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Experiment created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    experiment: { $ref: "#/components/schemas/GameExperiment" },
                  },
                  required: ["experiment"],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/game-experiments/{id}": {
      get: {
        tags: ["Game Experiments"],
        summary: "Get game experiment by id",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Experiment",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    experiment: { $ref: "#/components/schemas/GameExperiment" },
                  },
                  required: ["experiment"],
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/game-experiments/{id}/run": {
      post: {
        tags: ["Game Experiments"],
        summary: "Run an experiment",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Experiment result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    experimentId: { type: "string" },
                    results: { $ref: "#/components/schemas/GameResult" },
                  },
                  required: ["experimentId", "results"],
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
  },
  components: {
    parameters: {
      StrategyId: {
        name: "id",
        in: "path",
        required: true,
        description: "Strategy identifier",
        schema: { type: "string" },
      },
    },
    schemas: {
      Strategy: {
        type: "object",
        required: [
          "id",
          "name",
          "description",
          "version",
          "createdAt",
          "updatedAt",
          "status",
          "signals",
          "filters",
          "universe",
          "entryRules",
          "exitRules",
          "riskParams",
          "tags",
          "generationMethod",
        ],
        properties: {
          id: { type: "string", example: "strat-01" },
          name: { type: "string", example: "IT Momentum Swing" },
          description: { type: "string", example: "Momentum strategy focused on IT large-caps" },
          version: { type: "integer", minimum: 1, example: 1 },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          status: {
            type: "string",
            enum: ["draft", "validated", "simulated", "ranked", "production", "archived"],
          },
          signals: { type: "array", items: { type: "object", additionalProperties: true } },
          filters: { type: "array", items: { type: "object", additionalProperties: true } },
          universe: { type: "object", additionalProperties: true },
          entryRules: { type: "array", items: { type: "object", additionalProperties: true } },
          exitRules: { type: "array", items: { type: "object", additionalProperties: true } },
          riskParams: { type: "object", additionalProperties: true },
          tags: { type: "array", items: { type: "string" } },
          sector: { type: "string", nullable: true },
          regime: { type: "string", nullable: true },
          parentStrategyId: { type: "string", nullable: true },
          generationMethod: { type: "string", enum: ["manual", "ai-generated", "mutation", "crossover"] },
        },
      },
      StrategyCreate: {
        type: "object",
        properties: {
          prompt: { type: "string", minLength: 1 },
          query: { type: "string", minLength: 1 },
          text: { type: "string", minLength: 1 },
        },
        description: "Provide one of prompt/query/text",
      },
      StrategyUpdate: {
        type: "object",
        description: "Partial strategy payload",
        allOf: [{ $ref: "#/components/schemas/Strategy" }],
      },
      SimulationConfig: {
        type: "object",
        required: ["startDate", "endDate", "initialCapital", "commissionRate", "slippageRate"],
        properties: {
          startDate: { type: "string", format: "date-time", example: "2025-01-01T00:00:00.000Z" },
          endDate: { type: "string", format: "date-time", example: "2025-12-31T00:00:00.000Z" },
          initialCapital: { type: "number", minimum: 1, example: 1000000 },
          commissionRate: { type: "number", minimum: 0, example: 0.0005 },
          slippageRate: { type: "number", minimum: 0, example: 0.0005 },
          regime: { type: "string", example: "bull" },
          walkForwardWindows: {
            type: "array",
            items: {
              type: "object",
              required: ["startDate", "endDate"],
              properties: {
                startDate: { type: "string", format: "date-time" },
                endDate: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
      SimulationResult: {
        type: "object",
        required: [
          "runId",
          "strategyId",
          "startDate",
          "endDate",
          "trades",
          "equityCurve",
          "totalReturn",
          "annualizedReturn",
          "sharpeRatio",
          "maxDrawdown",
          "winRate",
          "profitFactor",
          "turnover",
          "volatility",
          "beta",
          "var95",
        ],
        properties: {
          runId: { type: "string" },
          strategyId: { type: "string" },
          startDate: { type: "string", format: "date-time" },
          endDate: { type: "string", format: "date-time" },
          trades: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "ticker", "side", "entryPrice", "exitPrice", "entryDate", "exitDate", "quantity", "pnl", "pnlPct"],
              properties: {
                id: { type: "string" },
                ticker: { type: "string" },
                side: { type: "string", enum: ["buy", "sell"] },
                entryPrice: { type: "number" },
                exitPrice: { type: "number" },
                entryDate: { type: "string", format: "date-time" },
                exitDate: { type: "string", format: "date-time" },
                quantity: { type: "number" },
                pnl: { type: "number" },
                pnlPct: { type: "number" },
              },
            },
          },
          equityCurve: {
            type: "array",
            items: {
              type: "object",
              required: ["date", "equity", "drawdown"],
              properties: {
                date: { type: "string", format: "date-time" },
                equity: { type: "number" },
                drawdown: { type: "number" },
              },
            },
          },
          totalReturn: { type: "number" },
          annualizedReturn: { type: "number" },
          sharpeRatio: { type: "number" },
          maxDrawdown: { type: "number" },
          winRate: { type: "number" },
          profitFactor: { type: "number" },
          turnover: { type: "number" },
          volatility: { type: "number" },
          beta: { type: "number" },
          var95: { type: "number" },
        },
      },
      RankingScore: {
        type: "object",
        required: [
          "strategyId",
          "runId",
          "returnScore",
          "downsideControlScore",
          "robustnessScore",
          "simplicityScore",
          "executionFeasibilityScore",
          "compositeScore",
          "globalRank",
          "sectorRank",
          "regimeRank",
          "confidence",
          "stabilityScore",
        ],
        properties: {
          strategyId: { type: "string" },
          runId: { type: "string" },
          returnScore: { type: "number" },
          downsideControlScore: { type: "number" },
          robustnessScore: { type: "number" },
          simplicityScore: { type: "number" },
          executionFeasibilityScore: { type: "number" },
          compositeScore: { type: "number" },
          globalRank: { type: "integer" },
          sectorRank: { type: "integer" },
          regimeRank: { type: "integer" },
          confidence: { type: "number" },
          stabilityScore: { type: "number" },
        },
      },
      RankingList: {
        type: "object",
        required: ["rankings", "count"],
        properties: {
          rankings: { type: "array", items: { $ref: "#/components/schemas/RankingScore" } },
          count: { type: "integer" },
        },
      },
      RulebookEntry: {
        type: "object",
        required: [
          "id",
          "context",
          "eligibleStrategyIds",
          "allocationPolicy",
          "maxPositionSize",
          "maxPortfolioRisk",
          "confidence",
          "explanation",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          id: { type: "string" },
          context: {
            type: "object",
            properties: {
              marketRegime: { type: "string", enum: ["bull", "bear", "sideways"] },
              volatilityState: { type: "string", enum: ["high", "medium", "low"] },
              sectorMomentum: { type: "object", additionalProperties: { type: "number" } },
              seasonality: {
                type: "object",
                properties: {
                  month: { type: "integer", minimum: 1, maximum: 12 },
                  quarter: { type: "integer", minimum: 1, maximum: 4 },
                },
              },
              policyFlags: { type: "array", items: { type: "string" } },
              dayOfWeek: { type: "integer", minimum: 0, maximum: 6 },
            },
            additionalProperties: true,
          },
          eligibleStrategyIds: { type: "array", items: { type: "string" } },
          allocationPolicy: { type: "string", enum: ["single-best", "weighted", "rotation"] },
          weights: { type: "object", additionalProperties: { type: "number" } },
          maxPositionSize: { type: "number", minimum: 0, maximum: 1 },
          maxPortfolioRisk: { type: "number", minimum: 0, maximum: 1 },
          confidence: { type: "number", minimum: 0, maximum: 100 },
          explanation: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      Recommendation: {
        type: "object",
        required: ["strategies", "totalAllocation", "riskEnvelope", "context", "confidence"],
        properties: {
          strategies: {
            type: "array",
            items: {
              type: "object",
              required: ["strategyId", "allocation", "reason"],
              properties: {
                strategyId: { type: "string" },
                allocation: { type: "number" },
                reason: { type: "string" },
              },
            },
          },
          totalAllocation: { type: "number" },
          riskEnvelope: {
            type: "object",
            required: ["maxPositionSize", "maxPortfolioRisk"],
            properties: {
              maxPositionSize: { type: "number" },
              maxPortfolioRisk: { type: "number" },
            },
          },
          context: {
            type: "object",
            required: ["marketRegime", "volatilityState", "sectorMomentum", "seasonality", "policyFlags", "dayOfWeek"],
            properties: {
              marketRegime: { type: "string", enum: ["bull", "bear", "sideways"] },
              volatilityState: { type: "string", enum: ["high", "medium", "low"] },
              sectorMomentum: { type: "object", additionalProperties: { type: "number" } },
              seasonality: {
                type: "object",
                required: ["month", "quarter"],
                properties: {
                  month: { type: "integer" },
                  quarter: { type: "integer" },
                },
              },
              policyFlags: { type: "array", items: { type: "string" } },
              dayOfWeek: { type: "integer" },
            },
          },
          confidence: { type: "number" },
        },
      },
      GameExperiment: {
        type: "object",
        required: ["id", "name", "type", "strategies", "config", "createdAt"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: {
            type: "string",
            enum: ["nash-equilibrium", "evolutionary", "zero-sum", "cooperator-defector", "signaling"],
          },
          strategies: { type: "array", items: { type: "string" } },
          baselineStrategies: { type: "array", items: { type: "string" } },
          config: { type: "object", additionalProperties: true },
          results: { $ref: "#/components/schemas/GameResult" },
          createdAt: { type: "string", format: "date-time" },
          completedAt: { type: "string", format: "date-time" },
        },
      },
      GameResult: {
        type: "object",
        required: [
          "equilibriumFound",
          "bestStrategies",
          "fitnessHistory",
          "generation",
          "payoffMatrix",
          "exploitability",
          "convergenceProgress",
          "runtime",
          "warnings",
        ],
        properties: {
          equilibriumFound: { type: "boolean" },
          equilibriumStrategies: { type: "array", items: { type: "string" } },
          bestStrategies: {
            type: "array",
            items: {
              type: "object",
              required: ["strategyId", "fitness"],
              properties: {
                strategyId: { type: "string" },
                fitness: { type: "number" },
              },
            },
          },
          fitnessHistory: { type: "array", items: { type: "number" } },
          generation: { type: "integer" },
          payoffMatrix: {
            type: "array",
            items: { type: "array", items: { type: "number" } },
          },
          exploitability: { type: "object", additionalProperties: { type: "number" } },
          convergenceProgress: { type: "array", items: { type: "number" } },
          runtime: { type: "number" },
          warnings: { type: "array", items: { type: "string" } },
        },
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string", example: "Strategy not found: strat-01" },
        },
      },
    },
    responses: {
      Error: {
        description: "Error response",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
          },
        },
      },
    },
  },
};

export function getOpenAPISpec(): object {
  return openAPISpec;
}

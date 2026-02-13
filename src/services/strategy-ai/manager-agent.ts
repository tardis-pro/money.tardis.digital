import { BUILTIN_TEMPLATES, type MetaStrategyTemplate, StrategyGenerator } from "./generator.js";
import type { Strategy } from "./dsl/strategy-schema.js";
import { StrategyStore } from "./store.js";

export interface StrategyIntent {
  type: "create" | "modify" | "analyze" | "explain";
  description: string;
  targetStrategyId?: string;
  desiredOutcomes: string[];
  constraints: string[];
  suggestedTemplate?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  content: string;
}

export interface LLMProvider {
  chat(messages: ChatMessage[]): Promise<ChatResponse>;
  structuredOutput<T>(messages: ChatMessage[], schema: object): Promise<T>;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface ConversationHistory {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
  lastIntent?: StrategyIntent;
  lastStrategyId?: string;
}

export interface AgentResponse {
  conversationId: string;
  message: string;
  intent: StrategyIntent;
  strategyId?: string;
  strategy?: Strategy;
}

interface ParsedIntentOutput {
  type?: StrategyIntent["type"];
  description?: string;
  targetStrategyId?: string;
  desiredOutcomes?: string[];
  constraints?: string[];
  suggestedTemplate?: string;
}

interface ModificationPatch {
  name?: string;
  description?: string;
  addTags?: string[];
  removeTags?: string[];
}

const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: ["create", "modify", "analyze", "explain"] },
    description: { type: "string" },
    targetStrategyId: { type: "string" },
    desiredOutcomes: { type: "array", items: { type: "string" } },
    constraints: { type: "array", items: { type: "string" } },
    suggestedTemplate: { type: "string" },
  },
  required: ["type", "description", "desiredOutcomes", "constraints"],
} as const;

const MODIFICATION_PATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    addTags: { type: "array", items: { type: "string" } },
    removeTags: { type: "array", items: { type: "string" } },
  },
} as const;

export class NLManagerAgent {
  private readonly llm: LLMProvider;
  private readonly store: StrategyStore;
  private readonly generator: StrategyGenerator;
  private readonly conversations = new Map<string, ConversationHistory>();

  constructor(deps: { llm: LLMProvider; store: StrategyStore; generator: StrategyGenerator }) {
    this.llm = deps.llm;
    this.store = deps.store;
    this.generator = deps.generator;
  }

  async parseIntent(query: string): Promise<StrategyIntent> {
    const llmParsed = await this.parseIntentWithLlm(query);
    const references = this.extractStrategyReferences(query);
    const inferredType = inferIntentType(query, references);
    const desiredOutcomes = unique([
      ...(llmParsed.desiredOutcomes ?? []),
      ...this.extractDesiredOutcomes(query),
    ]);
    const constraints = unique([
      ...(llmParsed.constraints ?? []),
      ...this.extractConstraints(query),
    ]);

    const targetStrategyId = llmParsed.targetStrategyId || references[0];
    const resolvedTemplate = normalizeTemplateKey(llmParsed.suggestedTemplate);
    const fallbackTemplate = normalizeTemplateKey(selectTemplateFromText(query));
    const selectedTemplate = resolvedTemplate ?? fallbackTemplate;

    const parsedIntent: StrategyIntent = {
      type: llmParsed.type ?? inferredType,
      description: llmParsed.description?.trim() || query.trim(),
      ...(targetStrategyId ? { targetStrategyId } : {}),
      desiredOutcomes,
      constraints,
    };

    if (selectedTemplate) {
      parsedIntent.suggestedTemplate = selectedTemplate;
    }

    return parsedIntent;
  }

  async generateStrategy(intent: StrategyIntent): Promise<Strategy> {
    const template = this.resolveTemplate(intent);
    const candidates = this.generator.generateFromTemplate(template);
    if (candidates.length === 0) {
      throw new Error(`No valid strategy candidates generated for template: ${template.id}`);
    }

    const best = this.pickBestCandidate(candidates, intent);
    const strategy: Strategy = {
      ...best,
      name: this.generateStrategyName(intent, template),
      description: this.composeDescription(intent, template, best.description),
      tags: unique([...(best.tags ?? []), "nl-manager", template.id, intent.type]),
      updatedAt: nowIso(),
    };

    return this.store.createStrategy(strategy);
  }

  async modifyStrategy(strategyId: string, feedback: string): Promise<Strategy> {
    const existing = await this.store.getStrategy(strategyId);
    if (!existing) {
      throw new Error(`Strategy not found: ${strategyId}`);
    }

    const intent = await this.parseIntent(feedback);
    const variants = this.generator.mutate(existing, 12);
    if (variants.length === 0) {
      throw new Error(`No valid modifications generated for strategy: ${strategyId}`);
    }

    const selected = this.pickBestCandidate(variants, intent);
    const patch = await this.parseModificationPatch(feedback);

    const tags = applyTagPatch(unique([...(selected.tags ?? []), "modified", "nl-manager"]), patch);
    const updates: Partial<Strategy> = {
      signals: selected.signals,
      filters: selected.filters,
      universe: selected.universe,
      entryRules: selected.entryRules,
      exitRules: selected.exitRules,
      riskParams: selected.riskParams,
      tags,
      generationMethod: selected.generationMethod,
      updatedAt: nowIso(),
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.description ? { description: patch.description } : {}),
    };

    return this.store.updateStrategy(strategyId, updates);
  }

  async explainStrategy(strategyId: string): Promise<string> {
    const strategy = await this.store.getStrategy(strategyId);
    if (!strategy) {
      throw new Error(`Strategy not found: ${strategyId}`);
    }

    try {
      const response = await this.llm.chat([
        {
          role: "system",
          content: "Explain trading strategies in clear, concise language for non-technical stakeholders.",
        },
        {
          role: "user",
          content: `Explain this strategy:\n${JSON.stringify(strategy)}`,
        },
      ]);
      if (response.content.trim().length > 0) {
        return response.content.trim();
      }
    } catch {
      return this.explainWithoutLlm(strategy);
    }

    return this.explainWithoutLlm(strategy);
  }

  async continueConversation(conversationId: string, message: string): Promise<AgentResponse> {
    const history = this.ensureConversation(conversationId);
    this.pushMessage(history, "user", message);

    const intent = await this.parseIntent(message);
    history.lastIntent = intent;

    let responseMessage = "Intent understood.";
    let strategy: Strategy | undefined;

    if (intent.type === "create") {
      strategy = await this.generateStrategy(intent);
      history.lastStrategyId = strategy.id;
      responseMessage = `Created strategy ${strategy.id} (${strategy.name}).`;
    } else if (intent.type === "modify") {
      const targetStrategyId = intent.targetStrategyId ?? history.lastStrategyId;
      if (!targetStrategyId) {
        responseMessage = "Please reference a strategy id to modify, for example: modify strategy <id>.";
      } else {
        strategy = await this.modifyStrategy(targetStrategyId, message);
        history.lastStrategyId = strategy.id;
        responseMessage = `Updated strategy ${strategy.id} to version ${strategy.version}.`;
      }
    } else if (intent.type === "analyze") {
      const targetStrategyId = intent.targetStrategyId ?? history.lastStrategyId;
      if (!targetStrategyId) {
        responseMessage = "Please reference a strategy id to analyze.";
      } else {
        const existing = await this.store.getStrategy(targetStrategyId);
        if (!existing) {
          responseMessage = `Strategy ${targetStrategyId} not found.`;
        } else {
          strategy = existing;
          responseMessage = this.analyzeStrategy(existing, intent);
          history.lastStrategyId = existing.id;
        }
      }
    } else if (intent.type === "explain") {
      const targetStrategyId = intent.targetStrategyId ?? history.lastStrategyId;
      if (!targetStrategyId) {
        responseMessage = "Please reference a strategy id to explain.";
      } else {
        responseMessage = await this.explainStrategy(targetStrategyId);
        history.lastStrategyId = targetStrategyId;
      }
    }

    this.pushMessage(history, "assistant", responseMessage);

    return {
      conversationId,
      message: responseMessage,
      intent,
      ...(history.lastStrategyId ? { strategyId: history.lastStrategyId } : {}),
      ...(strategy ? { strategy } : {}),
    };
  }

  getConversation(conversationId: string): ConversationHistory {
    const existing = this.conversations.get(conversationId);
    if (existing) {
      return existing;
    }

    const timestamp = nowIso();
    return {
      id: conversationId,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };
  }

  extractStrategyReferences(text: string): string[] {
    const matches = [
      ...text.matchAll(/\bstrategy\s+(?:id\s*)?([A-Za-z0-9:_-]{6,})\b/gi),
      ...text.matchAll(/#([A-Za-z0-9:_-]{6,})\b/g),
      ...text.matchAll(/\b([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\b/gi),
    ];
    return unique(matches.map((match) => match[1]).filter((value): value is string => Boolean(value)));
  }

  extractConstraints(text: string): string[] {
    const constraints = text
      .split(/[.!?\n]/)
      .map((part) => part.trim())
      .filter((part) => /\b(must|should|cannot|can't|without|avoid|max|min|limit|at most|at least|no more than)\b/i.test(part));
    return unique(constraints);
  }

  extractDesiredOutcomes(text: string): string[] {
    const outcomes = text
      .split(/[.!?\n]/)
      .map((part) => part.trim())
      .flatMap((part) => {
        const direct = part.match(/\b(to|so that|aim to|goal is to|want to)\s+(.+)$/i);
        if (direct?.[2]) {
          return [direct[2].trim()];
        }
        if (/\b(increase|improve|reduce|optimize|maximize|minimize|enhance)\b/i.test(part)) {
          return [part];
        }
        return [];
      });
    return unique(outcomes);
  }

  private ensureConversation(conversationId: string): ConversationHistory {
    const existing = this.conversations.get(conversationId);
    if (existing) {
      return existing;
    }

    const timestamp = nowIso();
    const created: ConversationHistory = {
      id: conversationId,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };
    this.conversations.set(conversationId, created);
    return created;
  }

  private pushMessage(history: ConversationHistory, role: "user" | "assistant", content: string): void {
    history.messages.push({ role, content, timestamp: nowIso() });
    history.updatedAt = nowIso();
  }

  private async parseIntentWithLlm(query: string): Promise<ParsedIntentOutput> {
    try {
      const parsed = await this.llm.structuredOutput<ParsedIntentOutput>([
        {
          role: "system",
          content:
            "Classify user request into strategy intent. Extract target strategy id when present, desired outcomes, constraints, and best template key among trend-following, mean-reversion, breakout, momentum.",
        },
        { role: "user", content: query },
      ], INTENT_SCHEMA);
      return parsed;
    } catch {
      return {};
    }
  }

  private async parseModificationPatch(feedback: string): Promise<ModificationPatch> {
    try {
      return await this.llm.structuredOutput<ModificationPatch>([
        {
          role: "system",
          content: "Extract optional strategy metadata edits from feedback: name, description, tags to add and remove.",
        },
        { role: "user", content: feedback },
      ], MODIFICATION_PATCH_SCHEMA);
    } catch {
      return {};
    }
  }

  private resolveTemplate(intent: StrategyIntent): MetaStrategyTemplate {
    const normalized = normalizeTemplateKey(intent.suggestedTemplate) ?? normalizeTemplateKey(selectTemplateFromText(intent.description));
    if (normalized && BUILTIN_TEMPLATES[normalized]) {
      return BUILTIN_TEMPLATES[normalized]!;
    }
    return BUILTIN_TEMPLATES.trendFollowing!;
  }

  private pickBestCandidate(candidates: Strategy[], intent: StrategyIntent): Strategy {
    let best = candidates[0]!;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      const score = this.scoreStrategyAgainstIntent(candidate, intent);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return best;
  }

  private scoreStrategyAgainstIntent(strategy: Strategy, intent: StrategyIntent): number {
    const haystack = [
      strategy.name,
      strategy.description,
      ...(strategy.tags ?? []),
      ...strategy.signals.map((signal) => signal.type),
    ]
      .join(" ")
      .toLowerCase();

    let score = 0;
    for (const outcome of intent.desiredOutcomes) {
      score += tokenOverlapScore(outcome, haystack) * 3;
    }
    for (const constraint of intent.constraints) {
      score += tokenOverlapScore(constraint, haystack);
    }
    if (intent.suggestedTemplate && haystack.includes(intent.suggestedTemplate.toLowerCase())) {
      score += 2;
    }
    return score;
  }

  private generateStrategyName(intent: StrategyIntent, template: MetaStrategyTemplate): string {
    const requested = intent.description.slice(0, 64).trim();
    if (requested.length >= 10) {
      return `${template.name}: ${requested}`;
    }
    return `${template.name} Strategy ${shortId()}`;
  }

  private composeDescription(intent: StrategyIntent, template: MetaStrategyTemplate, fallback: string): string {
    const outcomes = intent.desiredOutcomes.length > 0 ? `Outcomes: ${intent.desiredOutcomes.join("; ")}.` : "";
    const constraints = intent.constraints.length > 0 ? `Constraints: ${intent.constraints.join("; ")}.` : "";
    const description = `${intent.description} ${outcomes} ${constraints}`.trim();
    if (description.length > 0) {
      return `${description} Template: ${template.name}.`;
    }
    return fallback;
  }

  private analyzeStrategy(strategy: Strategy, intent: StrategyIntent): string {
    const outcomes = intent.desiredOutcomes.length > 0 ? intent.desiredOutcomes.join(", ") : "not explicitly provided";
    const constraints = intent.constraints.length > 0 ? intent.constraints.join(", ") : "not explicitly provided";
    return [
      `Strategy ${strategy.id} (${strategy.name}) uses ${strategy.signals.length} signals and ${strategy.entryRules.length}/${strategy.exitRules.length} entry/exit rules.`,
      `Generation method: ${strategy.generationMethod}, status: ${strategy.status}, version: ${strategy.version}.`,
      `Desired outcomes: ${outcomes}.`,
      `Constraints: ${constraints}.`,
    ].join(" ");
  }

  private explainWithoutLlm(strategy: Strategy): string {
    const signals = strategy.signals.map((signal) => signal.type).join(", ");
    return `Strategy ${strategy.name} trades using ${signals}. It has ${strategy.entryRules.length} entry rules and ${strategy.exitRules.length} exit rules, with ${strategy.riskParams.positionSizing.method} position sizing and ${strategy.status} lifecycle status.`;
  }
}

function inferIntentType(query: string, references: string[]): StrategyIntent["type"] {
  const text = query.toLowerCase();
  if (/\b(explain|describe|what does|how does)\b/.test(text)) {
    return "explain";
  }
  if (/\b(analyze|review|assess|evaluate|compare)\b/.test(text)) {
    return "analyze";
  }
  if (references.length > 0 || /\b(modify|update|change|tune|improve|adjust|refine)\b/.test(text)) {
    return "modify";
  }
  return "create";
}

function selectTemplateFromText(text: string): string {
  const normalized = text.toLowerCase();
  if (/\b(mean\s*reversion|rsi|bollinger)\b/.test(normalized)) {
    return "meanReversion";
  }
  if (/\b(breakout|volume\s*spike)\b/.test(normalized)) {
    return "breakout";
  }
  if (/\b(momentum|macd)\b/.test(normalized)) {
    return "momentum";
  }
  return "trendFollowing";
}

function normalizeTemplateKey(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  const value = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["trend", "trendfollowing", "trendfollow", "trend-following"].includes(value)) {
    return "trendFollowing";
  }
  if (["meanreversion", "mean-reversion"].includes(value)) {
    return "meanReversion";
  }
  if (["breakout"].includes(value)) {
    return "breakout";
  }
  if (["momentum"].includes(value)) {
    return "momentum";
  }
  return undefined;
}

function applyTagPatch(current: string[], patch: ModificationPatch): string[] {
  const remove = new Set((patch.removeTags ?? []).map((tag) => tag.toLowerCase()));
  const base = current.filter((tag) => !remove.has(tag.toLowerCase()));
  return unique([...base, ...(patch.addTags ?? [])]);
}

function tokenOverlapScore(input: string, haystack: string): number {
  const tokens = input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
  if (tokens.length === 0) {
    return 0;
  }

  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += 1;
    }
  }
  return score;
}

function unique(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const value = item.trim();
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(value);
  }
  return out;
}

function nowIso(): string {
  return new Date().toISOString();
}

function shortId(): string {
  return crypto.randomUUID().slice(0, 8);
}

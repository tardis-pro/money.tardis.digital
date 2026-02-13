import type { ChatMessage, ChatResponse, LLMProvider } from "./manager-agent.js";

type ProviderName = "openai" | "anthropic";

export interface ChatChunk {
  provider: ProviderName;
  model: string;
  contentDelta: string;
  done?: boolean;
}

export interface TanStackAIProviderConfig {
  openAiApiKey?: string;
  anthropicApiKey?: string;
  defaultProvider?: ProviderName;
  defaultModel?: string;
  openAiModel?: string;
  anthropicModel?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

interface ProviderRuntimeConfig {
  openAiApiKey: string | undefined;
  anthropicApiKey: string | undefined;
  defaultProvider: ProviderName | undefined;
  defaultModel: string | undefined;
  openAiModel: string;
  anthropicModel: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

class ProviderError extends Error {
  readonly provider: ProviderName;
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(input: { provider: ProviderName; message: string; status?: number; retryable?: boolean }) {
    super(input.message);
    this.name = "ProviderError";
    this.provider = input.provider;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
  }
}

export class TanStackAIProvider implements LLMProvider {
  private readonly config: ProviderRuntimeConfig;

  constructor(config: TanStackAIProviderConfig = {}) {
    this.config = {
      openAiApiKey: config.openAiApiKey ?? process.env.OPENAI_API_KEY,
      anthropicApiKey: config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY,
      defaultProvider: config.defaultProvider ?? normalizeProvider(process.env.STRATEGY_AI_DEFAULT_PROVIDER),
      defaultModel: config.defaultModel ?? process.env.STRATEGY_AI_DEFAULT_MODEL,
      openAiModel: config.openAiModel ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      anthropicModel: config.anthropicModel ?? process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest",
      temperature: numberFromEnv(config.temperature, process.env.STRATEGY_AI_TEMPERATURE, 0.2),
      maxTokens: intFromEnv(config.maxTokens, process.env.STRATEGY_AI_MAX_TOKENS, 1200),
      timeoutMs: intFromEnv(config.timeoutMs, process.env.STRATEGY_AI_TIMEOUT_MS, 45_000),
    };
  }

  async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    return this.runWithFallback((provider) => this.chatWithProvider(provider, messages));
  }

  async structuredOutput<T>(messages: ChatMessage[], schema: object): Promise<T> {
    return this.runWithFallback((provider) => this.structuredOutputWithProvider<T>(provider, messages, schema));
  }

  async *streamChat(messages: ChatMessage[]): AsyncIterable<ChatChunk> {
    const providers = this.getProviderOrder();
    if (providers.length === 0) {
      throw new Error("No LLM provider configured. Set OPENAI_API_KEY and/or ANTHROPIC_API_KEY.");
    }

    const errors: Error[] = [];
    for (const provider of providers) {
      let emitted = false;
      try {
        for await (const chunk of this.streamWithProvider(provider, messages)) {
          emitted = true;
          yield chunk;
        }
        return;
      } catch (error) {
        if (emitted) {
          throw error;
        }
        errors.push(toError(error));
      }
    }

    throw composeFallbackError(errors);
  }

  private async chatWithProvider(provider: ProviderName, messages: ChatMessage[]): Promise<ChatResponse> {
    if (provider === "openai") {
      const payload = {
        model: this.getModel("openai"),
        messages,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
      };
      const json = await this.postJson<OpenAIChatResponse>(provider, "https://api.openai.com/v1/chat/completions", payload);
      const content = json.choices?.[0]?.message?.content;
      return { content: normalizeContent(content) };
    }

    const system = collectSystemPrompt(messages);
    const payload = {
      model: this.getModel("anthropic"),
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      ...(system ? { system } : {}),
      messages: toAnthropicMessages(messages),
    };
    const json = await this.postJson<AnthropicMessageResponse>(provider, "https://api.anthropic.com/v1/messages", payload);
    return { content: readAnthropicText(json) };
  }

  private async structuredOutputWithProvider<T>(provider: ProviderName, messages: ChatMessage[], schema: object): Promise<T> {
    if (provider === "openai") {
      try {
        const payload = {
          model: this.getModel("openai"),
          messages,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "strategy_output",
              schema,
              strict: true,
            },
          },
        };
        const json = await this.postJson<OpenAIChatResponse>(provider, "https://api.openai.com/v1/chat/completions", payload);
        const content = normalizeContent(json.choices?.[0]?.message?.content);
        return parseJsonOutput<T>(content);
      } catch (error) {
        if (error instanceof ProviderError && error.status && error.status >= 400 && error.status < 500 && error.status !== 429) {
          const promptMessages = withSchemaPrompt(messages, schema);
          const retry = await this.chatWithProvider(provider, promptMessages);
          return parseJsonOutput<T>(retry.content);
        }
        throw error;
      }
    }

    const system = collectSystemPrompt(messages);
    const payload = {
      model: this.getModel("anthropic"),
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      ...(system ? { system } : {}),
      messages: toAnthropicMessages(messages),
      tools: [
        {
          name: "structured_output",
          description: "Return structured JSON that follows the required schema",
          input_schema: schema,
        },
      ],
      tool_choice: { type: "tool", name: "structured_output" },
    };

    const json = await this.postJson<AnthropicMessageResponse>(provider, "https://api.anthropic.com/v1/messages", payload);
    const toolBlock = json.content?.find(isStructuredOutputToolUseBlock);
    if (toolBlock && toolBlock.input !== undefined) {
      return toolBlock.input as T;
    }

    return parseJsonOutput<T>(readAnthropicText(json));
  }

  private async *streamWithProvider(provider: ProviderName, messages: ChatMessage[]): AsyncIterable<ChatChunk> {
    if (provider === "openai") {
      const payload = {
        model: this.getModel("openai"),
        messages,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        stream: true,
      };
      const response = await this.postStream(provider, "https://api.openai.com/v1/chat/completions", payload);
      for await (const event of readSseEvents(response)) {
        if (event === "[DONE]") {
          yield { provider, model: this.getModel(provider), contentDelta: "", done: true };
          return;
        }
        const parsed = safeJsonParse<OpenAIStreamEvent>(event);
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          yield { provider, model: this.getModel(provider), contentDelta: delta };
        }
      }
      yield { provider, model: this.getModel(provider), contentDelta: "", done: true };
      return;
    }

    const system = collectSystemPrompt(messages);
    const payload = {
      model: this.getModel("anthropic"),
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      ...(system ? { system } : {}),
      messages: toAnthropicMessages(messages),
      stream: true,
    };
    const response = await this.postStream(provider, "https://api.anthropic.com/v1/messages", payload);
    for await (const event of readSseEvents(response)) {
      const parsed = safeJsonParse<AnthropicStreamEvent>(event);
      if (!parsed) {
        continue;
      }
      if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta" && parsed.delta.text) {
        yield { provider, model: this.getModel(provider), contentDelta: parsed.delta.text };
      }
      if (parsed.type === "message_stop") {
        yield { provider, model: this.getModel(provider), contentDelta: "", done: true };
        return;
      }
    }
    yield { provider, model: this.getModel(provider), contentDelta: "", done: true };
  }

  private async runWithFallback<T>(operation: (provider: ProviderName) => Promise<T>): Promise<T> {
    const providers = this.getProviderOrder();
    if (providers.length === 0) {
      throw new Error("No LLM provider configured. Set OPENAI_API_KEY and/or ANTHROPIC_API_KEY.");
    }

    const errors: Error[] = [];
    for (const provider of providers) {
      try {
        return await operation(provider);
      } catch (error) {
        errors.push(toError(error));
      }
    }
    throw composeFallbackError(errors);
  }

  private getProviderOrder(): ProviderName[] {
    const configured: ProviderName[] = [];
    if (this.config.openAiApiKey) {
      configured.push("openai");
    }
    if (this.config.anthropicApiKey) {
      configured.push("anthropic");
    }
    if (configured.length <= 1) {
      return configured;
    }

    if (this.config.defaultProvider && configured.includes(this.config.defaultProvider)) {
      return [this.config.defaultProvider, ...configured.filter((provider) => provider !== this.config.defaultProvider)];
    }
    return configured;
  }

  private getModel(provider: ProviderName): string {
    if (this.config.defaultModel) {
      return this.config.defaultModel;
    }
    return provider === "openai" ? this.config.openAiModel : this.config.anthropicModel;
  }

  private authHeader(provider: ProviderName): Record<string, string> {
    if (provider === "openai") {
      const key = this.config.openAiApiKey;
      if (!key) {
        throw new ProviderError({ provider, message: "OPENAI_API_KEY is missing" });
      }
      return { Authorization: `Bearer ${key}` };
    }

    const key = this.config.anthropicApiKey;
    if (!key) {
      throw new ProviderError({ provider, message: "ANTHROPIC_API_KEY is missing" });
    }
    return {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    };
  }

  private async postJson<T>(provider: ProviderName, url: string, body: unknown): Promise<T> {
    const response = await this.fetchWithTimeout(provider, url, body);
    if (!response.ok) {
      throw await this.readProviderError(provider, response);
    }
    return await response.json() as T;
  }

  private async postStream(provider: ProviderName, url: string, body: unknown): Promise<Response> {
    const response = await this.fetchWithTimeout(provider, url, body);
    if (!response.ok) {
      throw await this.readProviderError(provider, response);
    }
    if (!response.body) {
      throw new ProviderError({ provider, message: `${provider} returned an empty stream body`, retryable: true });
    }
    return response;
  }

  private async fetchWithTimeout(provider: ProviderName, url: string, body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      return await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeader(provider),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ProviderError({
        provider,
        message: `${provider} request failed: ${message}`,
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readProviderError(provider: ProviderName, response: Response): Promise<ProviderError> {
    const bodyText = await response.text();
    const parsed = safeJsonParse<{ error?: { message?: string; type?: string } }>(bodyText);
    const message = parsed?.error?.message ?? `${provider} request failed with status ${response.status}`;
    const type = parsed?.error?.type;
    const retryable = response.status === 429 || response.status >= 500 || type === "rate_limit_error";
    return new ProviderError({ provider, message, status: response.status, retryable });
  }
}

export function createTanStackAIProviderFromEnv(): TanStackAIProvider {
  return new TanStackAIProvider();
}

function normalizeProvider(value: string | undefined): ProviderName | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase().trim();
  if (normalized === "openai") {
    return "openai";
  }
  if (normalized === "anthropic") {
    return "anthropic";
  }
  return undefined;
}

function intFromEnv(input: number | undefined, envValue: string | undefined, fallback: number): number {
  if (typeof input === "number" && Number.isFinite(input)) {
    return Math.max(1, Math.floor(input));
  }
  if (envValue) {
    const parsed = Number.parseInt(envValue, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function numberFromEnv(input: number | undefined, envValue: string | undefined, fallback: number): number {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input;
  }
  if (envValue) {
    const parsed = Number.parseFloat(envValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

function collectSystemPrompt(messages: ChatMessage[]): string | undefined {
  const merged = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter((value) => value.length > 0)
    .join("\n\n");
  return merged.length > 0 ? merged : undefined;
}

function toAnthropicMessages(messages: ChatMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));
}

function withSchemaPrompt(messages: ChatMessage[], schema: object): ChatMessage[] {
  const schemaPrompt: ChatMessage = {
    role: "system",
    content: `Return only valid JSON that matches this schema: ${JSON.stringify(schema)}`,
  };
  return [schemaPrompt, ...messages];
}

function readAnthropicText(response: AnthropicMessageResponse): string {
  return (response.content ?? [])
    .filter(isTextBlock)
    .map((block) => block.text ?? "")
    .join("");
}

async function* readSseEvents(response: Response): AsyncIterable<string> {
  if (!response.body) {
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  const reader = response.body.getReader();
  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    buffer += decoder.decode(next.value, { stream: true });
    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary === -1) {
        break;
      }
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (data.length > 0) {
        yield data;
      }
    }
  }

  buffer += decoder.decode();
  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    yield tail.slice(5).trim();
  }
}

function isToolUseBlock(block: AnthropicMessageContentBlock): block is AnthropicToolUseBlock {
  return block.type === "tool_use";
}

function isStructuredOutputToolUseBlock(block: AnthropicMessageContentBlock): block is AnthropicToolUseBlock {
  return isToolUseBlock(block) && block.name === "structured_output";
}

function isTextBlock(block: AnthropicMessageContentBlock): block is AnthropicTextBlock {
  return block.type === "text";
}

function parseJsonOutput<T>(raw: string): T {
  const trimmed = raw.trim();
  const direct = safeJsonParse<T>(trimmed);
  if (direct !== undefined) {
    return direct;
  }

  const fenced = trimmed.match(/```json\s*([\s\S]+?)\s*```/i)?.[1] ?? trimmed.match(/```\s*([\s\S]+?)\s*```/i)?.[1];
  if (fenced) {
    const parsedFenced = safeJsonParse<T>(fenced.trim());
    if (parsedFenced !== undefined) {
      return parsedFenced;
    }
  }

  const jsonSlice = extractJsonSlice(trimmed);
  if (jsonSlice) {
    const parsedSlice = safeJsonParse<T>(jsonSlice);
    if (parsedSlice !== undefined) {
      return parsedSlice;
    }
  }

  throw new Error("LLM did not return valid JSON for structured output");
}

function extractJsonSlice(raw: string): string | undefined {
  const objectStart = raw.indexOf("{");
  const objectEnd = raw.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    return raw.slice(objectStart, objectEnd + 1);
  }
  const arrayStart = raw.indexOf("[");
  const arrayEnd = raw.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return raw.slice(arrayStart, arrayEnd + 1);
  }
  return undefined;
}

function safeJsonParse<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

function composeFallbackError(errors: Error[]): Error {
  const details = errors.map((error, index) => {
    const prefix = error instanceof ProviderError
      ? `${error.provider}${error.status ? `(${error.status})` : ""}`
      : `error-${index + 1}`;
    return `${prefix}: ${error.message}`;
  });
  return new Error(`All configured LLM providers failed. ${details.join(" | ")}`);
}

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

interface OpenAIStreamEvent {
  choices?: Array<{ delta?: { content?: string } }>;
}

interface AnthropicMessageResponse {
  content?: AnthropicMessageContentBlock[];
}

type AnthropicTextBlock = { type: "text"; text?: string };
type AnthropicToolUseBlock = { type: "tool_use"; name?: string; input?: unknown };
type AnthropicUnknownBlock = { type: string };
type AnthropicMessageContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicUnknownBlock;

interface AnthropicStreamEvent {
  type?: string;
  delta?: { type?: string; text?: string };
}

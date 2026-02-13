import { createHmac, randomUUID } from "node:crypto";

export type WebhookEvent =
  | "strategy.created"
  | "strategy.updated"
  | "strategy.archived"
  | "simulation.completed"
  | "ranking.updated"
  | "rulebook.rebuilt"
  | "experiment.completed"
  | "alert.triggered"
  | "portfolio.rebalanced";

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: unknown;
  source: string;
}

export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  timeoutMs: number;
  retryOnStatuses: number[];
}

export interface WebhookConfig {
  url: string;
  events: WebhookEvent[];
  secret?: string;
  enabled: boolean;
  retryPolicy?: RetryPolicy;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 10_000,
  backoffMultiplier: 2,
  timeoutMs: 10_000,
  retryOnStatuses: [408, 425, 429, 500, 502, 503, 504],
};

const DEFAULT_SOURCE = "strategy-ai";

export class WebhookManager {
  private readonly webhooks = new Map<string, WebhookConfig>();

  constructor() {}

  register(config: WebhookConfig): string {
    const id = `webhook-${randomUUID()}`;
    this.webhooks.set(id, this.normalizeConfig(config));
    return id;
  }

  unregister(id: string): void {
    this.webhooks.delete(id);
  }

  update(id: string, config: Partial<WebhookConfig>): void {
    const current = this.webhooks.get(id);
    if (!current) {
      throw new Error(`Webhook not found: ${id}`);
    }
    const merged: WebhookConfig = {
      ...current,
      ...config,
      events: config.events ? [...config.events] : [...current.events],
      ...(config.retryPolicy
        ? { retryPolicy: { ...current.retryPolicy, ...config.retryPolicy } }
        : current.retryPolicy
          ? { retryPolicy: { ...current.retryPolicy } }
          : {}),
    };
    this.webhooks.set(id, this.normalizeConfig(merged));
  }

  list(): WebhookConfig[] {
    return [...this.webhooks.values()].map((config) => this.cloneConfig(config));
  }

  async trigger(event: WebhookEvent, data: unknown): Promise<void> {
    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
      source: DEFAULT_SOURCE,
    };

    const tasks: Promise<void>[] = [];
    for (const config of this.webhooks.values()) {
      if (!config.enabled || !config.events.includes(event)) {
        continue;
      }
      tasks.push(this.deliverWithRetry(config, payload));
    }

    const settled = await Promise.allSettled(tasks);
    const failures = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0) {
      const error = failures[0]?.reason;
      throw error instanceof Error ? error : new Error("One or more webhook deliveries failed");
    }
  }

  private async deliverWithRetry(config: WebhookConfig, payload: WebhookPayload): Promise<void> {
    const retryPolicy = config.retryPolicy ?? DEFAULT_RETRY_POLICY;
    const body = JSON.stringify(payload);

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= retryPolicy.maxRetries) {
      try {
        const response = await this.postWebhook(config, body, retryPolicy.timeoutMs, payload.timestamp);

        if (response.ok) {
          return;
        }

        const retriable = retryPolicy.retryOnStatuses.includes(response.status);
        const message = `Webhook responded with status ${response.status} for ${config.url}`;
        if (!retriable || attempt === retryPolicy.maxRetries) {
          if (!retriable) {
            throw new NonRetryableWebhookError(message);
          }
          throw new Error(message);
        }
        lastError = new Error(message);
      } catch (error) {
        if (error instanceof NonRetryableWebhookError) {
          throw error;
        }
        lastError = error instanceof Error ? error : new Error("Unknown webhook delivery error");
        if (attempt === retryPolicy.maxRetries) {
          break;
        }
      }

      const delayMs = this.computeBackoffDelay(retryPolicy, attempt);
      await sleep(delayMs);
      attempt += 1;
    }

    throw lastError ?? new Error("Webhook delivery failed after retries");
  }

  private async postWebhook(
    config: WebhookConfig,
    body: string,
    timeoutMs: number,
    timestamp: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const signature = this.signPayload(body, config.secret);
      const headers: HeadersInit = {
        "content-type": "application/json",
        "x-webhook-timestamp": timestamp,
      };
      if (signature) {
        headers["x-webhook-signature"] = signature;
      }
      return await fetch(config.url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private signPayload(body: string, secret: string | undefined): string | null {
    if (!secret) {
      return null;
    }
    const digest = createHmac("sha256", secret).update(body).digest("hex");
    return `sha256=${digest}`;
  }

  private computeBackoffDelay(policy: RetryPolicy, attempt: number): number {
    const exponential = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt);
    return Math.min(policy.maxDelayMs, Math.max(0, Math.floor(exponential)));
  }

  private normalizeConfig(config: WebhookConfig): WebhookConfig {
    const url = config.url.trim();
    if (url.length === 0) {
      throw new Error("Webhook URL is required");
    }
    if (config.events.length === 0) {
      throw new Error("Webhook must subscribe to at least one event");
    }

    const dedupedEvents = [...new Set(config.events)];
    const retryPolicy = this.normalizeRetryPolicy(config.retryPolicy);

    return {
      url,
      events: dedupedEvents,
      enabled: config.enabled,
      ...(config.secret ? { secret: config.secret } : {}),
      ...(retryPolicy ? { retryPolicy } : {}),
    };
  }

  private normalizeRetryPolicy(policy?: RetryPolicy): RetryPolicy | undefined {
    if (!policy) {
      return undefined;
    }
    return {
      maxRetries: Math.max(0, Math.floor(policy.maxRetries)),
      initialDelayMs: Math.max(0, Math.floor(policy.initialDelayMs)),
      maxDelayMs: Math.max(0, Math.floor(policy.maxDelayMs)),
      backoffMultiplier: Math.max(1, policy.backoffMultiplier),
      timeoutMs: Math.max(1, Math.floor(policy.timeoutMs)),
      retryOnStatuses: [...new Set(policy.retryOnStatuses)],
    };
  }

  private cloneConfig(config: WebhookConfig): WebhookConfig {
    return {
      ...config,
      events: [...config.events],
      ...(config.retryPolicy
        ? { retryPolicy: { ...config.retryPolicy, retryOnStatuses: [...config.retryPolicy.retryOnStatuses] } }
        : {}),
    };
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

class NonRetryableWebhookError extends Error {}

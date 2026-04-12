import { z } from "zod";
import { makeId, nowIso } from "../utils.js";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

const TelegramSendMessageResponseSchema = z.object({
  ok: z.boolean(),
  result: z.object({ message_id: z.number() }).passthrough().optional(),
  description: z.string().optional(),
});

const TelegramAckResponseSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
});

const TELEGRAM_REQUEST_TIMEOUT_MS = 8_000;
const TELEGRAM_MAX_ATTEMPTS = 3;
const TELEGRAM_BACKOFF_BASE_MS = 500;

async function postTelegram(
  url: string,
  body: unknown,
  context: string
): Promise<{ ok: true; response: Response } | { ok: false; error: string }> {
  let lastError = "unknown";
  for (let attempt = 1; attempt <= TELEGRAM_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TELEGRAM_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      // 4xx other than 429 are permanent — don't retry, return the response
      // so the caller can parse the description and surface it.
      if (response.status === 429 || response.status >= 500) {
        lastError = `http ${response.status}`;
        if (attempt < TELEGRAM_MAX_ATTEMPTS) {
          const retryAfterHeader = response.headers.get("retry-after");
          const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
          const backoff = Number.isFinite(retryAfterMs) && retryAfterMs > 0
            ? retryAfterMs
            : TELEGRAM_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
          console.warn(`[telegram] ${context} attempt ${attempt} got ${response.status}, retrying in ${backoff}ms`);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
      }
      return { ok: true, response };
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : "network error";
      lastError = msg;
      if (attempt < TELEGRAM_MAX_ATTEMPTS) {
        const backoff = TELEGRAM_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        console.warn(`[telegram] ${context} attempt ${attempt} failed: ${msg}, retrying in ${backoff}ms`);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
    }
  }
  console.warn(`[telegram] ${context} giving up after ${TELEGRAM_MAX_ATTEMPTS} attempts: ${lastError}`);
  return { ok: false, error: lastError };
}

async function parseTelegramJson<T>(
  response: Response,
  schema: z.ZodType<T>,
  context: string
): Promise<T | { __parseError: string }> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "json decode failed";
    console.warn(`[telegram] ${context} non-JSON response: ${msg}`);
    return { __parseError: `invalid JSON: ${msg}` };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`[telegram] ${context} unexpected response shape: ${parsed.error.message}`);
    return { __parseError: `unexpected response shape` };
  }
  return parsed.data;
}

export interface HeroAlertPayload {
  ticker: string;
  action: "execute" | "pass";
  buyPrice: number;
  stopLoss: number;
  target: number;
  score: number;
}

export class TelegramNotificationService {
  private botToken: string | null = null;
  private chatId: string | null = null;
  private webhookPath: string = "/api/telegram/webhook";
  private readonly callbackPayloadByToken = new Map<string, { payload: HeroAlertPayload; expiresAt: number }>();

  constructor(config?: TelegramConfig) {
    this.botToken = config?.botToken ?? process.env.TELEGRAM_BOT_TOKEN ?? null;
    this.chatId = config?.chatId ?? process.env.TELEGRAM_CHAT_ID ?? null;
  }

  isConfigured(): boolean {
    return this.botToken !== null && this.chatId !== null;
  }

  async sendMessage(text: string, parseMode?: "MarkdownV2" | "HTML"): Promise<{ ok: boolean; messageId?: number; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: "Telegram bot not configured" };
    }

    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const post = await postTelegram(
      url,
      {
        chat_id: this.chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
        disable_web_page_preview: true,
      },
      "sendMessage"
    );
    if (!post.ok) return { ok: false, error: post.error };

    const result = await parseTelegramJson(post.response, TelegramSendMessageResponseSchema, "sendMessage");
    if ("__parseError" in result) {
      return { ok: false, error: result.__parseError };
    }

    if (result.ok) {
      const msgId = result.result?.message_id;
      return msgId !== undefined ? { ok: true, messageId: msgId } : { ok: true };
    }

    return { ok: false, error: result.description ?? "Unknown error" };
  }

  async sendHeroAlertWithButtons(
    heroBrief: string,
    payload: HeroAlertPayload
  ): Promise<{ ok: boolean; messageId?: number; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: "Telegram bot not configured" };
    }

    const callbackToken = this.createCallbackToken(payload);
    const callbackDataExecute = `hero_execute:${callbackToken}`;
    const callbackDataPass = `hero_pass:${callbackToken}`;

    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const post = await postTelegram(
      url,
      {
        chat_id: this.chatId,
        text: `🎯 QVM-Hybrid Alert\n\n${heroBrief}`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ EXECUTE HERO TRADE", callback_data: callbackDataExecute },
              { text: "❌ PASS", callback_data: callbackDataPass },
            ],
          ],
        },
      },
      "sendHeroAlertWithButtons"
    );
    if (!post.ok) return { ok: false, error: post.error };

    const result = await parseTelegramJson(post.response, TelegramSendMessageResponseSchema, "sendHeroAlertWithButtons");
    if ("__parseError" in result) {
      return { ok: false, error: result.__parseError };
    }

    if (result.ok) {
      const msgId = result.result?.message_id;
      return msgId !== undefined ? { ok: true, messageId: msgId } : { ok: true };
    }

    const errMsg = result.description;
    return errMsg !== undefined ? { ok: false, error: errMsg } : { ok: false, error: "Unknown error" };
  }

  getHeroPayloadFromToken(token: string): HeroAlertPayload | null {
    const hit = this.callbackPayloadByToken.get(token);
    if (!hit) {
      return null;
    }
    if (Date.now() > hit.expiresAt) {
      this.callbackPayloadByToken.delete(token);
      return null;
    }
    return hit.payload;
  }

  private createCallbackToken(payload: HeroAlertPayload): string {
    const token = makeId("hero").replace("hero_", "h").slice(0, 24);
    this.callbackPayloadByToken.set(token, {
      payload,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    return token;
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.botToken) {
      return { ok: false, error: "Telegram bot not configured" };
    }

    const url = `https://api.telegram.org/bot${this.botToken}/answerCallbackQuery`;
    const post = await postTelegram(
      url,
      { callback_query_id: callbackQueryId, text },
      "answerCallbackQuery"
    );
    if (!post.ok) return { ok: false, error: post.error };

    const result = await parseTelegramJson(post.response, TelegramAckResponseSchema, "answerCallbackQuery");
    if ("__parseError" in result) {
      return { ok: false, error: result.__parseError };
    }
    if (result.ok) return { ok: true };
    const errMsg = result.description;
    return errMsg !== undefined ? { ok: false, error: errMsg } : { ok: false };
  }

  async sendHeroAlert(heroBrief: string): Promise<{ ok: boolean; error?: string }> {
    const header = "🎯 *QVM-Hybrid Alert*\n\n";
    return this.sendMessage(header + heroBrief);
  }

  async sendExecutionConfirmation(ticker: string, action: "BUY" | "SELL", price: number, qty: number): Promise<{ ok: boolean; error?: string }> {
    const message = `✅ *Trade Executed*\n\n*Action:* ${action}\n*Symbol:* ${ticker}\n*Price:* ₹${price.toFixed(2)}\n*Qty:* ${qty}\n*Time:* ${nowIso()}`;
    return this.sendMessage(message);
  }

  async sendEmergencyStop(ticker: string, reason: string): Promise<{ ok: boolean; error?: string }> {
    const message = `🛑 *EMERGENCY STOP*\n\n*Symbol:* ${ticker}\n*Reason:* ${reason}\n*Time:* ${nowIso()}`;
    return this.sendMessage(message);
  }

  async notifyHeroRejected(ticker: string): Promise<{ ok: boolean; error?: string }> {
    const message = `❌ *Hero Trade Rejected*\n\n*Symbol:* ${ticker}\n*Action:* PASSED\n*Time:* ${nowIso()}`;
    return this.sendMessage(message);
  }

  async notifyHeroExecuted(ticker: string, price: number, qty: number): Promise<{ ok: boolean; error?: string }> {
    const message = `✅ *Hero Trade Confirmed*\n\n*Symbol:* ${ticker}\n*Entry:* ₹${price.toFixed(2)}\n*Qty:* ${qty}\n*Time:* ${nowIso()}`;
    return this.sendMessage(message);
  }
}

let telegramServiceInstance: TelegramNotificationService | null = null;

export function getTelegramService(config?: TelegramConfig): TelegramNotificationService {
  if (!telegramServiceInstance) {
    telegramServiceInstance = new TelegramNotificationService(config);
  }
  return telegramServiceInstance;
}

export function createTelegramService(config: TelegramConfig): TelegramNotificationService {
  return new TelegramNotificationService(config);
}

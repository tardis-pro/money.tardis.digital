import { makeId, nowIso } from "../utils.js";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
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
    
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          ...(parseMode ? { parse_mode: parseMode } : {}),
          disable_web_page_preview: true,
        }),
      });

      const result = await response.json() as { ok: boolean; result?: { message_id: number }; description?: string };
      
      if (result.ok) {
        const msgId = result.result?.message_id;
        return msgId !== undefined ? { ok: true, messageId: msgId } : { ok: true };
      }
      
      return { ok: false, error: result.description ?? "Unknown error" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Network error" };
    }
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
    
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });

      const result = await response.json() as { ok: boolean; result?: { message_id: number }; description?: string };
      
      if (result.ok) {
        const msgId = result.result?.message_id;
        return msgId !== undefined ? { ok: true, messageId: msgId } : { ok: true };
      }
      
      const errMsg = result.description;
      return errMsg !== undefined ? { ok: false, error: errMsg } : { ok: false, error: "Unknown error" };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Network error";
      return { ok: false, error: errMsg };
    }
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
    
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text,
        }),
      });

      const result = await response.json() as { ok: boolean; description?: string };
      if (result.ok) return { ok: true };
      const errMsg = result.description;
      return errMsg !== undefined ? { ok: false, error: errMsg } : { ok: false };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Network error";
      return { ok: false, error: errMsg };
    }
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

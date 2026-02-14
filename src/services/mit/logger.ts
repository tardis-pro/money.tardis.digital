/**
 * MIT Trading System - Comprehensive Logger Service
 * 
 * Provides structured logging for:
 * - Trading activities (entry, exit, modifications)
 * - Data imports and refreshes
 * - System operations and errors
 * - Performance metrics
 * 
 * Logs to both console and file with rotation.
 */

import { mkdir, appendFile, stat, rename } from "node:fs/promises";
import path from "node:path";

export type LogLevel = "error" | "warn" | "info" | "debug" | "trade";
export type LogCategory = "trade" | "data" | "system" | "pipeline" | "backfill" | "alert";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  data?: Record<string, unknown>;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
  context?: {
    ticker?: string;
    positionId?: string;
    runId?: string;
    userId?: string;
  };
}

export interface TradeLogData {
  type: "entry" | "exit" | "modify" | "confirm" | "stop_update" | "pnl_refresh";
  ticker: string;
  feed: "nt-lite" | "quant";
  positionId?: string;
  entryPrice?: number;
  exitPrice?: number;
  qty?: number;
  stopLoss?: number;
  target?: number;
  pnl?: number;
  pnlPct?: number;
  reason?: string;
  details?: Record<string, unknown>;
}

class LoggerService {
  private logDir: string;
  private currentLogFile: string;
  private maxFileSizeBytes = 10 * 1024 * 1024; // 10MB
  private maxLogFiles = 30;
  private enabled: boolean;

  constructor(baseDir: string = process.cwd()) {
    this.logDir = path.join(baseDir, "logs");
    this.currentLogFile = "";
    this.enabled = true;
  }

  async init(): Promise<void> {
    try {
      await mkdir(this.logDir, { recursive: true });
      this.currentLogFile = this.getLogFilePath();
    } catch {
      this.enabled = false;
    }
  }

  private getLogFilePath(): string {
    const date = new Date().toISOString().slice(0, 10);
    return path.join(this.logDir, `mit-${date}.log`);
  }

  private async rotateIfNeeded(): Promise<void> {
    if (!this.enabled) return;
    
    try {
      const stats = await stat(this.currentLogFile);
      if (stats.size >= this.maxFileSizeBytes) {
        const timestamp = Date.now();
        const rotatedFile = this.currentLogFile.replace(".log", `-${timestamp}.log`);
        await rename(this.currentLogFile, rotatedFile);
        this.currentLogFile = this.getLogFilePath();
      }
    } catch {
      // File doesn't exist yet, no rotation needed
    }
  }

  private formatEntry(entry: LogEntry): string {
    return JSON.stringify(entry) + "\n";
  }

  async log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    data?: Record<string, unknown>,
    context?: LogEntry["context"],
    error?: Error
  ): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
    };

    if (data !== undefined) {
      entry.data = data;
    }
    if (context !== undefined) {
      entry.context = context;
    }

    if (error) {
      const errorInfo: { message: string; stack?: string; code?: string } = {
        message: error.message,
      };
      if (error.stack !== undefined) {
        errorInfo.stack = error.stack;
      }
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode !== undefined) {
        errorInfo.code = errorCode;
      }
      entry.error = errorInfo;
    }

    // Console output with colors
    const levelColors: Record<LogLevel, string> = {
      error: "\x1b[31m",
      warn: "\x1b[33m",
      info: "\x1b[36m",
      debug: "\x1b[90m",
      trade: "\x1b[32m",
    };
    const reset = "\x1b[0m";
    const color = levelColors[level];
    const prefix = `[${entry.timestamp}] [${level.toUpperCase()}] [${category}]`;
    const contextStr = context ? ` ${JSON.stringify(context)}` : "";
    
    console.log(`${color}${prefix}${reset}${contextStr} ${message}`);
    if (data) {
      console.log(`${color}${prefix}${reset} Data:`, JSON.stringify(data, null, 2));
    }
    if (error) {
      console.error(`${color}${prefix}${reset} Error:`, error.message);
      if (error.stack) {
        console.error(error.stack);
      }
    }

    // File output
    if (this.enabled) {
      await this.rotateIfNeeded();
      try {
        await appendFile(this.currentLogFile, this.formatEntry(entry));
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        console.warn(`MIT logger file write failed: ${message}`);
      }
    }
  }

  // Convenience methods
  async error(category: LogCategory, message: string, error?: Error, context?: LogEntry["context"]): Promise<void> {
    return this.log("error", category, message, undefined, context, error);
  }

  async warn(category: LogCategory, message: string, data?: Record<string, unknown>, context?: LogEntry["context"]): Promise<void> {
    return this.log("warn", category, message, data, context);
  }

  async info(category: LogCategory, message: string, data?: Record<string, unknown>, context?: LogEntry["context"]): Promise<void> {
    return this.log("info", category, message, data, context);
  }

  async debug(category: LogCategory, message: string, data?: Record<string, unknown>, context?: LogEntry["context"]): Promise<void> {
    if (process.env.LOG_LEVEL === "debug") {
      return this.log("debug", category, message, data, context);
    }
  }

  // Trade-specific logging
  async trade(data: TradeLogData, context?: LogEntry["context"]): Promise<void> {
    const message = `TRADE_${data.type.toUpperCase()}: ${data.ticker} (${data.feed})`;
    return this.log("trade", "trade", message, data as unknown as Record<string, unknown>, context);
  }

  // Trade entry logging
  async logTradeEntry(params: {
    ticker: string;
    feed: "nt-lite" | "quant";
    positionId: string;
    entryPrice: number;
    qty: number;
    allocatedAmount: number;
    stopLoss: number;
    target: number;
    notes?: string;
    userId?: string;
  }): Promise<void> {
    const context: LogEntry["context"] = { ticker: params.ticker, positionId: params.positionId };
    if (params.userId !== undefined) {
      context.userId = params.userId;
    }
    return this.trade({
      type: "entry",
      ticker: params.ticker,
      feed: params.feed,
      positionId: params.positionId,
      entryPrice: params.entryPrice,
      qty: params.qty,
      stopLoss: params.stopLoss,
      target: params.target,
      details: {
        allocatedAmount: params.allocatedAmount,
        notes: params.notes,
      },
    }, context);
  }

  // Trade exit logging
  async logTradeExit(params: {
    ticker: string;
    feed: "nt-lite" | "quant";
    positionId: string;
    entryPrice: number;
    exitPrice: number;
    qty: number;
    pnl: number;
    pnlPct: number;
    realizedRMultiple: number;
    holdDays: number;
    reason: string;
    userId?: string;
  }): Promise<void> {
    const context: LogEntry["context"] = { ticker: params.ticker, positionId: params.positionId };
    if (params.userId !== undefined) {
      context.userId = params.userId;
    }
    return this.trade({
      type: "exit",
      ticker: params.ticker,
      feed: params.feed,
      positionId: params.positionId,
      entryPrice: params.entryPrice,
      exitPrice: params.exitPrice,
      qty: params.qty,
      pnl: params.pnl,
      pnlPct: params.pnlPct,
      reason: params.reason,
      details: {
        realizedRMultiple: params.realizedRMultiple,
        holdDays: params.holdDays,
      },
    }, context);
  }

  // Stop loss update logging
  async logStopUpdate(params: {
    ticker: string;
    positionId: string;
    oldStop: number;
    newStop: number;
    reason: "trailing" | "manual" | "structural";
    userId?: string;
  }): Promise<void> {
    const context: LogEntry["context"] = { ticker: params.ticker, positionId: params.positionId };
    if (params.userId !== undefined) {
      context.userId = params.userId;
    }
    return this.trade({
      type: "stop_update",
      ticker: params.ticker,
      feed: "nt-lite",
      positionId: params.positionId,
      stopLoss: params.newStop,
      details: {
        oldStop: params.oldStop,
        reason: params.reason,
      },
    }, context);
  }

  // P&L refresh logging
  async logPnlRefresh(params: {
    portfolioEquity: number;
    cash: number;
    deployed: number;
    unrealizedPnl: number;
    realizedPnlCumulative: number;
    positionsCount: number;
    sellIndicatorsCount: number;
  }): Promise<void> {
    return this.trade({
      type: "pnl_refresh",
      ticker: "PORTFOLIO",
      feed: "nt-lite",
      pnl: params.unrealizedPnl,
      details: {
        portfolioEquity: params.portfolioEquity,
        cash: params.cash,
        deployed: params.deployed,
        realizedPnlCumulative: params.realizedPnlCumulative,
        positionsCount: params.positionsCount,
        sellIndicatorsCount: params.sellIndicatorsCount,
      },
    });
  }

  // Pipeline logging
  async logPipelineStart(params: { runId: string; universeSize: number }): Promise<void> {
    return this.info("pipeline", `Pipeline started`, params, { runId: params.runId });
  }

  async logPipelineComplete(params: {
    runId: string;
    status: "success" | "partial" | "failed";
    ideasGenerated: number;
    fundamentalsRefreshed: number;
    anomaliesDetected: number;
    durationMs: number;
    errors: string[];
  }): Promise<void> {
    const level = params.status === "failed" ? "error" : params.status === "partial" ? "warn" : "info";
    return this.log(level, "pipeline", `Pipeline completed: ${params.status}`, params, { runId: params.runId });
  }

  // Data import logging
  async logDataImport(params: {
    source: string;
    type: "fundamentals" | "candles" | "signals" | "news";
    tickersCount?: number;
    success: number;
    failed: number;
    errors?: string[];
  }): Promise<void> {
    const message = `Data import from ${params.source}: ${params.success} succeeded, ${params.failed} failed`;
    const level = params.failed > 0 ? "warn" : "info";
    return this.log(level, "data", message, params);
  }

  // Backfill logging
  async logBackfill(params: {
    runId: string;
    type: "notable" | "real-news" | "candles";
    status: "started" | "completed" | "failed";
    recordsProcessed?: number;
    errors?: string[];
  }): Promise<void> {
    const level = params.status === "failed" ? "error" : params.status === "started" ? "info" : "info";
    return this.log(level, "backfill", `Backfill ${params.type}: ${params.status}`, params, { runId: params.runId });
  }

  // Alert logging
  async logAlert(params: {
    type: "stop_breach" | "near_target" | "time_exit" | "momentum_decay" | "anomaly";
    ticker: string;
    positionId?: string;
    severity: "info" | "warning" | "critical";
    message: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    const level = params.severity === "critical" ? "error" : params.severity === "warning" ? "warn" : "info";
    const context: LogEntry["context"] = { ticker: params.ticker };
    if (params.positionId !== undefined) {
      context.positionId = params.positionId;
    }
    return this.log(level, "alert", `ALERT [${params.type}]: ${params.ticker} - ${params.message}`, params.details, context);
  }
}

// Singleton instance
let loggerInstance: LoggerService | null = null;

export async function getLogger(): Promise<LoggerService> {
  if (!loggerInstance) {
    loggerInstance = new LoggerService();
    await loggerInstance.init();
  }
  return loggerInstance;
}

export function getLoggerSync(): LoggerService {
  if (!loggerInstance) {
    loggerInstance = new LoggerService();
    loggerInstance.init().catch(() => {});
  }
  return loggerInstance;
}

export { LoggerService };

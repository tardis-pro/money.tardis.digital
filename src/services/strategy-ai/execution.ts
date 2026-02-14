import { randomUUID } from "node:crypto";
import type { Strategy, Rule, RuleCondition } from "./dsl/strategy-schema.js";
import type { Signal, SignalCondition } from "./dsl/signal-definitions.js";
import type { TimescaleTechnicalStore, IndicatorSnapshot, OHLCV } from "./ta-store.js";
import type { StrategyStore } from "./store.js";

export type ExecutionStatus = "idle" | "running" | "paused" | "error";

export interface PaperOrder {
  id: string;
  strategyId: string;
  ticker: string;
  side: "buy" | "sell";
  quantity: number;
  type: "market" | "limit";
  price?: number;
}

export interface PaperExecution {
  orderId: string;
  executedPrice: number;
  executedQuantity: number;
  timestamp: string;
  fees: number;
}

export interface PaperTrade {
  id: string;
  ticker: string;
  entry: number;
  exit: number;
  pnl: number;
  entryDate: string;
  exitDate: string;
}

export interface TradingSignal {
  type: "entry" | "exit";
  ticker: string;
  reason: string;
  confidence: number;
}

export interface Position {
  id: string;
  strategyId: string;
  ticker: string;
  side: "long";
  quantity: number;
  entryPrice: number;
  entryDate: string;
  lastPrice: number;
  unrealizedPnl: number;
  entryFees: number;
}

type SignalContext = {
  latestCandle: OHLCV;
  previousCandle: OHLCV | null;
  latestIndicator: IndicatorSnapshot | null;
  previousIndicator: IndicatorSnapshot | null;
};

type RuntimeState = {
  strategy: Strategy;
  status: ExecutionStatus;
  cash: number;
  positions: Map<string, Position>;
  closedTrades: PaperTrade[];
  openOrders: Map<string, PaperOrder & { cancelled: boolean }>;
  logs: string[];
  signalHandler: (signal: TradingSignal) => Promise<void>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export class ExecutionEngine {
  private readonly taStore: TimescaleTechnicalStore;
  private readonly store: StrategyStore;
  private readonly runtimes = new Map<string, RuntimeState>();
  private readonly status = new Map<string, ExecutionStatus>();

  private readonly initialCapital = this.getEnvNumber("PAPER_INITIAL_CAPITAL", 100_000);
  private readonly slippageRate = this.getEnvBps("PAPER_SLIPPAGE_BPS", 5);
  private readonly commissionRate = this.getEnvBps("PAPER_COMMISSION_BPS", 2);
  private readonly minExecutionDelayMs = Math.max(0, Math.floor(this.getEnvNumber("PAPER_MIN_EXEC_DELAY_MS", 150)));
  private readonly maxExecutionDelayMs = Math.max(
    this.minExecutionDelayMs,
    Math.floor(this.getEnvNumber("PAPER_MAX_EXEC_DELAY_MS", 650)),
  );
  private readonly defaultMaxPositions = Math.max(1, Math.floor(this.getEnvNumber("PAPER_MAX_POSITIONS", 10)));

  constructor(deps: { taStore: TimescaleTechnicalStore; store: StrategyStore }) {
    this.taStore = deps.taStore;
    this.store = deps.store;
  }

  async start(strategyId: string): Promise<void> {
    const strategy = await this.store.getStrategy(strategyId);
    if (!strategy) {
      throw new Error(`Strategy not found: ${strategyId}`);
    }

    const existing = this.runtimes.get(strategyId);
    if (existing) {
      existing.status = "running";
      this.status.set(strategyId, "running");
      this.log(strategyId, `Resumed paper trading for strategy ${strategyId}`);
      return;
    }

    const runtime: RuntimeState = {
      strategy,
      status: "running",
      cash: this.initialCapital,
      positions: new Map<string, Position>(),
      closedTrades: [],
      openOrders: new Map<string, PaperOrder & { cancelled: boolean }>(),
      logs: [],
      signalHandler: async (signal: TradingSignal) => {
        await this.processSignal(strategyId, signal);
      },
    };

    this.runtimes.set(strategyId, runtime);
    this.status.set(strategyId, "running");
    this.log(strategyId, `Started paper trading for strategy ${strategyId}`);
    this.log(strategyId, `Subscribed signal handler for strategy ${strategyId}`);
  }

  async stop(strategyId: string): Promise<void> {
    const runtime = this.runtimes.get(strategyId);
    if (!runtime) {
      this.status.set(strategyId, "idle");
      return;
    }

    runtime.status = "idle";
    for (const order of runtime.openOrders.values()) {
      order.cancelled = true;
    }
    runtime.openOrders.clear();
    this.status.set(strategyId, "idle");
    this.log(strategyId, `Stopped paper trading for strategy ${strategyId}`);
  }

  getStatus(): Map<string, ExecutionStatus> {
    return new Map(this.status);
  }

  getPositions(strategyId: string): Position[] {
    const runtime = this.runtimes.get(strategyId);
    if (!runtime) {
      return [];
    }
    return [...runtime.positions.values()].map((position) => ({ ...position }));
  }

  getClosedTrades(strategyId: string): PaperTrade[] {
    const runtime = this.runtimes.get(strategyId);
    if (!runtime) {
      return [];
    }
    return runtime.closedTrades.map((trade) => ({ ...trade }));
  }

  getEquity(strategyId: string): number {
    const runtime = this.runtimes.get(strategyId);
    if (!runtime) {
      return this.initialCapital;
    }

    const unrealized = [...runtime.positions.values()].reduce((sum, position) => {
      const pnl = (position.lastPrice - position.entryPrice) * position.quantity;
      return sum + pnl;
    }, 0);

    const investedCost = [...runtime.positions.values()].reduce((sum, position) => {
      return sum + position.entryPrice * position.quantity + position.entryFees;
    }, 0);

    return runtime.cash + investedCost + unrealized;
  }

  async submitOrder(strategyId: string, order: PaperOrder): Promise<PaperExecution> {
    const runtime = this.getRuntime(strategyId);
    this.assertRunning(runtime, strategyId);

    if (!Number.isFinite(order.quantity) || order.quantity <= 0) {
      throw new Error(`Invalid paper order quantity for order ${order.id}`);
    }

    const trackedOrder = { ...order, cancelled: false };
    runtime.openOrders.set(order.id, trackedOrder);

    const delay = this.randomDelay();
    await this.sleep(delay);
    if (trackedOrder.cancelled) {
      runtime.openOrders.delete(order.id);
      throw new Error(`Paper order ${order.id} was cancelled before execution`);
    }

    const latestPrice = await this.resolveLatestPrice(order.ticker);
    const rawPrice = this.resolveExecutionPrice(order, latestPrice);
    const executedPrice = this.applySlippage(rawPrice, order.side);
    const fees = this.applyCommission(executedPrice * order.quantity);
    const executedQuantity = Math.floor(order.quantity);
    if (executedQuantity <= 0) {
      runtime.openOrders.delete(order.id);
      throw new Error(`Paper order ${order.id} has non-executable quantity`);
    }

    const execution: PaperExecution = {
      orderId: order.id,
      executedPrice,
      executedQuantity,
      timestamp: new Date().toISOString(),
      fees,
    };

    this.applyExecution(runtime, order, execution);
    runtime.openOrders.delete(order.id);
    this.log(
      strategyId,
      `Executed ${order.side.toUpperCase()} ${execution.executedQuantity} ${order.ticker} @ ${execution.executedPrice.toFixed(2)} (fees ${execution.fees.toFixed(2)})`,
    );

    return execution;
  }

  async cancelOrder(strategyId: string, orderId: string): Promise<void> {
    const runtime = this.getRuntime(strategyId);
    const order = runtime.openOrders.get(orderId);
    if (!order) {
      return;
    }
    order.cancelled = true;
    runtime.openOrders.set(orderId, order);
    this.log(strategyId, `Cancelled paper order ${orderId}`);
  }

  async processSignal(strategyId: string, signal: TradingSignal): Promise<void> {
    const runtime = this.getRuntime(strategyId);
    this.assertRunning(runtime, strategyId);

    if (signal.type === "entry") {
      const canEnter = await this.evaluateEntry(runtime.strategy, signal.ticker);
      if (!canEnter) {
        this.log(strategyId, `Entry signal ignored for ${signal.ticker} (reason: ${signal.reason})`);
        return;
      }

      const price = await this.resolveLatestPrice(signal.ticker);
      const equity = this.getEquity(strategyId);
      const quantity = this.calculatePositionSize(runtime.strategy, equity, price);
      if (quantity <= 0) {
        this.log(strategyId, `Entry signal ignored for ${signal.ticker} due to zero position size`);
        return;
      }

      await this.submitOrder(strategyId, {
        id: `paper-order-${randomUUID()}`,
        strategyId,
        ticker: signal.ticker,
        side: "buy",
        quantity,
        type: "market",
      });

      this.log(strategyId, `Paper trade alert: entered ${signal.ticker} (${signal.confidence.toFixed(2)} confidence)`);
      return;
    }

    const position = runtime.positions.get(signal.ticker);
    if (!position) {
      this.log(strategyId, `Exit signal ignored for ${signal.ticker}; no open position`);
      return;
    }

    const canExit = await this.evaluateExit(runtime.strategy, position);
    if (!canExit) {
      this.log(strategyId, `Exit conditions not met for ${signal.ticker}`);
      return;
    }

    await this.submitOrder(strategyId, {
      id: `paper-order-${randomUUID()}`,
      strategyId,
      ticker: signal.ticker,
      side: "sell",
      quantity: position.quantity,
      type: "market",
    });

    this.log(strategyId, `Paper trade alert: exited ${signal.ticker} (${signal.confidence.toFixed(2)} confidence)`);
  }

  async evaluateEntry(strategy: Strategy, ticker: string): Promise<boolean> {
    const runtime = this.runtimes.get(strategy.id);
    if (!runtime || runtime.status !== "running") {
      return false;
    }

    if (!this.isTickerInUniverse(strategy, ticker)) {
      return false;
    }

    if (runtime.positions.has(ticker)) {
      return false;
    }

    const maxOpenPositions = Math.min(strategy.riskParams.maxOpenPositions, this.defaultMaxPositions);
    if (runtime.positions.size >= maxOpenPositions) {
      return false;
    }

    const context = await this.getSignalContext(strategy, ticker);
    return this.evaluateRules(strategy.entryRules, strategy.signals, context);
  }

  async evaluateExit(strategy: Strategy, position: Position): Promise<boolean> {
    const context = await this.getSignalContext(strategy, position.ticker);
    const ruleTriggered = this.evaluateRules(strategy.exitRules, strategy.signals, context);
    if (ruleTriggered) {
      return true;
    }

    const currentPrice = context.latestCandle.close;
    const stopLoss = strategy.riskParams.stopLoss;
    if (stopLoss.type === "fixed_pct" && stopLoss.value !== undefined) {
      const stopPrice = position.entryPrice * (1 - stopLoss.value);
      if (currentPrice <= stopPrice) {
        return true;
      }
    }

    const takeProfit = strategy.riskParams.takeProfit;
    if (takeProfit?.type === "fixed_pct" && takeProfit.value !== undefined) {
      const targetPrice = position.entryPrice * (1 + takeProfit.value);
      if (currentPrice >= targetPrice) {
        return true;
      }
    }

    return false;
  }

  private getRuntime(strategyId: string): RuntimeState {
    const runtime = this.runtimes.get(strategyId);
    if (!runtime) {
      throw new Error(`Execution runtime not started for strategy ${strategyId}`);
    }
    return runtime;
  }

  private assertRunning(runtime: RuntimeState, strategyId: string): void {
    if (runtime.status !== "running") {
      throw new Error(`Strategy ${strategyId} is not running (status=${runtime.status})`);
    }
  }

  private async getSignalContext(strategy: Strategy, ticker: string): Promise<SignalContext> {
    const maxLookback = Math.max(60, ...strategy.signals.map((signal) => signal.lookback + 5));
    const candles = await this.taStore.getLatestCandles(ticker, maxLookback);
    const latestCandle = candles[candles.length - 1];
    if (!latestCandle) {
      throw new Error(`No market data available for ${ticker}`);
    }
    const previousCandle = candles.length > 1 ? candles[candles.length - 2] ?? null : null;

    const periods = this.collectIndicatorPeriods(strategy.signals);
    if (periods.length > 0) {
      try {
        await this.taStore.computeAndSaveIndicators(ticker, periods);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        console.warn(`Failed to compute indicators for ${ticker}: ${message}`);
      }
    }

    const from = new Date(Date.now() - 120 * DAY_MS);
    const to = new Date();
    const indicators = await this.taStore.getIndicators(ticker, from, to);
    const latestIndicator = indicators.length > 0 ? indicators[indicators.length - 1] ?? null : null;
    const previousIndicator = indicators.length > 1 ? indicators[indicators.length - 2] ?? null : null;

    return {
      latestCandle,
      previousCandle,
      latestIndicator,
      previousIndicator,
    };
  }

  private evaluateRules(rules: Rule[], signals: Signal[], context: SignalContext): boolean {
    if (rules.length === 0) {
      return false;
    }

    return rules.some((rule) => {
      const conditionResults = rule.conditions.map((condition) => this.evaluateRuleCondition(condition, signals, context));
      return this.combineRuleConditions(rule.conditions, conditionResults);
    });
  }

  private evaluateRuleCondition(condition: RuleCondition, signals: Signal[], context: SignalContext): boolean {
    const signal = signals.find((item) => item.id === condition.signalId);
    if (!signal) {
      return false;
    }

    const signalResult = this.evaluateSignal(signal, context, condition.conditionIndex);
    return condition.negate ? !signalResult : signalResult;
  }

  private evaluateSignal(signal: Signal, context: SignalContext, conditionIndex?: number): boolean {
    if (conditionIndex !== undefined) {
      const condition = signal.conditions[conditionIndex];
      if (!condition) {
        return false;
      }
      return this.evaluateSignalCondition(signal, condition, context);
    }

    const results = signal.conditions.map((condition) => this.evaluateSignalCondition(signal, condition, context));
    return this.combineSignalConditions(signal.conditions, results);
  }

  private evaluateSignalCondition(signal: Signal, condition: SignalCondition, context: SignalContext): boolean {
    const current = this.resolveSignalValue(signal, context, false);
    const previous = this.resolveSignalValue(signal, context, true);
    if (current === null) {
      return false;
    }

    switch (condition.operator) {
      case "gt":
        return current > condition.threshold;
      case "lt":
        return current < condition.threshold;
      case "gte":
        return current >= condition.threshold;
      case "lte":
        return current <= condition.threshold;
      case "eq":
        return current === condition.threshold;
      case "crosses_above":
        return previous !== null && previous <= condition.threshold && current > condition.threshold;
      case "crosses_below":
        return previous !== null && previous >= condition.threshold && current < condition.threshold;
      default:
        return false;
    }
  }

  private resolveSignalValue(signal: Signal, context: SignalContext, usePrevious: boolean): number | null {
    const candle = usePrevious ? context.previousCandle : context.latestCandle;
    const indicator = usePrevious ? context.previousIndicator : context.latestIndicator;
    if (!candle) {
      return null;
    }

    switch (signal.type) {
      case "rsi":
        return indicator?.rsi[signal.params.period] ?? null;
      case "sma": {
        const sma = indicator?.sma[signal.params.period];
        return sma !== undefined ? candle.close - sma : null;
      }
      case "ema": {
        const ema = indicator?.ema[signal.params.period];
        return ema !== undefined ? candle.close - ema : null;
      }
      case "atr":
        return indicator?.atr[signal.params.period] ?? null;
      case "macd":
        return indicator?.macd.macd ?? null;
      case "bollinger":
        return indicator ? candle.close - indicator.bollinger.middle : null;
      case "volume":
        return candle.volume;
      case "custom":
        return typeof signal.params.value === "number" ? signal.params.value : null;
      default:
        return null;
    }
  }

  private combineRuleConditions(conditions: RuleCondition[], results: boolean[]): boolean {
    const first = results[0];
    if (first === undefined) {
      return false;
    }

    let combined = first;
    for (let i = 1; i < results.length; i += 1) {
      const result = results[i] ?? false;
      const previous = conditions[i - 1];
      const join = previous?.combinedWith ?? "and";
      combined = join === "or" ? combined || result : combined && result;
    }
    return combined;
  }

  private combineSignalConditions(conditions: SignalCondition[], results: boolean[]): boolean {
    const first = results[0];
    if (first === undefined) {
      return false;
    }

    let combined = first;
    for (let i = 1; i < results.length; i += 1) {
      const result = results[i] ?? false;
      const previous = conditions[i - 1];
      const join = previous?.combinedWith ?? "and";
      combined = join === "or" ? combined || result : combined && result;
    }
    return combined;
  }

  private calculatePositionSize(strategy: Strategy, equity: number, price: number): number {
    const sizing = strategy.riskParams.positionSizing;
    const riskPerTrade = sizing.riskPerTradePct ?? 0.01;
    const maxPositionNotional = equity * sizing.maxPositionSizePct;

    let desiredNotional = maxPositionNotional;
    switch (sizing.method) {
      case "fixed_notional":
        desiredNotional = Math.min(maxPositionNotional, sizing.notionalPerTrade ?? maxPositionNotional);
        break;
      case "fixed_fractional":
        desiredNotional = Math.min(maxPositionNotional, equity * riskPerTrade);
        break;
      case "volatility_target": {
        const targetVol = Math.max(0.01, sizing.targetVolatilityPct ?? 0.1);
        desiredNotional = Math.min(maxPositionNotional, equity * Math.min(1, riskPerTrade / targetVol));
        break;
      }
      case "risk_parity":
        desiredNotional = Math.min(maxPositionNotional, equity * riskPerTrade);
        break;
      default:
        desiredNotional = Math.min(maxPositionNotional, equity * riskPerTrade);
        break;
    }

    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(desiredNotional) || desiredNotional <= 0) {
      return 0;
    }

    return Math.max(0, Math.floor(desiredNotional / price));
  }

  private applyExecution(runtime: RuntimeState, order: PaperOrder, execution: PaperExecution): void {
    const strategyId = order.strategyId;
    const position = runtime.positions.get(order.ticker);

    if (order.side === "buy") {
      const notional = execution.executedPrice * execution.executedQuantity;
      runtime.cash -= notional + execution.fees;

      if (!position) {
        runtime.positions.set(order.ticker, {
          id: `paper-pos-${randomUUID()}`,
          strategyId,
          ticker: order.ticker,
          side: "long",
          quantity: execution.executedQuantity,
          entryPrice: execution.executedPrice,
          entryDate: execution.timestamp,
          lastPrice: execution.executedPrice,
          unrealizedPnl: 0,
          entryFees: execution.fees,
        });
        return;
      }

      const totalQuantity = position.quantity + execution.executedQuantity;
      const weightedEntry = ((position.entryPrice * position.quantity) + (execution.executedPrice * execution.executedQuantity))
        / totalQuantity;
      position.quantity = totalQuantity;
      position.entryPrice = weightedEntry;
      position.lastPrice = execution.executedPrice;
      position.entryFees += execution.fees;
      position.unrealizedPnl = (position.lastPrice - position.entryPrice) * position.quantity;
      runtime.positions.set(order.ticker, position);
      return;
    }

    if (!position) {
      throw new Error(`Cannot execute sell for ${order.ticker}; no open paper position`);
    }

    const quantityToClose = Math.min(position.quantity, execution.executedQuantity);
    const grossProceeds = quantityToClose * execution.executedPrice;
    runtime.cash += grossProceeds - execution.fees;

    const perUnitEntryFee = position.quantity > 0 ? position.entryFees / position.quantity : 0;
    const allocatedEntryFee = perUnitEntryFee * quantityToClose;
    const netPnl = ((execution.executedPrice - position.entryPrice) * quantityToClose) - allocatedEntryFee - execution.fees;

    const closedTrade: PaperTrade = {
      id: `paper-trade-${randomUUID()}`,
      ticker: order.ticker,
      entry: position.entryPrice,
      exit: execution.executedPrice,
      pnl: netPnl,
      entryDate: position.entryDate,
      exitDate: execution.timestamp,
    };

    runtime.closedTrades.push(closedTrade);

    if (quantityToClose === position.quantity) {
      runtime.positions.delete(order.ticker);
      return;
    }

    position.quantity -= quantityToClose;
    position.entryFees = Math.max(0, position.entryFees - allocatedEntryFee);
    position.lastPrice = execution.executedPrice;
    position.unrealizedPnl = (position.lastPrice - position.entryPrice) * position.quantity;
    runtime.positions.set(order.ticker, position);
  }

  private resolveExecutionPrice(order: PaperOrder, marketPrice: number): number {
    if (order.type === "market") {
      return marketPrice;
    }

    if (order.price === undefined) {
      throw new Error(`Limit order ${order.id} requires a limit price`);
    }

    if (order.side === "buy") {
      return Math.min(order.price, marketPrice);
    }
    return Math.max(order.price, marketPrice);
  }

  private async resolveLatestPrice(ticker: string): Promise<number> {
    const candles = await this.taStore.getLatestCandles(ticker, 1);
    const latest = candles[candles.length - 1];
    if (!latest) {
      throw new Error(`No latest candle available for ticker ${ticker}`);
    }
    return latest.close;
  }

  private applySlippage(price: number, side: "buy" | "sell"): number {
    if (side === "buy") {
      return price * (1 + this.slippageRate);
    }
    return price * (1 - this.slippageRate);
  }

  private applyCommission(notional: number): number {
    return Math.abs(notional) * this.commissionRate;
  }

  private collectIndicatorPeriods(signals: Signal[]): number[] {
    const periods: number[] = [];
    for (const signal of signals) {
      switch (signal.type) {
        case "rsi":
        case "sma":
        case "ema":
        case "atr":
        case "bollinger":
          periods.push(signal.params.period);
          break;
        case "macd":
          periods.push(signal.params.fastPeriod, signal.params.slowPeriod, signal.params.signalPeriod);
          break;
        default:
          break;
      }
    }
    return [...new Set(periods)].filter((period) => Number.isFinite(period) && period > 0).sort((a, b) => a - b);
  }

  private isTickerInUniverse(strategy: Strategy, ticker: string): boolean {
    if (strategy.universe.mode !== "custom_tickers") {
      return true;
    }
    return strategy.universe.tickers.includes(ticker);
  }

  private randomDelay(): number {
    const span = this.maxExecutionDelayMs - this.minExecutionDelayMs;
    if (span <= 0) {
      return this.minExecutionDelayMs;
    }
    return this.minExecutionDelayMs + Math.floor(Math.random() * (span + 1));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private log(strategyId: string, message: string): void {
    const runtime = this.runtimes.get(strategyId);
    const line = `[paper][${strategyId}] ${new Date().toISOString()} ${message}`;
    if (runtime) {
      runtime.logs.push(line);
      if (runtime.logs.length > 1_000) {
        runtime.logs.shift();
      }
    }
    console.info(line);
  }

  private getEnvNumber(name: string, defaultValue: number): number {
    const raw = process.env[name];
    if (raw === undefined) {
      return defaultValue;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }

  private getEnvBps(name: string, defaultBps: number): number {
    return this.getEnvNumber(name, defaultBps) / 10_000;
  }
}

import { randomUUID } from "node:crypto";
import type { Strategy, Rule } from "./dsl/strategy-schema.js";
import type { Signal, SignalCondition } from "./dsl/signal-definitions.js";
import { TimescaleTechnicalStore, type OHLCV, type IndicatorSnapshot } from "./ta-store.js";
import type { DailyCandle } from "../../mit-types.js";
import { sma, ema, rsi, macd, atr } from "../mit/technical-indicators.js";

export interface BacktestConfig {
  startDate: string;
  endDate: string;
  initialCapital: number;
  commissionRate: number;
  slippageRate: number;
  maxPositionSize: number;
  riskPerTrade: number;
  allowMultiplePositions: boolean;
  regime?: string;
}

export interface BacktestTrade {
  id: string;
  ticker: string;
  side: "buy" | "sell";
  entryPrice: number;
  exitPrice: number;
  entryDate: string;
  exitDate: string;
  quantity: number;
  pnl: number;
  pnlPct: number;
  fees: number;
}

export interface BacktestEquityPoint {
  date: string;
  equity: number;
  drawdown: number;
  positions: number;
  cash: number;
}

export interface BacktestMetrics {
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownDuration: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  avgTradeDuration: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  turnover: number;
  volatility: number;
  beta: number;
  var95: number;
  cvar95: number;
  calmarRatio: number;
}

export interface BacktestResult {
  runId: string;
  strategyId: string;
  ticker: string;
  startDate: string;
  endDate: string;
  config: BacktestConfig;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
  dailyReturns: number[];
  monthlyReturns: Record<string, number>;
  regime?: string;
}

export interface MonteCarloResult {
  runId: string;
  strategyId: string;
  ticker: string;
  numSimulations: number;
  metrics: {
    meanReturn: number;
    stdDevReturn: number;
    percentile5: number;
    percentile25: number;
    percentile50: number;
    percentile75: number;
    percentile95: number;
    probabilityOfLoss: number;
    probabilityOfTarget: number;
  };
  distribution: number[];
}

const TRADING_DAYS_PER_YEAR = 252;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type HistoricalContext = {
  candle: OHLCV;
  previousCandle: OHLCV | null;
  indicators: IndicatorSnapshot | null;
  previousIndicators: IndicatorSnapshot | null;
  lookbackCandles: OHLCV[];
};

export class HistoricalBacktester {
  private readonly taStore: TimescaleTechnicalStore;
  private config: BacktestConfig;

  constructor(taStore: TimescaleTechnicalStore, config: Partial<BacktestConfig> = {}) {
    this.taStore = taStore;
    this.config = {
      startDate: config.startDate ?? new Date(Date.now() - 365 * MS_PER_DAY).toISOString(),
      endDate: config.endDate ?? new Date().toISOString(),
      initialCapital: config.initialCapital ?? 1_000_000,
      commissionRate: config.commissionRate ?? 0.0005,
      slippageRate: config.slippageRate ?? 0.0005,
      maxPositionSize: config.maxPositionSize ?? 0.2,
      riskPerTrade: config.riskPerTrade ?? 0.02,
      allowMultiplePositions: config.allowMultiplePositions ?? true,
      regime: config.regime ?? "",
    };
  }

  async run(strategy: Strategy, ticker: string): Promise<BacktestResult> {
    const symbol = ticker.toUpperCase();
    
    const candles = await this.taStore.getCandles(
      symbol,
      new Date(this.config.startDate),
      new Date(this.config.endDate)
    );

    if (candles.length < 30) {
      throw new Error(`Insufficient historical data for ${symbol}. Need at least 30 days, got ${candles.length}`);
    }

    const tradingTickers = this.resolveTradingTickers(strategy, symbol);
    
    const indicatorsByTicker = new Map<string, IndicatorSnapshot[]>();
    for (const t of tradingTickers) {
      const tCandles = await this.taStore.getCandles(
        t,
        new Date(this.config.startDate),
        new Date(this.config.endDate)
      );
      if (tCandles.length >= 30) {
        indicatorsByTicker.set(t, this.computeIndicatorsForCandles(tCandles));
      }
    }

    const result = this.simulate(strategy, tradingTickers, candles, indicatorsByTicker);
    
    return {
      ...result,
      runId: `bt-${strategy.id}-${symbol}-${Date.now()}`,
      strategyId: strategy.id,
      ticker: symbol,
      startDate: this.config.startDate,
      endDate: this.config.endDate,
      config: { 
        ...this.config,
        regime: this.config.regime ?? "" 
      },
    };
  }

  async runUniverse(strategy: Strategy): Promise<BacktestResult[]> {
    const results: BacktestResult[] = [];
    
    if (strategy.universe.mode !== "custom_tickers" || strategy.universe.tickers.length === 0) {
      throw new Error("Strategy must have custom_tickers universe with at least one ticker");
    }

    for (const ticker of strategy.universe.tickers) {
      try {
        const result = await this.run(strategy, ticker);
        results.push(result);
      } catch (error) {
        console.warn(`Skipping ${ticker}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return results;
  }

  async runWalkForward(
    strategy: Strategy,
    ticker: string,
    trainDays: number = 252,
    testDays: number = 63,
    stepDays: number = 21
  ): Promise<BacktestResult[]> {
    const symbol = ticker.toUpperCase();
    const allCandles = await this.taStore.getCandles(
      symbol,
      new Date(this.config.startDate),
      new Date(this.config.endDate)
    );

    if (allCandles.length < trainDays + testDays) {
      throw new Error(`Insufficient data for walk-forward. Need ${trainDays + testDays} days, got ${allCandles.length}`);
    }

    const results: BacktestResult[] = [];
    const totalDays = allCandles.length;
    
    for (let testStart = trainDays; testStart + testDays <= totalDays; testStart += stepDays) {
      const testEnd = Math.min(testStart + testDays - 1, totalDays - 1);
      const testCandles = allCandles.slice(testStart, testEnd + 1);

      if (testCandles.length === 0) continue;

      const indicators = this.computeIndicatorsForCandles(allCandles.slice(0, testEnd + 1));
      const indicatorsByTicker = new Map<string, IndicatorSnapshot[]>([[symbol, indicators]]);

      const windowConfig: BacktestConfig = {
        ...this.config,
        startDate: testCandles[0]?.timestamp.toISOString() ?? this.config.startDate,
        endDate: testCandles[testCandles.length - 1]?.timestamp.toISOString() ?? this.config.endDate,
      };

      const originalConfig = this.config;
      this.config = windowConfig;

      try {
        const result = this.simulate(strategy, [symbol], testCandles, indicatorsByTicker);
        results.push({
          ...result,
          runId: `wf-${strategy.id}-${symbol}-${testStart}-${testEnd}`,
          strategyId: strategy.id,
          ticker: symbol,
          startDate: windowConfig.startDate,
          endDate: windowConfig.endDate,
          config: windowConfig,
        });
      } finally {
        this.config = originalConfig;
      }
    }

    return results;
  }

  async runMonteCarlo(
    strategy: Strategy,
    ticker: string,
    numSimulations: number = 1000,
    initialCapital?: number
  ): Promise<MonteCarloResult> {
    const result = await this.run(strategy, ticker);
    const dailyReturns = result.dailyReturns;

    if (dailyReturns.length < 30) {
      throw new Error("Need at least 30 days of returns for Monte Carlo");
    }

    const capital = initialCapital ?? this.config.initialCapital;
    const simulations: number[] = [];

    for (let sim = 0; sim < numSimulations; sim++) {
      const sampledReturns = this.bootstrapSample(dailyReturns, dailyReturns.length);
      let equity = capital;
      
      for (const ret of sampledReturns) {
        equity *= (1 + ret);
      }
      simulations.push(equity);
    }

    simulations.sort((a, b) => a - b);
    
    const returns = simulations.map(s => (s - capital) / capital);
    const meanReturn = this.mean(returns);
    const stdDevReturn = this.stdDev(returns);

    return {
      runId: `mc-${strategy.id}-${ticker}-${Date.now()}`,
      strategyId: strategy.id,
      ticker,
      numSimulations,
      metrics: {
        meanReturn,
        stdDevReturn,
        percentile5: this.percentile(returns, 5),
        percentile25: this.percentile(returns, 25),
        percentile50: this.percentile(returns, 50),
        percentile75: this.percentile(returns, 75),
        percentile95: this.percentile(returns, 95),
        probabilityOfLoss: returns.filter(r => r < 0).length / returns.length,
        probabilityOfTarget: returns.filter(r => r >= 0.10).length / returns.length,
      },
      distribution: returns,
    };
  }

  async runBatch(
    strategies: Strategy[],
    tickers?: string[]
  ): Promise<Map<string, BacktestResult>> {
    const results = new Map<string, BacktestResult>();

    const tasks: Array<{ strategy: Strategy; ticker: string }> = [];
    
    for (const strategy of strategies) {
      if (tickers && tickers.length > 0) {
        for (const t of tickers) {
          tasks.push({ strategy, ticker: t });
        }
      } else if (strategy.universe.mode === "custom_tickers" && strategy.universe.tickers.length > 0) {
        for (const t of strategy.universe.tickers) {
          tasks.push({ strategy, ticker: t });
        }
      } else {
        tasks.push({ strategy, ticker: "SANDBOX" });
      }
    }

    const concurrency = 4;
    for (let i = 0; i < tasks.length; i += concurrency) {
      const batch = tasks.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async ({ strategy, ticker }) => {
          try {
            return await this.run(strategy, ticker);
          } catch (error) {
            console.warn(`Backtest failed for ${strategy.id}/${ticker}: ${error instanceof Error ? error.message : error}`);
            return null;
          }
        })
      );

      for (let j = 0; j < batch.length; j++) {
        const result = batchResults[j];
        const task = batch[j];
        if (result && task) {
          results.set(`${task.strategy.id}:${task.ticker}`, result);
        }
      }
    }

    return results;
  }

  private resolveTradingTickers(strategy: Strategy, defaultTicker: string): string[] {
    if (strategy.universe.mode === "custom_tickers" && strategy.universe.tickers.length > 0) {
      return strategy.universe.tickers.map(t => t.toUpperCase());
    }
    return [defaultTicker];
  }

  private simulate(
    strategy: Strategy,
    tickers: string[],
    candles: OHLCV[],
    indicatorsByTicker: Map<string, IndicatorSnapshot[]>
  ): Omit<BacktestResult, "runId" | "strategyId" | "ticker" | "startDate" | "endDate" | "config"> {
    const trades: BacktestTrade[] = [];
    const equityCurve: BacktestEquityPoint[] = [];
    
    let cash = this.config.initialCapital;
    const positions = new Map<string, { quantity: number; entryPrice: number; entryDate: string }>();
    let peakEquity = this.config.initialCapital;

    const dailyReturns: number[] = [];
    const monthlyReturns: Record<string, number> = {};
    let currentMonth = "";

    const maxLookback = this.getMaxLookback(strategy);

    for (let i = maxLookback; i < candles.length; i++) {
      const currentCandle = candles[i];
      if (!currentCandle) continue;
      
      const dateStr = currentCandle.timestamp.toISOString().slice(0, 10);
      
      const monthKey = dateStr.slice(0, 7);
      if (monthKey !== currentMonth) {
        if (currentMonth && equityCurve.length > 0) {
          const monthStartEquity = equityCurve.find(e => e.date.slice(0, 7) === currentMonth)?.equity 
            ?? this.config.initialCapital;
          const monthEndEquity = equityCurve[equityCurve.length - 1]?.equity ?? monthStartEquity;
          monthlyReturns[currentMonth] = (monthEndEquity - monthStartEquity) / monthStartEquity;
        }
        currentMonth = monthKey;
      }

      const lookbackCandles = candles.slice(Math.max(0, i - maxLookback), i);
      const historicalContext = this.buildContext(
        tickers, 
        candles, 
        indicatorsByTicker, 
        i, 
        lookbackCandles
      );

      for (const [ticker, position] of positions) {
        const shouldExit = this.evaluateRules(
          strategy.exitRules,
          strategy.signals,
          historicalContext.get(ticker) ?? null
        );

        const context = historicalContext.get(ticker);
        const exitReasons: string[] = [];
        
        if (shouldExit) {
          exitReasons.push("rule");
        }
        
        if (strategy.riskParams.stopLoss?.type === "fixed_pct" && strategy.riskParams.stopLoss.value) {
          const stopLossPct = strategy.riskParams.stopLoss.value;
          const loss = (currentCandle.close - position.entryPrice) / position.entryPrice;
          if (loss <= -stopLossPct) {
            exitReasons.push("stop_loss");
          }
        }

        if (strategy.riskParams.takeProfit?.type === "fixed_pct" && strategy.riskParams.takeProfit.value) {
          const takeProfitPct = strategy.riskParams.takeProfit.value;
          const gain = (currentCandle.close - position.entryPrice) / position.entryPrice;
          if (gain >= takeProfitPct) {
            exitReasons.push("take_profit");
          }
        }

        if (exitReasons.length > 0) {
          const exitPrice = this.applySlippage(currentCandle.close, "sell");
          const fees = this.applyCommission(exitPrice * position.quantity);
          const grossProceeds = exitPrice * position.quantity - fees;
          const costBasis = position.quantity * position.entryPrice;
          const pnl = grossProceeds - costBasis;

          trades.push({
            id: `trade-${trades.length + 1}`,
            ticker,
            side: "sell",
            entryPrice: position.entryPrice,
            exitPrice,
            entryDate: position.entryDate,
            exitDate: dateStr,
            quantity: position.quantity,
            pnl,
            pnlPct: pnl / costBasis,
            fees,
          });

          cash += grossProceeds;
          positions.delete(ticker);
        }
      }

      if (this.config.allowMultiplePositions || positions.size === 0) {
        const maxPositions = strategy.riskParams.maxOpenPositions ?? 10;
        
        for (const ticker of tickers) {
          if (positions.size >= maxPositions) break;
          if (positions.has(ticker)) continue;

          const context = historicalContext.get(ticker);
          if (!context) continue;

          const shouldEnter = this.evaluateRules(
            strategy.entryRules,
            strategy.signals,
            context
          );

          if (shouldEnter) {
            const maxNotional = cash * this.config.maxPositionSize;
            const entryPrice = this.applySlippage(currentCandle.close, "buy");
            const riskAdjustedSize = this.calculatePositionSize(
              cash,
              entryPrice,
              strategy.riskParams.stopLoss?.value ?? 0.05
            );
            const quantity = Math.min(
              Math.floor(maxNotional / entryPrice),
              riskAdjustedSize
            );

            if (quantity > 0) {
              const fees = this.applyCommission(entryPrice * quantity);
              cash -= (entryPrice * quantity) + fees;

              positions.set(ticker, {
                quantity,
                entryPrice,
                entryDate: dateStr,
              });
            }
          }
        }
      }

      let positionValue = 0;
      for (const [ticker, position] of positions) {
        const tCandle = candles.find(c => c.ticker === ticker && c.timestamp.getTime() === currentCandle.timestamp.getTime())
          ?? currentCandle;
        positionValue += position.quantity * tCandle.close;
      }

      const equity = cash + positionValue;
      peakEquity = Math.max(peakEquity, equity);
      const drawdown = equity / peakEquity - 1;

      equityCurve.push({
        date: dateStr,
        equity,
        drawdown,
        positions: positions.size,
        cash,
      });

      if (equityCurve.length > 1) {
        const prevPoint = equityCurve[equityCurve.length - 2];
        const prevEquity = prevPoint?.equity ?? this.config.initialCapital;
        if (prevEquity > 0) {
          dailyReturns.push((equity - prevEquity) / prevEquity);
        }
      }
    }

    const lastCandle = candles[candles.length - 1];
    if (lastCandle) {
      const lastDate = lastCandle.timestamp.toISOString().slice(0, 10);

      for (const [ticker, position] of positions) {
        const exitPrice = this.applySlippage(lastCandle.close, "sell");
        const fees = this.applyCommission(exitPrice * position.quantity);
        const grossProceeds = exitPrice * position.quantity - fees;
        const costBasis = position.quantity * position.entryPrice;
        const pnl = grossProceeds - costBasis;

        trades.push({
          id: `trade-${trades.length + 1}`,
          ticker,
          side: "sell",
          entryPrice: position.entryPrice,
          exitPrice,
          entryDate: position.entryDate,
          exitDate: lastDate,
          quantity: position.quantity,
          pnl,
          pnlPct: pnl / costBasis,
          fees,
        });
      }
    }

    const metrics = this.computeMetrics(trades, equityCurve, dailyReturns, monthlyReturns);

    return {
      metrics,
      trades,
      equityCurve,
      dailyReturns,
      monthlyReturns,
    };
  }

  private buildContext(
    tickers: string[],
    allCandles: OHLCV[],
    indicatorsByTicker: Map<string, IndicatorSnapshot[]>,
    currentIndex: number,
    lookbackCandles: OHLCV[]
  ): Map<string, HistoricalContext> {
    const context = new Map<string, HistoricalContext>();
    const currentCandle = allCandles[currentIndex];
    const previousCandle = currentIndex > 0 ? allCandles[currentIndex - 1] : null;

    if (!currentCandle) return context;

    for (const ticker of tickers) {
      const tickerCandles = allCandles.filter(c => c.ticker === ticker);
      const tickerCurrentIdx = tickerCandles.findIndex(c => c.timestamp.getTime() === currentCandle.timestamp.getTime());
      const tickerCurrent = tickerCandles[tickerCurrentIdx] ?? currentCandle;
      const tickerPrevious = tickerCurrentIdx > 0 ? tickerCandles[tickerCurrentIdx - 1] : previousCandle;

      const indicators = indicatorsByTicker.get(ticker);
      const currentTs = tickerCurrent.timestamp.getTime();
      
      let currentIndicators: IndicatorSnapshot | null = null;
      let previousIndicators: IndicatorSnapshot | null = null;

      if (indicators) {
        for (let i = indicators.length - 1; i >= 0; i--) {
          const ind = indicators[i];
          if (ind && ind.timestamp.getTime() <= currentTs) {
            currentIndicators = ind;
            previousIndicators = i > 0 ? (indicators[i - 1] ?? null) : null;
            break;
          }
        }
      }

      if (!currentIndicators && lookbackCandles.length > 0) {
        const tickerLookback = lookbackCandles.filter(c => c.ticker === ticker);
        currentIndicators = this.computeIndicatorsSingle(tickerLookback.concat(tickerCurrent));
        previousIndicators = tickerLookback.length > 1 
          ? this.computeIndicatorsSingle(tickerLookback.slice(0, -1))
          : null;
      }

      context.set(ticker, {
        candle: tickerCurrent,
        previousCandle: tickerPrevious ?? null,
        indicators: currentIndicators,
        previousIndicators,
        lookbackCandles,
      });
    }

    return context;
  }

  private computeIndicatorsForCandles(candles: OHLCV[]): IndicatorSnapshot[] {
    const indicators: IndicatorSnapshot[] = [];
    const tickerGroups = new Map<string, OHLCV[]>();

    for (const candle of candles) {
      const existing = tickerGroups.get(candle.ticker) ?? [];
      existing.push(candle);
      tickerGroups.set(candle.ticker, existing);
    }

    for (const [ticker, tCandles] of tickerGroups) {
      tCandles.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      for (let i = 20; i < tCandles.length; i++) {
        const slice = tCandles.slice(0, i + 1);
        const indicator = this.computeIndicatorsSingle(slice);
        indicator.ticker = ticker;
        indicators.push(indicator);
      }
    }

    return indicators.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  private computeIndicatorsSingle(candles: OHLCV[]): IndicatorSnapshot {
    const closes = candles.map(c => c.close);

    const latest = candles[candles.length - 1];
    if (!latest) {
      throw new Error("No candles provided");
    }

    return {
      ticker: latest.ticker,
      timestamp: latest.timestamp,
      sma: {
        20: sma(toDailyCandles(candles), 20) ?? 0,
        50: sma(toDailyCandles(candles), 50) ?? 0,
        200: sma(toDailyCandles(candles), 200) ?? 0,
      },
      ema: {
        12: ema(toDailyCandles(candles), 12) ?? 0,
        26: ema(toDailyCandles(candles), 26) ?? 0,
      },
      rsi: {
        14: rsi(toDailyCandles(candles), 14) ?? 50,
      },
      macd: macd(closes, 12, 26, 9) ?? { macd: 0, signal: 0, histogram: 0 },
      atr: {
        14: atr(toDailyCandles(candles), 14) ?? 0,
      },
      bollinger: computeBollinger(closes, 20, 2),
    };
  }

  private getMaxLookback(strategy: Strategy): number {
    let maxLookback = 30;
    
    for (const signal of strategy.signals) {
      if ('lookback' in signal && typeof signal.lookback === 'number') {
        maxLookback = Math.max(maxLookback, signal.lookback + 5);
      }
      if ('params' in signal && signal.params) {
        if ('period' in signal.params && typeof signal.params.period === 'number') {
          maxLookback = Math.max(maxLookback, signal.params.period + 10);
        }
        if ('slowPeriod' in signal.params && typeof signal.params.slowPeriod === 'number') {
          maxLookback = Math.max(maxLookback, signal.params.slowPeriod + 10);
        }
      }
    }

    return maxLookback;
  }

  private evaluateRules(rules: Rule[], signals: Signal[], context: HistoricalContext | null): boolean {
    if (!context || rules.length === 0) {
      return false;
    }

    return rules.some((rule) => {
      const conditionResults = rule.conditions.map((condition) => 
        this.evaluateRuleCondition(
          { signalId: condition.signalId, conditionIndex: condition.conditionIndex, negate: condition.negate ?? false, combinedWith: condition.combinedWith ?? "and" },
          signals,
          context
        )
      );
      return this.combineConditions(rule.conditions, conditionResults);
    });
  }

  private evaluateRuleCondition(
    condition: { signalId: string; conditionIndex?: number | undefined; negate?: boolean | undefined; combinedWith?: string | undefined },
    signals: Signal[],
    context: HistoricalContext
  ): boolean {
    const signal = signals.find(s => s.id === condition.signalId);
    if (!signal) return false;

    const idx = condition.conditionIndex;
    const result = this.evaluateSignal(signal, context, idx);
    return condition.negate ? !result : result;
  }

  private evaluateSignal(
    signal: Signal,
    context: HistoricalContext,
    conditionIndex?: number
  ): boolean {
    const { candle, indicators, previousIndicators } = context;
    if (!indicators) return false;

    const currentValue = this.resolveSignalValue(signal, candle, indicators);
    const previousValue = previousIndicators 
      ? this.resolveSignalValue(signal, candle, previousIndicators)
      : null;

    const conditions = signal.conditions;
    let toEvaluate: SignalCondition[] = [];
    
    if (conditionIndex !== undefined && conditionIndex < conditions.length) {
      const cond = conditions[conditionIndex];
      if (cond) toEvaluate = [cond];
    } else {
      toEvaluate = conditions;
    }

    const results = toEvaluate.map(condition => 
      this.evaluateCondition(condition, currentValue, previousValue)
    );

    return this.combineSignalConditions(conditions, results);
  }

  private resolveSignalValue(signal: Signal, candle: OHLCV, indicators: IndicatorSnapshot): number | null {
    switch (signal.type) {
      case "rsi": {
        const period = signal.params.period ?? 14;
        return indicators.rsi[period] ?? null;
      }
      case "sma": {
        const period = signal.params.period ?? 20;
        const smaValue = indicators.sma[period];
        if (smaValue === undefined || smaValue === null) return null;
        return candle.close - smaValue;
      }
      case "ema": {
        const period = signal.params.period ?? 12;
        const emaValue = indicators.ema[period];
        if (emaValue === undefined || emaValue === null) return null;
        return candle.close - emaValue;
      }
      case "atr": {
        const period = signal.params.period ?? 14;
        return indicators.atr[period] ?? null;
      }
      case "macd": {
        return indicators.macd.macd;
      }
      case "bollinger": {
        const bb = indicators.bollinger;
        if (!bb || bb.middle === 0) return null;
        return candle.close - bb.middle;
      }
      case "volume": {
        return candle.volume;
      }
      case "custom": {
        return typeof signal.params.value === 'number' ? signal.params.value : null;
      }
      default:
        return null;
    }
  }

  private evaluateCondition(
    condition: SignalCondition,
    current: number | null,
    previous: number | null
  ): boolean {
    if (current === null) return false;

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

  private combineConditions(conditions: { combinedWith?: string | undefined }[], results: boolean[]): boolean {
    if (results.length === 0) return false;
    
    let combined = results[0] ?? false;
    for (let i = 1; i < results.length; i++) {
      const join = conditions[i - 1]?.combinedWith ?? "and";
      const resultVal = results[i] ?? false;
      combined = join === "or" ? combined || resultVal : combined && resultVal;
    }
    return combined;
  }

  private combineSignalConditions(conditions: SignalCondition[], results: boolean[]): boolean {
    if (results.length === 0) return false;
    
    let combined = results[0] ?? false;
    for (let i = 1; i < results.length; i++) {
      const join = conditions[i - 1]?.combinedWith ?? "and";
      const resultVal = results[i] ?? false;
      combined = join === "or" ? combined || resultVal : combined && resultVal;
    }
    return combined;
  }

  private calculatePositionSize(cash: number, price: number, stopLossPct: number): number {
    if (stopLossPct <= 0 || !Number.isFinite(stopLossPct)) {
      return Math.floor((cash * this.config.maxPositionSize) / price);
    }

    const riskAmount = cash * this.config.riskPerTrade;
    const riskPerShare = price * stopLossPct;
    
    if (riskPerShare <= 0) {
      return Math.floor((cash * this.config.maxPositionSize) / price);
    }

    return Math.floor(riskAmount / riskPerShare);
  }

  private applySlippage(price: number, side: "buy" | "sell"): number {
    if (side === "buy") {
      return price * (1 + this.config.slippageRate);
    }
    return price * (1 - this.config.slippageRate);
  }

  private applyCommission(notional: number): number {
    return notional * this.config.commissionRate;
  }

  private computeMetrics(
    trades: BacktestTrade[],
    equityCurve: BacktestEquityPoint[],
    dailyReturns: number[],
    monthlyReturns: Record<string, number>
  ): BacktestMetrics {
    if (equityCurve.length === 0) {
      return this.emptyMetrics();
    }

    const startEquityPoint = equityCurve[0];
    const endEquityPoint = equityCurve[equityCurve.length - 1];
    if (!startEquityPoint || !endEquityPoint) {
      return this.emptyMetrics();
    }

    const startEquity = startEquityPoint.equity;
    const endEquity = endEquityPoint.equity;
    const totalReturn = startEquity > 0 ? (endEquity - startEquity) / startEquity : 0;

    const days = equityCurve.length;
    const annualizedReturn = Math.pow(1 + totalReturn, TRADING_DAYS_PER_YEAR / days) - 1;

    const meanDailyReturn = this.mean(dailyReturns);
    const stdDailyReturn = this.stdDev(dailyReturns);
    const sharpeRatio = stdDailyReturn > 0 
      ? (meanDailyReturn / stdDailyReturn) * Math.sqrt(TRADING_DAYS_PER_YEAR)
      : 0;

    const negativeReturns = dailyReturns.filter(r => r < 0);
    const downsideDeviation = negativeReturns.length > 0 
      ? Math.sqrt(negativeReturns.reduce((sum, r) => sum + r * r, 0) / negativeReturns.length)
      : 0;
    const sortinoRatio = downsideDeviation > 0 
      ? (meanDailyReturn / downsideDeviation) * Math.sqrt(TRADING_DAYS_PER_YEAR)
      : 0;

    let maxDrawdown = 0;
    let maxDrawdownDuration = 0;
    let currentDrawdownDuration = 0;
    
    for (const point of equityCurve) {
      if (point.drawdown < maxDrawdown) {
        maxDrawdown = point.drawdown;
      }
      if (point.drawdown < -0.01) {
        currentDrawdownDuration++;
        maxDrawdownDuration = Math.max(maxDrawdownDuration, currentDrawdownDuration);
      } else {
        currentDrawdownDuration = 0;
      }
    }

    const winningTrades = trades.filter(t => t.pnl > 0);
    const losingTrades = trades.filter(t => t.pnl < 0);
    const winRate = trades.length > 0 ? winningTrades.length / trades.length : 0;

    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    const avgWin = winningTrades.length > 0 
      ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length 
      : 0;
    const avgLoss = losingTrades.length > 0 
      ? losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length 
      : 0;

    const largestWin = winningTrades.length > 0 
      ? Math.max(...winningTrades.map(t => t.pnl)) 
      : 0;
    const largestLoss = losingTrades.length > 0 
      ? Math.min(...losingTrades.map(t => t.pnl)) 
      : 0;

    let avgTradeDuration = 0;
    if (trades.length > 0) {
      const durations = trades.map(t => {
        const entry = new Date(t.entryDate).getTime();
        const exit = new Date(t.exitDate).getTime();
        return (exit - entry) / MS_PER_DAY;
      });
      avgTradeDuration = this.mean(durations);
    }

    const totalNotional = trades.reduce((sum, t) => sum + t.entryPrice * t.quantity + t.exitPrice * t.quantity, 0);
    const avgEquity = equityCurve.reduce((sum, p) => sum + p.equity, 0) / equityCurve.length;
    const turnover = avgEquity > 0 ? totalNotional / avgEquity : 0;

    const volatility = stdDailyReturn * Math.sqrt(TRADING_DAYS_PER_YEAR);

    const sortedReturns = [...dailyReturns].sort((a, b) => a - b);
    const varIndex = Math.floor(sortedReturns.length * 0.05);
    const var95 = Math.abs(sortedReturns[varIndex] ?? 0);
    const cvar95 = sortedReturns.slice(0, varIndex + 1).length > 0
      ? Math.abs(sortedReturns.slice(0, varIndex + 1).reduce((sum, r) => sum + r, 0) / (varIndex + 1))
      : 0;

    const calmarRatio = Math.abs(maxDrawdown) > 0 ? annualizedReturn / Math.abs(maxDrawdown) : 0;

    return {
      totalReturn,
      annualizedReturn,
      sharpeRatio,
      sortinoRatio,
      maxDrawdown,
      maxDrawdownDuration,
      winRate,
      profitFactor,
      totalTrades: trades.length,
      avgTradeDuration,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      turnover,
      volatility,
      beta: 0,
      var95,
      cvar95,
      calmarRatio,
    };
  }

  private emptyMetrics(): BacktestMetrics {
    return {
      totalReturn: 0,
      annualizedReturn: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: 0,
      maxDrawdownDuration: 0,
      winRate: 0,
      profitFactor: 0,
      totalTrades: 0,
      avgTradeDuration: 0,
      avgWin: 0,
      avgLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      turnover: 0,
      volatility: 0,
      beta: 0,
      var95: 0,
      cvar95: 0,
      calmarRatio: 0,
    };
  }

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private stdDev(values: number[]): number {
    if (values.length < 2) return 0;
    const m = this.mean(values);
    const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)] ?? 0;
  }

  private bootstrapSample<T>(array: T[], size: number): T[] {
    const result: T[] = [];
    for (let i = 0; i < size; i++) {
      const element = array[Math.floor(Math.random() * array.length)];
      result.push(element as T);
    }
    return result;
  }
}

function toDailyCandles(candles: OHLCV[]): DailyCandle[] {
  return candles.map(c => ({
    date: c.timestamp.toISOString().slice(0, 10),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

function computeBollinger(closes: number[], period: number, stdDevMultiplier: number) {
  if (closes.length < period) {
    return { upper: 0, middle: 0, lower: 0 };
  }

  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: middle + stdDev * stdDevMultiplier,
    middle,
    lower: middle - stdDev * stdDevMultiplier,
  };
}

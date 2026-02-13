import type { Strategy } from "./dsl/strategy-schema.js";

export interface SimulationConfig {
  startDate: string;
  endDate: string;
  initialCapital: number;
  commissionRate: number;
  slippageRate: number;
  regime?: string;
  walkForwardWindows?: Array<{
    startDate: string;
    endDate: string;
  }>;
}

export interface Trade {
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
}

export interface EquityPoint {
  date: string;
  equity: number;
  drawdown: number;
}

export interface Position {
  ticker: string;
  quantity: number;
  entryPrice: number;
  entryDate: string;
}

export interface PerformanceMetrics {
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  turnover: number;
  volatility: number;
  beta: number;
  var95: number;
}

export interface SimulationResult extends PerformanceMetrics {
  runId: string;
  strategyId: string;
  startDate: string;
  endDate: string;
  trades: Trade[];
  equityCurve: EquityPoint[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TRADING_DAYS_PER_YEAR = 252;

export class Simulator {
  private readonly config: SimulationConfig;

  constructor(config: SimulationConfig) {
    if (new Date(config.endDate).getTime() < new Date(config.startDate).getTime()) {
      throw new Error("Simulation endDate must be >= startDate");
    }
    if (config.initialCapital <= 0) {
      throw new Error("Simulation initialCapital must be > 0");
    }
    this.config = { ...config };
  }

  async run(strategy: Strategy): Promise<SimulationResult> {
    const ticker = strategy.universe.mode === "custom_tickers" && strategy.universe.tickers.length > 0
      ? (strategy.universe.tickers[0] ?? "SANDBOX")
      : "SANDBOX";

    const dates = this.getDateRange(this.config.startDate, this.config.endDate);
    const prices = dates.map((_, index) => this.syntheticPrice(strategy.id, index));

    const trades: Trade[] = [];
    const equityCurve: EquityPoint[] = [];
    let position: Position | null = null;
    let cash = this.config.initialCapital;
    let peakEquity = this.config.initialCapital;

    for (let i = 0; i < dates.length; i += 1) {
      const currentDate = dates[i];
      const currentPrice = prices[i];
      if (!currentDate || currentPrice === undefined) {
        continue;
      }

      if (!position && this.shouldEnter(strategy, i)) {
        const allocatableCash = cash * 0.2;
        const entryPrice = this.applySlippage(currentPrice, "buy");
        const quantity = Math.floor(allocatableCash / entryPrice);
        if (quantity > 0) {
          const grossCost = quantity * entryPrice;
          const fee = this.applyCommission(grossCost);
          cash -= grossCost + fee;
          position = {
            ticker,
            quantity,
            entryPrice,
            entryDate: currentDate,
          };
        }
      }

      if (position && (this.shouldExit(strategy, i) || i === dates.length - 1)) {
        const exitPrice = this.applySlippage(currentPrice, "sell");
        const grossProceeds = position.quantity * exitPrice;
        const fee = this.applyCommission(grossProceeds);
        cash += grossProceeds - fee;

        const costBasis = position.quantity * position.entryPrice;
        const totalExitValue = grossProceeds - fee;
        const pnl = totalExitValue - costBasis;
        const pnlPct = costBasis === 0 ? 0 : pnl / costBasis;

        trades.push({
          id: `trade-${strategy.id}-${trades.length + 1}`,
          ticker: position.ticker,
          side: "buy",
          entryPrice: position.entryPrice,
          exitPrice,
          entryDate: position.entryDate,
          exitDate: currentDate,
          quantity: position.quantity,
          pnl,
          pnlPct,
        });

        position = null;
      }

      const markToMarket = position ? position.quantity * currentPrice : 0;
      const equity = cash + markToMarket;
      peakEquity = Math.max(peakEquity, equity);
      const drawdown = peakEquity === 0 ? 0 : equity / peakEquity - 1;

      equityCurve.push({
        date: currentDate,
        equity,
        drawdown,
      });
    }

    const metrics = this.computeMetrics(trades, equityCurve);

    return {
      runId: this.createRunId(strategy.id, this.config.startDate, this.config.endDate),
      strategyId: strategy.id,
      startDate: this.config.startDate,
      endDate: this.config.endDate,
      ...metrics,
      trades,
      equityCurve,
    };
  }

  async runWalkForward(strategy: Strategy, windowSize: number, stepSize: number): Promise<SimulationResult[]> {
    if (windowSize <= 0 || stepSize <= 0) {
      throw new Error("windowSize and stepSize must be > 0");
    }

    const allDates = this.getDateRange(this.config.startDate, this.config.endDate);
    if (allDates.length < windowSize) {
      return [];
    }

    const results: SimulationResult[] = [];
    for (let start = 0; start + windowSize <= allDates.length; start += stepSize) {
      const windowStart = allDates[start];
      const windowEnd = allDates[start + windowSize - 1];
      if (!windowStart || !windowEnd) {
        continue;
      }
      const windowSimulator = new Simulator({
        ...this.config,
        startDate: windowStart,
        endDate: windowEnd,
      });
      const result = await windowSimulator.run(strategy);
      results.push(result);
    }

    return results;
  }

  computeMetrics(trades: Trade[], equityCurve: EquityPoint[]): PerformanceMetrics {
    if (equityCurve.length === 0) {
      return {
        totalReturn: 0,
        annualizedReturn: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        winRate: 0,
        profitFactor: 0,
        turnover: 0,
        volatility: 0,
        beta: 0,
        var95: 0,
      };
    }

    const firstPoint = equityCurve[0];
    const lastPoint = equityCurve[equityCurve.length - 1];
    if (!firstPoint || !lastPoint) {
      return {
        totalReturn: 0,
        annualizedReturn: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        winRate: 0,
        profitFactor: 0,
        turnover: 0,
        volatility: 0,
        beta: 0,
        var95: 0,
      };
    }

    const firstEquity = firstPoint.equity;
    const lastEquity = lastPoint.equity;
    const totalReturn = firstEquity === 0 ? 0 : lastEquity / firstEquity - 1;

    const durationDays = Math.max(1, equityCurve.length - 1);
    const annualizedReturn = Math.pow(1 + totalReturn, TRADING_DAYS_PER_YEAR / durationDays) - 1;

    const dailyReturns = this.computeDailyReturns(equityCurve);
    const meanReturn = this.mean(dailyReturns);
    const stdDev = this.standardDeviation(dailyReturns, meanReturn);
    const volatility = stdDev * Math.sqrt(TRADING_DAYS_PER_YEAR);
    const sharpeRatio = stdDev === 0 ? 0 : (meanReturn / stdDev) * Math.sqrt(TRADING_DAYS_PER_YEAR);

    const maxDrawdown = Math.min(...equityCurve.map((point) => point.drawdown));

    const winningTrades = trades.filter((trade) => trade.pnl > 0).length;
    const winRate = trades.length === 0 ? 0 : winningTrades / trades.length;

    const grossProfit = trades.filter((trade) => trade.pnl > 0).reduce((sum, trade) => sum + trade.pnl, 0);
    const grossLoss = trades.filter((trade) => trade.pnl < 0).reduce((sum, trade) => sum + trade.pnl, 0);
    const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Number.POSITIVE_INFINITY : 0) : grossProfit / Math.abs(grossLoss);

    const turnoverNotional = trades.reduce((sum, trade) => {
      const entryNotional = trade.entryPrice * trade.quantity;
      const exitNotional = trade.exitPrice * trade.quantity;
      return sum + entryNotional + exitNotional;
    }, 0);
    const averageEquity = this.mean(equityCurve.map((point) => point.equity));
    const turnover = averageEquity === 0 ? 0 : turnoverNotional / averageEquity;

    const beta = 0;

    const sortedReturns = [...dailyReturns].sort((a, b) => a - b);
    const index = Math.max(0, Math.floor(sortedReturns.length * 0.05) - 1);
    const percentileReturn = sortedReturns[index];
    const var95 = percentileReturn === undefined ? 0 : Math.abs(percentileReturn);

    return {
      totalReturn,
      annualizedReturn,
      sharpeRatio,
      maxDrawdown,
      winRate,
      profitFactor,
      turnover,
      volatility,
      beta,
      var95,
    };
  }

  applySlippage(price: number, side: "buy" | "sell"): number {
    const slippage = Math.abs(this.config.slippageRate);
    if (side === "buy") {
      return price * (1 + slippage);
    }
    return price * (1 - slippage);
  }

  applyCommission(amount: number): number {
    return Math.abs(amount) * Math.abs(this.config.commissionRate);
  }

  private computeDailyReturns(equityCurve: EquityPoint[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i += 1) {
      const previousPoint = equityCurve[i - 1];
      const currentPoint = equityCurve[i];
      if (!previousPoint || !currentPoint) {
        continue;
      }
      const previous = previousPoint.equity;
      const current = currentPoint.equity;
      returns.push(previous === 0 ? 0 : current / previous - 1);
    }
    return returns;
  }

  private getDateRange(startDate: string, endDate: string): string[] {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const result: string[] = [];

    for (let t = start.getTime(); t <= end.getTime(); t += MS_PER_DAY) {
      result.push(new Date(t).toISOString());
    }

    return result;
  }

  private syntheticPrice(seedSource: string, dayIndex: number): number {
    const base = 100;
    const trend = dayIndex * 0.05;
    const cycle = Math.sin(dayIndex / 7) * 2;
    const noise = (this.seed(seedSource, dayIndex) - 0.5) * 1.5;
    const price = base + trend + cycle + noise;
    return Math.max(1, price);
  }

  private shouldEnter(strategy: Strategy, dayIndex: number): boolean {
    const cadence = Math.max(3, strategy.entryRules.length * 2 + 3);
    return dayIndex % cadence === 0;
  }

  private shouldExit(strategy: Strategy, dayIndex: number): boolean {
    const cadence = Math.max(4, strategy.exitRules.length * 2 + 4);
    return dayIndex % cadence === 0;
  }

  private seed(source: string, index: number): number {
    let hash = 0;
    const value = `${source}:${index}`;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return (Math.abs(hash) % 10_000) / 10_000;
  }

  private createRunId(strategyId: string, startDate: string, endDate: string): string {
    const start = new Date(startDate).toISOString().slice(0, 10);
    const end = new Date(endDate).toISOString().slice(0, 10);
    return `sim-${strategyId}-${start}-${end}`;
  }

  private mean(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private standardDeviation(values: number[], mean: number): number {
    if (values.length === 0) {
      return 0;
    }
    const variance = values.reduce((sum, value) => {
      const diff = value - mean;
      return sum + diff * diff;
    }, 0) / values.length;
    return Math.sqrt(variance);
  }
}

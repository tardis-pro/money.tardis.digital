import type { MetaStrategyTemplate } from "./generator.js";
import type { Strategy } from "./dsl/strategy-schema.js";

type StrategyTemplate = Omit<MetaStrategyTemplate, "defaultParams"> & {
  defaultParams: Record<string, unknown>;
  strategyReferenceId?: Strategy["id"];
};

export const ADVANCED_TEMPLATES: StrategyTemplate[] = [
  {
    id: "pairs-trading",
    name: "Pairs Trading",
    category: "stat-arb",
    description: "Trades correlated pairs when spread deviates and exits on mean reversion.",
    requiredSignals: ["sma", "ema", "rsi"],
    paramSpaces: {
      lookback: { min: 20, max: 252, step: 5 },
      deviationThreshold: { min: 1, max: 4, step: 0.1 },
      exitThreshold: { min: 0.1, max: 2, step: 0.1 },
    },
    defaultParams: {
      lookback: 90,
      deviationThreshold: 2,
      exitThreshold: 0.5,
    },
    constraints: [
      {
        field: "exitThreshold",
        message: "Exit threshold should be smaller than entry deviation threshold.",
        relation: "exitThreshold < deviationThreshold",
      },
    ],
  },
  {
    id: "sector-rotation",
    name: "Sector Rotation",
    category: "rotation",
    description: "Allocates to top sectors with momentum above benchmark and rotates at rebalance intervals.",
    requiredSignals: ["sma", "ema", "macd"],
    paramSpaces: {
      lookback: { min: 20, max: 252, step: 5 },
      numSectors: { min: 2, max: 12, step: 1 },
      rebalanceFrequency: { min: 1, max: 12, step: 1 },
    },
    defaultParams: {
      lookback: 126,
      numSectors: 4,
      rebalanceFrequency: 1,
    },
    constraints: [
      {
        field: "numSectors",
        message: "At least two sectors are required for rotation.",
        min: 2,
      },
    ],
  },
  {
    id: "mean-reversion-volatility",
    name: "Mean Reversion with Volatility",
    category: "mean-reversion",
    description: "Buys RSI oversold setups during low volatility and exits on overbought or volatility expansion.",
    requiredSignals: ["rsi", "bollinger"],
    paramSpaces: {
      rsiPeriod: { min: 5, max: 30, step: 1 },
      volPeriod: { min: 5, max: 100, step: 1 },
      rsiThreshold: { min: 15, max: 45, step: 1 },
      volThreshold: { min: 0.5, max: 2.5, step: 0.1 },
    },
    defaultParams: {
      rsiPeriod: 14,
      volPeriod: 20,
      rsiThreshold: 30,
      volThreshold: 1.2,
    },
    constraints: [
      {
        field: "rsiThreshold",
        message: "Oversold RSI threshold should stay below 50 for mean reversion.",
        max: 49,
      },
    ],
  },
  {
    id: "breakout-volume-confirmation",
    name: "Breakout with Volume Confirmation",
    category: "breakout",
    description: "Enters on price breakout confirmed by volume surge and exits via trailing stop or time stop.",
    requiredSignals: ["sma", "volume"],
    paramSpaces: {
      lookback: { min: 10, max: 120, step: 1 },
      volumeMultiplier: { min: 1.1, max: 5, step: 0.1 },
      stopLoss: { min: 0.5, max: 10, step: 0.1 },
    },
    defaultParams: {
      lookback: 55,
      volumeMultiplier: 2,
      stopLoss: 3,
    },
    constraints: [
      {
        field: "volumeMultiplier",
        message: "Volume confirmation should require at least 1.1x average volume.",
        min: 1.1,
      },
      {
        field: "stopLoss",
        message: "Stop loss must be greater than zero.",
        min: 0.1,
      },
    ],
  },
  {
    id: "multi-timeframe-momentum",
    name: "Multi-Timeframe Momentum",
    category: "momentum",
    description: "Requires daily and weekly momentum alignment for entries and exits on any timeframe breakdown.",
    requiredSignals: ["rsi", "macd", "sma"],
    paramSpaces: {
      dailyLookback: { min: 5, max: 120, step: 1 },
      weeklyLookback: { min: 2, max: 52, step: 1 },
      confirmationRequired: { min: 1, max: 2, step: 1 },
    },
    defaultParams: {
      dailyLookback: 20,
      weeklyLookback: 12,
      confirmationRequired: 2,
    },
    constraints: [
      {
        field: "weeklyLookback",
        message: "Weekly lookback should not exceed daily lookback.",
        relation: "weeklyLookback <= dailyLookback",
      },
      {
        field: "confirmationRequired",
        message: "Confirmation count must be one or two timeframes.",
        min: 1,
        max: 2,
      },
    ],
  },
];

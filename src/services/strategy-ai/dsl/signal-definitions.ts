import { z } from "zod";

/** Supported operators for evaluating signal thresholds. */
export const signalOperatorSchema = z.enum([
  "gt",
  "lt",
  "gte",
  "lte",
  "eq",
  "crosses_above",
  "crosses_below",
]);

/** Logical connector used between multiple signal conditions. */
export const conditionJoinSchema = z.enum(["and", "or"]);

/**
 * A condition that evaluates a computed indicator value.
 *
 * `threshold` is interpreted in the indicator's native units.
 */
export const signalConditionSchema = z.object({
  operator: signalOperatorSchema,
  threshold: z.number().finite(),
  combinedWith: conditionJoinSchema.optional(),
});

/** Relative strength index signal configuration. */
export const rsiSignalSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.literal("rsi"),
  lookback: z.number().int().positive(),
  params: z.object({
    period: z.number().int().min(2).max(200),
    source: z.enum(["open", "high", "low", "close", "hlc3", "ohlc4"]).default("close"),
  }),
  conditions: z.array(signalConditionSchema).min(1),
});

/** Moving average convergence divergence signal configuration. */
export const macdSignalSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.literal("macd"),
  lookback: z.number().int().positive(),
  params: z.object({
    fastPeriod: z.number().int().min(2).max(100),
    slowPeriod: z.number().int().min(3).max(200),
    signalPeriod: z.number().int().min(2).max(100),
    source: z.enum(["open", "high", "low", "close", "hlc3", "ohlc4"]).default("close"),
  }).refine((value) => value.fastPeriod < value.slowPeriod, {
    message: "fastPeriod must be smaller than slowPeriod",
    path: ["fastPeriod"],
  }),
  conditions: z.array(signalConditionSchema).min(1),
});

/** Simple moving average signal configuration. */
export const smaSignalSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.literal("sma"),
  lookback: z.number().int().positive(),
  params: z.object({
    period: z.number().int().min(2).max(400),
    source: z.enum(["open", "high", "low", "close", "hlc3", "ohlc4"]).default("close"),
  }),
  conditions: z.array(signalConditionSchema).min(1),
});

/** Exponential moving average signal configuration. */
export const emaSignalSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.literal("ema"),
  lookback: z.number().int().positive(),
  params: z.object({
    period: z.number().int().min(2).max(400),
    source: z.enum(["open", "high", "low", "close", "hlc3", "ohlc4"]).default("close"),
  }),
  conditions: z.array(signalConditionSchema).min(1),
});

/** Average true range signal configuration. */
export const atrSignalSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.literal("atr"),
  lookback: z.number().int().positive(),
  params: z.object({
    period: z.number().int().min(2).max(200),
  }),
  conditions: z.array(signalConditionSchema).min(1),
});

/** Bollinger Bands signal configuration. */
export const bollingerSignalSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.literal("bollinger"),
  lookback: z.number().int().positive(),
  params: z.object({
    period: z.number().int().min(2).max(200),
    stdDev: z.number().min(0.1).max(10),
    source: z.enum(["open", "high", "low", "close", "hlc3", "ohlc4"]).default("close"),
  }),
  conditions: z.array(signalConditionSchema).min(1),
});

/** Volume-based signal configuration. */
export const volumeSignalSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.literal("volume"),
  lookback: z.number().int().positive(),
  params: z.object({
    period: z.number().int().min(1).max(250),
    mode: z.enum(["raw", "sma_ratio", "ema_ratio"]).default("raw"),
  }),
  conditions: z.array(signalConditionSchema).min(1),
});

/** User-defined custom signal configuration for future extensibility. */
export const customSignalSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.literal("custom"),
  lookback: z.number().int().positive(),
  params: z.record(z.union([z.number().finite(), z.string(), z.boolean()])),
  conditions: z.array(signalConditionSchema).min(1),
});

/** Canonical union of all supported strategy signal definitions. */
export const signalSchema = z.discriminatedUnion("type", [
  rsiSignalSchema,
  macdSignalSchema,
  smaSignalSchema,
  emaSignalSchema,
  atrSignalSchema,
  bollingerSignalSchema,
  volumeSignalSchema,
  customSignalSchema,
]);

/** Strategy signal type. */
export type Signal = z.infer<typeof signalSchema>;

/** Signal condition type. */
export type SignalCondition = z.infer<typeof signalConditionSchema>;

/** Signal operator type. */
export type SignalOperator = z.infer<typeof signalOperatorSchema>;

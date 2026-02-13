import { z } from "zod";

/** Position sizing method family. */
export const positionSizingMethodSchema = z.enum([
  "fixed_fractional",
  "fixed_notional",
  "volatility_target",
  "risk_parity",
]);

/**
 * Position sizing parameters used by the execution layer.
 * Percentages are represented as decimals in [0, 1].
 */
export const positionSizingSchema = z.object({
  method: positionSizingMethodSchema,
  riskPerTradePct: z.number().min(0).max(1).optional(),
  notionalPerTrade: z.number().positive().optional(),
  targetVolatilityPct: z.number().min(0).max(1).optional(),
  maxPositionSizePct: z.number().min(0).max(1),
});

/** Stop-loss policy definition. */
export const stopLossSchema = z.object({
  type: z.enum(["fixed_pct", "atr_multiple", "trailing_pct", "none"]),
  value: z.number().min(0).max(5).optional(),
}).superRefine((value, ctx) => {
  if (value.type !== "none" && value.value === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["value"],
      message: "value is required when stop loss is enabled",
    });
  }
});

/** Take-profit policy definition. */
export const takeProfitSchema = z.object({
  type: z.enum(["fixed_pct", "risk_reward", "none"]),
  value: z.number().min(0).max(10).optional(),
}).superRefine((value, ctx) => {
  if (value.type !== "none" && value.value === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["value"],
      message: "value is required when take profit is enabled",
    });
  }
});

/**
 * Risk controls for a complete strategy.
 * Percentages are represented as decimals in [0, 1].
 */
export const riskParametersSchema = z.object({
  positionSizing: positionSizingSchema,
  stopLoss: stopLossSchema,
  takeProfit: takeProfitSchema.optional(),
  maxDrawdownPct: z.number().min(0).max(1),
  maxOpenPositions: z.number().int().positive(),
  maxSectorExposurePct: z.number().min(0).max(1).optional(),
  maxPortfolioHeatPct: z.number().min(0).max(1).optional(),
  rebalanceFrequency: z.enum(["daily", "weekly", "monthly", "never"]).default("weekly"),
}).superRefine((value, ctx) => {
  if (
    value.maxPortfolioHeatPct !== undefined
    && value.positionSizing.maxPositionSizePct > value.maxPortfolioHeatPct
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["positionSizing", "maxPositionSizePct"],
      message: "maxPositionSizePct cannot exceed maxPortfolioHeatPct",
    });
  }
});

/** Strategy risk parameters type. */
export type RiskParameters = z.infer<typeof riskParametersSchema>;

/** Strategy stop-loss type. */
export type StopLoss = z.infer<typeof stopLossSchema>;

/** Strategy position-sizing type. */
export type PositionSizing = z.infer<typeof positionSizingSchema>;

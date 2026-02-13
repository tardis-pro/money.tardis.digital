import { z } from "zod";

/**
 * Universe selection controls the symbol pool before rule filters execute.
 */
export const universeSchema = z.object({
  mode: z.enum(["all_equities", "index_members", "watchlist", "custom_tickers"]),
  exchanges: z.array(z.string().min(1).max(32)).min(1).default(["NSE"]),
  indexIds: z.array(z.string().min(1).max(64)).default([]),
  tickers: z.array(z.string().min(1).max(24)).default([]),
}).superRefine((value, ctx) => {
  if (value.mode === "index_members" && value.indexIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["indexIds"],
      message: "indexIds is required when mode is index_members",
    });
  }
  if (value.mode === "custom_tickers" && value.tickers.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["tickers"],
      message: "tickers is required when mode is custom_tickers",
    });
  }
});

/** Price filter for eligible symbols. */
export const priceFilterSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.literal("price"),
  minPrice: z.number().positive().optional(),
  maxPrice: z.number().positive().optional(),
});

/** Liquidity filter based on trade volume. */
export const volumeFilterSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.literal("volume"),
  minAverageDailyVolume: z.number().positive().optional(),
  minAverageDailyValue: z.number().positive().optional(),
  lookbackDays: z.number().int().min(1).max(252).default(20),
});

/** Sector inclusion and exclusion filter. */
export const sectorFilterSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.literal("sector"),
  include: z.array(z.string().min(1).max(80)).default([]),
  exclude: z.array(z.string().min(1).max(80)).default([]),
});

/** Market-cap based filter for universe shaping. */
export const marketCapFilterSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.literal("market_cap"),
  minMarketCap: z.number().positive().optional(),
  maxMarketCap: z.number().positive().optional(),
  unit: z.enum(["inr", "usd"]).default("inr"),
});

/** Canonical union of supported universe filters. */
export const filterSchema = z.discriminatedUnion("type", [
  priceFilterSchema,
  volumeFilterSchema,
  sectorFilterSchema,
  marketCapFilterSchema,
]).superRefine((value, ctx) => {
  if (value.type === "price") {
    if (value.minPrice !== undefined && value.maxPrice !== undefined && value.minPrice > value.maxPrice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minPrice"],
        message: "minPrice must be smaller than or equal to maxPrice",
      });
    }
  }

  if (value.type === "volume") {
    if (value.minAverageDailyVolume === undefined && value.minAverageDailyValue === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minAverageDailyVolume"],
        message: "Either minAverageDailyVolume or minAverageDailyValue must be provided",
      });
    }
  }

  if (value.type === "sector") {
    if (value.include.length === 0 && value.exclude.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["include"],
        message: "At least one sector must be included or excluded",
      });
    }
  }

  if (value.type === "market_cap") {
    if (
      value.minMarketCap !== undefined
      && value.maxMarketCap !== undefined
      && value.minMarketCap > value.maxMarketCap
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minMarketCap"],
        message: "minMarketCap must be smaller than or equal to maxMarketCap",
      });
    }
  }
});

/** Strategy universe type. */
export type Universe = z.infer<typeof universeSchema>;

/** Strategy filter type. */
export type Filter = z.infer<typeof filterSchema>;

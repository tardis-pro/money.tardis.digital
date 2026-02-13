import { z } from "zod";
import { strategySchema } from "./strategy-schema.js";

/**
 * Strategy schema with cross-field and reference-level constraint checks.
 */
export const constrainedStrategySchema = strategySchema.superRefine((strategy, ctx) => {
  const signalIds = new Set<string>();
  for (const signal of strategy.signals) {
    if (signalIds.has(signal.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signals"],
        message: `Duplicate signal id '${signal.id}'`,
      });
    }
    signalIds.add(signal.id);
  }

  const filterIds = new Set<string>();
  for (const filter of strategy.filters) {
    if (filterIds.has(filter.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filters"],
        message: `Duplicate filter id '${filter.id}'`,
      });
    }
    filterIds.add(filter.id);
  }

  for (const [ruleListKey, ruleList] of [
    ["entryRules", strategy.entryRules],
    ["exitRules", strategy.exitRules],
  ] as const) {
    const ruleIds = new Set<string>();
    for (const rule of ruleList) {
      if (ruleIds.has(rule.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [ruleListKey],
          message: `Duplicate rule id '${rule.id}' in ${ruleListKey}`,
        });
      }
      ruleIds.add(rule.id);

      for (const condition of rule.conditions) {
        if (!signalIds.has(condition.signalId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [ruleListKey, rule.id, "conditions"],
            message: `Rule '${rule.id}' references unknown signal '${condition.signalId}'`,
          });
        }
      }
    }
  }

  if (new Set(strategy.tags).size !== strategy.tags.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["tags"],
      message: "Strategy tags must be unique",
    });
  }

  if (
    strategy.universe.mode === "custom_tickers"
    && strategy.universe.tickers.length > 0
    && strategy.filters.some((filter) => filter.type === "sector")
  ) {
    const sectorFilter = strategy.filters.find((filter) => filter.type === "sector");
    if (sectorFilter && sectorFilter.include.length === 0 && sectorFilter.exclude.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filters"],
        message: "Sector exclusion-only filters are ambiguous for custom ticker universes",
      });
    }
  }
});

/** Strategy validation result with normalized issue messages. */
export type StrategyValidationResult = {
  success: boolean;
  issues: string[];
};

/** Parses and validates a strategy against all DSL constraints. */
export const parseStrategyDsl = (input: unknown) => constrainedStrategySchema.parse(input);

/** Safely validates strategy input and returns human-readable issue strings. */
export const validateStrategyDsl = (input: unknown): StrategyValidationResult => {
  const parsed = constrainedStrategySchema.safeParse(input);
  if (parsed.success) {
    return {
      success: true,
      issues: [],
    };
  }

  return {
    success: false,
    issues: parsed.error.issues.map((issue) => {
      const issuePath = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${issuePath}: ${issue.message}`;
    }),
  };
};

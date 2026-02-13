import { z } from "zod";
import { filterSchema, universeSchema } from "./filter-definitions.js";
import { riskParametersSchema } from "./risk-definitions.js";
import { signalSchema } from "./signal-definitions.js";

/** Strategy lifecycle state. */
export const strategyStatusSchema = z.enum([
  "draft",
  "validated",
  "simulated",
  "ranked",
  "production",
  "archived",
]);

/** Source used to create the current strategy version. */
export const generationMethodSchema = z.enum([
  "manual",
  "ai-generated",
  "mutation",
  "crossover",
]);

/**
 * Rule-level signal predicate that references a named signal.
 * Rule predicates compose entry and exit logic.
 */
export const ruleConditionSchema = z.object({
  signalId: z.string().min(1).max(128),
  conditionIndex: z.number().int().min(0).optional(),
  negate: z.boolean().default(false),
  combinedWith: z.enum(["and", "or"]).optional(),
});

/**
 * Logical rule block used for entries and exits.
 * Conditions are evaluated in list order.
 */
export const ruleSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  conditions: z.array(ruleConditionSchema).min(1),
});

/** Canonical strategy DSL model. */
export const strategySchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  description: z.string().max(5000),
  version: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  status: strategyStatusSchema,
  signals: z.array(signalSchema).min(1),
  filters: z.array(filterSchema).default([]),
  universe: universeSchema,
  entryRules: z.array(ruleSchema).min(1),
  exitRules: z.array(ruleSchema).min(1),
  riskParams: riskParametersSchema,
  tags: z.array(z.string().min(1).max(64)).max(32).default([]),
  sector: z.string().min(1).max(80).optional(),
  regime: z.string().min(1).max(80).optional(),
  parentStrategyId: z.string().min(1).max(128).optional(),
  generationMethod: generationMethodSchema,
});

/** Strategy type inferred from the DSL schema. */
export type Strategy = z.infer<typeof strategySchema>;

/** Entry/exit rule type. */
export type Rule = z.infer<typeof ruleSchema>;

/** Rule predicate type. */
export type RuleCondition = z.infer<typeof ruleConditionSchema>;

/** Strategy status type. */
export type StrategyStatus = z.infer<typeof strategyStatusSchema>;

/** Strategy generation-method type. */
export type StrategyGenerationMethod = z.infer<typeof generationMethodSchema>;

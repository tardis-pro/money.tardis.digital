import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  STORE_BACKEND: z.enum(["json", "postgres"]).default("json"),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  SCREENIPY_PYTHON: z.string().default("python3"),
  SCREENIPY_SCRIPT_PATH: z.string().optional(),
  MIT_INTRADAY_REFRESH_SLOTS: z.string().optional().default("10:00,12:30,14:45"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  GITHUB_REPO_OWNER: z.string().optional(),
  GITHUB_REPO_NAME: z.string().optional(),
  AUDIT_LOG: z.enum(["true", "false"]).optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

let validatedEnv: EnvConfig | null = null;

export function validateEnv(): EnvConfig {
  if (validatedEnv) {
    return validatedEnv;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  validatedEnv = result.data;
  console.log(`[Config] Validated: NODE_ENV=${validatedEnv.NODE_ENV}, STORE_BACKEND=${validatedEnv.STORE_BACKEND}`);
  
  return validatedEnv;
}

export function getEnv(): EnvConfig {
  if (!validatedEnv) {
    return validateEnv();
  }
  return validatedEnv;
}

import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      lazyConnect: true,
    });

    redisClient.on("error", (err: Error) => {
      console.error("[Redis] Connection error:", err.message);
    });

    redisClient.on("connect", () => {
      console.log("[Redis] Connected");
    });
  }
  return redisClient;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

/**
 * Distributed lock using Redis SET NX with expiration.
 * Returns a release function or null if lock could not be acquired.
 */
export async function acquireLock(
  key: string,
  ttlMs: number = 30000,
  waitMs: number = 5000
): Promise<(() => Promise<void>) | null> {
  const redis = getRedisClient();
  const lockValue = `${process.pid}-${Date.now()}`;
  const startTime = Date.now();

  while (Date.now() - startTime < waitMs) {
    // Try to acquire lock with NX (only set if not exists) and PX (milliseconds expiry)
    const result = await redis.set(key, lockValue, "PX", ttlMs, "NX");

    if (result === "OK") {
      // Lock acquired - return release function
      return async () => {
        // Only release if we still own the lock (compare value)
        const currentValue = await redis.get(key);
        if (currentValue === lockValue) {
          await redis.del(key);
        }
      };
    }

    // Lock held by another process - wait and retry
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.warn(`[RedisLock] Failed to acquire lock for ${key} after ${waitMs}ms`);
  return null;
}

/**
 * Simple lock acquisition with immediate failure (no waiting).
 * Use for non-critical locks where missing is acceptable.
 */
export async function tryAcquireLock(
  key: string,
  ttlMs: number = 30000
): Promise<(() => Promise<void>) | null> {
  const redis = getRedisClient();
  const lockValue = `${process.pid}-${Date.now()}`;

  const result = await redis.set(key, lockValue, "PX", ttlMs, "NX");

  if (result === "OK") {
    return async () => {
      const currentValue = await redis.get(key);
      if (currentValue === lockValue) {
        await redis.del(key);
      }
    };
  }

  return null;
}

/**
 * Check if Redis is available and healthy.
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const result = await redis.ping();
    return result === "PONG";
  } catch {
    return false;
  }
}

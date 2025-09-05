import Redis from "ioredis";
import { config, logger, formatPhoneNumber } from "./utils.js";

// Redis client instance
let redis: Redis | null = null;

/**
 * Initialize Redis connection
 */
export function initRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.redisUrl, {
      enableReadyCheck: false,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    redis.on("connect", () => {
      logger.info("Connected to Redis");
    });

    redis.on("error", (error) => {
      logger.error({ error }, "Redis connection error");
    });

    redis.on("close", () => {
      logger.warn("Redis connection closed");
    });
  }

  return redis;
}

/**
 * Get Redis instance (initialize if needed)
 */
export function getRedis(): Redis {
  if (!redis) {
    return initRedis();
  }
  return redis;
}

/**
 * Check if phone number has exceeded rate limit
 * Returns true if allowed, false if rate limited
 */
export async function checkRateLimit(phoneNumber: string): Promise<boolean> {
  try {
    const redis = getRedis();
    const formattedPhone = formatPhoneNumber(phoneNumber);
    const key = `rate_limit:${formattedPhone}`;

    // Get current count
    const current = await redis.get(key);
    const count = current ? parseInt(current) : 0;

    logger.debug({ phone: formattedPhone, count }, "Checking rate limit");

    // Check if exceeded
    if (count >= config.rateLimitActionsPerHour) {
      logger.warn({ phone: formattedPhone, count }, "Rate limit exceeded");
      return false;
    }

    return true;
  } catch (error) {
    logger.error({ error, phoneNumber }, "Error checking rate limit");
    // Fail open - allow the request if Redis is down
    return true;
  }
}

/**
 * Increment rate limit counter for phone number
 */
export async function incrementRateLimit(phoneNumber: string): Promise<void> {
  try {
    const redis = getRedis();
    const formattedPhone = formatPhoneNumber(phoneNumber);
    const key = `rate_limit:${formattedPhone}`;

    // Increment counter with 1 hour expiry
    const pipeline = redis.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, 3600); // 1 hour in seconds

    const results = await pipeline.exec();

    if (results && results[0] && results[0][1]) {
      const newCount = results[0][1] as number;
      logger.debug(
        { phone: formattedPhone, count: newCount },
        "Rate limit incremented"
      );
    }
  } catch (error) {
    logger.error({ error, phoneNumber }, "Error incrementing rate limit");
    // Don't throw - rate limiting is not critical for core functionality
  }
}

/**
 * Get remaining actions for phone number
 */
export async function getRemainingActions(
  phoneNumber: string
): Promise<number> {
  try {
    const redis = getRedis();
    const formattedPhone = formatPhoneNumber(phoneNumber);
    const key = `rate_limit:${formattedPhone}`;

    const current = await redis.get(key);
    const count = current ? parseInt(current) : 0;

    return Math.max(0, config.rateLimitActionsPerHour - count);
  } catch (error) {
    logger.error({ error, phoneNumber }, "Error getting remaining actions");
    return config.rateLimitActionsPerHour; // Assume full allowance if Redis error
  }
}

/**
 * Reset rate limit for phone number (admin function)
 */
export async function resetRateLimit(phoneNumber: string): Promise<void> {
  try {
    const redis = getRedis();
    const formattedPhone = formatPhoneNumber(phoneNumber);
    const key = `rate_limit:${formattedPhone}`;

    await redis.del(key);
    logger.info({ phone: formattedPhone }, "Rate limit reset");
  } catch (error) {
    logger.error({ error, phoneNumber }, "Error resetting rate limit");
  }
}

/**
 * Get rate limit status for phone number
 */
export async function getRateLimitStatus(phoneNumber: string): Promise<{
  current: number;
  limit: number;
  remaining: number;
  resetTime?: Date;
}> {
  try {
    const redis = getRedis();
    const formattedPhone = formatPhoneNumber(phoneNumber);
    const key = `rate_limit:${formattedPhone}`;

    const pipeline = redis.pipeline();
    pipeline.get(key);
    pipeline.ttl(key);

    const results = await pipeline.exec();

    const current =
      results && results[0] && results[0][1]
        ? parseInt(results[0][1] as string)
        : 0;
    const ttl =
      results && results[1] && results[1][1] ? (results[1][1] as number) : -1;

    const remaining = Math.max(0, config.rateLimitActionsPerHour - current);
    const resetTime = ttl > 0 ? new Date(Date.now() + ttl * 1000) : undefined;

    return {
      current,
      limit: config.rateLimitActionsPerHour,
      remaining,
      resetTime,
    };
  } catch (error) {
    logger.error({ error, phoneNumber }, "Error getting rate limit status");
    return {
      current: 0,
      limit: config.rateLimitActionsPerHour,
      remaining: config.rateLimitActionsPerHour,
    };
  }
}

/**
 * Clean up Redis connection on app shutdown
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    logger.info("Redis connection closed");
  }
}

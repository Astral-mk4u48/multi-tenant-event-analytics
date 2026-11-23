import { logger } from "./logger";

export type RedisCircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class RedisCircuitBreakerOpenError extends Error {
  public readonly statusCode = 503;
  public readonly retryAfter: number;

  constructor(message: string, retryAfterSeconds = 5) {
    super(message);
    this.name = "RedisCircuitBreakerOpenError";
    this.retryAfter = retryAfterSeconds;
  }
}

export interface RedisCircuitBreakerOptions {
  failureThreshold?: number; // Consecutive failures before tripping (default 3)
  cooldownMs?: number; // Duration to remain in OPEN before probing (default 5000ms)
  timeoutMs?: number; // Timeout for individual Redis operations (default 1500ms)
}

export class RedisCircuitBreaker {
  private state: RedisCircuitBreakerState = "CLOSED";
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private nextAttemptTime: number | null = null;

  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly timeoutMs: number;

  constructor(options: RedisCircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 5000;
    this.timeoutMs = options.timeoutMs ?? 1500;
  }

  public getState(): RedisCircuitBreakerState {
    if (this.state === "OPEN" && this.nextAttemptTime !== null && Date.now() >= this.nextAttemptTime) {
      this.state = "HALF_OPEN";
      logger.info("Redis circuit breaker cooldown elapsed; entering HALF_OPEN state to probe connection");
    }
    return this.state;
  }

  public getMetrics() {
    return {
      state: this.getState(),
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
    };
  }

  public reset(): void {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
    logger.info("Redis circuit breaker manually reset to CLOSED");
  }

  public trip(reason = "Forced manual trip"): void {
    this.state = "OPEN";
    this.failureCount = this.failureThreshold;
    this.lastFailureTime = Date.now();
    this.nextAttemptTime = Date.now() + this.cooldownMs;
    logger.warn({ reason }, "Redis circuit breaker manually tripped to OPEN");
  }

  /**
   * Executes a Redis operation protected by the circuit breaker.
   * If the circuit is OPEN, fails fast or calls the optional fallback without hitting Redis.
   */
  public async execute<T>(
    operation: () => Promise<T>,
    fallback?: () => T | Promise<T>
  ): Promise<T> {
    const currentState = this.getState();

    if (currentState === "OPEN") {
      const remainingMs = Math.max(0, (this.nextAttemptTime ?? 0) - Date.now());
      const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
      logger.warn(
        { state: this.state, retryAfterSeconds },
        "Redis circuit breaker is OPEN; skipping operation"
      );

      if (fallback) {
        return await fallback();
      }

      throw new RedisCircuitBreakerOpenError(
        `Redis cluster unreachable (circuit breaker is OPEN). Retry after ${retryAfterSeconds}s`,
        retryAfterSeconds
      );
    }

    try {
      // Execute operation with timeout protection
      const result = await this.withTimeout(operation(), this.timeoutMs);

      // On success in HALF_OPEN, close the circuit
      if (this.state === "HALF_OPEN") {
        logger.info("Redis probe succeeded in HALF_OPEN state; circuit breaker reset to CLOSED");
        this.reset();
      } else {
        // Reset failure count on successful normal operation
        this.failureCount = 0;
      }

      return result;
    } catch (err) {
      this.handleFailure(err);

      if (fallback) {
        logger.info("Invoking fallback handler following Redis operation failure");
        return await fallback();
      }

      throw err;
    }
  }

  private handleFailure(err: unknown): void {
    this.failureCount += 1;
    this.lastFailureTime = Date.now();

    logger.error(
      {
        err,
        failureCount: this.failureCount,
        threshold: this.failureThreshold,
        currentState: this.state,
      },
      "Redis operation failed under circuit breaker"
    );

    if (this.state === "HALF_OPEN" || this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      this.nextAttemptTime = Date.now() + this.cooldownMs;
      const cooldownSec = Math.ceil(this.cooldownMs / 1000);
      logger.warn(
        { failureCount: this.failureCount, cooldownSec },
        `Redis circuit breaker TRIPPED to OPEN state. Cooldown for ${cooldownSec}s`
      );
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Redis operation timed out after ${ms}ms`)), ms)
      ),
    ]);
  }
}

// Global singleton instance for platform operations
export const redisCircuitBreaker = new RedisCircuitBreaker({
  failureThreshold: 3,
  cooldownMs: 5000,
  timeoutMs: 1500,
});

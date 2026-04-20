import type { Logger } from '../lib/logger.js';

export interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier?: number;
  onRetry?: (attempt: number, error: unknown) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  logger?: Logger,
): Promise<T> {
  let lastError: unknown;
  let delay = options.delayMs;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < options.maxAttempts) {
        logger?.warn({ attempt, maxAttempts: options.maxAttempts, error }, 'Attempt failed, retrying...');
        options.onRetry?.(attempt, error);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= options.backoffMultiplier ?? 1;
      }
    }
  }

  throw lastError;
}

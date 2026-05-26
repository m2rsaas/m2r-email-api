import { describe, expect, it } from 'vitest';
import { RetryPolicy } from './retry-policy.js';

describe('RetryPolicy', () => {
  const policy = new RetryPolicy();

  it('returns exponential backoff delays for attempts 1..5', () => {
    expect(policy.backoffMs(1)).toBe(30_000);
    expect(policy.backoffMs(2)).toBe(120_000);
    expect(policy.backoffMs(3)).toBe(600_000);
    expect(policy.backoffMs(4)).toBe(3_600_000);
    expect(policy.backoffMs(5)).toBe(21_600_000);
  });

  it('says stop after 5 attempts', () => {
    expect(policy.shouldRetry('soft', 4)).toBe(true);
    expect(policy.shouldRetry('soft', 5)).toBe(false);
  });

  it('never retries hard failures', () => {
    expect(policy.shouldRetry('hard', 1)).toBe(false);
  });

  it('never retries fatal', () => {
    expect(policy.shouldRetry('fatal', 1)).toBe(false);
  });

  it('next fire date = now + backoff', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const next = policy.nextFireAt(1, now);
    expect(next.getTime() - now.getTime()).toBe(30_000);
  });
});

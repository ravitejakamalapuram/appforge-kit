import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/rate-limiter.js';

describe('RateLimiter', () => {
  it('allows requests up to the limit within the window', () => {
    const limiter = new RateLimiter(2, 60_000, () => 0);
    expect(limiter.allow('ip-1')).toBe(true);
    expect(limiter.allow('ip-1')).toBe(true);
  });

  it('rejects a request once the limit is exceeded within the window', () => {
    const limiter = new RateLimiter(2, 60_000, () => 0);
    limiter.allow('ip-1');
    limiter.allow('ip-1');
    expect(limiter.allow('ip-1')).toBe(false);
  });

  it('tracks each key independently', () => {
    const limiter = new RateLimiter(1, 60_000, () => 0);
    expect(limiter.allow('ip-1')).toBe(true);
    expect(limiter.allow('ip-2')).toBe(true);
  });

  it('allows again once the window has passed', () => {
    let now = 0;
    const limiter = new RateLimiter(1, 1000, () => now);
    expect(limiter.allow('ip-1')).toBe(true);
    expect(limiter.allow('ip-1')).toBe(false);
    now = 1001;
    expect(limiter.allow('ip-1')).toBe(true);
  });
});

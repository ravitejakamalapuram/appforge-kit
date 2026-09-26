/**
 * Per-isolate sliding-window limiter. Not shared across edge locations or isolate restarts —
 * a deliberate "cheapest reliable implementation" choice (see Global Constraints); Cloudflare
 * dashboard Rate Limiting Rules are the upgrade path if abuse ever needs a global view.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now
  ) {}

  allow(key: string): boolean {
    const now = this.now();
    const windowStart = now - this.windowMs;
    const existing = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (existing.length >= this.maxRequests) {
      this.hits.set(key, existing);
      return false;
    }
    existing.push(now);
    this.hits.set(key, existing);
    return true;
  }
}

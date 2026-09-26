import type { FlagsCache, FlagsClientOptions, FlagsFetcher } from './types.js';

const DEFAULT_CACHE_TTL_MS = 3_600_000; // 1 hour

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A cached remote-config client. Compiled-in `defaults` are always the floor: a remote response
 * (or a cached one) only ever merges *over* them, so an extension keeps working correctly even
 * if the edge is unreachable, slow, or returns a response that omits fields.
 */
export class FlagsClient<T extends Record<string, unknown>> {
  constructor(
    private readonly fetcher: FlagsFetcher,
    private readonly cache: FlagsCache,
    private readonly opts: FlagsClientOptions<T>
  ) {}

  private cacheKey(): string {
    return `appforge:flags:${this.opts.product}`;
  }

  private merge(remote: unknown): T {
    return { ...this.opts.defaults, ...(isPlainObject(remote) ? remote : {}) } as T;
  }

  async get(): Promise<T> {
    const ttl = this.opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    const cached = await this.cache.get(this.cacheKey());

    if (cached && Date.now() - cached.fetchedAt < ttl) {
      return this.merge(cached.value);
    }

    try {
      const response = await this.fetcher.fetch(`${this.opts.edgeUrl}/v1/config/${this.opts.product}`);
      if (!response.ok) throw new Error(`flags fetch for "${this.opts.product}" returned a non-ok response`);
      const remote = await response.json();
      await this.cache.set(this.cacheKey(), remote, Date.now());
      return this.merge(remote);
    } catch {
      // Network/edge failure: prefer a stale-but-known-good cache over bare defaults, since a
      // stale config is usually closer to correct than the compiled-in fallback.
      if (cached) return this.merge(cached.value);
      return this.merge(undefined);
    }
  }
}

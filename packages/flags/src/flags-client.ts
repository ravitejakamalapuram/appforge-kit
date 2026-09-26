import type { FlagsCache, FlagsClientOptions, FlagsFetcher } from './types.js';

const DEFAULT_CACHE_TTL_MS = 3_600_000; // 1 hour

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A cached remote-config client. Compiled-in `defaults` are always the floor, and the merge is
 * a **type-guarded, top-level-only** merge, not a deep merge:
 * - Only keys already present in `defaults` are ever copied from a remote/cached value; unknown
 *   extra keys are dropped.
 * - A key is copied only when `typeof remote[key] === typeof defaults[key]`; a type mismatch
 *   (e.g. a boolean flag sent back as the string `"true"`) is ignored and the default wins,
 *   since a malformed or compromised edge response must not silently corrupt a flag's type.
 * - If `defaults[key]` is itself an object, a remote override of that key replaces the whole
 *   nested object rather than merging into it — nested objects are NOT deep-merged. Model
 *   flags as flat fields if you need per-field override safety.
 * Every failure mode (unreachable edge, broken cache, a cache write that can't be persisted)
 * degrades to the best data still available — cache, then compiled-in defaults — rather than
 * rejecting, so a caller's `await flagsClient.get()` never throws.
 */
export class FlagsClient<T extends object> {
  constructor(
    private readonly fetcher: FlagsFetcher,
    private readonly cache: FlagsCache,
    private readonly opts: FlagsClientOptions<T>
  ) {}

  private cacheKey(): string {
    return `appforge:flags:${this.opts.product}`;
  }

  private merge(remote: unknown): T {
    const defaults = this.opts.defaults as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...defaults };
    if (isPlainObject(remote)) {
      for (const key of Object.keys(defaults)) {
        if (key in remote && typeof remote[key] === typeof defaults[key]) {
          merged[key] = remote[key];
        }
      }
    }
    return merged as T;
  }

  async get(): Promise<T> {
    const ttl = this.opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    const cached = await this.getCachedSafely();

    if (cached && Date.now() - cached.fetchedAt < ttl) {
      return this.merge(cached.value);
    }

    try {
      const response = await this.fetcher.fetch(`${this.opts.edgeUrl}/v1/config/${this.opts.product}`);
      if (!response.ok) throw new Error(`flags fetch for "${this.opts.product}" returned a non-ok response`);
      const remote = await response.json();
      const merged = this.merge(remote);
      await this.setCachedSafely(remote);
      return merged;
    } catch {
      // Network/edge failure: prefer a stale-but-known-good cache over bare defaults, since a
      // stale config is usually closer to correct than the compiled-in fallback.
      if (cached) return this.merge(cached.value);
      return this.merge(undefined);
    }
  }

  private async getCachedSafely() {
    try {
      return await this.cache.get(this.cacheKey());
    } catch {
      // A broken cache backend is a miss, not a hard failure — fall through to fetching.
      return undefined;
    }
  }

  private async setCachedSafely(remote: unknown): Promise<void> {
    try {
      await this.cache.set(this.cacheKey(), remote, Date.now());
    } catch {
      // Caching is best-effort (e.g. storage quota exceeded); the freshly fetched value is
      // still returned to the caller even if we can't persist it for next time.
    }
  }
}

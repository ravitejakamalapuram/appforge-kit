/** Minimal fetch surface this package needs, injected so it never touches the global `fetch`. */
export interface FlagsFetcher {
  fetch(url: string): Promise<{ ok: boolean; json(): Promise<unknown> }>;
}

/** A single cached entry: the last value seen and when it was fetched. */
export interface CachedFlagsEntry {
  value: unknown;
  fetchedAt: number;
}

/**
 * The subset of a storage backend this package needs to cache remote config. The real extension
 * would back this with `@appforge/storage`; tests use an in-memory fake.
 */
export interface FlagsCache {
  get(key: string): Promise<CachedFlagsEntry | undefined>;
  set(key: string, value: unknown, fetchedAt: number): Promise<void>;
}

export interface FlagsClientOptions<T> {
  edgeUrl: string;
  product: string;
  defaults: T;
  /** How long a cached value is trusted before re-fetching. Default 1 hour. */
  cacheTtlMs?: number;
}

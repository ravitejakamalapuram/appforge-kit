import { describe, it, expect, vi } from 'vitest';
import { FlagsClient, type FlagsFetcher, type FlagsCache } from '../src/index.js';

interface ProductFlags {
  paywallEnabled: boolean;
  bannerText: string;
}

const DEFAULTS: ProductFlags = { paywallEnabled: false, bannerText: 'default' };

function fetcherReturning(json: unknown, ok = true): FlagsFetcher {
  return { fetch: vi.fn(async () => ({ ok, json: async () => json })) };
}

function memoryCache(initial?: { value: unknown; fetchedAt: number }): FlagsCache & { store: Record<string, { value: unknown; fetchedAt: number }> } {
  const store: Record<string, { value: unknown; fetchedAt: number }> = initial ? { 'appforge:flags:demo': initial } : {};
  return {
    store,
    async get(key) {
      return store[key];
    },
    async set(key, value, fetchedAt) {
      store[key] = { value, fetchedAt };
    },
  };
}

describe('FlagsClient', () => {
  it('fetches, merges over defaults, and caches on a fresh call with no cache', async () => {
    const fetcher = fetcherReturning({ paywallEnabled: true });
    const cache = memoryCache();
    const client = new FlagsClient(fetcher, cache, { edgeUrl: 'https://edge.example.com', product: 'demo', defaults: DEFAULTS });

    const flags = await client.get();

    expect(flags).toEqual({ paywallEnabled: true, bannerText: 'default' });
    expect(fetcher.fetch).toHaveBeenCalledWith('https://edge.example.com/v1/config/demo');
    expect(cache.store['appforge:flags:demo'].value).toEqual({ paywallEnabled: true });
  });

  it('returns the cached value without re-fetching when the cache is still within the TTL', async () => {
    const fetcher = fetcherReturning({ paywallEnabled: true });
    const cache = memoryCache({ value: { bannerText: 'cached banner' }, fetchedAt: Date.now() });
    const client = new FlagsClient(fetcher, cache, { edgeUrl: 'https://edge.example.com', product: 'demo', defaults: DEFAULTS, cacheTtlMs: 60_000 });

    const flags = await client.get();

    expect(flags).toEqual({ paywallEnabled: false, bannerText: 'cached banner' });
    expect(fetcher.fetch).not.toHaveBeenCalled();
  });

  it('re-fetches when the cache is past the TTL', async () => {
    const fetcher = fetcherReturning({ paywallEnabled: true });
    const cache = memoryCache({ value: { bannerText: 'stale' }, fetchedAt: Date.now() - 120_000 });
    const client = new FlagsClient(fetcher, cache, { edgeUrl: 'https://edge.example.com', product: 'demo', defaults: DEFAULTS, cacheTtlMs: 60_000 });

    const flags = await client.get();

    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    expect(flags.paywallEnabled).toBe(true);
  });

  it('falls back to the stale cache (not bare defaults) when a re-fetch fails but a cache entry exists', async () => {
    const fetcher: FlagsFetcher = { fetch: vi.fn(async () => { throw new Error('network down'); }) };
    const cache = memoryCache({ value: { bannerText: 'last known good' }, fetchedAt: Date.now() - 120_000 });
    const client = new FlagsClient(fetcher, cache, { edgeUrl: 'https://edge.example.com', product: 'demo', defaults: DEFAULTS, cacheTtlMs: 60_000 });

    const flags = await client.get();

    expect(flags).toEqual({ paywallEnabled: false, bannerText: 'last known good' });
  });

  it('falls back to bare compiled-in defaults when the fetch fails and there is no cache at all', async () => {
    const fetcher: FlagsFetcher = { fetch: vi.fn(async () => { throw new Error('network down'); }) };
    const cache = memoryCache();
    const client = new FlagsClient(fetcher, cache, { edgeUrl: 'https://edge.example.com', product: 'demo', defaults: DEFAULTS });

    const flags = await client.get();

    expect(flags).toEqual(DEFAULTS);
  });

  it('falls back to defaults/cache when the fetch resolves but with a non-ok response, not throwing', async () => {
    const fetcher = fetcherReturning({ paywallEnabled: true }, false);
    const cache = memoryCache();
    const client = new FlagsClient(fetcher, cache, { edgeUrl: 'https://edge.example.com', product: 'demo', defaults: DEFAULTS });

    const flags = await client.get();

    expect(flags).toEqual(DEFAULTS);
  });

  it('merges remote fields over defaults rather than replacing the whole object (a remote response omitting a field keeps the default)', async () => {
    const fetcher = fetcherReturning({ bannerText: 'only this changed' });
    const cache = memoryCache();
    const client = new FlagsClient(fetcher, cache, { edgeUrl: 'https://edge.example.com', product: 'demo', defaults: DEFAULTS });

    const flags = await client.get();

    expect(flags).toEqual({ paywallEnabled: false, bannerText: 'only this changed' });
  });
});

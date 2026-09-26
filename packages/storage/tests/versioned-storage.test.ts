import { describe, it, expect } from 'vitest';
import { VersionedStorage, type ChromeStorageArea, type Migration } from '../src/index.js';

/** In-memory fake of the subset of chrome.storage.StorageArea this package needs. */
function fakeArea(initial: Record<string, unknown> = {}): ChromeStorageArea {
  const store: Record<string, unknown> = { ...initial };
  return {
    async get(key: string) {
      return key in store ? { [key]: store[key] } : {};
    },
    async set(items: Record<string, unknown>) {
      Object.assign(store, items);
    },
    async remove(key: string) {
      delete store[key];
    },
  };
}

interface SettingsV1 { theme: string }
interface SettingsV2 { theme: string; language: string }

describe('VersionedStorage', () => {
  it('returns the default value when nothing is stored yet', async () => {
    const storage = new VersionedStorage<SettingsV1>(fakeArea(), 'settings', 1, [], { theme: 'light' });
    expect(await storage.get()).toEqual({ theme: 'light' });
  });

  it('round-trips a value through set() then get()', async () => {
    const storage = new VersionedStorage<SettingsV1>(fakeArea(), 'settings', 1, [], { theme: 'light' });
    await storage.set({ theme: 'dark' });
    expect(await storage.get()).toEqual({ theme: 'dark' });
  });

  it('applies a single migration when the stored version is one behind', async () => {
    const migrations: Migration[] = [
      { version: 2, migrate: (data) => ({ ...(data as SettingsV1), language: 'en' }) },
    ];
    const area = fakeArea({ settings: { version: 1, data: { theme: 'dark' } } });
    const storage = new VersionedStorage<SettingsV2>(area, 'settings', 2, migrations, { theme: 'light', language: 'en' });
    expect(await storage.get()).toEqual({ theme: 'dark', language: 'en' });
  });

  it('applies multiple migrations in order when several versions behind', async () => {
    const migrations: Migration[] = [
      { version: 2, migrate: (data) => ({ ...(data as SettingsV1), language: 'en' }) },
      { version: 3, migrate: (data) => ({ ...(data as SettingsV2), theme: (data as SettingsV2).theme.toUpperCase() }) },
    ];
    const area = fakeArea({ settings: { version: 1, data: { theme: 'dark' } } });
    const storage = new VersionedStorage(area, 'settings', 3, migrations, { theme: 'LIGHT', language: 'en' });
    expect(await storage.get()).toEqual({ theme: 'DARK', language: 'en' });
  });

  it('fails safe to the default value for malformed pre-versioning data instead of crashing', async () => {
    // Simulates data written before this package existed: a bare value, no {version, data} envelope.
    const area = fakeArea({ settings: 'not-an-envelope' });
    const storage = new VersionedStorage<SettingsV1>(area, 'settings', 1, [], { theme: 'light' });
    expect(await storage.get()).toEqual({ theme: 'light' });
  });

  it('fails safe to the default value when the stored version is newer than the code understands (downgrade)', async () => {
    const area = fakeArea({ settings: { version: 5, data: { theme: 'dark', language: 'en', somethingFutureOnly: true } } });
    const storage = new VersionedStorage<SettingsV1>(area, 'settings', 1, [], { theme: 'light' });
    expect(await storage.get()).toEqual({ theme: 'light' });
  });

  it('clears the stored value on remove()', async () => {
    const area = fakeArea();
    const storage = new VersionedStorage<SettingsV1>(area, 'settings', 1, [], { theme: 'light' });
    await storage.set({ theme: 'dark' });
    await storage.remove();
    expect(await storage.get()).toEqual({ theme: 'light' });
  });
});

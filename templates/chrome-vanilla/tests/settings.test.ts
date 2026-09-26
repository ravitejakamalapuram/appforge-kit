import { describe, it, expect } from 'vitest';
import type { ChromeStorageArea } from '@appforge/storage';
import { createSettingsStorage } from '../src/shared/settings.js';

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

describe('createSettingsStorage', () => {
  it('defaults to the light theme when nothing is stored yet', async () => {
    const storage = createSettingsStorage(fakeArea());
    expect(await storage.get()).toEqual({ theme: 'light' });
  });

  it('persists a theme change across get() calls', async () => {
    const storage = createSettingsStorage(fakeArea());
    await storage.set({ theme: 'dark' });
    expect(await storage.get()).toEqual({ theme: 'dark' });
  });
});

import { defineConfig } from 'vitest/config';

// Real Chromium launches per test — the monorepo's Vitest default (5s) is too short.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

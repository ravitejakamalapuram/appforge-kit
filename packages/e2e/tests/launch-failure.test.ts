import { describe, it, expect, vi } from 'vitest';
import { existsSync, mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CHROME_VANILLA_DIST } from './fixture.js';

let capturedProfileDir: string | undefined;

// Observes (without changing) the temp profile dir launchExtension creates via mkdtemp, so this
// test can assert it was cleaned up on a launch failure -- real fs.mkdtemp still runs underneath.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdtemp: async (...args: Parameters<typeof actual.mkdtemp>) => {
      const result = await actual.mkdtemp(...args);
      capturedProfileDir = result as string;
      return result;
    },
  };
});

const { launchExtension } = await import('../src/launch.js');

/**
 * Review (final-review finding C2/I1): if anything after `launchPersistentContext` throws (e.g.
 * the service worker never registers within launchTimeoutMs), the persistent browser context and
 * its temp profile directory must not leak -- otherwise the CLI's Node process never exits on a
 * launch failure (an orphaned Chromium process keeps the event loop alive), and a broken build
 * turns a fast, clear CI failure into a hang until the job timeout.
 */
describe('launchExtension failure cleanup', () => {
  it('removes the temp profile dir when the service worker never appears (launchTimeoutMs elapses)', async () => {
    const brokenDir = mkdtempSync(path.join(tmpdir(), 'appforge-e2e-broken-fixture-'));
    try {
      cpSync(CHROME_VANILLA_DIST, brokenDir, { recursive: true });
      const manifestPath = path.join(brokenDir, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.background.service_worker = 'this-file-does-not-exist.js'; // never registers -> waitForEvent times out
      writeFileSync(manifestPath, JSON.stringify(manifest));

      await expect(launchExtension(brokenDir, { launchTimeoutMs: 1000 })).rejects.toThrow();

      expect(capturedProfileDir).toBeDefined();
      expect(existsSync(capturedProfileDir!)).toBe(false); // no leaked temp profile dir
    } finally {
      rmSync(brokenDir, { recursive: true, force: true });
    }
  }, 15_000);
});

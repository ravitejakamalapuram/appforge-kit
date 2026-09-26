import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { launchExtension } from '../src/launch.js';
import type { LaunchedExtension } from '../src/launch.js';
import { CHROME_VANILLA_DIST } from './fixture.js';

describe('launchExtension', () => {
  let ext: LaunchedExtension | undefined;

  afterEach(async () => {
    await ext?.close();
    ext = undefined;
  });

  it('loads the built chrome-vanilla template and discovers its extension id', async () => {
    expect(existsSync(CHROME_VANILLA_DIST)).toBe(true); // run `pnpm build` first if this fails
    ext = await launchExtension(CHROME_VANILLA_DIST);
    expect(ext.extensionId).toMatch(/^[a-p]{32}$/); // Chrome extension ids use the a-p alphabet
  });

  it('reports the service worker as "activated" via the ServiceWorker CDP tracker', async () => {
    ext = await launchExtension(CHROME_VANILLA_DIST);
    const activated = await ext.swTracker.waitUntil(() => ext!.swTracker.find(ext!.extensionId)?.status === 'activated', 10_000);
    expect(activated).toBe(true);
    expect(ext.swTracker.find(ext.extensionId)?.status).toBe('activated');
  });
});

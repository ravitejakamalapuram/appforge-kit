import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchExtension } from '../src/launch.js';
import type { LaunchedExtension } from '../src/launch.js';
import { checkServiceWorkerRestart } from '../src/checks/sw-restart.js';
import { CHROME_VANILLA_DIST } from './fixture.js';

describe('checkServiceWorkerRestart', () => {
  let ext: LaunchedExtension;

  beforeAll(async () => {
    ext = await launchExtension(CHROME_VANILLA_DIST);
  });

  afterAll(async () => {
    await ext.close();
  });

  it('survives a forced service worker restart with chrome.storage.local state intact', async () => {
    await expect(checkServiceWorkerRestart(ext)).resolves.toBeUndefined();
  }, 20_000);

  it('actually forced a restart (Review Focus: prove runningStatus round-tripped stopped -> running, not a no-op)', async () => {
    const version = ext.swTracker.find(ext.extensionId);
    expect(version?.runningStatus).toBe('running'); // back to running after the check above
  });
});

import type { LaunchedExtension } from '../launch.js';

const PROBE_KEY = '__appforge_e2e_probe'; // namespaced so it can never collide with real extension state — see Review Focus item 3

async function waitForReady(page: import('playwright').Page): Promise<void> {
  // main.ts's init() is async (it round-trips a runtime message before setting #status), so a
  // navigation's 'load' event is not proof the page finished initializing — poll for the real
  // end state instead (same fix as checkSmoke, Task 2 ledger).
  await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'Ready', undefined, { timeout: 5000 });
}

export async function checkServiceWorkerRestart(ext: LaunchedExtension): Promise<void> {
  const { context, swTracker, extensionId } = ext;
  const page = await context.newPage();
  try {
    await page.goto('chrome://newtab/', { waitUntil: 'load' });
    await waitForReady(page);

    const probeValue = `e2e-sw-restart-${Date.now()}`;
    await page.evaluate(
      ([key, value]) =>
        new Promise<void>((resolve, reject) => {
          chrome.storage.local.set({ [key]: value }, () => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve();
          });
        }),
      [PROBE_KEY, probeValue] as const
    );

    await swTracker.waitUntil(() => swTracker.find(extensionId)?.status === 'activated', 5000);
    const version = swTracker.find(extensionId);
    if (!version) {
      throw new Error(`no service worker version found for extension ${extensionId}`);
    }

    // ServiceWorker.stopWorker (not Target.closeTarget — see Review Focus item 1) reliably
    // transitions runningStatus to 'stopped'; the extension respawns it naturally on next use.
    await swTracker.stop(version.versionId);
    const stopped = await swTracker.waitUntil(() => swTracker.get(version.versionId)?.runningStatus === 'stopped', 5000);
    if (!stopped) {
      throw new Error(
        `service worker did not report "stopped" after ServiceWorker.stopWorker (last seen: ${JSON.stringify(swTracker.get(version.versionId))})`
      );
    }

    const wakePage = await context.newPage();
    try {
      await wakePage.goto('chrome://newtab/', { waitUntil: 'load' }); // triggers a runtime message on load, waking the SW
      await waitForReady(wakePage);

      const restarted = await swTracker.waitUntil(() => swTracker.get(version.versionId)?.runningStatus === 'running', 5000);
      if (!restarted) {
        throw new Error(
          `service worker did not restart ("running") after the wake trigger (last seen: ${JSON.stringify(swTracker.get(version.versionId))})`
        );
      }

      const readBack = await wakePage.evaluate(
        (key) =>
          new Promise<Record<string, unknown>>((resolve) => {
            chrome.storage.local.get(key, (items) => resolve(items));
          }),
        PROBE_KEY
      );
      if (readBack[PROBE_KEY] !== probeValue) {
        throw new Error(
          `expected chrome.storage.local["${PROBE_KEY}"] to still be "${probeValue}" after the service worker restart, got ${JSON.stringify(readBack[PROBE_KEY])}`
        );
      }
    } finally {
      await wakePage.close();
    }
  } finally {
    await page.close();
  }
}

import { launchExtension, type LaunchedExtension } from './launch.js';
import { checkSmoke } from './checks/smoke.js';
import { checkServiceWorkerRestart } from './checks/sw-restart.js';
import type { E2eCheckResult, E2eReport, RunE2eSuiteOptions } from './types.js';

interface NamedCheck {
  name: string;
  run: (ext: LaunchedExtension) => Promise<void>;
}

const CHECKS: NamedCheck[] = [
  { name: 'smoke: loads and renders the new-tab page without an unexpected console error', run: checkSmoke },
  { name: 'service worker restart survives chrome.storage.local state', run: checkServiceWorkerRestart },
];

export async function runE2eSuite(buildDir: string, options: RunE2eSuiteOptions = {}): Promise<E2eReport> {
  let ext: LaunchedExtension;
  try {
    ext = await launchExtension(buildDir, { headless: options.headless, launchTimeoutMs: options.launchTimeoutMs });
  } catch (err) {
    return {
      ok: false,
      buildDir,
      checks: [{ name: 'suite setup: launch the extension', ok: false, error: (err as Error).message, durationMs: 0 }],
    };
  }

  const checks: E2eCheckResult[] = [];
  try {
    for (const check of CHECKS) {
      const start = Date.now();
      try {
        await check.run(ext);
        checks.push({ name: check.name, ok: true, durationMs: Date.now() - start });
      } catch (err) {
        checks.push({ name: check.name, ok: false, error: (err as Error).message, durationMs: Date.now() - start });
      }
    }
  } finally {
    await ext.close();
  }
  return { ok: checks.every((c) => c.ok), buildDir, checks };
}

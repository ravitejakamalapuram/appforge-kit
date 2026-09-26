import { chromium, type BrowserContext } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServiceWorkerTracker } from './service-worker-cdp.js';

export interface LaunchedExtension {
  context: BrowserContext;
  extensionId: string;
  swTracker: ServiceWorkerTracker;
  close(): Promise<void>;
}

export interface LaunchExtensionOptions {
  headless?: boolean;
  launchTimeoutMs?: number;
}

/**
 * Loads an unpacked MV3 extension the way Chrome's own documentation for automated extension
 * testing recommends: `chromium.launchPersistentContext` with `--load-extension` (extensions
 * only load with a persistent context — never `chromium.launch()`). Headless coverage requires
 * `--headless=new` passed as a raw arg while Playwright's own `headless` option stays `false` —
 * `headless: true` does not reliably enable extension loading. Verified against this repo's own
 * `templates/chrome-vanilla` build during this plan's investigation (Review Focus item 4).
 */
export async function launchExtension(buildDir: string, options: LaunchExtensionOptions = {}): Promise<LaunchedExtension> {
  const headless = options.headless ?? true;
  const launchTimeoutMs = options.launchTimeoutMs ?? 10_000;
  const userDataDir = await mkdtemp(join(tmpdir(), 'appforge-e2e-'));

  const args = [`--disable-extensions-except=${buildDir}`, `--load-extension=${buildDir}`];
  if (headless) args.push('--headless=new');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // the --headless=new arg above does the real work — see this function's docstring
    args,
  });

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: launchTimeoutMs });
  }
  const extensionId = new URL(serviceWorker.url()).host;

  const anchorPage = await context.newPage(); // kept open for the life of the context — the CDPSession is tied to it
  const cdp = await context.newCDPSession(anchorPage);
  const swTracker = new ServiceWorkerTracker(cdp);
  await swTracker.enable();

  return {
    context,
    extensionId,
    swTracker,
    close: () => context.close(),
  };
}

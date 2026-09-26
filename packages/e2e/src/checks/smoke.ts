import type { LaunchedExtension } from '../launch.js';

/**
 * Chromium logs a failed resource load (e.g. a fetch()) as a type:'error' console message even
 * though the page's own JS never calls console.error. chrome-vanilla's main.ts deliberately
 * points FlagsClient at this placeholder host until a real appforge-edge deployment exists;
 * FlagsClient itself catches the failure and falls back to defaults. Filtering by the exact
 * failing request's origin (not "any network error") means an unrelated broken asset still
 * fails this check. See this plan's Review Focus item 2.
 */
const EXPECTED_PLACEHOLDER_HOST = 'edge.appforge.example';

export async function checkSmoke(ext: LaunchedExtension): Promise<void> {
  await ext.swTracker.waitUntil(() => ext.swTracker.find(ext.extensionId)?.status === 'activated', 5000);
  const version = ext.swTracker.find(ext.extensionId);
  if (!version || version.status !== 'activated') {
    throw new Error(`expected the extension's service worker to be "activated", got ${JSON.stringify(version)}`);
  }

  const page = await ext.context.newPage();
  const unexpectedErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const location = msg.location();
    if (location.url && location.url.includes(EXPECTED_PLACEHOLDER_HOST)) return;
    unexpectedErrors.push(msg.text());
  });
  page.on('pageerror', (err) => unexpectedErrors.push(String(err)));

  try {
    await page.goto('chrome://newtab/', { waitUntil: 'load' });
    // main.ts's init() is async (it round-trips a runtime message before setting #status), so
    // the DOM 'load' event fires before "Ready" appears — wait for the real end state instead
    // of reading #status immediately after navigation.
    let status: string | null;
    try {
      await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'Ready', undefined, { timeout: 5000 });
      status = await page.textContent('#status');
    } catch {
      status = await page.textContent('#status');
    }
    if (status !== 'Ready') {
      throw new Error(`expected #status to read "Ready" once the page finished loading, got ${JSON.stringify(status)}`);
    }
    if (unexpectedErrors.length > 0) {
      throw new Error(`unexpected console error(s): ${unexpectedErrors.join('; ')}`);
    }
  } finally {
    await page.close();
  }
}

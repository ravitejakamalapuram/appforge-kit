import { sendTypedMessage, type ChromeRuntime } from '@appforge/messaging';
import { installGlobalErrorHandlers, reportError } from '@appforge/errors';
import { FlagsClient } from '@appforge/flags';
import type { Settings } from '../shared/settings.js';
import type { AppMessages } from '../shared/messages.js';

const errorSink = (event: unknown): void => {
  console.error('[appforge-template:newtab]', event);
};

installGlobalErrorHandlers(window, errorSink);

const runtime: ChromeRuntime = { sendMessage: (message) => chrome.runtime.sendMessage(message) };

function applyTheme(theme: Settings['theme']): void {
  document.body.dataset.theme = theme;
}

async function init(): Promise<void> {
  const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
  const toggleButton = document.querySelector<HTMLButtonElement>('#toggle-theme')!;
  const betaBanner = document.querySelector<HTMLParagraphElement>('#beta-banner')!;

  const settings = await sendTypedMessage<AppMessages['getSettings']['payload'], AppMessages['getSettings']['result']>(
    runtime,
    'getSettings',
    undefined
  );
  applyTheme(settings.theme);

  toggleButton.addEventListener('click', () => {
    const next: Settings['theme'] = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    // A DOM event listener callback that rejects (e.g. the background service worker didn't
    // wake up in time) is an unhandled rejection, not something the browser reports back to
    // this code — so this is caught explicitly rather than left as `async () => { await ... }`.
    sendTypedMessage<AppMessages['setTheme']['payload'], AppMessages['setTheme']['result']>(runtime, 'setTheme', { theme: next })
      .then(() => applyTheme(next))
      .catch((error: unknown) => reportError(errorSink, error, { action: 'setTheme' }));
  });

  // Demo wiring for @appforge/flags. No appforge-edge deployment exists yet (P1-10), so this
  // edgeUrl is a placeholder — the fetch will fail and FlagsClient correctly falls back to
  // `defaults` below, which is exactly the "fails safe" behavior this is meant to demonstrate.
  // Replace edgeUrl with a real deployment, and the in-memory cache below with @appforge/storage,
  // once appforge-edge exists.
  interface TemplateFlags {
    showBetaBanner: boolean;
  }
  const memoryCache = new Map<string, { value: unknown; fetchedAt: number }>();
  const flags = new FlagsClient<TemplateFlags>(
    { fetch: (url) => fetch(url) },
    {
      get: async (key) => memoryCache.get(key),
      set: async (key, value, fetchedAt) => void memoryCache.set(key, { value, fetchedAt }),
    },
    { edgeUrl: 'https://edge.appforge.example', product: 'chrome-vanilla-template', defaults: { showBetaBanner: false } }
  );
  const { showBetaBanner } = await flags.get();
  betaBanner.toggleAttribute('hidden', !showBetaBanner);

  statusEl.textContent = 'Ready';
}

init().catch((error: unknown) => reportError(errorSink, error, { action: 'init' }));

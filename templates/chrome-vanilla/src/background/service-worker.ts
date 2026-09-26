import { installGlobalErrorHandlers, type ErrorEventTarget } from '@appforge/errors';
import { createMessageRouter } from '@appforge/messaging';
import { createSettingsStorage } from '../shared/settings.js';
import type { MessageHandlerMap } from '../shared/messages.js';

// A service worker has `self`, not `window`; ErrorEventTarget only needs
// addEventListener/removeEventListener for 'error'/'unhandledrejection', which self provides.
installGlobalErrorHandlers(self as unknown as ErrorEventTarget, (event) => {
  // Replace with a real sink once appforge-edge (P1-10) exists to receive these.
  console.error('[appforge-template:background]', event);
});

const settings = createSettingsStorage();

// Typed against the same AppMessages contract main.ts sends against — a mismatch here (wrong
// payload/result shape) is now a compile error, not a runtime surprise.
const router = createMessageRouter<MessageHandlerMap>({
  getSettings: async () => settings.get(),
  setTheme: async (payload) => {
    await settings.set({ theme: payload.theme });
    return { ok: true };
  },
});

chrome.runtime.onMessage.addListener(router);

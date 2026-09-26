import type { Settings } from './settings.js';

/** The message contract between the new-tab page and the background service worker. Both sides
 * are checked against this single map — see main.ts (sender) and service-worker.ts (router). */
export interface AppMessages {
  getSettings: { payload: undefined; result: Settings };
  setTheme: { payload: { theme: Settings['theme'] }; result: { ok: true } };
}

export type MessageType = keyof AppMessages;

export type MessageHandlerMap = {
  [K in MessageType]: (payload: AppMessages[K]['payload']) => Promise<AppMessages[K]['result']>;
};

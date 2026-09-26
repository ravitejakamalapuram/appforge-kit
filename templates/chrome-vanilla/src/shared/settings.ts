import { VersionedStorage, type ChromeStorageArea } from '@appforge/storage';

export interface Settings {
  theme: 'light' | 'dark';
}

const STORAGE_KEY = 'settings';
const CURRENT_VERSION = 1;
const DEFAULT_SETTINGS: Settings = { theme: 'light' };

/** Adapts chrome.storage.local to the ChromeStorageArea interface @appforge/storage expects. */
function chromeLocalArea(): ChromeStorageArea {
  return {
    get: (key) => chrome.storage.local.get(key),
    set: (items) => chrome.storage.local.set(items),
    remove: (key) => chrome.storage.local.remove(key),
  };
}

/**
 * The single source of truth for extension settings, shared between the background service
 * worker and any page that needs it. Pass an explicit `area` in tests; production code omits it
 * and gets the real chrome.storage.local.
 */
export function createSettingsStorage(area: ChromeStorageArea = chromeLocalArea()): VersionedStorage<Settings> {
  return new VersionedStorage<Settings>(area, STORAGE_KEY, CURRENT_VERSION, [], DEFAULT_SETTINGS);
}

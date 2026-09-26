/**
 * The subset of chrome.storage.StorageArea this package needs (get/set/remove of a single key).
 * Injected by the caller — the real extension passes chrome.storage.local/sync/session; tests
 * pass an in-memory fake — so this package never touches the chrome.* globals directly.
 */
export interface ChromeStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/** The wire shape actually written to storage: the schema version plus the data itself. */
export interface StoredEnvelope<T = unknown> {
  version: number;
  data: T;
}

/**
 * A migration that upgrades stored data to `version`. `migrate` receives whatever the previous
 * version stored (untyped, since it may predate the current type) and the version it came from.
 */
export interface Migration<T = unknown> {
  version: number;
  migrate: (data: unknown, fromVersion: number) => T;
}

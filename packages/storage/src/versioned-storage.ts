import type { ChromeStorageArea, Migration, StoredEnvelope } from './types.js';

function isStoredEnvelope(value: unknown): value is StoredEnvelope {
  return typeof value === 'object' && value !== null && typeof (value as StoredEnvelope).version === 'number' && 'data' in value;
}

export class VersionedStorage<T> {
  constructor(
    private readonly area: ChromeStorageArea,
    private readonly key: string,
    private readonly currentVersion: number,
    private readonly migrations: readonly Migration[],
    private readonly defaultValue: T
  ) {}

  async get(): Promise<T> {
    const result = await this.area.get(this.key);
    const raw = result[this.key];

    if (raw === undefined) return this.defaultValue;
    if (!isStoredEnvelope(raw)) {
      // Pre-versioning or corrupted data — fail safe to the default rather than guess its shape.
      return this.defaultValue;
    }
    if (raw.version > this.currentVersion) {
      // Data was written by a newer version of the code (e.g. the user downgraded the
      // extension). Migrations only go forward, so fail safe to the default rather than
      // silently truncate fields this version doesn't understand.
      return this.defaultValue;
    }

    let data: unknown = raw.data;
    let version = raw.version;
    const applicable = [...this.migrations]
      .filter((m) => m.version > version)
      .sort((a, b) => a.version - b.version);
    for (const migration of applicable) {
      data = migration.migrate(data, version);
      version = migration.version;
    }
    return data as T;
  }

  async set(value: T): Promise<void> {
    const envelope: StoredEnvelope<T> = { version: this.currentVersion, data: value };
    await this.area.set({ [this.key]: envelope });
  }

  async remove(): Promise<void> {
    await this.area.remove(this.key);
  }
}

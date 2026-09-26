import { VersionedStorage, type ChromeStorageArea } from '@appforge/storage';
import type { EventEnvelope, TelemetryQueueOptions } from './types.js';

interface QueuedState {
  seq: number;
  events: EventEnvelope[];
}

const DEFAULT_MAX_QUEUE_SIZE = 500;
const STORAGE_KEY = 'appforge_telemetry_queue';
const STORAGE_VERSION = 1;

export class TelemetryQueue {
  private readonly storage: VersionedStorage<QueuedState>;
  private readonly maxQueueSize: number;
  private readonly now: () => number;

  constructor(area: ChromeStorageArea, private readonly options: TelemetryQueueOptions) {
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.now = options.now ?? Date.now;
    this.storage = new VersionedStorage<QueuedState>(area, STORAGE_KEY, STORAGE_VERSION, [], { seq: 0, events: [] });
  }

  async enqueue(event: string, props: Record<string, unknown> = {}): Promise<EventEnvelope> {
    const state = await this.storage.get();
    const envelope: EventEnvelope = {
      v: 1,
      product: this.options.product,
      app_version: this.options.appVersion,
      env: this.options.env,
      install_id: this.options.installId,
      session_id: this.options.sessionId,
      ts: this.now(),
      event,
      props,
      seq: state.seq,
    };
    const events = [...state.events, envelope].slice(-this.maxQueueSize);
    await this.storage.set({ seq: state.seq + 1, events });
    return envelope;
  }

  async size(): Promise<number> {
    return (await this.storage.get()).events.length;
  }

  /** Returns the queued envelopes and clears the queue; the seq counter is preserved. */
  async drain(): Promise<EventEnvelope[]> {
    const state = await this.storage.get();
    await this.storage.set({ seq: state.seq, events: [] });
    return state.events;
  }
}

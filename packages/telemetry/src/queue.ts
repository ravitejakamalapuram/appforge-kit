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
  // Serializes every read-modify-write against storage. Without this, two overlapping
  // enqueue() calls (a very normal pattern for fire-and-forget `track()` helpers that callers
  // don't await) both read the same seq, both write, and the second write clobbers the first —
  // one event silently vanishes and the other gets a duplicate seq (Review finding).
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(area: ChromeStorageArea, private readonly options: TelemetryQueueOptions) {
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.now = options.now ?? Date.now;
    this.storage = new VersionedStorage<QueuedState>(area, STORAGE_KEY, STORAGE_VERSION, [], { seq: 0, events: [] });
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.writeChain.then(fn, fn);
    this.writeChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async enqueue(event: string, props: Record<string, unknown> = {}): Promise<EventEnvelope> {
    return this.serialize(async () => {
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
    });
  }

  async size(): Promise<number> {
    return (await this.storage.get()).events.length;
  }

  /**
   * Returns up to `maxCount` queued envelopes WITHOUT removing them. Pair with `ack()` after a
   * batch is confirmed delivered — this is the retry-safe way to drain the queue for POSTing:
   * if delivery fails, the events are still there to retry (the server's idempotent
   * `(install_id, seq)` write means a resend is always safe). Prefer this over `drain()`.
   */
  async peek(maxCount: number = this.maxQueueSize): Promise<EventEnvelope[]> {
    const state = await this.storage.get();
    return state.events.slice(0, maxCount);
  }

  /** Removes every queued envelope with `seq <= uptoSeq`. Call after a `peek()`'d batch's POST succeeds. */
  async ack(uptoSeq: number): Promise<void> {
    return this.serialize(async () => {
      const state = await this.storage.get();
      const events = state.events.filter((e) => e.seq > uptoSeq);
      await this.storage.set({ seq: state.seq, events });
    });
  }

  /**
   * Returns the queued envelopes and clears the queue immediately; the seq counter is preserved.
   * NOT retry-safe: a delivery failure after `drain()` has already cleared the queue loses that
   * batch for good, since there is nothing left to resend. Prefer `peek()` + `ack()` for any
   * consumer that POSTs the drained batch over a network.
   */
  async drain(): Promise<EventEnvelope[]> {
    return this.serialize(async () => {
      const state = await this.storage.get();
      await this.storage.set({ seq: state.seq, events: [] });
      return state.events;
    });
  }
}

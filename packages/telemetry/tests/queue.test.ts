import { describe, it, expect } from 'vitest';
import type { ChromeStorageArea } from '@appforge/storage';
import { TelemetryQueue } from '../src/index.js';

function fakeArea(initial: Record<string, unknown> = {}): ChromeStorageArea {
  const store: Record<string, unknown> = { ...initial };
  return {
    async get(key: string) {
      return key in store ? { [key]: store[key] } : {};
    },
    async set(items: Record<string, unknown>) {
      Object.assign(store, items);
    },
    async remove(key: string) {
      delete store[key];
    },
  };
}

const BASE_OPTIONS = {
  product: 'json-workbench',
  appVersion: '0.2.0',
  env: 'dev' as const,
  installId: 'install-abc',
  sessionId: 'session-1',
};

describe('TelemetryQueue', () => {
  it('enqueues an event with seq 0 on a fresh queue', async () => {
    const queue = new TelemetryQueue(fakeArea(), { ...BASE_OPTIONS, now: () => 1000 });
    const envelope = await queue.enqueue('feature_used', { feature: 'pipeline_run' });
    expect(envelope).toEqual({
      v: 1, product: 'json-workbench', app_version: '0.2.0', env: 'dev',
      install_id: 'install-abc', session_id: 'session-1', ts: 1000,
      event: 'feature_used', props: { feature: 'pipeline_run' }, seq: 0,
    });
  });

  it('defaults props to an empty object when none are given', async () => {
    const queue = new TelemetryQueue(fakeArea(), BASE_OPTIONS);
    const envelope = await queue.enqueue('app_installed');
    expect(envelope.props).toEqual({});
  });

  it('increments seq on each enqueue', async () => {
    const queue = new TelemetryQueue(fakeArea(), BASE_OPTIONS);
    const first = await queue.enqueue('a');
    const second = await queue.enqueue('b');
    expect(first.seq).toBe(0);
    expect(second.seq).toBe(1);
  });

  it('persists the seq counter across queue instances backed by the same storage (Review Focus: survives a restart)', async () => {
    const area = fakeArea();
    await new TelemetryQueue(area, BASE_OPTIONS).enqueue('a');
    const reopened = new TelemetryQueue(area, BASE_OPTIONS);
    const envelope = await reopened.enqueue('b');
    expect(envelope.seq).toBe(1);
  });

  it('caps the queue at maxQueueSize, dropping the oldest event', async () => {
    const queue = new TelemetryQueue(fakeArea(), { ...BASE_OPTIONS, maxQueueSize: 2 });
    await queue.enqueue('a');
    await queue.enqueue('b');
    await queue.enqueue('c');
    const drained = await queue.drain();
    expect(drained.map((e) => e.event)).toEqual(['b', 'c']);
  });

  it('drain clears the queue so a second drain returns empty, but keeps the seq counter', async () => {
    const queue = new TelemetryQueue(fakeArea(), BASE_OPTIONS);
    await queue.enqueue('a');
    const first = await queue.drain();
    const second = await queue.drain();
    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    const next = await queue.enqueue('b');
    expect(next.seq).toBe(1);
  });

  it('starts fresh without throwing when storage has nothing stored yet', async () => {
    const queue = new TelemetryQueue(fakeArea(), BASE_OPTIONS);
    expect(await queue.size()).toBe(0);
  });
});

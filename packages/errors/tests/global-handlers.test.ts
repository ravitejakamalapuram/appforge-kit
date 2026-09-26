import { describe, it, expect, vi } from 'vitest';
import { installGlobalErrorHandlers, reportError, type ErrorEventTarget } from '../src/index.js';

/** A minimal fake EventTarget: stores listeners by type and lets tests dispatch fake events. */
function fakeTarget(): ErrorEventTarget & { dispatch: (type: string, event: unknown) => void } {
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  return {
    addEventListener(type, listener) {
      (listeners[type] ??= []).push(listener as (event: unknown) => void);
    },
    removeEventListener(type, listener) {
      listeners[type] = (listeners[type] ?? []).filter((l) => l !== listener);
    },
    dispatch(type, event) {
      for (const listener of listeners[type] ?? []) listener(event);
    },
  };
}

describe('installGlobalErrorHandlers', () => {
  it('reports a window error event with message, stack, and source', () => {
    const target = fakeTarget();
    const sink = vi.fn();
    installGlobalErrorHandlers(target, sink);

    const error = new Error('boom');
    target.dispatch('error', { message: 'boom', error });

    expect(sink).toHaveBeenCalledTimes(1);
    const event = sink.mock.calls[0][0];
    expect(event.message).toBe('boom');
    expect(event.stack).toBe(error.stack);
    expect(event.source).toBe('window_error');
    expect(typeof event.timestamp).toBe('number');
  });

  it('reports an unhandled rejection with an Error reason', () => {
    const target = fakeTarget();
    const sink = vi.fn();
    installGlobalErrorHandlers(target, sink);

    const reason = new Error('rejected');
    target.dispatch('unhandledrejection', { reason });

    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ message: 'rejected', stack: reason.stack, source: 'unhandled_rejection' }));
  });

  it('reports an unhandled rejection with a non-Error reason (e.g. a rejected string) without crashing', () => {
    const target = fakeTarget();
    const sink = vi.fn();
    installGlobalErrorHandlers(target, sink);

    target.dispatch('unhandledrejection', { reason: 'just a string' });

    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ message: 'just a string', stack: undefined, source: 'unhandled_rejection' }));
  });

  it('the returned uninstall function actually removes both listeners', () => {
    const target = fakeTarget();
    const sink = vi.fn();
    const uninstall = installGlobalErrorHandlers(target, sink);

    uninstall();
    target.dispatch('error', { message: 'after uninstall', error: new Error('x') });
    target.dispatch('unhandledrejection', { reason: new Error('y') });

    expect(sink).not.toHaveBeenCalled();
  });
});

describe('reportError', () => {
  it('reports a manual error with the given context', () => {
    const sink = vi.fn();
    reportError(sink, new Error('manual failure'), { feature: 'export' });

    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'manual failure', source: 'manual', context: { feature: 'export' } })
    );
  });

  it('handles a non-Error value passed to reportError', () => {
    const sink = vi.fn();
    reportError(sink, 'plain string failure');

    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ message: 'plain string failure', stack: undefined, source: 'manual' }));
  });
});

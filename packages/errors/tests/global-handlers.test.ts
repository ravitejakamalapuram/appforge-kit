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

  it('reports a cross-origin/muted script error (event.error is null, per the browser spec) using event.message, not the string "null" (fix)', () => {
    const target = fakeTarget();
    const sink = vi.fn();
    installGlobalErrorHandlers(target, sink);

    target.dispatch('error', { message: 'Script error.', error: null });

    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ message: 'Script error.', source: 'window_error' }));
  });

  it('does not let a synchronously throwing sink escape the listener (fix)', () => {
    const target = fakeTarget();
    const throwingSink = vi.fn(() => { throw new Error('sink is broken'); });
    installGlobalErrorHandlers(target, throwingSink);

    expect(() => target.dispatch('error', { message: 'x', error: new Error('x') })).not.toThrow();
    expect(throwingSink).toHaveBeenCalledTimes(1);
  });

  it('does not let a rejecting async sink produce an unhandled rejection (fix)', async () => {
    const target = fakeTarget();
    const rejectingSink = vi.fn(async () => { throw new Error('telemetry endpoint down'); });
    installGlobalErrorHandlers(target, rejectingSink);

    target.dispatch('error', { message: 'x', error: new Error('x') });
    // Give the rejecting sink's promise a chance to settle. If its rejection were unhandled,
    // vitest's own unhandled-rejection detector (as it caught the equivalent case in
    // packages/messaging's tests) would fail this test run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rejectingSink).toHaveBeenCalledTimes(1);
  });

  it('drops a re-entrant report that fires while the sink for a PRIOR report is still in flight, instead of looping forever (fix: a rejecting async sink whose own failure re-triggers unhandledrejection must not call itself again immediately)', async () => {
    const target = fakeTarget();
    let resolveFirstSinkCall!: () => void;
    const sink = vi.fn(() => new Promise<void>((resolve) => { resolveFirstSinkCall = resolve; }));
    installGlobalErrorHandlers(target, sink);

    target.dispatch('error', { message: 'first', error: new Error('first') });
    // While the first call's promise is still unresolved, a second report comes in — this is
    // exactly the shape of "the sink's own rejection re-triggers an error event" collapsed into
    // a synchronous re-entrant call for a deterministic test.
    target.dispatch('error', { message: 'second (re-entrant)', error: new Error('second') });
    expect(sink).toHaveBeenCalledTimes(1);

    resolveFirstSinkCall();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Once the first call has settled, a genuinely new report is reported normally again.
    target.dispatch('error', { message: 'third (after settling)', error: new Error('third') });
    expect(sink).toHaveBeenCalledTimes(2);
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

  it('does not throw when the sink itself throws synchronously (fix)', () => {
    const throwingSink = vi.fn(() => { throw new Error('sink is broken'); });
    expect(() => reportError(throwingSink, new Error('x'))).not.toThrow();
  });

  it('does not produce an unhandled rejection when the sink returns a rejecting promise (fix)', async () => {
    const rejectingSink = vi.fn(async () => { throw new Error('telemetry endpoint down'); });
    reportError(rejectingSink, new Error('x'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rejectingSink).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendTypedMessage, MessagingTimeoutError, type ChromeRuntime } from '../src/index.js';

describe('sendTypedMessage', () => {
  it('resolves with the result on an ok:true response', async () => {
    const runtime: ChromeRuntime = {
      sendMessage: async (message) => ({ requestId: (message as { requestId: string }).requestId, ok: true, result: { echoed: true } }),
    };
    const result = await sendTypedMessage(runtime, 'ping', { x: 1 });
    expect(result).toEqual({ echoed: true });
  });

  it('throws the error message on an ok:false response', async () => {
    const runtime: ChromeRuntime = {
      sendMessage: async () => ({ requestId: 'irrelevant', ok: false, error: { message: 'handler blew up' } }),
    };
    await expect(sendTypedMessage(runtime, 'ping', {})).rejects.toThrow('handler blew up');
  });

  it('throws a clear "no handler" error when sendMessage resolves to undefined (no listener registered)', async () => {
    const runtime: ChromeRuntime = { sendMessage: async () => undefined };
    await expect(sendTypedMessage(runtime, 'ping', {})).rejects.toThrow(/No handler responded/);
  });

  describe('timeout', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('throws MessagingTimeoutError when no response arrives within timeoutMs', async () => {
      const runtime: ChromeRuntime = { sendMessage: () => new Promise(() => {}) }; // never resolves
      const promise = sendTypedMessage(runtime, 'ping', {}, { timeoutMs: 1000 });
      const assertion = expect(promise).rejects.toThrow(MessagingTimeoutError);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    });

    it('clears its timeout on a successful response instead of leaving a timer running (fix: was leaking a live timer per call)', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      const runtime: ChromeRuntime = { sendMessage: async () => ({ requestId: 'x', ok: true, result: 'fast' }) };
      await sendTypedMessage(runtime, 'ping', {}, { timeoutMs: 5000 });
      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('rejects with the real error, and leaves no dangling timeout that later rejects unhandled, when sendMessage throws synchronously (fix: a real MV3 failure — "Extension context invalidated" after a reload)', async () => {
      const runtime: ChromeRuntime = {
        sendMessage: () => { throw new Error('Extension context invalidated'); },
      };
      await expect(sendTypedMessage(runtime, 'ping', {}, { timeoutMs: 1000 })).rejects.toThrow('Extension context invalidated');
      // If the timeout set up before the synchronous throw were never cleared, it would still
      // fire here and reject with no handler — vitest's own unhandled-rejection detector (as
      // triggered the equivalent case in message-router.test.ts) would fail this test run.
      await vi.advanceTimersByTimeAsync(1000);
    });
  });
});

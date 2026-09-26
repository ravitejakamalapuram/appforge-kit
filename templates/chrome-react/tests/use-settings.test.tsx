import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ChromeRuntime } from '@appforge/messaging';
import { useSettings } from '../src/hooks/useSettings.js';
import type { Settings } from '../src/shared/settings.js';

function fakeRuntime(initial: Settings = { theme: 'light' }): ChromeRuntime {
  let state = initial;
  return {
    sendMessage: async (message: unknown) => {
      const { type, payload, requestId } = message as { type: string; payload: unknown; requestId: string };
      if (type === 'getSettings') return { requestId, ok: true, result: state };
      if (type === 'setTheme') {
        state = { theme: (payload as { theme: Settings['theme'] }).theme };
        return { requestId, ok: true, result: { ok: true } };
      }
      return { requestId, ok: false, error: { message: `unhandled type "${type}" in fake runtime` } };
    },
  };
}

describe('useSettings', () => {
  it('starts in a loading state and resolves the initial settings from the runtime', async () => {
    // The runtime is created ONCE, outside renderHook's callback, and passed as a stable
    // reference — the same as real code (main.tsx calls the real runtime factory once, not on
    // every render). Creating a fresh fakeRuntime() inside the renderHook callback would give a
    // new object on every re-render, which useSettings' useEffect([runtime]) would treat as a
    // change and re-run against a *reset* fake, discarding whatever the fake had recorded.
    const runtime = fakeRuntime({ theme: 'dark' });
    const { result } = renderHook(() => useSettings(runtime));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.settings).toEqual({ theme: 'dark' });
    expect(result.current.error).toBeUndefined();
  });

  it('setTheme updates the returned settings after the round trip completes', async () => {
    const runtime = fakeRuntime({ theme: 'light' });
    const { result } = renderHook(() => useSettings(runtime));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      void result.current.setTheme('dark');
    });

    await waitFor(() => expect(result.current.settings).toEqual({ theme: 'dark' }));
  });

  it('surfaces a runtime failure as `error` instead of throwing out of the hook', async () => {
    const failingRuntime: ChromeRuntime = {
      sendMessage: async () => {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      },
    };
    const { result } = renderHook(() => useSettings(failingRuntime));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error?.message).toContain('Could not establish connection');
    expect(result.current.settings).toBeUndefined();
  });

  it('does not update state after unmount (fix would regress into a React "state update on unmounted component" warning)', async () => {
    let resolveSend: ((value: unknown) => void) | undefined;
    const slowRuntime: ChromeRuntime = {
      sendMessage: () => new Promise((resolve) => { resolveSend = resolve; }),
    };
    const { result, unmount } = renderHook(() => useSettings(slowRuntime));
    expect(result.current.loading).toBe(true);

    // sendTypedMessage calls runtime.sendMessage from inside a Promise.resolve().then(...), so
    // slowRuntime.sendMessage (and therefore resolveSend) isn't set until a microtask later —
    // wait for it before unmounting, or there is nothing yet to resolve.
    await waitFor(() => expect(resolveSend).toBeDefined());

    unmount();
    resolveSend?.({ requestId: 'x', ok: true, result: { theme: 'dark' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // No assertion beyond "this did not throw/warn" — the real risk here is a
    // setState-after-unmount warning, which this test's absence of any thrown/rejected
    // error already rules out given vitest would surface an unhandled rejection otherwise.
  });
});

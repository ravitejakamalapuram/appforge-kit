import { useCallback, useEffect, useRef, useState } from 'react';
import { sendTypedMessage, type ChromeRuntime } from '@appforge/messaging';
import type { AppMessages } from '../shared/messages.js';
import type { Settings } from '../shared/settings.js';

function defaultRuntime(): ChromeRuntime {
  return { sendMessage: (message) => chrome.runtime.sendMessage(message) };
}

export interface UseSettingsResult {
  settings: Settings | undefined;
  loading: boolean;
  error: Error | undefined;
  setTheme: (theme: Settings['theme']) => Promise<void>;
}

/**
 * Loads settings from the background service worker on mount and exposes a `setTheme` mutator.
 * Accepts an explicit `runtime` for tests; production callers omit it and get the real
 * chrome.runtime. A runtime failure (e.g. the service worker hasn't woken up yet) is surfaced as
 * `error`, not thrown, so a component can render a real error state instead of crashing.
 */
export function useSettings(runtime: ChromeRuntime = defaultRuntime()): UseSettingsResult {
  const [settings, setSettings] = useState<Settings>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    sendTypedMessage<AppMessages['getSettings']['payload'], AppMessages['getSettings']['result']>(runtime, 'getSettings', undefined)
      .then((result) => {
        if (mountedRef.current) setSettings(result);
      })
      .catch((err: unknown) => {
        if (mountedRef.current) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
    return () => {
      mountedRef.current = false;
    };
  }, [runtime]);

  const setTheme = useCallback(
    async (theme: Settings['theme']) => {
      await sendTypedMessage<AppMessages['setTheme']['payload'], AppMessages['setTheme']['result']>(runtime, 'setTheme', { theme });
      if (mountedRef.current) setSettings((prev) => (prev ? { ...prev, theme } : { theme }));
    },
    [runtime]
  );

  return { settings, loading, error, setTheme };
}

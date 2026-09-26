import { useEffect, useState } from 'react';
import { FlagsClient } from '@appforge/flags';
import { useSettings } from '../hooks/useSettings.js';

interface TemplateFlags {
  showBetaSection: boolean;
}

// Demo wiring for @appforge/flags. No appforge-edge deployment exists yet (P1-10), so this
// edgeUrl is a placeholder — the fetch will fail and FlagsClient correctly falls back to
// `defaults` below, which is exactly the "fails safe" behavior this is meant to demonstrate.
// Replace edgeUrl with a real deployment, and the in-memory cache with @appforge/storage, once
// appforge-edge exists.
const memoryCache = new Map<string, { value: unknown; fetchedAt: number }>();
const flags = new FlagsClient<TemplateFlags>(
  { fetch: (url) => fetch(url) },
  {
    get: async (key) => memoryCache.get(key),
    set: async (key, value, fetchedAt) => void memoryCache.set(key, { value, fetchedAt }),
  },
  { edgeUrl: 'https://edge.appforge.example', product: 'chrome-react-template', defaults: { showBetaSection: false } }
);

export function App() {
  const { settings, loading, error, setTheme } = useSettings();
  const [showBetaSection, setShowBetaSection] = useState(false);

  useEffect(() => {
    flags.get().then((result) => setShowBetaSection(result.showBetaSection));
  }, []);

  if (loading) return <p>Loading…</p>;
  if (error) return <p role="alert">Something went wrong: {error.message}</p>;

  return (
    <main>
      <h1>AppForge Template — Options</h1>
      <section>
        <h2>Appearance</h2>
        <label>
          <input
            type="checkbox"
            checked={settings?.theme === 'dark'}
            onChange={(event) => void setTheme(event.target.checked ? 'dark' : 'light')}
          />
          Dark theme
        </label>
      </section>
      {showBetaSection ? (
        <section>
          <h2>Beta features</h2>
          <p>You have an active beta flag enabled.</p>
        </section>
      ) : null}
    </main>
  );
}

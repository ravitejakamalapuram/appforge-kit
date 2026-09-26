import { useSettings } from '../hooks/useSettings.js';

export function App() {
  const { settings, loading, error, setTheme } = useSettings();

  if (loading) return <p>Loading…</p>;
  if (error) return <p role="alert">Something went wrong: {error.message}</p>;

  return (
    <main>
      <h1>AppForge Template</h1>
      <button type="button" onClick={() => void setTheme(settings?.theme === 'dark' ? 'light' : 'dark')}>
        Toggle theme (currently {settings?.theme})
      </button>
    </main>
  );
}

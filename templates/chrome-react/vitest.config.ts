import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// A separate config from vite.config.ts: the crx() plugin used for the real extension build
// expects a Chrome extension context and isn't relevant to (and can interfere with) unit tests.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
  },
});

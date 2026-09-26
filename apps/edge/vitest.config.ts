import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// @cloudflare/vitest-pool-workers@0.22.0 (requires Vitest 4) dropped the old
// defineWorkersConfig()/poolOptions.workers shape in favor of a Vite plugin — see this plan's
// Task 2 ledger entry for why apps/edge is pinned to Vitest 4 in isolation from the rest of
// the monorepo (which stays on Vitest 2 + defineWorkspace).
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.toml' } })],
});

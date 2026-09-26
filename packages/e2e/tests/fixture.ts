import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * The fixture every check in this package runs against: chrome-vanilla's real built output.
 * Requires `pnpm build` (root) to have run first — guaranteed for `pnpm test` (root `pretest`
 * runs `pnpm run build`) but NOT guaranteed for a bare `pnpm --filter @appforge/e2e test`;
 * run `pnpm --filter appforge-chrome-vanilla-template build` first if using that filtered form.
 */
export const CHROME_VANILLA_DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../templates/chrome-vanilla/dist'
);

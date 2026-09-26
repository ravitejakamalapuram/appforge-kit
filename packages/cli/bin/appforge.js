#!/usr/bin/env node
// A committed, always-present entry point for pnpm's workspace bin linking. pnpm creates the
// `node_modules/.bin/appforge` symlink at `pnpm install` time, pointing at whatever this "bin"
// path resolves to on disk *then* -- if it pointed straight at dist/index.js (gitignored, only
// produced by `pnpm run build`), a fresh checkout's install would skip the link (ENOENT) and
// never retry it once `pnpm build` later creates dist/, leaving `appforge` unresolved for any
// consumer (e.g. templates/chrome-vanilla's test:e2e script) even after a full build. This file
// always exists in git, so the link is always created; it just delegates to the real build output.
import '../dist/index.js';

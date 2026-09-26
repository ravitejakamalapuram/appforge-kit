// Applies src/schema.ts's SCHEMA_STATEMENTS to a real D1 database via wrangler.
// Usage: node --experimental-strip-types scripts/apply-schema.ts [--remote]
import { execFileSync } from 'node:child_process';
// Note the .ts extension: this script runs via `node --experimental-strip-types`, which
// (unlike tsc's NodeNext resolution used everywhere else in this repo) does not remap a `.js`
// import specifier to a sibling `.ts` file — it needs the real on-disk extension.
import { SCHEMA_STATEMENTS } from '../src/schema.ts';

const extraArgs = process.argv.slice(2);
for (const statement of SCHEMA_STATEMENTS) {
  execFileSync('wrangler', ['d1', 'execute', 'appforge-edge-db', '--command', statement, ...extraArgs], {
    stdio: 'inherit',
  });
}

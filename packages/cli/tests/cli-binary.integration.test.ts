import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '../dist/index.js');

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: Buffer | string; stderr?: Buffer | string };
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

describe('appforge CLI binary (commander wiring, not just the exported run* functions)', () => {
  it('exits 0 and prints the version for --version', () => {
    const { code, stdout } = run(['--version']);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('0.1.0');
  });

  it('exits 2, not commander\'s default 1, when a required option is missing (Review Focus: usage errors stay in the cli-output@1 exit-code table)', () => {
    const { code } = run(['product-transition', '--to', 'RESEARCHING']);
    expect(code).toBe(2);
  });

  it('exits 2 for an unknown option instead of crashing past our exit-code contract', () => {
    const { code } = run(['product-transition', '--from', 'DISCOVERED', '--to', 'RESEARCHING', '--not-a-real-flag']);
    expect(code).toBe(2);
  });
});

export interface CliOutput<T> {
  schema: 'cli-output@1';
  ok: boolean;
  command: string;
  data?: T;
  errors: string[];
}

export function buildOutput<T>(command: string, ok: boolean, data?: T, errors: string[] = []): CliOutput<T> {
  return { schema: 'cli-output@1', ok, command, data, errors };
}

export function printOutput<T>(output: CliOutput<T>, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(output) + '\n');
    return;
  }
  if (output.ok) {
    console.log(`✔ ${output.command} passed`);
  } else {
    console.error(`✘ ${output.command} failed`);
    for (const err of output.errors) console.error(`  - ${err}`);
  }
}

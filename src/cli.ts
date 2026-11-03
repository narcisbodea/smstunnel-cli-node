#!/usr/bin/env node
import { OptionSpec, parseArgs } from './args';
import { login, logout } from './commands/login';
import { phones } from './commands/phones';
import { received } from './commands/received';
import { send } from './commands/send';
import { status } from './commands/status';
import { usage } from './commands/usage';
import { EXIT, VERSION } from './constants';
import { buildContext, Context } from './context';
import { CliError, usageError } from './errors';
import { COMMAND_HELP, helpFor } from './help';

const GLOBAL_OPTIONS: OptionSpec[] = [
  { name: 'json', type: 'boolean' },
  { name: 'api-base', type: 'string' },
  { name: 'help', type: 'boolean', short: 'h' },
  { name: 'version', type: 'boolean', short: 'v' },
];

const SEND_OPTIONS: OptionSpec[] = [
  { name: 'phone', type: 'string' },
  { name: 'country', type: 'string' },
  { name: 'wait', type: 'boolean' },
  { name: 'timeout', type: 'string' },
  { name: 'idempotency-key', type: 'string' },
];

const COMMAND_OPTIONS: Record<string, OptionSpec[]> = {
  login: [],
  logout: [],
  phones: [],
  send: SEND_OPTIONS,
  code: SEND_OPTIONS,
  status: [],
  received: [
    { name: 'since', type: 'string' },
    { name: 'from', type: 'string' },
    { name: 'phone', type: 'string' },
    { name: 'limit', type: 'string' },
    { name: 'watch', type: 'boolean' },
    { name: 'interval', type: 'string' },
  ],
  usage: [],
};

const COMMANDS: Record<string, (ctx: Context, args: string[]) => Promise<number>> = {
  login,
  logout,
  phones,
  send: (ctx, args) => send(ctx, args, 'text'),
  code: (ctx, args) => send(ctx, args, 'code'),
  status,
  received,
  usage,
};

function allOptions(): OptionSpec[] {
  const byName = new Map<string, OptionSpec>();
  for (const spec of [...GLOBAL_OPTIONS, ...Object.values(COMMAND_OPTIONS).flat()]) byName.set(spec.name, spec);
  return [...byName.values()];
}

function report(error: unknown, json: boolean): number {
  if (error instanceof CliError) {
    if (json) {
      process.stderr.write(
        `${JSON.stringify({ error: { message: error.message, exitCode: error.exitCode, ...error.details } })}\n`,
      );
    } else {
      process.stderr.write(`${error.message}\n`);
    }
    return error.exitCode;
  }
  const message = error instanceof Error ? error.stack || error.message : String(error);
  if (json) {
    process.stderr.write(`${JSON.stringify({ error: { message: String((error as Error)?.message ?? error), exitCode: EXIT.UNEXPECTED } })}\n`);
  } else {
    process.stderr.write(`Unexpected error: ${message}\n`);
  }
  return EXIT.UNEXPECTED;
}

export async function main(argv: string[]): Promise<number> {
  const json = argv.includes('--json');
  try {
    const { positionals, options } = parseArgs(argv, allOptions());
    const [command, ...args] = positionals;

    if (options.version === true) {
      process.stdout.write(`${VERSION}\n`);
      return EXIT.OK;
    }
    if (command === 'help') {
      process.stdout.write(`${helpFor(args[0])}\n`);
      return EXIT.OK;
    }
    if (!command) {
      process.stdout.write(`${helpFor(undefined)}\n`);
      return options.help === true ? EXIT.OK : EXIT.USAGE;
    }
    const run = COMMANDS[command];
    if (!run) {
      throw usageError(`Unknown command "${command}". See "smstunnel --help".`);
    }
    if (options.help === true) {
      process.stdout.write(`${COMMAND_HELP[command] ?? helpFor(undefined)}\n`);
      return EXIT.OK;
    }
    const allowed = new Set([...GLOBAL_OPTIONS, ...COMMAND_OPTIONS[command]].map((spec) => spec.name));
    for (const name of Object.keys(options)) {
      if (!allowed.has(name)) throw usageError(`--${name} is not an option of "smstunnel ${command}". See "smstunnel ${command} --help".`);
    }
    const ctx = buildContext(options);
    return await run(ctx, args);
  } catch (error) {
    return report(error, json);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.exitCode = report(error, process.argv.includes('--json'));
    },
  );
}

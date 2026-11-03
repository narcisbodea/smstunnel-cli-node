import { usageError } from './errors';

export interface OptionSpec {
  name: string;
  type: 'boolean' | 'string';
  /** A short form such as "h" for -h. */
  short?: string;
}

export interface ParsedArgs {
  positionals: string[];
  options: Record<string, string | boolean>;
}

/**
 * A small argv parser: --name value, --name=value, boolean --flags, the short forms listed, and
 * "--" after which everything is a positional. A word starting with a single "-" that is not a
 * listed short form stays a positional, so a text such as "-20% today" needs no quoting tricks.
 * Unknown --options are refused.
 */
export function parseArgs(argv: string[], specs: OptionSpec[]): ParsedArgs {
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  const byShort = new Map(specs.filter((spec) => spec.short).map((spec) => [spec.short as string, spec]));
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith('--') && token.length > 2) {
      const eq = token.indexOf('=');
      const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
      const spec = byName.get(name);
      if (!spec) {
        throw usageError(`Unknown option --${name}. See "smstunnel --help".`);
      }
      if (spec.type === 'boolean') {
        if (eq !== -1) throw usageError(`--${name} takes no value.`);
        options[name] = true;
        continue;
      }
      let value: string | undefined;
      if (eq !== -1) {
        value = token.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next === undefined || (next.startsWith('--') && next.length > 2)) {
          throw usageError(`--${name} needs a value.`);
        }
        value = next;
        i += 1;
      }
      if (value === '') throw usageError(`--${name} needs a value.`);
      options[name] = value;
      continue;
    }
    if (/^-[A-Za-z]$/.test(token) && byShort.has(token.slice(1))) {
      const spec = byShort.get(token.slice(1)) as OptionSpec;
      if (spec.type === 'boolean') {
        options[spec.name] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined) throw usageError(`-${spec.short} needs a value.`);
      options[spec.name] = next;
      i += 1;
      continue;
    }
    positionals.push(token);
  }
  return { positionals, options };
}

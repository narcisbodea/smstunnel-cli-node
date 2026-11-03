import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EXIT } from './constants';
import { CliError } from './errors';

export type StoreKind = 'macos-keychain' | 'windows-credential-manager' | 'secret-service' | 'file';

/** config.json: where the key is, and the API address it belongs to. The key itself only with the file store. */
export interface Config {
  keyStore?: StoreKind;
  apiBase?: string;
  apiKey?: string;
}

type Env = Record<string, string | undefined>;

const ACCOUNT = 'api-key';
const LABEL = 'SMSTunnel API key';
/** Keys are sk_live_ + hex; refusing anything else keeps them safe to hand to the keychain tools. */
export const KEY_PATTERN = /^[A-Za-z0-9_.-]{8,256}$/;

/** SMSTUNNEL_CONFIG_DIR, else %APPDATA%\smstunnel on Windows, else $XDG_CONFIG_HOME/smstunnel or ~/.config/smstunnel. */
export function configDir(env: Env = process.env, platform: string = process.platform, home: string = os.homedir()): string {
  if (env.SMSTUNNEL_CONFIG_DIR) return env.SMSTUNNEL_CONFIG_DIR;
  if (platform === 'win32') {
    return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'smstunnel');
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'smstunnel');
}

export function configPath(env: Env = process.env): string {
  return path.join(configDir(env), 'config.json');
}

export function readConfig(env: Env = process.env): Config {
  const file = configPath(env);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new CliError(`Could not read ${file}: ${(error as Error).message}`, EXIT.UNEXPECTED);
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Config) : {};
  } catch {
    throw new CliError(`${file} is not valid JSON. Delete it and run "smstunnel login" again.`, EXIT.UNEXPECTED);
  }
}

/** Writes config.json readable and writable only by you (0600), in a folder only you can open (0700). */
export function writeConfig(config: Config, env: Env = process.env): string {
  const dir = configDir(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Not ours to change (an existing shared folder): the file mode below still applies.
  }
  const file = path.join(dir, 'config.json');
  const temp = `${file}.${process.pid}.tmp`;
  const clean: Config = {};
  if (config.keyStore) clean.keyStore = config.keyStore;
  if (config.apiBase) clean.apiBase = config.apiBase;
  if (config.apiKey) clean.apiKey = config.apiKey;
  fs.writeFileSync(temp, `${JSON.stringify(clean, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, file);
  return file;
}

function keychainService(env: Env): string {
  const name = env.SMSTUNNEL_KEYCHAIN_SERVICE || 'smstunnel';
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) {
    throw new CliError('SMSTUNNEL_KEYCHAIN_SERVICE may only hold letters, digits, ".", "_" and "-".', EXIT.USAGE);
  }
  return name;
}

function onPath(command: string, env: Env): boolean {
  const dirs = (env.PATH || '').split(path.delimiter).filter(Boolean);
  return dirs.some((dir) => {
    try {
      fs.accessSync(path.join(dir, command), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export interface SecretStore {
  kind: Exclude<StoreKind, 'file'>;
  label: string;
  available(): boolean;
  save(key: string): void;
  load(): string | null;
  remove(): boolean;
}

const RUN_TIMEOUT_MS = 20_000;

/** macOS Keychain through /usr/bin/security; the key goes in on stdin (security -i), never in argv. */
function macosKeychain(env: Env): SecretStore {
  const tool = '/usr/bin/security';
  const service = keychainService(env);
  return {
    kind: 'macos-keychain',
    label: 'your macOS Keychain',
    available: () => fs.existsSync(tool),
    save(key) {
      const run = spawnSync(tool, ['-i'], {
        input: `add-generic-password -U -a "${ACCOUNT}" -s "${service}" -l "${LABEL}" -w "${key}"\n`,
        encoding: 'utf8',
        timeout: RUN_TIMEOUT_MS,
      });
      if (run.status !== 0 || this.load() !== key) {
        throw new Error((run.stderr || run.stdout || 'security could not save the key').trim());
      }
    },
    load() {
      const run = spawnSync(tool, ['find-generic-password', '-a', ACCOUNT, '-s', service, '-w'], {
        encoding: 'utf8',
        timeout: RUN_TIMEOUT_MS,
      });
      if (run.status !== 0) return null;
      const key = run.stdout.trim();
      return key === '' ? null : key;
    },
    remove() {
      const run = spawnSync(tool, ['delete-generic-password', '-a', ACCOUNT, '-s', service], {
        encoding: 'utf8',
        timeout: RUN_TIMEOUT_MS,
      });
      return run.status === 0;
    },
  };
}

/** The Secret Service (GNOME Keyring, KWallet) through secret-tool, which reads the key from stdin. */
function secretService(env: Env): SecretStore {
  const service = keychainService(env);
  return {
    kind: 'secret-service',
    label: 'your system keyring (Secret Service)',
    available: () => onPath('secret-tool', env) && Boolean(env.DBUS_SESSION_BUS_ADDRESS),
    save(key) {
      const run = spawnSync('secret-tool', ['store', `--label=${LABEL}`, 'service', service, 'account', ACCOUNT], {
        input: key,
        encoding: 'utf8',
        timeout: RUN_TIMEOUT_MS,
      });
      if (run.status !== 0 || this.load() !== key) {
        throw new Error((run.stderr || 'secret-tool could not save the key').trim());
      }
    },
    load() {
      const run = spawnSync('secret-tool', ['lookup', 'service', service, 'account', ACCOUNT], {
        encoding: 'utf8',
        timeout: RUN_TIMEOUT_MS,
      });
      if (run.status !== 0) return null;
      const key = run.stdout.trim();
      return key === '' ? null : key;
    },
    remove() {
      const run = spawnSync('secret-tool', ['clear', 'service', service, 'account', ACCOUNT], {
        encoding: 'utf8',
        timeout: RUN_TIMEOUT_MS,
      });
      return run.status === 0;
    },
  };
}

/**
 * Windows Credential Manager (the PasswordVault of Windows PowerShell 5.1, which ships with
 * Windows 10 and 11). The script goes in -EncodedCommand; the key only through stdin.
 */
function windowsCredentialManager(env: Env): SecretStore {
  const resource = keychainService(env);
  const powershell = path.join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const prelude =
    "$ErrorActionPreference = 'Stop'; " +
    '$null = [Windows.Security.Credentials.PasswordVault, Windows.Security.Credentials, ContentType = WindowsRuntime]; ' +
    '$vault = New-Object Windows.Security.Credentials.PasswordVault; ' +
    `$resource = '${resource}'; $account = '${ACCOUNT}'; `;
  const run = (script: string, input?: string) =>
    spawnSync(
      powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(prelude + script, 'utf16le').toString('base64')],
      { input: input ?? '', encoding: 'utf8', timeout: RUN_TIMEOUT_MS, windowsHide: true },
    );
  return {
    kind: 'windows-credential-manager',
    label: 'Windows Credential Manager',
    available: () => fs.existsSync(powershell),
    save(key) {
      const result = run(
        '$secret = [Console]::In.ReadToEnd().Trim(); ' +
          'try { $vault.FindAllByResource($resource) | ForEach-Object { $vault.Remove($_) } } catch { } ' +
          '$vault.Add((New-Object Windows.Security.Credentials.PasswordCredential($resource, $account, $secret)))',
        key,
      );
      if (result.status !== 0 || this.load() !== key) {
        throw new Error((result.stderr || 'PowerShell could not save the key').trim().split('\n')[0]);
      }
    },
    load() {
      const result = run(
        'try { $c = $vault.Retrieve($resource, $account) } catch { exit 3 }; $c.RetrievePassword(); [Console]::Out.Write($c.Password)',
      );
      if (result.status !== 0) return null;
      const key = result.stdout.trim();
      return key === '' ? null : key;
    },
    remove() {
      const result = run(
        '$n = 0; try { $vault.FindAllByResource($resource) | ForEach-Object { $vault.Remove($_); $n++ } } catch { }; [Console]::Out.Write($n)',
      );
      return result.status === 0 && Number(result.stdout.trim()) > 0;
    },
  };
}

/** The system store for this computer, or null (then the key goes in config.json). */
export function systemStore(env: Env = process.env, platform: string = process.platform): SecretStore | null {
  const choice = (env.SMSTUNNEL_KEY_STORE || 'auto').toLowerCase();
  if (choice === 'file') return null;
  if (choice !== 'auto') {
    throw new CliError('SMSTUNNEL_KEY_STORE takes "auto" or "file".', EXIT.USAGE);
  }
  if (platform === 'darwin') return macosKeychain(env);
  if (platform === 'win32') return windowsCredentialManager(env);
  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd') return secretService(env);
  return null;
}

function storeOfKind(kind: StoreKind | undefined, env: Env): SecretStore | null {
  switch (kind) {
    case 'macos-keychain':
      return macosKeychain(env);
    case 'windows-credential-manager':
      return windowsCredentialManager(env);
    case 'secret-service':
      return secretService(env);
    default:
      return null;
  }
}

export function storeLabel(kind: StoreKind | undefined, env: Env = process.env): string {
  if (kind === 'file' || kind === undefined) return configPath(env);
  return storeOfKind(kind, env)?.label ?? kind;
}

export interface SaveResult {
  kind: StoreKind;
  label: string;
  /** Why the system store was not used, when the key went to the file. */
  fallbackReason?: string;
}

/** Saves the key in the system store when there is one that works, else in config.json (0600). */
export function saveKey(key: string, apiBase: string | undefined, env: Env = process.env, platform: string = process.platform): SaveResult {
  if (!KEY_PATTERN.test(key)) {
    throw new CliError('That does not look like an SMSTunnel API key (they look like sk_live_…).', EXIT.USAGE);
  }
  const previous = readConfig(env);
  const store = systemStore(env, platform);
  let fallbackReason: string | undefined;
  if (store && store.available()) {
    try {
      store.save(key);
      // A key left in the file from an earlier login goes away.
      writeConfig({ keyStore: store.kind, apiBase }, env);
      return { kind: store.kind, label: store.label };
    } catch (error) {
      fallbackReason = `${store.label} did not take it (${(error as Error).message || 'unknown error'})`;
    }
  } else if (store) {
    fallbackReason = `${store.label} is not available here`;
  } else if ((env.SMSTUNNEL_KEY_STORE || '').toLowerCase() === 'file') {
    fallbackReason = 'SMSTUNNEL_KEY_STORE=file';
  } else {
    fallbackReason = 'no system keychain is known on this system';
  }
  // The earlier system entry, if any, is removed so only one copy of a key stays around.
  if (previous.keyStore && previous.keyStore !== 'file') {
    try {
      storeOfKind(previous.keyStore, env)?.remove();
    } catch {
      // Best effort.
    }
  }
  const file = writeConfig({ keyStore: 'file', apiBase, apiKey: key }, env);
  return { kind: 'file', label: file, fallbackReason };
}

export interface LoadedKey {
  key: string;
  source: 'env' | 'stored';
  kind?: StoreKind;
}

/** SMSTUNNEL_API_KEY wins; otherwise the saved key. Null when there is none. */
export function loadKey(env: Env = process.env): LoadedKey | null {
  const fromEnv = (env.SMSTUNNEL_API_KEY || '').trim();
  if (fromEnv !== '') return { key: fromEnv, source: 'env' };
  const config = readConfig(env);
  if (config.keyStore === 'file' || (!config.keyStore && config.apiKey)) {
    return config.apiKey ? { key: config.apiKey, source: 'stored', kind: 'file' } : null;
  }
  const store = storeOfKind(config.keyStore, env);
  if (!store) return null;
  const key = store.load();
  if (!key) {
    throw new CliError(
      `The saved key is missing from ${store.label}. Run "smstunnel login" again.`,
      EXIT.AUTH,
    );
  }
  return { key, source: 'stored', kind: store.kind };
}

export interface RemoveResult {
  removedFrom: string[];
}

/** Removes the saved key wherever it is, and the API address saved with it. */
export function removeKey(env: Env = process.env): RemoveResult {
  const config = readConfig(env);
  const removedFrom: string[] = [];
  const store = storeOfKind(config.keyStore, env);
  if (store) {
    try {
      if (store.remove()) removedFrom.push(store.label);
    } catch {
      // Reported below as nothing removed from it.
    }
  }
  const file = configPath(env);
  if (config.apiKey) removedFrom.push(file);
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  return { removedFrom };
}

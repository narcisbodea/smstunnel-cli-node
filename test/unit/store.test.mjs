import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { configDir, configPath, readConfig, writeConfig, saveKey, loadKey, removeKey, systemStore } = require('../../dist/store.js');

const KEY = `sk_live_${'0123456789abcdef'.repeat(2)}`;
const posix = process.platform !== 'win32';

function tempEnv(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smstunnel-store-'));
  return { env: { SMSTUNNEL_CONFIG_DIR: path.join(dir, 'cfg'), SMSTUNNEL_KEY_STORE: 'file', PATH: '', ...extra }, dir };
}

test('config folder: SMSTUNNEL_CONFIG_DIR, %APPDATA% on Windows, XDG or ~/.config elsewhere', () => {
  assert.equal(configDir({ SMSTUNNEL_CONFIG_DIR: '/x/y' }, 'linux', '/home/a'), '/x/y');
  assert.equal(configDir({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32', 'C:\\Users\\a'), path.join('C:\\Users\\a\\AppData\\Roaming', 'smstunnel'));
  assert.equal(configDir({ XDG_CONFIG_HOME: '/home/a/.cfg' }, 'linux', '/home/a'), path.join('/home/a/.cfg', 'smstunnel'));
  assert.equal(configDir({}, 'darwin', '/Users/a'), path.join('/Users/a', '.config', 'smstunnel'));
});

test('the file store: config.json with the key, readable only by you (0600)', () => {
  const { env, dir } = tempEnv();
  try {
    const saved = saveKey(KEY, undefined, env);
    assert.equal(saved.kind, 'file');
    assert.equal(saved.fallbackReason, 'SMSTUNNEL_KEY_STORE=file');
    const file = configPath(env);
    assert.equal(saved.label, file);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { keyStore: 'file', apiKey: KEY });
    if (posix) {
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
    }
    assert.deepEqual(loadKey(env), { key: KEY, source: 'stored', kind: 'file' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the API address saved with the key is kept, the default one is not written', () => {
  const { env, dir } = tempEnv();
  try {
    saveKey(KEY, 'http://127.0.0.1:3121/api/v1', env);
    assert.equal(readConfig(env).apiBase, 'http://127.0.0.1:3121/api/v1');
    saveKey(KEY, undefined, env);
    assert.equal(readConfig(env).apiBase, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('without a known system keychain the key falls back to the file, with the reason', () => {
  const { env, dir } = tempEnv({ SMSTUNNEL_KEY_STORE: undefined });
  try {
    const saved = saveKey(KEY, undefined, env, 'aix');
    assert.equal(saved.kind, 'file');
    assert.match(saved.fallbackReason, /no system keychain/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Linux without secret-tool or a D-Bus session falls back to the file', () => {
  const { env, dir } = tempEnv({ SMSTUNNEL_KEY_STORE: undefined });
  try {
    const store = systemStore(env, 'linux');
    assert.equal(store.kind, 'secret-service');
    assert.equal(store.available(), false);
    const saved = saveKey(KEY, undefined, env, 'linux');
    assert.equal(saved.kind, 'file');
    assert.match(saved.fallbackReason, /is not available here/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SMSTUNNEL_API_KEY wins over the saved key', () => {
  const { env, dir } = tempEnv();
  try {
    saveKey(KEY, undefined, env);
    const other = `sk_live_${'f'.repeat(32)}`;
    assert.deepEqual(loadKey({ ...env, SMSTUNNEL_API_KEY: ` ${other} ` }), { key: other, source: 'env' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no key saved: null', () => {
  const { env, dir } = tempEnv();
  try {
    assert.equal(loadKey(env), null);
    assert.deepEqual(readConfig(env), {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('logout removes the file and says where from', () => {
  const { env, dir } = tempEnv();
  try {
    saveKey(KEY, undefined, env);
    const file = configPath(env);
    assert.deepEqual(removeKey(env).removedFrom, [file]);
    assert.equal(fs.existsSync(file), false);
    assert.equal(loadKey(env), null);
    assert.deepEqual(removeKey(env).removedFrom, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('keys with characters an SMSTunnel key never has are refused (exit 2)', () => {
  const { env, dir } = tempEnv();
  try {
    for (const bad of ['sk_live_"; rm -rf', 'short', 'sk live with spaces', `sk_live_${'a'.repeat(300)}`]) {
      assert.throws(() => saveKey(bad, undefined, env), (error) => error.exitCode === 2, bad);
    }
    assert.equal(fs.existsSync(configPath(env)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a broken config.json is reported, not silently replaced', () => {
  const { env, dir } = tempEnv();
  try {
    writeConfig({ keyStore: 'file', apiKey: KEY }, env);
    fs.writeFileSync(configPath(env), '{ not json');
    assert.throws(() => readConfig(env), (error) => error.exitCode === 1 && /not valid JSON/.test(error.message));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SMSTUNNEL_KEY_STORE takes auto or file only', () => {
  assert.throws(() => systemStore({ SMSTUNNEL_KEY_STORE: 'cloud' }, 'linux'), (error) => error.exitCode === 2);
  assert.equal(systemStore({ SMSTUNNEL_KEY_STORE: 'file' }, 'darwin'), null);
  assert.equal(systemStore({}, 'darwin').kind, 'macos-keychain');
  assert.equal(systemStore({}, 'win32').kind, 'windows-credential-manager');
  assert.throws(() => systemStore({ SMSTUNNEL_KEYCHAIN_SERVICE: "bad'name" }, 'darwin'), (error) => error.exitCode === 2);
});

import fs from 'fs';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveDbPath,
  ensureDbDir,
  DEFAULT_DB_PATH,
} from '../../server/src/persistence/dbPath';

// resolveDbPath()/ensureDbDir() are pure (they open no DB), so — unlike the rest
// of the suite which must set DB_PATH before importing db.ts — we can exercise
// every branch directly here. Save/restore DB_PATH around each case so the
// process-wide env is not mutated for other test files.
describe('resolveDbPath', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.DB_PATH;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = saved;
  });

  test('explicit DB_PATH is used as-is', () => {
    process.env.DB_PATH = '/tmp/custom/elemental-test.db';
    expect(resolveDbPath()).toBe('/tmp/custom/elemental-test.db');
  });

  test('explicit DB_PATH is trimmed of surrounding whitespace', () => {
    process.env.DB_PATH = '  /var/data/e.db\n';
    expect(resolveDbPath()).toBe('/var/data/e.db');
  });

  test('unset DB_PATH falls back to the sandbox-writable /var/lib default', () => {
    delete process.env.DB_PATH;
    expect(resolveDbPath()).toBe('/var/lib/elemental-rings/elemental.db');
    expect(resolveDbPath()).toBe(DEFAULT_DB_PATH);
  });

  test('empty / whitespace-only DB_PATH falls back to the default', () => {
    process.env.DB_PATH = '';
    expect(resolveDbPath()).toBe(DEFAULT_DB_PATH);
    process.env.DB_PATH = '   ';
    expect(resolveDbPath()).toBe(DEFAULT_DB_PATH);
  });
});

describe('ensureDbDir', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('creates the parent dir and does not throw on success', () => {
    const mkdir = vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    expect(() => ensureDbDir('/some/where/elemental.db')).not.toThrow();
    expect(mkdir).toHaveBeenCalledWith('/some/where', { recursive: true });
  });

  test('swallows a mkdir failure when the dir already exists (sandbox no-op)', () => {
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {
      throw new Error('EROFS: read-only file system');
    });
    // The sandbox data dir already exists as a directory.
    vi.spyOn(fs, 'statSync').mockReturnValue({
      isDirectory: () => true,
    } as unknown as fs.Stats);
    expect(() =>
      ensureDbDir('/var/lib/elemental-rings/elemental.db'),
    ).not.toThrow();
  });

  test('rethrows an actionable error when the dir is genuinely absent', () => {
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });
    vi.spyOn(fs, 'statSync').mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });
    expect(() => ensureDbDir('/var/lib/elemental-rings/elemental.db')).toThrow(
      /Cannot create SQLite directory .*DB_PATH=.*write to/s,
    );
  });

  test('rethrows when a non-directory file collides at the parent path (ENOTDIR)', () => {
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {
      throw new Error('ENOTDIR: not a directory');
    });
    // A regular file exists at the parent path — existence alone is not enough.
    vi.spyOn(fs, 'statSync').mockReturnValue({
      isDirectory: () => false,
    } as unknown as fs.Stats);
    expect(() => ensureDbDir('/etc/hosts/elemental.db')).toThrow(
      /Cannot create SQLite directory/,
    );
  });
});

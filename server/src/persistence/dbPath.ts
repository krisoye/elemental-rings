import fs from 'fs';
import path from 'path';

/**
 * SQLite database path resolution.
 *
 * Split out of `db.ts` (which opens a process-wide singleton connection as an
 * import side effect) so the resolution + directory-prep logic are pure,
 * side-effect-free functions that can be unit-tested without opening a database
 * against the real filesystem. `db.ts` calls {@link resolveDbPath} and
 * {@link ensureDbDir} exactly once at module load.
 */

/**
 * The documented, sandbox-writable default DB path. Matches the systemd
 * `override.conf` drop-in (`Environment=DB_PATH=/var/lib/elemental-rings/elemental.db`)
 * and the `elemental-rings.service` `ReadWritePaths=/var/lib/elemental-rings` —
 * the ONE path writable under the hardened sandbox (`ProtectSystem=strict`,
 * `ProtectHome=read-only`).
 *
 * Used as the fallback when `DB_PATH` is unset/blank. Previously the fallback
 * resolved to `server/data/elemental.db` (relative to the module) — which under
 * the sandbox lands inside the read-only source tree and crashes the server at
 * boot with `EROFS`/`SQLITE_CANTOPEN`. Defaulting to this writable path means a
 * missing/blank drop-in no longer takes the exposed game server down; the
 * explicit `override.conf` `DB_PATH` still overrides it (preferred in prod).
 */
export const DEFAULT_DB_PATH = '/var/lib/elemental-rings/elemental.db';

/**
 * Resolve the SQLite path to open.
 *
 * Precedence:
 *  1. An explicit, non-empty `DB_PATH` (whitespace-trimmed) — used as-is.
 *     Production sets this via the systemd `override.conf` drop-in; the test
 *     and E2E suites set a throwaway file. Behaviour-preserving relative to the
 *     previous `process.env.DB_PATH || …` implementation, save for trimming a
 *     stray-whitespace value (which the old code would have passed through as a
 *     guaranteed-invalid path).
 *  2. `DB_PATH` unset or blank → {@link DEFAULT_DB_PATH}, the documented,
 *     sandbox-writable default.
 *
 * The fallback is intentionally NOT gated on `NODE_ENV`: the production units
 * do not set `NODE_ENV=production`, so a gate would never fire live and would
 * leave the `EROFS` crash in place when the drop-in is missing.
 *
 * @returns the SQLite path to open.
 */
export function resolveDbPath(): string {
  const explicit = process.env.DB_PATH?.trim();
  return explicit ? explicit : DEFAULT_DB_PATH;
}

/**
 * Ensure the parent directory of `dbPath` exists so opening the DB never fails
 * on a missing folder.
 *
 * Under the systemd sandbox the writable data dir (`/var/lib/elemental-rings`)
 * already exists, so this is a no-op there — `fs.mkdirSync(dir, { recursive:
 * true })` never throws for an already-existing directory. A throw therefore
 * signals a genuine failure, which is only fatal when the directory is truly
 * absent: if it already exists as a directory, the subsequent DB open will
 * succeed, so the mkdir error is benign and swallowed. When the directory
 * cannot be created (and does not already exist as a directory — e.g. a
 * read-only parent, or a non-directory colliding at the path), a clear,
 * actionable error is raised instead of a cryptic `EROFS`/`ENOTDIR` at DB-open.
 *
 * @param dbPath the resolved SQLite file path whose parent dir must exist.
 */
export function ensureDbDir(dbPath: string): void {
  const dir = path.dirname(dbPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    if (!isExistingDir(dir)) {
      throw new Error(
        `Cannot create SQLite directory ${dir} (from DB_PATH=${dbPath}): ` +
          `${(err as Error).message}. Point DB_PATH at a path you can write to ` +
          `(e.g. a file under your home directory for local dev), or grant the ` +
          `service account write access to ${dir}.`,
      );
    }
  }
}

/** True only when `p` exists AND is a directory (not a colliding regular file). */
function isExistingDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

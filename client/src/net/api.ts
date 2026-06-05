import type { MeState } from '../../../shared/types';

// The build-time server URL override (Vite `define` in vite.config.ts: Playwright
// passes ws://localhost:2568; '' default → derive from the page hostname).
// Declared the same way Connection.ts / the scenes declare it so the HTTP API base
// is derived identically — this module is now the single place that does it.
declare const __SERVER_URL__: string;

const WS = __SERVER_URL__ || `ws://${window.location.hostname}:2567`;

/**
 * REST base URL for the authoritative game server, derived from the WebSocket URL
 * by swapping the `ws`/`wss` scheme for `http`/`https`. This is the one canonical
 * derivation — every client HTTP call routes through it (directly, or via the
 * helpers below). Previously duplicated inline in 12 files (#293).
 */
export const API_BASE: string = WS.replace(/^ws/, 'http');

/** The stored JWT, or null when the player is not authenticated. */
export function getToken(): string | null {
  return localStorage.getItem('er_token');
}

/**
 * Bearer auth headers for an authenticated request. When `json` is true the
 * `Content-Type: application/json` header is added (for bodied POST/PUT requests).
 * The token is read live from localStorage so callers never construct it inline.
 */
export function authHeaders(json = false): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${localStorage.getItem('er_token') ?? ''}`,
  };
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

/**
 * Low-level authenticated fetch: prepends {@link API_BASE} to `path` and injects
 * the Bearer auth header (merged with any caller-supplied headers), returning the
 * raw {@link Response}. Use this at call sites with bespoke error handling
 * (status-code branches, `res.json().catch(...)` fallbacks, toast messages) that
 * must NOT be flattened into the generic throwing helpers below — it removes the
 * inline API_BASE + token boilerplate while leaving the response handling to the
 * caller. A JSON body is stringified and the JSON content-type header is added
 * automatically when `init.json` is provided.
 */
export function apiFetch(
  path: string,
  init: Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit } = {},
): Promise<Response> {
  const { json, headers, body, ...rest } = init;
  const hasJson = json !== undefined;
  return fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: { ...authHeaders(hasJson), ...(headers as Record<string, string> | undefined) },
    body: hasJson ? JSON.stringify(json) : body,
  });
}

/**
 * Convenience JSON client for happy-path call sites: each method routes through
 * {@link apiFetch} and THROWS on a non-2xx response. Call sites that need to
 * inspect a specific status (400/401/409) or surface a server error message
 * should use {@link apiFetch} directly and keep their own handling.
 */
export const apiClient = {
  async get<T>(path: string): Promise<T> {
    const res = await apiFetch(path, { method: 'GET' });
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return res.json() as Promise<T>;
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await apiFetch(path, { method: 'POST', json: body });
    if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
    return res.json() as Promise<T>;
  },
  async put<T>(path: string, body?: unknown): Promise<T> {
    const res = await apiFetch(path, { method: 'PUT', json: body });
    if (!res.ok) throw new Error(`PUT ${path} → ${res.status}`);
    return res.json() as Promise<T>;
  },
  async del<T>(path: string, body?: unknown): Promise<T> {
    const res = await apiFetch(path, { method: 'DELETE', json: body });
    if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
    return res.json() as Promise<T>;
  },
};

/**
 * Fetch the canonical player snapshot (GET /api/me). Throws on a non-2xx
 * response. Collapses the recurring POST-then-fetchMe and standalone /api/me
 * reads into one helper. The default {@link MeState} shape is intentionally
 * broad; callers that need extra fields pass a narrower `T`.
 */
export async function fetchMe<T = MeState>(): Promise<T> {
  return apiClient.get<T>('/api/me');
}

/**
 * #421 — non-throwing mutation helper for call sites that must branch on commit
 * status AND surface the server's error message (e.g. swap moves that keep the
 * player's held selection on rejection instead of silently deselecting).
 *
 * Returns `{ ok: true, error: null }` on a 2xx response. On a non-2xx response
 * returns `{ ok: false, error }` with the parsed `body.error` (null when the body
 * is unparseable). On a network failure — or when unauthenticated (no request is
 * made) — returns `{ ok: false, error: null }`.
 */
export async function apiMutate(
  method: 'PUT' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; error: string | null }> {
  if (!getToken()) return { ok: false, error: null };
  try {
    const res = await apiFetch(path, { method, json: body });
    if (res.ok) return { ok: true, error: null };
    const parsed = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: parsed.error ?? null };
  } catch {
    return { ok: false, error: null };
  }
}

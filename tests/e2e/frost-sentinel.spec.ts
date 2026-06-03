import { test, expect } from '@playwright/test';

/**
 * #269 E2E scenario #1 — the Frost Sentinel mini-boss appears on the
 * forest_snow_gate roster for a fresh player.
 *
 * forest_snow_gate is a dead-end clearing with no rendered overworld map yet, so
 * this spec hits the roster API directly rather than driving a scene: it mints a
 * fresh-player token via /api/test/mint-token (same helper seedAuthToken uses) and
 * GETs /api/overworld/npcs?screen=forest_snow_gate. The response must include
 * forest_frost_sentinel — the NPC PR #255's World Map boss icon now points at.
 * Every assertion reads real server state — no mocks.
 */
const API_URL = 'http://localhost:2568';

interface NpcEntry {
  id: string;
  personality: string;
  type: string;
  element: number;
  spriteFrame: number;
  x: number;
  y: number;
  aiSeed: number;
  stakeXp: number;
}

/** Mint a fresh-player auth token straight from the test route. */
async function mintToken(): Promise<string> {
  const res = await fetch(`${API_URL}/api/test/mint-token`, { method: 'POST' });
  if (!res.ok) throw new Error(`mint-token failed (${res.status})`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

async function snowGateRoster(token: string): Promise<NpcEntry[]> {
  const res = await fetch(`${API_URL}/api/overworld/npcs?screen=forest_snow_gate`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as NpcEntry[];
}

test('frost-sentinel: forest_snow_gate roster includes forest_frost_sentinel for a fresh player', async () => {
  const token = await mintToken();
  const roster = await snowGateRoster(token);

  const sentinel = roster.find((n) => n.id === 'forest_frost_sentinel');
  expect(sentinel, 'forest_frost_sentinel present on forest_snow_gate').toBeDefined();
  expect(sentinel!.personality).toBe('AGGRESSIVE');
  expect(sentinel!.type).toBe('monster');
  // #344 — repositioned from tx:16,ty:8 to tx:16,ty:2 (stands in the northern passage).
  // world px = tile*16 + 8 (TILE_SIZE=16 in routes.ts).
  expect(sentinel!.x).toBe(16 * 16 + 8); // 264
  expect(sentinel!.y).toBe(2 * 16 + 8);  // 40
});

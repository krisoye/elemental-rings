/**
 * #269 — Frost Sentinel mini-boss (forest_snow_gate).
 *
 * Verifies the spawn-table contract end-to-end against a throwaway SQLite DB:
 *   1. A fresh player sees `forest_frost_sentinel` on the forest_snow_gate roster.
 *   2. After `recordNpcDefeat`, the sentinel is hidden (respawnDays: 0 = permanent).
 *   3. First defeat grants MINI_BOSS_FOOD_DROP food units via the foodDrop path.
 *
 * The roster filter mirrors the live GET /api/overworld/npcs logic
 * (server/src/api/routes.ts): a permanent NPC is hidden once it appears in
 * getDefeatedNpcs. DB_PATH must be set before the first import of db.ts (a
 * process-level singleton), so the repo is loaded dynamically in beforeAll.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, test, expect, beforeAll } from 'vitest';
import { NPC_SPAWNS, type NpcSpawnDef } from '../../server/src/persistence/NpcSpawns';
import { MINI_BOSS_FOOD_DROP } from '../../server/src/game/constants';

let repo: typeof import('../../server/src/persistence/PlayerRepo');
let dbInstance: import('better-sqlite3').Database;

/** Create a bare player row + empty loadout (no starter rings needed here). */
function makePlayer(db: import('better-sqlite3').Database): string {
  const id = `p_${Math.random().toString(36).slice(2)}`;
  db.prepare(`INSERT INTO players (id, username, password_hash) VALUES (?, ?, ?)`).run(
    id,
    `u_${id}`,
    'x',
  );
  db.prepare(
    `INSERT INTO loadout (player_id, thumb, a1, a2, d1, d2) VALUES (?, NULL, NULL, NULL, NULL, NULL)`,
  ).run(id);
  return id;
}

/**
 * Re-implements the GET /api/overworld/npcs visibility filter for one screen:
 * an NPC is hidden when the player has defeated it AND it is permanent
 * (respawnDays === 0) or its respawn window has not yet elapsed.
 */
function rosterForScreen(playerId: string, screen: string): NpcSpawnDef[] {
  const player = repo.getPlayerById(playerId);
  const gameDay = player?.game_day ?? 0;
  const defeated = repo.getDefeatedNpcs(playerId);
  return NPC_SPAWNS.filter((npc) => npc.screen === screen).filter((npc) => {
    const defeatedDay = defeated.get(npc.id);
    if (defeatedDay === undefined) return true;
    if (npc.respawnDays === 0) return false;
    return gameDay - defeatedDay >= npc.respawnDays;
  });
}

beforeAll(async () => {
  const dbFile = path.join(os.tmpdir(), `er-frost-sentinel-test-${process.pid}-${Date.now()}.db`);
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbFile + ext)) fs.unlinkSync(dbFile + ext);
  }
  process.env.DB_PATH = dbFile;
  repo = await import('../../server/src/persistence/PlayerRepo');
  dbInstance = (await import('../../server/src/persistence/db')).db;
});

describe('Frost Sentinel — forest_snow_gate mini-boss (#269)', () => {
  test('spawn table defines the sentinel with the expected mini-boss shape', () => {
    const sentinel = NPC_SPAWNS.find((n) => n.id === 'forest_frost_sentinel');
    expect(sentinel).toBeDefined();
    expect(sentinel).toMatchObject({
      biome: 'forest',
      screen: 'forest_snow_gate',
      personality: 'AGGRESSIVE',
      type: 'monster',
      respawnDays: 0,
      foodDrop: MINI_BOSS_FOOD_DROP,
    });
  });

  test('appears on the forest_snow_gate roster for a fresh player', () => {
    const p = makePlayer(dbInstance);
    const roster = rosterForScreen(p, 'forest_snow_gate');
    expect(roster.map((n) => n.id)).toContain('forest_frost_sentinel');
  });

  test('is absent from the roster after recordNpcDefeat (permanent)', () => {
    const p = makePlayer(dbInstance);
    repo.recordNpcDefeat(p, 'forest_frost_sentinel');
    const roster = rosterForScreen(p, 'forest_snow_gate');
    expect(roster.map((n) => n.id)).not.toContain('forest_frost_sentinel');
  });

  test('first defeat grants MINI_BOSS_FOOD_DROP food units', () => {
    const p = makePlayer(dbInstance);
    const before = repo.getSpiritAndFood(p).food_units;

    // Mirror BattleRoom.persistBattleResult: a permanent boss NPC drops its
    // foodDrop cache the first time it is defeated.
    const sentinel = NPC_SPAWNS.find((n) => n.id === 'forest_frost_sentinel');
    expect(sentinel?.respawnDays).toBe(0);
    expect(sentinel?.foodDrop).toBe(MINI_BOSS_FOOD_DROP);
    repo.addFood(p, sentinel!.foodDrop ?? 0);
    repo.recordNpcDefeat(p, 'forest_frost_sentinel');

    const after = repo.getSpiritAndFood(p).food_units;
    expect(after - before).toBe(MINI_BOSS_FOOD_DROP);
  });
});

CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,
  username   TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  gold       INTEGER NOT NULL DEFAULT 200,
  game_day   INTEGER NOT NULL DEFAULT 0,
  carry_cap      INTEGER NOT NULL DEFAULT 10,
  spirit_max     INTEGER NOT NULL DEFAULT 50,
  spirit_current INTEGER NOT NULL DEFAULT 50,
  food_units     INTEGER NOT NULL DEFAULT 100
);
CREATE TABLE IF NOT EXISTS rings (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES players(id),
  element      INTEGER NOT NULL,
  tier         INTEGER NOT NULL DEFAULT 1,
  max_uses     INTEGER NOT NULL DEFAULT 3,
  current_uses INTEGER NOT NULL DEFAULT 3,
  xp           INTEGER NOT NULL DEFAULT 0,
  escrowed     INTEGER NOT NULL DEFAULT 0,
  in_carry     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS loadout (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  thumb TEXT REFERENCES rings(id),
  a1    TEXT REFERENCES rings(id),
  a2    TEXT REFERENCES rings(id),
  d1    TEXT REFERENCES rings(id),
  d2    TEXT REFERENCES rings(id)
);
-- #61 — Phase 8B waystone attunement (GDD §10.7). One row per (player, waystone)
-- the player has permanently attuned. attuned_at is a millisecond epoch.
CREATE TABLE IF NOT EXISTS waystone_attunements (
  player_id   TEXT NOT NULL REFERENCES players(id),
  waystone_id TEXT NOT NULL,
  attuned_at  INTEGER NOT NULL,
  PRIMARY KEY (player_id, waystone_id)
);
-- #81 — Phase 8C.1 talisman loadout (GDD §14.2/§14.3). One row per player holds
-- the equipped necklace talisman id and its remaining charges. A null necklace_id
-- with 0 charges is the "nothing equipped" baseline (seeded at createPlayer).
CREATE TABLE IF NOT EXISTS talisman_loadout (
  player_id        TEXT PRIMARY KEY REFERENCES players(id),
  necklace_id      TEXT,
  necklace_charges INTEGER NOT NULL DEFAULT 0
);
-- #83 — Phase 8C.3 NPC defeat tracking (GDD §10.5). One row per (player, npc)
-- the player has beaten. defeated_at_day is the player's game_day at the time of
-- the win; permanent NPCs (respawnDays = 0) stay hidden forever, periodic ones
-- reappear once game_day - defeated_at_day >= respawnDays.
CREATE TABLE IF NOT EXISTS npc_defeats (
  player_id        TEXT NOT NULL REFERENCES players(id),
  npc_id           TEXT NOT NULL,
  defeated_at_day  INTEGER NOT NULL,
  PRIMARY KEY (player_id, npc_id)
);
-- #231 — Fusion Shrine seal state (GDD §4.6 shrine crafting). One row per
-- (player, shrine) the player has permanently unsealed by consuming a matching
-- fusion ring-key. unlocked_at is the player's game_day at the time of unlock.
CREATE TABLE IF NOT EXISTS shrines (
  player_id   TEXT    NOT NULL REFERENCES players(id),
  shrine_id   TEXT    NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, shrine_id)
);

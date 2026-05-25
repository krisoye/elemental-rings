CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,
  username   TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  gold       INTEGER NOT NULL DEFAULT 200,
  game_day   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rings (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES players(id),
  element      INTEGER NOT NULL,
  tier         INTEGER NOT NULL DEFAULT 1,
  max_uses     INTEGER NOT NULL DEFAULT 3,
  current_uses INTEGER NOT NULL DEFAULT 3,
  xp           INTEGER NOT NULL DEFAULT 0,
  escrowed     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS loadout (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  thumb TEXT REFERENCES rings(id),
  a1    TEXT REFERENCES rings(id),
  a2    TEXT REFERENCES rings(id),
  d1    TEXT REFERENCES rings(id),
  d2    TEXT REFERENCES rings(id)
);

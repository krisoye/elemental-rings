# Elemental Rings — HTTP API Reference

Source of truth: `server/src/api/routes.ts`. Every entry below is derived directly from the route handler source. Do not add GDD design intent or implementation-status flags to this document — those belong in `docs/gdd-*.md` and GitHub respectively.

---

## Base URL

Development: `http://localhost:2567`
Production (game-da-god): `http://192.168.4.140:2567`

All endpoints accept and return JSON. Request bodies must be sent with `Content-Type: application/json`.

---

## Authentication Middleware Chain

Two Express middlewares guard most mutation endpoints, applied in order:

**`requireAuth`** (defined in `server/src/auth/auth.ts`) — validates the `Authorization: Bearer <token>` header. It calls `verifyToken`, which runs `jwt.verify` against `JWT_SECRET`. On success it sets `req.playerId` and `req.username` and calls `next()`. On failure it short-circuits with `401 { error: 'Missing or malformed Authorization header' }` (missing/malformed header) or `401 { error: 'Invalid or expired token' }` (bad signature / expired). Tokens are signed with a 30-day expiry.

**`requirePlayer`** (defined in `server/src/api/middleware.ts`) — must be mounted after `requireAuth` so `req.playerId` is already set. It calls `getPlayerById(req.playerId)` (a synchronous better-sqlite3 read). On success it attaches the full player row as `req.player` and calls `next()`. On failure it short-circuits with `404 { error: 'Player not found' }`. Only a subset of endpoints (those that need the player row pre-fetched) chain `requirePlayer`; the rest use `requireAuth` alone and call `getPlayerById` themselves inside the handler if needed.

---

## Global Error Convention

All error responses use the shape `{ error: string }` with an appropriate HTTP status code. The `fail(res, code, msg)` helper in `server/src/api/middleware.ts` enforces this uniformly across all handlers. Common status codes:

| Code | Meaning |
|------|---------|
| 400 | Bad request — missing/invalid fields, business rule violation |
| 401 | Unauthorized — missing, malformed, or expired Bearer token |
| 404 | Not found — player or resource does not exist |
| 409 | Conflict — duplicate resource or depleted node |
| 500 | Internal server error — unexpected failure |

---

## Route Groups

- [Auth](#auth)
- [Player State](#player-state)
- [Ring Management](#ring-management)
- [Spirit and Blink](#spirit-and-blink)
- [Staking](#staking)
- [Camp](#camp)
- [Encounter](#encounter)
- [Fusion](#fusion)
- [Shrines](#shrines)
- [Waystones and Teleport](#waystones-and-teleport)
- [Sanctum](#sanctum)
- [Talisman](#talisman)
- [Overworld](#overworld)
- [Merchant](#merchant)
- [Test-Only Routes](#test-only-routes)

---

## Auth

### POST /auth/register

**Auth required:** no
**Request body:** `{ username: string, password: string }`
**Response (success):** `{ token: string, playerId: string }` — HTTP 201
**Response (error):** 400 — `"username and password are required"` | 409 — `"Username already taken"` | 500 — `"Registration failed"`

Create a new player with starter inventory and default loadout. Returns a signed 30-day JWT and the new player's id. Bcrypt cost factor is 10. The username UNIQUE constraint is the authoritative guard; a 409 is returned on both the fast-path pre-check and on concurrent-insert race.

---

### POST /auth/login

**Auth required:** no
**Request body:** `{ username: string, password: string }`
**Response (success):** `{ token: string, playerId: string }` — HTTP 200
**Response (error):** 400 — `"username and password are required"` | 401 — `"Invalid credentials"`

Verify credentials via `bcrypt.compare` and return a signed token. Both an unknown username and a wrong password return 401 with the same message to prevent username enumeration.

---

## Player State

### GET /api/me

**Auth required:** yes (requireAuth + requirePlayer)
**Request body:** none
**Response (success):** `{ player: PlayerBlock, rings: Ring[], loadout: Loadout | null }` — HTTP 200
**Response (error):** 401 — auth failure | 404 — `"Player not found"`

Return the authenticated player's full state. `player` is the canonical `/api/me` player block (see below). `rings` is all rings owned by the player (excludes the heart-slot ring, which is in `player.heart_ring`). `loadout` is the battle-hand slot map or null if never saved.

**PlayerBlock fields:** all columns from the `players` table plus computed fields:
`difficulty`, `spirit_max` (derived from aggregate Reliquary XP × difficulty multiplier), `aggregate_xp` (sum of Reliquary ring XP), `carry_cap` (derived: `spare_ring_max + CORE_SLOTS`), `spare_ring_max` (per-player spare grid cap, default 9), `pending_ring_id` (id of the WON ring awaiting overflow resolution, or `null`), `reliquaryCap`, `reliquaryShards`, `reliquaryCount`, `heart_ring` (heart-slot ring row or null), `total_xp`, `battle_hand_avg_xp`.

Note: `spareCapacity` was removed in EPIC #378 — use `spare_ring_max` instead.

---

### PUT /api/carry

**Auth required:** yes (requireAuth only)
**Request body:** `{ ringIds: string[] }`
**Response (success):** `{ rings: Ring[] }` — HTTP 200
**Response (error):** 400 — `"ringIds must be an array of strings"` | 400 — message from `packLoadout` (carry cap exceeded or ring not owned)

Set the player's carried ring set to exactly the provided ring ids. Returns the full updated ring list.

---

### PUT /api/difficulty

**Auth required:** yes (requireAuth only)
**Request body:** `{ tier: DifficultyTier }`
**Response (success):** `{ difficulty: DifficultyTier, spirit_max: number }` — HTTP 200
**Response (error):** 400 — `"invalid tier"`

Change the player's difficulty tier. Recomputes `spirit_max` (Σ Reliquary max_uses × new multiplier) and clamps `spirit_current` to the new max. `DifficultyTier` must satisfy `isDifficultyTier()` from `shared/types`.

---

### PUT /api/heart-slot

**Auth required:** yes (requireAuth + requirePlayer)
**Request body:** `{ ringId?: string, releaseTo?: 'reliquary' | 'spare' | 'thumb' | 'a1' | 'a2' | 'd1' | 'd2' }`
**Response (success):** `{ player: PlayerBlock, rings: Ring[] }` — HTTP 200
**Response (error):** 400 — `"ringId must be a non-empty string when provided"` | 400 — `"invalid releaseTo"` | 400 — message from `setHeartRing`

Equip a ring into the Heart slot, or swap the heart ring with a battle-hand slot. `releaseTo` defaults to `'reliquary'`. For a battle-slot `releaseTo` (`thumb`, `a1`, `a2`, `d1`, `d2`) the swap is slot-for-slot and `ringId` is ignored. `setHeartRing` recomputes `spirit_max` and clamps the gauge. Returns the full `/api/me` player block and updated ring list.

---

## Ring Management

### DELETE /api/rings/:ringId

**Auth required:** yes (requireAuth only)
**Request body:** none
**Response (success):** `{ rings: Ring[] }` — HTTP 200
**Response (error):** 404 — `"ring not found"`

Permanently discard a ring the player owns. Returns the full updated ring list.

---

### PUT /api/rings/:ringId/accept

**Auth required:** yes (requireAuth only)
**Request body:** none
**Response (success):** `{ player: PlayerBlock, rings: Ring[] }` — HTTP 200
**Response (error):** 400 — `"ring not found or not owned"` | 400 — `"ring is not pending"` | 400 — `"spare grid still full"`

Accept the WON (pending) ring as a regular spare ring. Clears `rings.pending` on the ring. Only valid when the spare grid is no longer in overflow (spare count ≤ `spare_ring_max`). Returns the updated `/api/me` player block and ring list.

---

### PUT /api/rings/swap

**Auth required:** yes (requireAuth + requirePlayer)
**Request body:** `{ ringId1: string, ringId2: string }`
**Response (success):** `{ player: PlayerBlock, rings: Ring[], loadout: Loadout | null }` — HTTP 200
**Response (error):** 400 — `"ringId1 and ringId2 must be non-empty strings"` | 400 — `"ring not found or not owned"` | 400 — `"ring is locked in a duel"` | 400 — `"cannot swap a ring with itself"`

Exchange the positions of two rings owned by the authenticated player. The swap is capacity-free: because one ring enters each pool and one leaves simultaneously, no carry or reliquary cap is ever exceeded. Supported position pairs: spare↔slot, slot↔slot, reliquary↔spare, heart↔spare, pending↔spare, pending↔slot. Same-pool swaps (spare↔spare, reliquary↔reliquary) are positionally meaningless and return 200 with no state change. When either ring is the heart ring, `spirit_max` and `spirit_current` are recomputed. When the WON (pending) ring swaps with a spare, `pending=1` transfers to the displaced ring.

Returns the same shape as `GET /api/me`: the canonical player block, the full ring list (excluding the heart-slot ring), and the current loadout.

---

### POST /api/rings/merge

**Auth required:** yes (requireAuth + requirePlayer)
**Request body:** `{ ringId1: string, ringId2: string, shrineId: string }`
**Response (success):** `{ ring: Ring }` — HTTP 200; the newly created merged ring
**Response (error):** 400 — `"ringId1 and ringId2 must be non-empty strings and shrineId must be a non-empty string"` | 400 — `"Ring not found or not owned"` | 400 — `"Cannot merge a ring with itself"` | 400 — `"Ring is locked in a duel (escrowed)"` | 400 — `"Ring is the pending WON ring"` | 400 — `"Rings must be the same element to merge"` | 400 — `"Both rings must reach Tier 1 (≥ 500 XP) to merge"` | 400 — `"Shrine is sealed or not found"` | 401 — not authenticated

Merge two same-element rings into a single consolidated ring at an unsealed shrine. Both parents are consumed atomically; the resulting ring carries the summed XP (`xp = r1.xp + r2.xp`), tier derived from that sum (`tier = tierForXp(xp)`), and `max_uses = 3 + tier` (starts fully charged). Fusion-element rings (e.g. Steam, Storm) may be merged with another ring of the same fusion element. The `parent_dominant` field on the result is the element of the higher-XP parent, or −1 on an exact tie. Unlike fusion (`POST /api/fusion/combine`), merge never changes the element — the result is always the same element as both inputs. The `shrineId` must correspond to a shrine the player has already unsealed; sealed shrines are rejected server-side regardless of what the client sends.

---

### PUT /api/loadout

**Auth required:** yes (requireAuth only)
**Request body:** `{ thumb?: string | null, a1?: string | null, a2?: string | null, d1?: string | null, d2?: string | null }` (partial — only provided keys are updated)
**Response (success):** `{ loadout: Loadout }` — HTTP 200
**Response (error):** 400 — `"spare grid full (n > max)"` when the post-move spare count would exceed `spare_ring_max` | 400 — `"Invalid value for slot <key>"` | 400 — message from `saveLoadout`

Update one or more battle-hand loadout slots. Unknown keys are silently ignored; slot values must be a ring id string or `null`. Rejection is delta-aware: moves that drain the spare grid (e.g. slotting a bench ring into an empty battle slot) are permitted even when the bench is at capacity; only moves that would push the spare count above `spare_ring_max` (e.g. clearing a slot while the bench is full) are rejected.

---

## Spirit and Blink

### POST /api/spirit/recharge

**Auth required:** yes (requireAuth only)
**Request body:** `{ ringId: string, uses?: number }`
**Response (success):** `{ ring: Ring, restored: number, spirit_current: number }` — HTTP 200
**Response (error):** 400 — `"ringId is required"` | 400 — `"uses must be a non-negative number"` | 400 — reason from `rechargeRingWithSpirit`

Recharge one ring using spirit. `uses` defaults to a full top-off. Spends `SPIRIT_PER_RING_USE` per restored use. Returns the updated ring row, the number of uses restored, and the player's remaining spirit.

---

### POST /api/spirit/recharge-all

**Auth required:** yes (requireAuth only)
**Request body:** `{ includeReliquary?: boolean }` (optional)
**Response (success):** `{ rings: Ring[], spirit_current: number }` — HTTP 200
**Response (error):** 401 — auth failure

Recharge every carried ring in slot priority order (Thumb → A1 → A2 → D1 → D2 → spares), stopping when spirit reaches 0. Returns the full updated ring list and remaining spirit.

When `includeReliquary: true` is passed, also recharges resting Reliquary rings (`in_carry=0, heart_slot=0, escrowed=0`) after all carried rings, most-depleted first. Intended for Sanctum use only — field and Fusion overlays omit this flag. Spirit spending stops at 0 regardless.

---

### POST /api/spirit/blink

**Auth required:** yes (requireAuth only)
**Request body:** `{ distance: number }`
**Response (success):** `{ spirit_current: number, cost: number }` — HTTP 200
**Response (error):** 400 — `"insufficient spirit"`

Spend spirit for a short-range blink. The server computes the authoritative cost via `blinkCost(distance)` (from `shared/blink`). `distance` is clamped and re-costed server-side regardless of client input. Uses an atomic check-and-spend (`spendSpiritAtomic`) to prevent concurrent blinks from pushing spirit negative.

---

## Staking

### POST /api/stake/lock

**Auth required:** yes (requireAuth only)
**Request body:** none
**Response (success):** `{ ok: true }` — HTTP 200
**Response (error):** 401 — auth failure

Escrow the player's current thumb ring as a stake.

---

### POST /api/stake/unlock

**Auth required:** yes (requireAuth only)
**Request body:** none
**Response (success):** `{ ok: true }` — HTTP 200
**Response (error):** 401 — auth failure

Release the player's thumb ring from stake escrow.

---

## Camp

### POST /api/camp/sleep

**Auth required:** yes (requireAuth + requirePlayer)
**Request body:** none
**Response (success):** `{ player: PlayerRow, rings: Ring[] }` — HTTP 200
**Response (error):** 400 — `"Not enough food (need <N>)"`

Spend `FOOD_PER_SLEEP` food units to rest: fully restores the spirit gauge, sleep-recharges all rings, advances `game_day` by 1, and refills the equipped necklace talisman's charges (no-op when no necklace is equipped). Location-agnostic — the server does not distinguish Sanctum rest from Anchorage rest.

---

## Encounter

### GET /api/encounter/preview

**Auth required:** optional
**Request body:** none
**Response (success):** `{ playerBattleHandAvgXp: number, [AIPersonality]: { element: number, aiSeed: number, stakeTier: number, stakeXp: number, totalXp: number, npcEffectiveXp: number } }` — HTTP 200
**Response (error):** none

Return a randomized preview of each AI personality's staked ring. Auth is optional: a valid Bearer token scales each opponent's `npcEffectiveXp` to the authenticated player's battle-hand weighted-average XP; no/invalid token falls back to `playerBattleHandAvgXp = 0`. The `aiSeed` in the response is the exact seed passed to `BattleRoom` for loadout generation, so previewed and actual opponents are identical.

---

### GET /api/encounter/bosses

**Auth required:** yes (requireAuth only)
**Request body:** none
**Response (success):** `{ bosses: Array<{ id: string, name: string, tier: number, personality: string, element: number, aiSeed: number, spriteFrame: string, spriteElement: number }> }` — HTTP 200
**Response (error):** 401 — auth failure

Return the list of boss NPCs this player has already defeated. Intersects the player's defeated-NPC record with `NPC_SPAWNS` entries that carry a `boss` descriptor. `element` is the boss's fused thumb element; `aiSeed` is `hashNpcId(id)` and reproduces the boss loadout deterministically. A boss stays permanently beaten but remains rematachable.

---

## Fusion

### POST /api/fusion/combine

**Auth required:** yes (requireAuth only)
**Request body:** `{ ringId1: string, ringId2: string }`
**Response (success):** `{ ring: Ring }` — HTTP 200
**Response (error):** 400 — `"ringId1 and ringId2 are required"` | 400 — descriptive message from `fuseRings` (not owned, already a fusion, below 500 XP, invalid pair)

Fuse two parent rings into a fusion ring. Each parent must have `xp ≥ 500` (independently); neither may itself be a fusion ring; their elements must form a valid fusion pair. The same-tier requirement was removed in #390. Returns the new fusion ring row.

---

## Shrines

### GET /api/shrines/:id

**Auth required:** yes (requireAuth only)
**Request body:** none
**Response (success):** `{ unlocked: boolean }` — HTTP 200
**Response (error):** 401 — auth failure

Return whether the authenticated player has permanently unsealed the named Fusion Shrine. A fresh player always returns `unlocked: false`.

---

### POST /api/shrines/:id/unlock

**Auth required:** yes (requireAuth only)
**Request body:** `{ ringId: string }`
**Response (success):** `{ ok: true }` — HTTP 200
**Response (error):** 400 — `"ringId is required"` | 400 — `"ring not found or not owned"` | 400 — `"ring must be in carry"` | 400 — `"a Thornado ring is required"` | 400 — `"ring could not be consumed"`

Permanently unseal a Fusion Shrine by consuming a matching fusion ring-key. The ring must be owned, in carry (`in_carry = 1`), and carry element `THORNADO` (Wood+Wind). On success the ring is deleted and the shrine is marked unlocked. Idempotent unlock is permitted but still consumes a key.

---

## Waystones and Teleport

### GET /api/waystones

**Auth required:** yes (requireAuth only)
**Request body:** none
**Response (success):** `{ aggregateXp: number, spiritCurrent: number, anchor: string, waystones: Array<{ id: string, name: string, spiritCost: number, attuned: boolean, meetsThreshold: boolean }> }` — HTTP 200
**Response (error):** 401 — auth failure

Return the waystone catalog joined with the player's attunement set and current spirit. `spiritCost` is relative to the player's current anchor (absolute cost minus anchor's cost). `meetsThreshold` is true when `spiritCurrent >= spiritCost`.

---

### POST /api/waystones/attune

**Auth required:** yes (requireAuth only)
**Request body:** `{ waystoneId: string }`
**Response (success):** same shape as `GET /api/waystones` — HTTP 200
**Response (error):** 400 — `"Unknown waystone"`

Attune the player to a waystone. Idempotent — re-attuning an already-attuned waystone succeeds. Returns the full waystone payload so the client can refresh in one round-trip.

---

### POST /api/teleport

**Auth required:** yes (requireAuth only)
**Request body:** `{ waystoneId: string }`
**Response (success):** `{ anchor: string, spirit_current: number, spiritCost: number }` — HTTP 200
**Response (error):** 400 — `"unknown waystone"` | 400 — `"not attuned"` | 400 — `"requires <N> spirit"`

Re-anchor the player to a waystone. Cost is relative to the current anchor: `|destination.spiritCost - currentAnchor.spiritCost|`. Uses atomic check-and-spend to prevent concurrent teleports from pushing spirit negative. A zero-cost destination still succeeds.

---

## Sanctum

### POST /api/sanctum/summon

**Auth required:** yes (requireAuth only)
**Request body:** `{ anchorageId: string }`
**Response (success):** `{ anchor: string, spirit_current: number, spiritCost: number }` — HTTP 200
**Response (error):** 400 — `"unknown anchorage"` | 400 — `"not attuned"` | 400 — `"requires <N> spirit"`

Re-anchor the player's Sanctum to an attuned anchorage. Cost is the current anchor's `spiritCost` (the Sanctum travels from there); zero cost when already at the destination. Uses atomic check-and-spend.

---

### POST /api/sanctum/expand-reliquary

**Auth required:** yes (requireAuth only)
**Request body:** none
**Response (success):** `{ reliquaryCap: number, reliquaryShards: number }` — HTTP 200
**Response (error):** 400 — `"no Reliquary Shards"`

Spend one Reliquary Shard to expand the Reliquary capacity by `RELIQUARY_SHARD_INCREMENT`. The shard is consumed and the cap raised atomically.

---

## Talisman

### GET /api/talisman-loadout

**Auth required:** yes (requireAuth only)
**Request body:** none
**Response (success):** `{ necklaceId: string | null, necklaceCharges: number }` — HTTP 200
**Response (error):** 401 — auth failure

Return the player's equipped necklace talisman id and remaining charges. A fresh player returns `{ necklaceId: null, necklaceCharges: 0 }`.

---

### POST /api/talisman/equip

**Auth required:** yes (requireAuth only)
**Request body:** `{ talismanlId: string, slot: 'necklace' }`
**Response (success):** `{ necklaceId: string, necklaceCharges: number }` — HTTP 200
**Response (error):** 400 — `"talismanlId (string) and slot=\"necklace\" are required"` | 400 — `"Unknown necklace talisman"`

Equip a talisman to the necklace slot. Resets charges to the catalog maximum. `talismanlId` must correspond to a talisman with `slot === 'necklace'` in the shared talisman catalog. Note: the request body field name is `talismanlId` (with a double `l`) matching the source.

---

## Overworld

### GET /api/overworld/npcs

**Auth required:** yes (requireAuth only)
**Request body:** none
**Query parameters:** `biome?: string`, `screen?: string`
**Response (success):** `Array<{ id: string, personality: string, type: string, element: number, spriteFrame: string, x: number, y: number, aiSeed: number, stakeXp: number, displayName?: string, bossTier?: number }>` — HTTP 200
**Response (error):** 400 — `"screen required"` (when `biome` provided without `screen`) | 404 — `"Player not found"`

Return NPC spawn entries visible to the player on the requested screen. Hidden when the NPC is permanent (`respawnDays === 0`) and already defeated, or when within its respawn window. `x`/`y` are world-pixel tile centers (tile coords × 16 + 8). `stakeXp` is pre-computed via `previewOpponent` scaled to the player's carried battle-hand average XP. Boss entries include `displayName` and `bossTier`.

---

### POST /api/overworld/forage

**Auth required:** yes (requireAuth only)
**Request body:** `{ node_id: string }`
**Response (success):** `{ food_units: number, yielded: number }` — HTTP 200
**Response (error):** 400 — `"node_id is required"` | 400 — reason from `forage` | 409 — `"Node depleted"`

Harvest a berry node. Per-player depletion: two players can forage the same node on the same day. Returns updated food total and the quantity yielded. `409` is returned specifically when the node is within its respawn window for this player.

---

### GET /api/overworld/forage-status

**Auth required:** yes (requireAuth only)
**Request body:** none
**Query parameters:** `screen: string` (required)
**Response (success):** `{ nodes: ForageStatusEntry[] }` — HTTP 200
**Response (error):** 400 — `"screen query parameter is required"`

Return the depletion state of every node the player has ever foraged on the given screen. Nodes never foraged are not returned (implicitly available). Used on scene load to set initial sprite visuals.

---

## Merchant

### GET /api/merchant/catalog

**Auth required:** no
**Request body:** none
**Response (success):** `{ food: { buyPrice: number, sellPrice: number }, rings: Array<{ element: string, elementIndex: number, tier: number, buyPrice: number, sellPrice: number }> }` — HTTP 200
**Response (error):** none

Return the fixed merchant inventory with buy and sell prices. Prices are public. `rings` contains one entry per base element (`fire`, `water`, `earth`, `wind`, `wood`), all Tier 1.

---

### POST /api/merchant/buy

**Auth required:** yes (requireAuth only)
**Request body:** `{ item: 'food', quantity: number }` | `{ item: 'ring', element: 'fire' | 'water' | 'earth' | 'wind' | 'wood', tier: 1 }`
**Response (success — food):** `{ gold: number, food_units: number }` — HTTP 200
**Response (success — ring):** `{ gold: number, ring: Ring }` — HTTP 200
**Response (error):** 400 — `"quantity must be a positive integer"` | 400 — `"element must be one of: fire, water, earth, wind, wood"` | 400 — `"item must be \"food\" or \"ring\""` | 400 — reason from `merchantBuyFood` or `merchantBuyRing` (insufficient gold, `"Resolve your pending won ring first"`)

Buy food or a Tier 1 ring from the merchant. `quantity` must be a positive integer for food purchases. `tier` field in the request body is not validated server-side (only `element` is used for ring purchases).

Ring purchases route through the same bench/WON overflow model as duel wins (#423): when the bench (spare grid) has room, the ring enters carry as a normal spare (`pending=0`); when the bench is full, the ring is minted as the pending WON ring (`pending=1` in the returned `ring` row — exactly one overflow allowed) and the player must resolve it via the ring-management overlay. A purchase while a won ring is already pending is rejected with HTTP 400 **before** gold is deducted. The old aggregate carry-cap rejection (`"Carry cap full"`) is gone.

---

### POST /api/merchant/sell

**Auth required:** yes (requireAuth only)
**Request body:** `{ item: 'food', quantity: number }` | `{ item: 'ring', ring_id: string }`
**Response (success — food):** `{ gold: number, food_units: number }` — HTTP 200
**Response (success — ring):** `{ gold: number }` — HTTP 200
**Response (error):** 400 — `"quantity must be a positive integer"` | 400 — `"ring_id is required"` | 400 — `"item must be \"food\" or \"ring\""` | 400 — reason from `merchantSellFood` or `merchantSellRing` (insufficient food, ring not owned, ring in active slot)

Sell food or a ring to the merchant.

---

## Test-Only Routes

These routes are registered only when the server starts with `E2E_TEST_ROUTES=1` (set by the Playwright `webServer` environment). They are never available in production. All test routes with `requireAuth` require a valid Bearer token.

---

### POST /api/test/mint-token

**Auth required:** no
**Request body:** none
**Response (success):** `{ token: string, playerId: string }` — HTTP 200

Provision a fresh player with starter inventory (identical to `/auth/register`) but without the bcrypt hash step. Skips the slow bcrypt cost on the E2E test hot path. The resulting player is indistinguishable from a registered player for all downstream reads.

---

### POST /api/test/create-battle-room

**Auth required:** no
**Request body:** none
**Response (success):** `{ roomId: string }` — HTTP 200

Generate a unique room key for keyed PvP matchmaking in Playwright workers. Two contexts that `joinOrCreate('battle', { e2eRoomId })` with the same id pair into one isolated room.

---

### POST /api/test/drain-spirit

**Auth required:** yes (requireAuth only)
**Request body:** none
**Response (success):** `{ spirit_current: number }` — HTTP 200

Set the authenticated player's `spirit_current` to 0 so the no-spirit recharge guard can be asserted deterministically.

---

### POST /api/test/set-ring-xp

**Auth required:** yes (requireAuth only)
**Request body:** `{ ringId: string, xp: number }`
**Response (success):** `{ rings: Ring[] }` — HTTP 200
**Response (error):** 400 — `"ringId (string) and xp (non-negative number) are required"` | 404 — `"ring not found"`

Set a ring's XP to an absolute value. Used to deterministically max a parent ring for fusion tests.

---

### POST /api/test/set-gold

**Auth required:** yes (requireAuth only)
**Request body:** `{ gold: number }`
**Response (success):** `{ gold: number }` — HTTP 200
**Response (error):** 400 — `"gold (non-negative integer) is required"` | 404 — `"player not found"`

Set the authenticated player's gold to an exact value. `gold` must be a non-negative integer.

---

### POST /api/test/set-spirit

**Auth required:** yes (requireAuth only)
**Request body:** `{ spirit: number }`
**Response (success):** `{ spirit_current: number }` — HTTP 200
**Response (error):** 400 — `"spirit (non-negative integer) is required"`

Set the authenticated player's `spirit_current` to an exact value. `spirit` must be a non-negative integer.

---

### POST /api/test/grant-shard

**Auth required:** yes (requireAuth only)
**Request body:** none
**Response (success):** `{ ok: true, reliquaryShards: number }` — HTTP 200

Credit one Reliquary Shard to the authenticated player.

---

### POST /api/test/seed-npc-defeat

**Auth required:** yes (requireAuth only)
**Request body:** `{ npcId: string }`
**Response (success):** `{ ok: true }` — HTTP 200
**Response (error):** 400 — `"npcId (string) is required"`

Record a defeat of the given NPC for the authenticated player, so the boss-rematch row appears without driving a full win duel. Mirrors `recordNpcDefeat` called by `BattleRoom` on a real win.

---

### POST /api/test/grant-ring

**Auth required:** yes (requireAuth only)
**Request body:** `{ element?: number, tier?: number }`
**Response (success):** `{ ringId: string, player: PlayerBlock }` — HTTP 200
**Response (error):** 400 — any error from `grantRing`

Grant the authenticated player a WON ring (`in_carry=1, pending=1`) as if they won a battle. Spare count goes to `spare_ring_max+1` (one-slot overflow, always allowed on this path). Used to seed the pending-ring state in E2E tests without driving a real duel.

---

### POST /api/test/seed-resting-rings

**Auth required:** yes (requireAuth only)
**Request body:** `{ count: number, element?: number }`
**Response (success):** `{ ok: true, reliquaryCount: number }` — HTTP 200
**Response (error):** 400 — `"count (positive integer) is required"` | 400 — `"element must be a non-negative integer"`

Add `count` rings directly to the authenticated player's Reliquary (`in_carry = 0`). `element` defaults to `0` (Fire). Used to fill the Reliquary near or at capacity without going through normal ring-win mechanics.

---

### POST /api/test/set-aggregate-xp

**Auth required:** yes (requireAuth only)
**Request body:** `{ xp: number }`
**Response (success):** `{ ok: true, aggregateXp: number }` — HTTP 200
**Response (error):** 400 — `"xp (non-negative integer) is required"`

Grant the authenticated player a Reliquary ring carrying `xp` XP, so their `aggregate_xp` (sum of Reliquary ring XP) increases by `xp`. Additive — one call seeds a veteran from a fresh E2E player. `xp` must be a non-negative integer.

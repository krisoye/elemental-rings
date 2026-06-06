## Snow Mountains Region

> Region manifest for the Snow Mountains biome. For world architecture see `gdd-10-regions.md`.

The Snow Mountains are an optional side-biome north of the Forest, entered through the Frost Sentinel gate (`forest_snow_gate`). There is no progression requirement to enter — it can be attempted at any time — but Water and Wind enemies are stronger than early Forest opposition. The biome holds two fusion shrines (Storm, Dust) and a major boss.

**Dominant elements:** Water, Wind. **Counters to bring:** Wood (beats Water), Earth (safe defense).

**Biome visuals:** pale snowfield → glacier → mountain summit. Pale blue sky tint, constant snow-particle ambient, reduced ambient brightness. Standard detection radius (open terrain aids visibility). Implemented in `SnowScene.biomeVisuals()`.

**Region topology (9 screens):**

```
              [snow_blizzard_peak]⚔MAJOR
                      │ S/N
              [snow_storm_shrine]✦──E/W──[snow_glacier_upper]
                      │ S/N                      │ S/N
              [snow_frozen_lake]⚓2        [snow_dust_shrine]✦
                      │ S/N
              [snow_wind_pass]
              │ W/E            │ S/N
[snow_frost_cavern]🦇    [snow_snowhaven]🏠
                                │ S/N
                          [snow_entry]⚓1
                                │ S/N
                          → Forest north gate
```

Grid convention: `N = +y`, `S = −y`. Entry at `(0, 0)`.

---

#### `snow_entry` — Snow Fields Entry
- **size:** 32×24
- **coord:** `{ x: 0, y: 0 }`
- **exits:** north → `snow_snowhaven`
- **anchorage:** `snow_anchor_1` (Snow Fields)
- **biome_exit:** south → `ForestScene`
- **danger:** 2
- **content:** The first screen of the Snow Mountains — a windswept snowfield where cold sets in immediately. Packed snow broken by ice patches and frost-dusted boulders; sparse pines at the edges, branches laden with snow. Two mid-tier roamers patrol (a Wind monster and a Water monster — the player's first Water encounter if they arrived before the Swamp). The Snow Anchorage sits in the northern half of the clearing; discovering it allows teleportation back from the Sanctum. A pale blue sky overlay and snow-particle ambient establish the biome's visual identity. Walking south returns to the Forest.

---

#### `snow_snowhaven` — Snowhaven
- **size:** 38×30
- **coord:** `{ x: 0, y: 1 }`
- **exits:** south → `snow_entry`, west → `snow_frost_cavern`, north → `snow_wind_pass`
- **safe:** true
- **content:** A compact settlement dug into a sheltered rock face — the only safe ground in the Snow Mountains. Stone-and-timber buildings crouch against the cliff; smoke rises from chimneys behind thick wooden shutters. A Water-element merchant and a Wind-element merchant operate here, the only vendors in the biome. A quest-giver NPC sits near the central fire-ring. The rock wall behind the settlement is carved with old frost-rune patterns. The western door leads into the Frost Cavern. The north path climbs toward the mountain interior.

---

#### `snow_frost_cavern` — Frost Cavern
- **size:** 30×24
- **coord:** `{ x: -1, y: 1 }`
- **exits:** east → `snow_snowhaven`
- **danger:** 2
- **content:** A natural cave in the mountainside west of Snowhaven, cold enough to fog every breath. Icy stalactites hang from a low ceiling; the floor is uneven frozen mud. **Reduced detection radius** — dim light and tight passages mean enemies appear at close range. Shadow rings drop here: the only dark underground zone in the Snow Mountains. A narrow dead-end passage holds a forage cache of frost-preserved mushrooms. Exit only east to Snowhaven.

---

#### `snow_wind_pass` — Wind Pass
- **size:** 20×36
- **coord:** `{ x: 0, y: 2 }`
- **exits:** south → `snow_snowhaven`, north → `snow_frozen_lake`
- **danger:** 2
- **content:** A narrow pass between two rock faces, fully exposed to mountain wind. The path is barely wide enough for one person; loose snow blows sideways across the gap. Wind-element enemies are densest here — this corridor teaches players to manage defense against unavoidable neutral Wind attacks (always neutral; cannot be elementally countered, but still always costs a heart on a weak catch). A forage node sits in a sheltered alcove cut into the east wall. The pass connects Snowhaven below to the Frozen Lake plateau above.

---

#### `snow_frozen_lake` — The Frozen Lake
- **size:** 40×32
- **coord:** `{ x: 0, y: 3 }`
- **exits:** south → `snow_wind_pass`, north → `snow_storm_shrine`, east → `snow_glacier_upper`
- **anchorage:** `snow_anchor_2` (Frozen Lake)
- **danger:** 2
- **content:** A wide plateau where a mountain lake has frozen solid — a mirror of pale blue ice ringed by snow-dusted boulders and bare frost-firs. The Frozen Lake Anchorage sits on the western bank, a hard-earned second rest point. The ice surface is passable on foot. Two mid-tier Water and Wind duelists patrol the perimeter. The north path climbs toward the Storm Shrine; the east path rises onto the glacier. Foraging is possible along the rocky western shore.

---

#### `snow_glacier_upper` — Upper Glacier
- **size:** 32×28
- **coord:** `{ x: 1, y: 3 }`
- **exits:** west → `snow_frozen_lake`, north → `snow_dust_shrine`
- **danger:** 3
- **content:** The glacier's upper surface — rolling ancient blue ice broken by pressure ridges. Wind is relentless; the light is stark. Danger 3 Wind and Water duelists patrol the exposed expanse. No cover: detection range is effectively doubled because nothing blocks sightlines. The path north terminates at the Dust Shrine behind a rock outcrop. A forage cache sits wedged in a glacial crevice. Eastern face is a sheer ice drop — dead end.

---

#### `snow_storm_shrine` — Storm Shrine
- **size:** 38×30
- **coord:** `{ x: 0, y: 4 }`
- **exits:** south → `snow_frozen_lake`, east → `snow_dust_shrine`, north → `snow_blizzard_peak`
- **danger:** 2
- **shrine:** Storm (Water + Wind)
- **shrine_key:** The altar doors are sealed. A Storm ring must be won in combat and inserted into the altar slot to unseal them permanently. The Storm Guardian — a Water+Wind duelist who holds the only Storm ring at this altitude — must be defeated first. Inserting the ring consumes it; the doors open and Storm crafting becomes available here.
- **content:** A wide clearing sheltered between two rock shoulders at mid-height. An ancient stone altar stands at center, twin doors carved with intertwined water-flow and spiral-wind glyphs, sealed tight. A permanent low-level storm circles the clearing — snow swirls in counter-clockwise rings but never accumulates. The Storm Guardian patrols the outer ring. The north pass continues toward the summit.

---

#### `snow_dust_shrine` — Dust Shrine
- **size:** 32×26
- **coord:** `{ x: 1, y: 4 }`
- **exits:** west → `snow_storm_shrine`, south → `snow_glacier_upper`
- **danger:** 2
- **shrine:** Dust (Wind + Earth)
- **shrine_key:** The altar doors are sealed. A Dust ring must be won in combat and presented to the altar. The Dust Guardian — a Wind+Earth duelist — must be defeated first.
- **content:** A rocky shelf east of the Storm Shrine clearing, partially sheltered by a line of standing stones worn smooth by centuries of ice. The Dust altar is simpler — a single upright slab with a recessed ring socket, dark stone doors flush with a cliff face. A rare forage node grows on a sunlit south-facing wall: dried alpine plants clinging to the only warm rock in the area. Dead end from north and east.

---

#### `snow_blizzard_peak` — Blizzard Peak
- **size:** 36×28
- **coord:** `{ x: 0, y: 5 }`
- **exits:** south → `snow_storm_shrine`
- **danger:** 3

**Boss: The Blizzard King**
A towering figure of compressed storm-matter — condensed snow and howling wind that has claimed the mountain's highest reachable point as its seat. Uses Water offensively and Wind defensively; the same combination as the Storm ring, previewing what fusion produces.

| Property | Value |
|---|---|
| Elements | Water (attack) + Wind (defense) |
| Personality | Status-Hunter (Water → Drowning) |
| HP | Major boss tier |
| XP | Major boss tier |

**Defeat rewards:**
1. **Reliquary Shard** — expands the Reliquary by 10 ring slots (§4.1.1).
2. **Large food cache** — biome boss food drop (§10.5).
3. **Storm ring** — the Blizzard King's staked **Storm** (Water+Wind) fused thumb transfers to the winner (§9.1).

**Content:** The mountain's highest accessible point — a narrow summit plateau scoured clean by permanent blizzard. Visibility is low; the environment is pure white and grey. The Blizzard King stands at the center of a permanent eye-of-the-storm. No exits north. Approach from the Storm Shrine is the only path up.

---

### Snow Region Design Notes

- Snow is entirely optional — no world-progression gate requires it.
- Shadow rings drop only in `snow_frost_cavern`.
- Both shrines (Storm, Dust) are sealed-door type — guardian must be defeated before altar unlocks.
- `snow_anchor_2` (Frozen Lake) must be added to `shared/waystones.ts` in the implementation EPIC.

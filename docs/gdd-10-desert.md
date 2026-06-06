## Desert, Canyon & Volcano Regions

> Region manifests for `DesertScene` and `VolcanoScene`. For world architecture see `gdd-10-regions.md`.

The Desert/Canyon/Volcano is the game's largest and final region — a crescent wrapping the eastern and southern edges of the Forest and Swamp. It is implemented as **two separate scene classes**: `DesertScene` (southern canyon and desert flatlands, 13 screens) and `VolcanoScene` (northeastern volcanic highlands, 9 screens). The two scenes connect via an ungated internal passage (`desert_volcano_link` ↔ `volcano_canyon_link`).

**First Fire.** This is where Fire element appears for the first time. No Fire merchants or enemies exist in the Forest, Snow, or Swamp. All four Fire-fusion shrines (Wildfire, Magma, Inferno, Steam) are located here. Players arrive with Earth/Wind/Water/Wood rings and acquire Fire rings through combat or Desert merchants.

---

## DesertScene

**Dominant elements:** Fire, Earth. **Counters to bring:** Water (beats Fire), Wind (safe offense).

**Biome visuals:** sandy palette, heat shimmer on distant terrain, bleached sky. No fog. Wide open screens; standard or better detection radius. Implemented in `DesertScene.biomeVisuals()`.

**Three entries:**
- `desert_south_entry` ← from `swamp_south_gate` (south of Swamp)
- `desert_east_entry` ← from `swamp_east_gate` (east of Swamp)
- `desert_volcano_link` ← ungated internal link from `VolcanoScene`

**Region topology (13 screens):**

```
[desert_volcano_link](0,6) biomeExit N→VolcanoScene
          │ S/N
[desert_canyon_upper](0,5)──W──[desert_magma_shrine](-1,5)✦ dead end
          │ S/N
[desert_canyon_crossing](0,4)──W──[desert_obsidian_dungeon](-1,4)⚿
          │ S/N  ──E──[desert_east_entry](1,4) biomeExit E→SwampScene
                              │ N/S
                  [desert_wildfire_shrine](1,5)✦ dead end
[desert_oasis_town](0,3)⚓──E──[desert_scorched_cave](1,3)🦇
          │ S/N
[desert_flats](0,2)──E──[desert_dune_sea](1,2) dead end
          │ S/N
[desert_dune_approach](0,1)
          │ S/N
[desert_south_entry](0,0) biomeExit S→SwampScene
```

Grid: `N = +y`. South entry at `(0,0)` (player exits Swamp heading south; Desert's y=0 is Swamp-adjacent). Volcano link at `(0,6)`.

---

#### `desert_south_entry` — Southern Desert Entry
- **size:** 32×22
- **coord:** `{ x: 0, y: 0 }`
- **exits:** north → `desert_dune_approach`
- **biome_exit:** south → `SwampScene`
- **danger:** 2
- **content:** One step and the ground shifts from sandy mud to hard-packed orange earth. The smell of rot and standing water is immediately replaced by dry heat. Sparse scrub brush clings to cracked soil. The first Fire-element roamer in the game patrols here alongside an Earth-element partner. No anchorage; no merchants. Walking south returns to the Swamp through the Southern Bog Gate.

---

#### `desert_dune_approach` — Dune Approach
- **size:** 30×24
- **coord:** `{ x: 0, y: 1 }`
- **exits:** south → `desert_south_entry`, north → `desert_flats`
- **danger:** 1
- **content:** Shallow dunes of compacted sand and gravel interrupted by bleached rock outcrops. The gradient from Swamp humidity to full desert heat is perceptible here. Danger 1 roamers make this the safest Desert screen. A forage cache sits under a rock ledge on the eastern side.

---

#### `desert_flats` — The Desert Flats
- **size:** 40×30
- **coord:** `{ x: 0, y: 2 }`
- **exits:** south → `desert_dune_approach`, north → `desert_oasis_town`, east → `desert_dune_sea`
- **danger:** 2
- **content:** Open flat desert — baked earth cracked into irregular plates, sparse fire-thorn bushes, a salt flat running east–west. The sky is enormous. Fire and Earth enemies roam in wide arcs; the open terrain makes ambush impossible. A forage node marks a cluster of desert plants at the base of a rock face.

---

#### `desert_dune_sea` — The Dune Sea
- **size:** 36×28
- **coord:** `{ x: 1, y: 2 }`
- **exits:** west → `desert_flats`
- **danger:** 2
- **content:** Rolling deep sand dunes east of the Flats. Wind and Fire duelists patrol the crests; the dunes provide cover and make movement less predictable. A forage node of dried desert fungi sits in a dune valley. Eastern dunes become impassable cliff-dunes — dead end.

---

#### `desert_oasis_town` — The Oasis
- **size:** 44×36
- **coord:** `{ x: 0, y: 3 }`
- **exits:** south → `desert_flats`, north → `desert_canyon_crossing`, east → `desert_scorched_cave`
- **anchorage:** `desert_oasis` (Desert Oasis)
- **safe:** true
- **content:** A genuine desert oasis — date palms, a spring-fed pool, shade structures of woven canvas over timber frames. The Oasis Anchorage is the mid-region rest point. Three merchants operate here: a Fire-element merchant (**the first Fire-ring vendor in the game**), an Earth-element merchant, and a general merchant stocking food and shrine maps. A quest-giver NPC oversees the spring. Neutral ground — built on permanent trade routes predating any current political entity.

---

#### `desert_scorched_cave` — Scorched Cave
- **size:** 26×22
- **coord:** `{ x: 1, y: 3 }`
- **exits:** west → `desert_oasis_town`
- **danger:** 2
- **content:** A cave in the canyon wall east of the Oasis, its walls scorched black by ancient heat. The temperature is extreme. **Reduced detection radius** — darkness and narrow passages make this dangerous at close quarters. Shadow rings drop here. A Fire/Wind enemy guards the deepest chamber; a forage cache sits behind it. Dead end.

---

#### `desert_east_entry` — Canyon Mouth Entry
- **size:** 30×22
- **coord:** `{ x: 1, y: 4 }`
- **exits:** west → `desert_canyon_crossing`, north → `desert_wildfire_shrine`
- **biome_exit:** east → `SwampScene`
- **danger:** 2
- **content:** The canyon mouth opening from the Swamp's eastern gate. High canyon walls rise immediately; the transition from swamp scrub to dry rock is dramatic. Fire enemies first appear here for players arriving via the eastern route. Walking east returns to the Swamp through the Eastern Canyon Gate. Distant volcanic activity becomes audible for the first time.

---

#### `desert_wildfire_shrine` — Wildfire Shrine
- **size:** 34×26
- **coord:** `{ x: 1, y: 5 }`
- **exits:** south → `desert_east_entry`
- **danger:** 2
- **shrine:** Wildfire (Fire + Wood)
- **shrine_key:** The altar doors are sealed. A Wildfire ring must be won in combat and presented to the altar. The Wildfire Guardian — a Fire+Wood duelist — must be defeated first.
- **content:** A dead-end canyon alcove where ancient charred wood forms natural benches around an altar of black stone. The Wildfire shrine sits at the geographic boundary between the Swamp's forest zone and the Desert's fire zone — its fusion element (Fire+Wood) reflects exactly this meeting point. The Guardian's Wood rings are among the last Wood-element enemies in the game. Dead end.

---

#### `desert_canyon_crossing` — The Canyon Crossing
- **size:** 38×28
- **coord:** `{ x: 0, y: 4 }`
- **exits:** south → `desert_oasis_town`, north → `desert_canyon_upper`, east → `desert_east_entry`, west → `desert_obsidian_dungeon`
- **danger:** 3
- **content:** The central canyon junction — a wide dry riverbed where three canyon channels converge. High walls; the sky is a narrow strip overhead. Danger 3 Fire and Earth enemies patrol in pairs. A forage cache sits in a crevice on the north wall. The four exits make this the strategic decision point of the Desert: oasis (south), canyon climb (north), Swamp mouth (east), dungeon (west).

---

#### `desert_obsidian_dungeon` — The Obsidian Vault
- **size:** 36×28
- **coord:** `{ x: -1, y: 4 }`
- **exits:** east → `desert_canyon_crossing`
- **danger:** 3
- **content:** A deep canyon chamber with walls of natural obsidian — volcanic glass formed when ancient lava flows met the canyon's underground water. The dungeon sub-boss — an Aggressive Fire+Earth duelist — occupies the deepest point. Defeating it yields a **Reliquary Shard** (expands Reliquary by 10 slots, §4.1.1) and a significant XP cache. Dead end.

---

#### `desert_canyon_upper` — Upper Canyon
- **size:** 32×26
- **coord:** `{ x: 0, y: 5 }`
- **exits:** south → `desert_canyon_crossing`, north → `desert_volcano_link`, west → `desert_magma_shrine`
- **danger:** 3
- **content:** The upper reach of the canyon — walls grow hotter and the rock changes from tan sandstone to dark red-brown. Volcanic activity is visible: a faint glow of distant lava, rising thermals, ash particles. Danger 3 enemies patrol in pairs. Walking north continues into the Canyon–Volcano Passage (`desert_volcano_link`) toward `VolcanoScene` — no gate boss blocks this route.

---

#### `desert_volcano_link` — Canyon–Volcano Passage
- **size:** 20×36
- **coord:** `{ x: 0, y: 6 }`
- **exits:** south → `desert_canyon_upper`
- **biome_exit:** north → `VolcanoScene`
- **danger:** 3
- **content:** A tight corridor where the canyon narrows to its minimum width and rock transitions from red sandstone to black basalt. Heat is palpable; one patrol enemy. Transition screen between DesertScene and VolcanoScene — functionally a passage, not a destination. No anchorage. Walking north enters `VolcanoScene` at `volcano_canyon_link`.

---

#### `desert_magma_shrine` — Magma Shrine
- **size:** 34×26
- **coord:** `{ x: -1, y: 5 }`
- **exits:** east → `desert_canyon_upper`
- **danger:** 2
- **shrine:** Magma (Fire + Earth)
- **shrine_key:** The altar doors are sealed. A Magma ring must be won in combat and presented to the altar. The Magma Guardian — a Fire+Earth duelist — must be defeated first.
- **content:** A dead-end canyon alcove west of the Upper Canyon. Solidified lava flows have formed a natural shelf around the altar — stepped black rock reading like a ceremonial floor. The Magma altar is squat and wide, built from the same basalt as the walls, sealed doors inlaid with orange-red ore that glows faintly. The Guardian here is the most Earth-heavy enemy in the game. Dead end.

---

### DesertScene Design Notes

- Shadow rings drop only in `desert_scorched_cave`.
- The Obsidian Vault sub-boss is Dungeon encounter — reward-only, no gate opens.
- `desert_oasis` anchorage id must be added to `shared/waystones.ts` in the implementation EPIC.
- The `desert_volcano_link` biome exit is **ungated** — DesertScene and VolcanoScene are one continuous region.

---

## VolcanoScene

**Dominant elements:** Fire, Wind. **Counters to bring:** Water (beats Fire), Earth (safe defense).

**Biome visuals:** dark basalt terrain, orange-red lava-glow ambient, ash particles, heat shimmer. Narrowing screens in the upper section. Implemented in `VolcanoScene.biomeVisuals()`.

**One entry from Forest** (`forest_volcano_gate` → `volcano_entry`). **One internal connection** to/from DesertScene (`volcano_canyon_link` ↔ `desert_volcano_link`). **Future stub north** from `volcano_summit`.

**Region topology (9 screens):**

```
[volcano_summit](0,5) future biomeExit N→FUTURE_REGION
          │ S/N (opens on boss defeat)
[volcano_molten_throne](0,4) ⚔MAJOR
          │ S/N (gated)
[volcano_caldera_rim](0,3) ⚓
          │ S/N
[volcano_caldera_approach](0,2)──E──[volcano_steam_shrine](1,2)✦
          │ S/N             └──W──[volcano_inferno_shrine](-1,2)✦
[volcano_highlands](0,1)──E──[volcano_canyon_link](1,1) biomeExit S→DesertScene
          │ S/N
[volcano_entry](0,0) ⚓1 biomeExit W→ForestScene
          │ S/N
→ forest_volcano_gate
```

Grid: `N = +y`. Entry at `(0,0)` (west edge — Forest is to the west). Boss at north.

---

#### `volcano_entry` — Volcanic Entry
- **size:** 34×26
- **coord:** `{ x: 0, y: 0 }`
- **exits:** north → `volcano_highlands`
- **anchorage:** `volcano_anchor_1` (Volcanic Entry)
- **biome_exit:** west → `ForestScene`
- **danger:** 2
- **content:** The first screen of the Volcano region — an abrupt shift from scorched Forest fringe to raw volcanic rock. Basalt plates, lava-rock rubble, pools of geothermal water. The air tastes of sulphur. The Volcanic Entry Anchorage sits in the western half, the first rest point in the Volcano. Fire and Wind enemies patrol at mid tier. Walking west returns to Forest through the Volcano Gate. North climbs into the volcanic highlands; the canyon link down to `DesertScene` is reached through them.

---

#### `volcano_highlands` — Volcanic Highlands
- **size:** 36×28
- **coord:** `{ x: 0, y: 1 }`
- **exits:** south → `volcano_entry`, north → `volcano_caldera_approach`, east → `volcano_canyon_link`
- **danger:** 2
- **content:** Elevated basalt terrain with lava seams glowing through rock cracks. Fire and Wind enemies are standard here; the first Inferno-element NPC (Fire+Wind) can appear as a mid-tier duelist. Ash particles fall in the background. Two to three duelists patrol the open highland floor.

---

#### `volcano_canyon_link` — Canyon Link
- **size:** 20×30
- **coord:** `{ x: 1, y: 1 }`
- **exits:** west → `volcano_highlands`
- **biome_exit:** south → `DesertScene`
- **danger:** 2
- **content:** A narrow east-facing passage where volcanic highlands descend into the upper canyon. The transition is geological: black basalt above gives way to red sandstone below. Walking south crosses into `DesertScene` at `desert_volcano_link` (ungated). One patrol enemy. No anchorage. Effectively a corridor connecting the two scene classes of the same region.

---

#### `volcano_caldera_approach` — Caldera Approach
- **size:** 32×24
- **coord:** `{ x: 0, y: 2 }`
- **exits:** south → `volcano_highlands`, north → `volcano_caldera_rim`, east → `volcano_steam_shrine`, west → `volcano_inferno_shrine`
- **danger:** 3
- **content:** The tightening approach to the caldera — steeper terrain, wider lava seams, strongest heat shimmer. Danger 3 enemies. The two lateral passages lead to the Inferno and Steam shrines; the north path continues climbing to the caldera rim. This is the final branching point before the pre-boss rest.

---

#### `volcano_steam_shrine` — Steam Shrine
- **size:** 32×26
- **coord:** `{ x: 1, y: 2 }`
- **exits:** west → `volcano_caldera_approach`
- **danger:** 2
- **shrine:** Steam (Fire + Water)
- **shrine_key:** The altar doors are sealed. A Steam ring must be won in combat and presented to the altar. The Steam Guardian — a Fire+Water duelist — must be defeated first.
- **content:** A dead-end alcove where a geothermal spring meets exposed lava rock — the only water visible in the Volcano. Steam rises in vertical columns. The altar emerges from the largest vent: black stone, doors inlaid with blue-grey glass where mineral deposits have crystallised. Dead end.

---

#### `volcano_inferno_shrine` — Inferno Shrine
- **size:** 32×26
- **coord:** `{ x: -1, y: 2 }`
- **exits:** east → `volcano_caldera_approach`
- **danger:** 2
- **shrine:** Inferno (Fire + Wind)
- **shrine_key:** The altar doors are sealed. An Inferno ring must be won in combat and presented to the altar. The Inferno Guardian — a Fire+Wind duelist — must be defeated first.
- **content:** A wind-blasted ledge scoured clean by updrafts rising from a lava vent below. The Inferno altar stands near the vent edge; the carving shows fire spiralling outward in all directions. The Guardian wields the same elemental combination as the boss above, previewing the Molten Throne encounter. Dead end.

---

#### `volcano_caldera_rim` — The Caldera Rim
- **size:** 36×28
- **coord:** `{ x: 0, y: 3 }`
- **exits:** south → `volcano_caldera_approach`, north → `volcano_molten_throne` *(gated)*
- **anchorage:** `volcano_caldera` (Caldera Rim)
- **danger:** 1
- **content:** A flat outcrop on the caldera's outer rim — the only safe ground near the summit. The Caldera Rim Anchorage is the last teleportation option before the final boss. The view is the game's most dramatic landscape: a sea of glowing lava below, the distant green of the Forest visible to the southwest. One or two passive NPCs rest here — wanderers who reached the rim but turned back. Walking north enters the Molten Throne approach.

---

#### `volcano_molten_throne` — The Molten Throne
- **size:** 40×32
- **coord:** `{ x: 0, y: 4 }`
- **exits:** south → `volcano_caldera_rim`, north → `volcano_summit` *(opens on boss defeat)*
- **danger:** 3

**Boss: The Molten Sovereign**
An ancient fire elemental that has claimed the volcanic caldera as its throne — solidified lava and channelled volcanic wind, older than the Forest itself. Uses Fire offensively and Wind defensively; mirrors the Inferno ring.

| Property | Value |
|---|---|
| Elements | Fire (attack) + Wind (defense) |
| Personality | Aggressive + enrage phase (≤ 30% HP) |
| HP | Major boss tier |
| XP | Major boss tier |

**Defeat rewards:**
1. **Reliquary Shard** — expands the Reliquary by 10 ring slots (§4.1.1).
2. **Large food cache** — biome boss food drop (§10.5).
3. **North exit opens** — `volcano_summit` becomes accessible.
4. **Inferno ring** — the Sovereign's staked **Inferno** (Fire+Wind) fused thumb transfers to the winner (§9.1).

**Content:** The caldera's inner floor — a wide platform of cooled lava above a still-active magma pool. Heat columns rise in visible waves. The Molten Sovereign stands at center, motionless until approached. Defeating it is the game's current content endpoint.

---

#### `volcano_summit` — Volcanic Summit
- **size:** 28×22
- **coord:** `{ x: 0, y: 5 }`
- **exits:** south → `volcano_molten_throne`
- **biome_exit:** north → *(future region — unimplemented; the exit is present but sealed)*
- **danger:** 1
- **content:** The volcanic summit — highest reachable point in the current build. A short flat platform above the caldera, open sky in all directions. The world is visible from here: the Forest's green canopy to the southwest, the Swamp's grey-green expanse to the south, the Desert's orange expanse below and around. A sealed stone arch marks the northern edge — carved with glyphs that match no known faction. It does not open. The path south leads back to the Molten Throne and the long descent home.

---

### VolcanoScene Design Notes

- `volcano_anchor_1` and `volcano_caldera` anchorage ids must be added to `shared/waystones.ts` in the implementation EPIC.
- The Desert ↔ Volcano passage is **ungated** — players can freely move between scenes once in the region.
- The `volcano_summit` north exit is a **visual stub only** — the arch is present on the world map but cannot be used. Handle `FUTURE_REGION` as a no-op transition with a "path is sealed" message.
- The Molten Sovereign's enrage phase reuses the existing `enraged` schema field on `PlayerState`.

---

### Regional Summary

| Scene | Screens | Shrines | Boss | Anchorages |
|---|---|---|---|---|
| DesertScene | 13 | Wildfire (F+Wo), Magma (F+E) | Obsidian sub-boss (dungeon) | `desert_oasis` |
| VolcanoScene | 9 | Inferno (F+Wi), Steam (F+W) | Molten Sovereign (major) | `volcano_anchor_1`, `volcano_caldera` |
| **Combined** | **22** | **4 Fire fusions** | **1 major** | **3** |

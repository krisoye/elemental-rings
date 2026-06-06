> Region manifest for the Forest biome. For world architecture and biome-scene class hierarchy see `gdd-10-regions.md`. For other biomes: `gdd-10-snow.md`, `gdd-10-swamp.md`, `gdd-10-desert.md`.

### 10.15 Forest Region Screens

The Forest is a **multi-screen region** — a graph of discrete maps connected by road edges. Walking off a screen edge transitions (brief fade) to the neighbor, spawning the player at the opposite edge. Each screen is one Tiled map file generated from this manifest.

**Schema conventions:**
- `size` is width × height in tiles. Narrow dimensions imply a corridor — the generator flanks the short axis with trees/rocks, leaving only the road open.
- `exits` are always reciprocal and validated by a drift test. `north`/`south` and `east`/`west` are the only valid directions.
- `anchorage` ids must exist in the anchorage catalog (`shared/waystones.ts`).
- A `waystone` is a **revelation marker** — attuning it reveals a distant region; it is not a teleport destination.
- A `biome_exit` marks a transition to a different biome scene, held by a boss gate until that boss is defeated.
- `danger` (1–3) controls NPC tier and density. Omit for safe screens.
- Add a new screen here first; the drift test catches broken exits or unknown ids before implementation.

**Region topology (29 screens):**

The Forest is embedded on a coherent integer grid (`coord` in each `ScreenDef`):
`N = +y`, `S = −y`, `E = +x`, `W = −x`. Every exit is a unit cardinal step to the
room at the adjacent cell. The map below is drawn to that grid.

*Main body + west wing + Thornado wing:*
```
            [snow_gate]
                 │ N/S
            [north_road]
                 │ N/S
[fen_ridge]─S/N─[deep_fen]─E/W─[mossy_fen]─E/W─[anchorage]─E/W─[east_path]─E/W─[glade]─E/W─[heath]─N/S─[gale_lookout]
                                                      │ N/S                              │ N/S       │ E/W
                                               [south_path]                        [crossroads]  [wind_shelf]─E/W─[thornado_shrine]
                                                      │ N/S                              │ N/S
                                               [hollow]─W/E─[swamp_gate]──→ SwampScene  [ridge]─N/S─[rocky_overlook]
                                                                                            │ E/W
                                                           [briar_pass]─E/W─[crossroads's column]
                                                                 │ N/S
                                                           [deepwood]─E/W─[ridge]
                                                                 │ N/S
                                                           [boss_clearing]
```
The crossroads cluster forms a planar vertical chain. `briar_pass` sits **west** of
`crossroads`; the spine runs `briar_pass(1,1) → deepwood(1,2) → boss_clearing(1,3)`
with `ridge(2,2)` to the east of `deepwood` (and `crossroads(2,1)` south of `ridge`,
`rocky_overlook(2,3)` north of it):
```
[crossroads]──N/S──[ridge]──N/S──[rocky_overlook]
     │ W/E            │ W/E
[briar_pass]──N/S──[deepwood]
                     │ N/S
                [boss_clearing]   (N boss-gated)
```
*Deep forest (north of boss clearing — reachable only after the Warden falls):*
```
[boss_clearing]─N/S─[verdant_descent]─N/S─[ancient_grove]─W/E─[bloom_hollow]
                                               │ E/W
                                          [root_tangle]─E/W─[canopy_walk]─E/W─[briar_thicket]
```
The old `root_tangle → deepwood` backdoor is removed: the deep forest is now a
dead-end wing entered exclusively through the boss gate.
```
[hidden_alcove]  ← teleport-only, no walking exits, no grid coord
```

---

#### `forest_anchorage` — Forest Anchorage (hub)
- **size:** 40×30 tiles × 16 px = 640×480 world pixels (rendered at 2× zoom)
- **exits:** north → `forest_north_road`, east → `forest_east_path`, south → `forest_south_path`, west → `forest_mossy_fen`
- **safe:** true
- **anchorage:** `forest_entry`
- **map:** hand-authored Tiled export (`client/public/assets/maps/forest/forest_anchorage.json`) — **not generated** by the forest-screen generator. Merchant NPCs are spawned as interactive sprites from the `objects` layer.
- **layers:** follows the three-layer convention (§10.1) — `ground` (terrain), `behind` (south walls, trunks), `in-front` (roofs, canopy)
- **objects:** `spawn` (player start), `anchorage` (forest_entry zone), `sanctum_return` (return-to-Sanctum zone), two `forage_node` objects (berry_1, berry_2), two `merchant` NPCs
- **content:** The safe community hub. A large lake occupies the northwest quarter. An orange-roofed merchant building sits in the northeast; a larger blue-roofed building with a south-facing entrance dominates the center. Berry bushes, mixed grass-and-soil paths, and a stone wall section fill the remaining space. Two merchant NPCs are present. The Sanctum anchors here by default; all four cardinal exits lead into the wider Forest region.

---

#### `forest_north_road` — North Road
- **size:** 16×32
- **exits:** south → `forest_anchorage`, north → `forest_snow_gate`
- **danger:** 1
- **content:** A narrow north corridor — trees press in on both sides, the dirt path bisects the center. Pines gradually take on frost tips toward the north edge. One or two early-zone roamers patrol the length.

---

#### `forest_snow_gate` — Snow Gate
- **size:** 32×20
- **exits:** south → `forest_north_road`
- **biome_exit:** north → `SnowScene` *(held by the Frost Sentinel gate warden until defeated)*
- **danger:** 2
- **content:** A widening clearing at the forest's northern fringe. Frost-touched firs press in from the east and west; the air is noticeably colder here than deeper in the Forest. The **Frost Sentinel** — a gate-tier WIND-element boss — stands in the northern passage. Until it falls, the north exit is physically blocked; defeating it drops a food cache and opens the path into the Snow Fields. The Sentinel's WIND thumb transfers to the winner like any duel (§9.1).

---

#### `forest_mossy_fen` — Mossy Fen
- **size:** 32×22
- **exits:** east → `forest_anchorage`, west → `forest_deep_fen`
- **danger:** 1
- **content:** A quiet, slightly boggy clearing west of town. Mossy ground, scattered mushroom clusters, low-hanging branches. The richest early foraging spot. A solitary passive Villager wanders here. A path west continues deeper into the fen.

---

#### `forest_east_path` — East Path
- **size:** 24×12
- **exits:** west → `forest_anchorage`, east → `forest_glade`
- **danger:** 1
- **content:** A short east-west connector. Trees close in from north and south; a single dirt road runs the length. One roamer patrols the midpoint. Feels like stepping out of the safety of town for the first time.

---

#### `forest_glade` — The Glade
- **size:** 36×28
- **exits:** west → `forest_east_path`, north → `forest_crossroads`, east → `forest_heath`
- **anchorage:** `forest_glade`
- **danger:** 1
- **content:** A sunlit open meadow — the second Anchorage and the first natural rest stop beyond the hub. Tall grass at the edges, a worn campfire ring at center. Several Duelist NPCs wander between here and the Crossroads. The eastern edge opens onto rolling heath — the start of the Thornado wing.

---

#### `forest_crossroads` — The Crossroads
- **size:** 28×22
- **exits:** south → `forest_glade`, north → `forest_ridge`, west → `forest_briar_pass`
- **danger:** 1
- **content:** A three-way junction where the road forks into increasingly dangerous territory. Two to three mid-tier duelists patrol. The choice of west (Briar Pass) or north (Ridge ascent) gives the player a meaningful direction decision.

---

#### `forest_south_path` — South Path
- **size:** 16×28
- **exits:** north → `forest_anchorage`, south → `forest_hollow`
- **danger:** 1
- **content:** A narrow portrait corridor south of town. The dirt path narrows and the canopy closes overhead. Mushrooms crowd the verges. A gentle danger ramp between the hub and the Hollow.

---

#### `forest_hollow` — The Hollow
- **size:** 36×24
- **exits:** north → `forest_south_path`, west → `forest_swamp_gate`
- **danger:** 2
- **content:** A wide, sunken clearing with darker palette and muddy ground patches. The best foraging density in the Forest — mushroom clusters, roots, berry tangles. Two to three tougher NPCs. The western path carries a faint smell of peat; the Swamp Gate is close.

---

#### `forest_swamp_gate` — Swamp Gate
- **size:** 28×18
- **exits:** east → `forest_hollow`
- **danger:** 2
- **biome_exit:** south → `SwampScene` *(held by the Bogwood Warden boss gate until defeated)*
- **content:** The southwestern fringe. Ground shifts from dirt to mud; standing water pools near the edge. The **Bogwood Warden** — a mid-tier boss wielding Mud (Water+Earth) attack and Wood defense — stands in the south passage. Until it falls, the south edge is impassable; defeating it opens the way into the Swamp, drops a food cache, and yields its staked **Mud** (Water+Earth) ring — the Warden's fused thumb transfers to the winner like any duel (§9.1).

---

#### `forest_briar_pass` — Briar Pass
- **size:** 40×16
- **exits:** east → `forest_crossroads`, north → `forest_deepwood`
- **danger:** 2
- **content:** A wide, low corridor choked with thorns on both sides — the road is barely a lane. Danger 2 roamers feel more menacing because of the tight sightlines. The east path returns to the Crossroads; the north path climbs into the Deepwood spine.

---

#### `forest_ridge` — The Ridge
- **size:** 32×22
- **exits:** south → `forest_crossroads`, north → `forest_rocky_overlook`, west → `forest_deepwood`
- **danger:** 2
- **content:** Rocky elevated ground; implied hillside looking south over the canopy. Sparse trees, more open sky. Danger 2 duelists patrol the exposed rock. The western descent drops into the darkest part of the forest. A rocky path climbs north to an exposed overlook.

---

#### `forest_deepwood` — The Deepwood
- **size:** 40×30
- **exits:** south → `forest_briar_pass`, east → `forest_ridge`, north → `forest_boss_clearing`
- **anchorage:** `forest_depths`
- **danger:** 3
- **content:** The oldest, darkest part of the forest — ancient gnarled trees, almost no light reaching the floor. The forest_depths Anchorage sits in a rare clearing, a hard-earned rest point. Danger 3 duelists. The Deepwood is the middle link of the crossroads-cluster spine: south returns to the Briar Pass, east climbs to the Ridge, and north opens into the Boss Clearing.

---

#### `forest_boss_clearing` — The Boss Clearing
- **size:** 28×22
- **exits:** south → `forest_deepwood`, north → `forest_verdant_descent` *(opens on boss defeat)*
- **danger:** 3

**Boss: The Thornwood Warden**
A towering spirit of bark and howling wind, the oldest guardian the Forest has ever set against intruders. Uses Wood offensively and Wind defensively — the same combination as the Thornado ring, previewing what fusion can produce.

| Property | Value |
|---|---|
| Elements | Wood (attack) + Wind (defense) |
| Personality | Aggressive / Defensive mix |
| HP | Major boss tier |
| XP | Major boss tier |

**Defeat rewards:**
1. **Reliquary Shard** — the first shard in the game. Expands the Reliquary from 20 to 30 ring slots (§4.1.1).
2. **Large food cache** — biome boss food drop (§10.5).
3. **North exit opens** — the Verdant Descent becomes accessible, unlocking the Bloom wing.
4. **Thornado ring** — the Warden's staked **Thornado** (Wood+Wind) fused thumb transfers to the winner, like any duel (§9.1).

**Content:** A circular clearing of stamped earth ringed by ancient standing stones, unnaturally still and quiet. The Warden blocks the north passage; the clearing is reached from the south via the Deepwood, the southern terminus of the crossroads-cluster spine — but there is no way north into the deep forest until the Warden is defeated.

---

#### `forest_heath` — The Heath
- **size:** 38×26
- **exits:** west → `forest_glade`, east → `forest_wind_shelf`, north → `forest_gale_lookout`
- **danger:** 2
- **content:** Open rolling heath east of the Glade. Long grass, scattered boulders, hawthorn thickets at the edges. The first screen where Wind-element NPCs appear in numbers alongside Wood ones. The air tastes drier, more open — a noticeable shift from the enclosed forest interior.

---

#### `forest_gale_lookout` — Gale Lookout
- **size:** 26×20
- **exits:** south → `forest_heath`
- **danger:** 2
- **content:** A rocky outcrop north of the Heath at the top of a slight rise. Open sky, sweeping view back over the forest canopy. One strong Wind-element duelist guards the high ground. A forage node sits in a windswept crevice. Dead end.

---

#### `forest_wind_shelf` — Wind Shelf
- **size:** 28×28
- **exits:** west → `forest_heath`, east → `forest_thornado_shrine`
- **danger:** 2
- **content:** Elevated rocky shelf — trees here are sparse and twisted sideways after decades of wind. Stones are scoured smooth. The path east narrows into a natural wind tunnel between two stone faces; the sound of the shrine clearing is audible before it is visible.

---

#### `forest_thornado_shrine` — Thornado Shrine
- **size:** 40×30
- **exits:** west → `forest_wind_shelf`, east → `forest_volcano_gate`
- **danger:** 2
- **shrine:** Thornado (Wood + Wind)
- **shrine_key:** The altar doors are sealed. A Thornado ring must be won and inserted into the altar slot to unseal them permanently. The Shrine Guardian — a duelist who wields the only Thornado ring in this part of the forest — must be defeated first. Inserting the ring consumes it; the doors open and crafting becomes available from that point forward.
- **content:** A wide clearing at the forest's windswept eastern fringe. An ancient stone altar stands at the center, its twin doors sealed and carved with intertwined Wood and Wind glyphs. A perpetual gale circles the clearing, bending the grass flat. The Shrine Guardian patrols the outer ring. Defeat them, claim their Thornado ring, and present it to the altar to unlock Thornado crafting here. The shrine is reachable before the Forest boss, but the Thornado ring must be won in combat first. The east path continues to the Volcano Gate at the forest's scorched eastern fringe.

---

#### `forest_verdant_descent` — Verdant Descent
- **size:** 18×32
- **exits:** south → `forest_boss_clearing`, north → `forest_ancient_grove`
- **danger:** 2
- **content:** A narrow root-lined passage north of the Boss Clearing, accessible only after the Thornwood Warden is defeated. The ground rises through tangled roots; ancient tree roots form natural steps. The air shifts — warmer, earthier, rich with mulch and pollen. The oppressive stillness of the clearing gives way to something alive.

---

#### `forest_ancient_grove` — The Ancient Grove
- **size:** 44×34
- **exits:** south → `forest_verdant_descent`, west → `forest_bloom_hollow`, east → `forest_root_tangle`
- **danger:** 3
- **content:** The oldest living part of the Forest — oak trees with canopies so wide they block the sky entirely. The floor is carpeted with flowering moss, exposed root systems, and patches of deep earth. This is the hub of the post-boss region: south leads back down to the Boss Clearing via the Verdant Descent, west reaches the Bloom Hollow and its shrine, east descends into the Root Tangle. Danger 3 Earth-and-Wood duelists wander between the great trunks.

---

#### `forest_bloom_hollow` — Bloom Hollow
- **size:** 38×30
- **exits:** east → `forest_ancient_grove`
- **danger:** 2
- **shrine:** Bloom (Wood + Earth)
- **content:** A sunken hollow west of the Ancient Grove. The ground dips into a natural bowl thick with flowering vines, wild roses, and earthen mounds. The Bloom shrine altar sits at the lowest point — its doors stand open, unsealed long before the Forest was settled, awaiting whoever comes to use it. A shrine guardian defends the hollow; defeating the **Bloom Guardian** grants a **Bloom** (Wood+Earth) ring — because the altar is already open, this fused thumb is a combat reward rather than a seal-key (§9.1). Dead end — the western edge is a sheer root wall.

---

#### `forest_root_tangle` — The Root Tangle
- **size:** 32×24
- **exits:** west → `forest_ancient_grove`, east → `forest_canopy_walk`
- **danger:** 3
- **content:** Chaotic exposed root systems east of the Ancient Grove — root walls as tall as a person force a winding path through the screen. The eastern path climbs toward the Canopy Walk; the western path returns to the Ancient Grove. The old northern backdoor to the Deepwood is gone — the deep forest is a sealed post-boss wing with no shortcut back to the crossroads cluster. Two or three of the toughest Forest-zone duelists roam here.

---

#### `forest_canopy_walk` — Canopy Walk
- **size:** 22×38
- **exits:** west → `forest_root_tangle`, east → `forest_briar_thicket`
- **danger:** 3
- **content:** The terrain rises east of the Root Tangle; ancient root platforms and compressed bark form a natural elevated walkway above the forest floor. Rare high-XP NPCs patrol the walkway. The path continues east into the densest briar growth in the Forest.

---

#### `forest_briar_thicket` — The Briar Thicket
- **size:** 30×22
- **exits:** west → `forest_canopy_walk`
- **danger:** 3
- **content:** The easternmost screen of the Forest biome — a wall of mature briar and thorned undergrowth pressed against the canopy ceiling. The highest NPC density in the Forest. Rewards those who push all the way through with the strongest XP gains before they leave the biome. Dead end.

---

#### `forest_deep_fen` — The Deep Fen
- **size:** 34×28
- **exits:** east → `forest_mossy_fen`, north → `forest_fen_ridge`
- **danger:** 2
- **content:** A boggy extension west of the Mossy Fen. Darker palette, standing water pools, unfamiliar mushroom varieties. Better foraging than the Mossy Fen but stronger NPCs. The northern rise is rocky and exposed above the waterline.

---

#### `forest_fen_ridge` — Fen Ridge
- **size:** 28×22
- **exits:** south → `forest_deep_fen`
- **danger:** 2
- **content:** A rocky ridge above the western fen, exposed to wind blowing in from the open country beyond the Forest's edge. One strong NPC holds the high ground. A forage node sits in a windswept crevice. Dead end — the western face is a sheer drop.

---

#### `forest_rocky_overlook` — Rocky Overlook
- **size:** 28×18
- **exits:** south → `forest_ridge`
- **danger:** 2
- **content:** Elevated rock north of the Ridge. The forest canopy stretches south as far as the eye can see — a rare open view. One seasoned Duelist NPC. Dead end.

---

#### `forest_hidden_alcove` — Hidden Alcove
- **size:** 24×18
- **exits:** *(none — teleport-only via `forest_hidden_anchor`)*
- **anchorage:** `forest_hidden_anchor`
- **danger:** 1
- **content:** A serene, impossibly still clearing accessible only by teleporting after attuning the Ironbark Rune in the Swamp. The Hidden Anchorage sits here. A secret reward — quiet and beautiful, a deliberate contrast to the boss route.

---

#### `forest_volcano_gate` — Volcano Gate
- **size:** 32×20
- **coord:** `{ x: 6, y: 0 }`
- **exits:** west → `forest_thornado_shrine`
- **biome_exit:** east → `VolcanoScene` *(held by the Cinder Sentinel gate warden until defeated)*
- **danger:** 2
- **content:** The Forest's eastern fringe where ancient trees give way to scorched stone. The last trees here are blackened and leafless — their bark stripped by years of radiant heat from the east. Cracked rock threaded with obsidian veins replaces the forest floor. The **Cinder Sentinel** — a Fire/Wind gate warden drawn down from the volcanic highlands — stands in the eastern passage. The air shimmers visibly; this is the player's first encounter with Fire element. Until the Sentinel falls, the east exit is blocked; defeating it drops a food cache and opens the volcanic passage. The Sentinel's Fire/Wind loadout transfers to the winner (§9.1).

---

**§10.15 design-change note — planar Forest grid.** The Forest map was re-laid out onto a coherent integer grid (each screen carries a `{x, y}` `coord`; exits are unit cardinal steps). The Root Tangle→Deepwood backdoor has been removed — the deep forest is now exclusively accessible post-boss. The non-planar 5-cycle (crossroads–ridge–deepwood–boss_clearing–briar_pass) has been resolved: briar_pass is now west of crossroads, and the cluster forms a planar vertical chain. The Thornwood Warden now gates the **north** edge of the Boss Clearing into the deep forest (previously south).

- **`forest_volcano_gate` added at coord `(6, 0)`.** New gate screen east of `forest_thornado_shrine` opening the eastern passage into the volcanic highlands (`VolcanoScene`). The Cinder Sentinel is the first Fire-element NPC the player encounters in the world.

---

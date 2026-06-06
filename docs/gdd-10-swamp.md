## Swamp Region

> Region manifest for the Swamp biome. For world architecture see `gdd-10-regions.md`.

The Swamp is the mid-game spine biome, directly south of the Forest. It introduces Water/Earth/Wood opposition and persistent fog (reduced detection radius throughout). Two gate bosses at the biome's southern and eastern edges open separate entries into the Desert/Canyon region (`DesertScene`).

**Dominant elements:** Water, Earth, Wood. **Counters to bring:** Wind (safe offensive pressure). Fire is unavailable until the Desert — its absence here is intentional.

**Biome visuals:** fog overlay (moderate, applies to all screens including safe ones — only the detection radius is affected, not HUD visibility), desaturated palette, standing water ambient, reduced detection radius (~25% shorter than Forest baseline). Implemented in `SwampScene.biomeVisuals()`.

**Region topology (10 screens):**

```
   [swamp_mud_shrine]✦──E/W──[swamp_bog_crossing]──E/W──[swamp_east_gate]⚔→DesertScene E
                                      │ S/N
   [swamp_sunken_dungeon]⚿──E/W──[swamp_deepmuck]⚓2──E/W──[swamp_peat_hollow]🦇
                                      │ S/N
                               [swamp_tidal_shrine]✦
                                      │ S/N
                               [swamp_mire_town]🏠
                                      │ S/N
                               [swamp_entry]⚓1
                                      │ S/N
                               → Forest south gate
      [swamp_south_gate]⚔→DesertScene S
              │ S/N (south of bog_crossing)
```

Grid convention: `N = +y`. Entry at `(0, 0)`; deeper Swamp is negative y; Desert gates at most-negative y.

---

#### `swamp_entry` — The Mire
- **size:** 35×28
- **coord:** `{ x: 0, y: 0 }`
- **exits:** south → `swamp_mire_town`
- **anchorage:** `swamp_anchor_1` (Mire Anchorage)
- **biome_exit:** north → `ForestScene`
- **danger:** 2
- **content:** Where the Forest floor abruptly softens into sucking mud and standing water. Gnarled trees replace straight trunks; moss hangs in curtains from branches sagging over the path. The air thickens instantly and the fog begins immediately. Two Water/Wood roamers patrol the wide clearing. The Mire Anchorage sits on a patch of relatively firm ground at center. Detection radius is reduced from the Forest baseline. Walking north returns to the Forest through the Swamp Gate.

---

#### `swamp_mire_town` — Mirewatch
- **size:** 40×32
- **coord:** `{ x: 0, y: -1 }`
- **exits:** north → `swamp_entry`, south → `swamp_tidal_shrine`
- **safe:** true
- **content:** A compact settlement on raised wooden platforms above the waterline — planked walkways connect squat buildings perched on heavy bog-oak piles. The wood is dark with age and water-staining. A Water-element merchant and an Earth-element merchant operate here. A Wood-element merchant passes through on an irregular schedule (alternate in-game days). A quest-giver NPC sits at the central fire-ring. Foraging is available in the reed beds at the platform edges.

---

#### `swamp_tidal_shrine` — Tidal Shrine
- **size:** 38×30
- **coord:** `{ x: 0, y: -2 }`
- **exits:** north → `swamp_mire_town`, south → `swamp_deepmuck`
- **danger:** 2
- **shrine:** Tidal (Water + Wood)
- **shrine_key:** The altar doors are sealed. A Tidal ring must be won in combat and inserted to unseal them. The Tidal Guardian — a Water+Wood duelist — must be defeated first.
- **content:** A sump depression south of Mirewatch where the water is deepest and most still. An ancient stone altar rises from a flooded clearing, its base submerged, doors carved with interlocked wave-and-root glyphs. Thick root structures grip the altar from below. The Tidal Guardian patrols the high ground at the clearing's perimeter. The path south descends into deeper bog.

---

#### `swamp_deepmuck` — The Deepmuck
- **size:** 42×34
- **coord:** `{ x: 0, y: -3 }`
- **exits:** north → `swamp_tidal_shrine`, south → `swamp_bog_crossing`, east → `swamp_peat_hollow`, west → `swamp_sunken_dungeon`
- **anchorage:** `swamp_anchor_2` (Deepmuck Anchorage)
- **danger:** 2
- **content:** The deepest navigable bog — waist-high root knees break the muddy water surface; ancient submerged logs make the ground unpredictable underfoot. The Deepmuck Anchorage sits on a broad cypress-root island at center: the last reliable rest point before the southern push toward the Desert gates. Three mid-tier Earth/Wood duelists patrol the perimeter. Foraging is dense here — mushrooms, roots, and bog-flowers clustered on every dry patch. East leads to a cave; west descends into a partly-flooded stone structure.

---

#### `swamp_peat_hollow` — Peat Hollow
- **size:** 28×22
- **coord:** `{ x: 1, y: -3 }`
- **exits:** west → `swamp_deepmuck`
- **danger:** 2
- **content:** A dark lateral cave cut into the peat bank east of the Deepmuck. The ceiling is low; the floor is thick wet peat. **Reduced detection radius** — tight dim passages mean enemies appear at very close range. Shadow rings drop here: the only dark underground zone in the Swamp. Water seeps constantly through the walls. A forage cache of fungal spores sits near the back wall. Dead end.

---

#### `swamp_sunken_dungeon` — The Sunken Ruin
- **size:** 36×28
- **coord:** `{ x: -1, y: -3 }`
- **exits:** east → `swamp_deepmuck`
- **danger:** 3
- **content:** A partly-flooded stone structure — pre-Anchorage construction, purpose unknown. The upper level is intact; the lower level is submerged. The dungeon sub-boss — a Resilient Earth+Water duelist — holds the deepest chamber. Defeating it yields a **Reliquary Shard** (expands Reliquary by 10 slots, §4.1.1) and a significant XP cache. The stone-carving style matches no local faction. Dead end.

---

#### `swamp_bog_crossing` — The Bog Crossing
- **size:** 34×26
- **coord:** `{ x: 0, y: -4 }`
- **exits:** north → `swamp_deepmuck`, south → `swamp_south_gate`, east → `swamp_east_gate`, west → `swamp_mud_shrine`
- **danger:** 3
- **content:** The worst stretch of the Swamp — open bog where almost no firm ground exists. Stepping-stone logs and submerged rocks form the only path; the fog is densest here, reducing detection radius to a minimum. Danger 3 duelists patrol in pairs. This four-way junction is the last decision point before the Desert exits: south leads to the desert approach gate, east leads to the canyon-mouth gate, west follows a causeway to the Mud Shrine.

---

#### `swamp_mud_shrine` — Mud Shrine
- **size:** 34×26
- **coord:** `{ x: -1, y: -4 }`
- **exits:** east → `swamp_bog_crossing`
- **danger:** 2
- **shrine:** Mud (Water + Earth)
- **shrine_key:** The altar doors are sealed. A Mud ring must be won in combat and presented to the altar. The Mud Guardian — a Water+Earth duelist — must be defeated first.
- **content:** A wide mudflat west of the Bog Crossing — the most open screen in the Swamp, because nothing grows in the chemically hostile mud. The altar is half-sunk into the ground, doors at a slight inward angle, carving filled with dried clay. The Mud Guardian is a slow, Defensive-personality NPC who uses the open sightlines to detect the player early. Dead end.

---

#### `swamp_south_gate` — Southern Bog Gate
- **size:** 28×20
- **coord:** `{ x: 0, y: -5 }`
- **exits:** north → `swamp_bog_crossing`
- **danger:** 2
- **biome_exit:** south → `DesertScene` *(held by the Mire Asp boss until defeated)*
- **content:** The southern fringe — the bog shallows here and becomes sandy mud, a preview of the arid terrain ahead. The **Mire Asp** — an Earth+Water gate boss — coils in the south passage. It is among the first enemies in the game to use Earth offensively. Defeating it drops a food cache and opens the southern passage into the Desert flatlands. The Asp's staked ring transfers to the winner (§9.1).

---

#### `swamp_east_gate` — Eastern Canyon Gate
- **size:** 28×20
- **coord:** `{ x: 1, y: -4 }`
- **exits:** west → `swamp_bog_crossing`
- **danger:** 2
- **biome_exit:** east → `DesertScene` *(held by the Bogwood Striker boss until defeated)*
- **content:** The eastern fringe — vegetation abruptly shifts from water-plants to scrub brush; the first rocky outcrops appear. The **Bogwood Striker** — a Wood+Water gate boss — guards the eastern passage. Defeating it drops a food cache and opens the canyon-mouth entry into the Desert. The canyon visible through the gate is dry, pale, and dramatically different from everything behind the player.

---

### Swamp Region Design Notes

- Fog (`biomeVisuals()` detection-radius reduction) applies to all screens including safe ones — only detection radius is affected, not player HUD visibility.
- Shadow rings drop only in `swamp_peat_hollow`.
- Both shrines (Tidal, Mud) are sealed-door type.
- `swamp_anchor_2` (Deepmuck) already exists in `shared/waystones.ts`.
- The Sunken Ruin sub-boss is a Dungeon encounter — reward-only; no gate opens.
- Gate boss convention: the warden physically blocks the biome exit in the same screen (pattern matches `forest_snow_gate`).

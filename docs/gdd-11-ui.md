## 11. UI and Information Display

### 11.1 Overworld Detection HUD
When within detection range of an enemy, both parties see:
- Opponent's **element types** in loadout (base element view; fused rings show as both component elements)
- Opponent's **hearts**
- Opponent's **aggregate uses per base element type**
- Opponent's **Thumb ring element** — the staked ring's element reveals which passive it carries (§9.3)

### 11.2 Battle HUD
During a duel, both players see for each opponent:
- **Hearts remaining**
- **Element types** in battle hand (same fused ring display rule as overworld)
- **Aggregate uses per base element type** — updated in real time

**Fused ring display rule:** A Mud ring (Water + Earth) adds its uses to both the Water and Earth counters. This creates deliberate ambiguity — the opponent knows elemental exposure but cannot cleanly reverse-engineer ring configuration.

**Example:** Player has a Mud ring (5 uses) and a separate Water ring (3 uses).
- Water shows: 8 uses
- Earth shows: 5 uses
The opponent knows Water and Earth are present but must infer whether that's one Mud ring, two separate rings, or both.

### 11.3 Ring Reveal
The attack is **telegraphed before the defender commits**: when the attacker throws, the attacking ring's base-element color(s) travel across the screen toward the defender (fused rings show all component colors). The defender therefore sees the attacker's element identity — revealed by the orb color crossing the screen — *before* choosing a ring. The exact ring identity — including whether it is a fused ring and its specific tier — becomes fully visible to both players at the moment the block resolves.

### 11.4 Extinguished Ring Visibility
When a ring is extinguished during battle the use count for that element type drops to 0 and the element icon becomes inactive in the HUD. Both players can see exactly which element types are exhausted.

### 11.5 Status Effect Display
Active status effects are shown in the battle HUD alongside the affected player's hearts. The status name, icon, and current gauge value are visible to both players. Statuses persist as long as the gauge meets or exceeds the threshold — they have no fixed turn duration (see §7.1 for gauge mechanics). The Shadow gauge additionally shows how many HUD elements are currently hidden.

### 11.6 Overworld Resource HUD

While in any biome (Forest, Swamp, Snow, etc.) the player always sees a compact stat bar pinned to the top-right corner of the screen:

```
Day N · Gold N · Food N · Spirit N/N · ♥ N/N · XP N · Total: N · Avg: N
```

Each segment reads directly from the server (`GET /api/me`) and is never computed client-side:

- **Day** — current in-game day.
- **Gold** — current gold supply.
- **Food** — food units remaining.
- **Spirit N/N** — spirit gauge (current / max).
- **♥ N/N** — equipped heart ring HP (current uses / max uses); shows `♥ 0/0` when the heart slot is empty.
- **XP N** — aggregate XP across all carried rings (the `aggregate_xp` field).
- **Total: N** — total ring XP across the full collection (`total_xp`).
- **Avg: N** — average XP earned per battle hand (`battle_hand_avg_xp`), rounded to the nearest integer.

The purpose of this bar is **at-a-glance resource awareness without opening a menu** — the player can see their HP, food, spirit, and ring growth trajectory at a single glance while exploring. The HP readout also appears directly in the Manage Battle Rings overlay for readability at close range, so the player does not need to close the modal to check their HP; the HUD serves the broader field-navigation context.

### 11.7 Passive Trigger Visual (Phase 6+)
When a Thumb passive triggers mid-battle (Wellspring block refund, Deep Roots heart guard, Tailwind attack refund), a brief elemental pulse effect plays on the Thumb ring — color matching the element. Both players see this, signaling that the passive fired and the Thumb ring lost a use. *Visual not yet implemented; flagged for Phase 6.*

---

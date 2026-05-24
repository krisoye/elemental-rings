## 11. UI and Information Display

### 11.1 Overworld Detection HUD
When within detection range of an enemy, both parties see:
- Opponent's **element types** in loadout (base element view; fused rings show as both component elements)
- Opponent's **hearts**
- Opponent's **aggregate uses per base element type**
- Opponent's **staked ring jewelry position** (dominant hand bracelet / off hand bracelet / necklace)

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
Active status effects are shown in the battle HUD alongside the affected player's hearts. The status name, icon, and remaining duration (in turns) are visible to both players.

### 11.6 Necklace Pulse Visual
When the Recharge Pulse triggers (necklace stake position, player is losing), a visible elemental pulse effect plays — color matching the staked ring's element. Both players see this. It signals that a ring was just recharged, changing the opponent's calculus going forward.

---

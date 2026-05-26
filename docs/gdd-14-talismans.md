# §14 — Talisman System

Talismans are utility items distinct from rings. They occupy separate equipment slots, have no combat function, and do not interact with the spirit gauge or ring recharge economy. They exist to solve overworld logistics problems: rest before a boss, navigate the biome, access locked areas.

---

## 14.1 Design Principles

| Principle | Rationale |
|---|---|
| **Separate from rings** | Rings define combat identity. Utility items should not compete for ring slots or carry cap. |
| **Limited uses** | Scarcity forces meaningful decisions. "Should I use this here or save it?" |
| **Geographic constraint, not gold** | Abuse is prevented by where an item can be used (safe spots, waystones), not by cost. |
| **Refills at rest, not by purchase** | Recharging at the Sanctum ties talisman use to the expedition loop rather than gold spending. |

---

## 14.2 Equipment Slots

| Slot | Items | Limit |
|---|---|---|
| **Necklace** | One talisman (e.g. Sanctum Stone) | 1 equipped |
| **Bracelet** | Charm slots — future expansion | TBD |

Talisman slots are independent of the ring carry cap. A player with 10 carried rings can still equip a necklace talisman.

---

## 14.3 The Sanctum Stone

### What it does
When activated at a **safe spot** in the overworld, the Sanctum Stone summons the player's Sanctum to that location for the duration of their rest. The player can then sleep (restoring spirit) and recharge rings before moving on.

The Sanctum is not physically transported — the Stone opens a temporary connection between the safe spot and the Sanctum. Once the player leaves the spot, the connection closes.

### Physical form
A polished stone on a chain, worn as a necklace. It glows faintly when near a safe spot.

### Stats
| Property | Value |
|---|---|
| Slot | Necklace |
| Charges | 3 |
| Where usable | Designated safe spots only (see §10) |
| Recharge | Automatically when player sleeps at the Sanctum |
| Gold cost (from merchant) | TBD |

### Charge economy
- Charges are pre-loaded before each expedition by sleeping at home.
- Charges do **not** refill in the field — if you run out, you cannot rest at a safe spot.
- Sleeping at the Sanctum (25 food) restores all charges at no extra cost.

### Abuse prevention
- Only activatable at designated safe spots. The player cannot summon the Sanctum mid-battle, in a dungeon corridor, or anywhere arbitrary.
- 3 charges per expedition creates a hard ceiling on how many times rest can be taken per outing.
- Safe spots are fixed world objects placed intentionally by level design (often near boss approaches but not adjacent to them).

### Acquisition
- Purchased from merchants in towns.
- Occasionally found as a exploration reward in the overworld.
- Starting players do **not** begin with a Sanctum Stone — it is a mid-game upgrade.

---

## 14.4 Future Talisman Ideas

These are placeholders — not yet designed or implemented.

| Talisman | Slot | Concept |
|---|---|---|
| **Waystone Compass** | Necklace | Points toward the nearest undiscovered waystone; pulses faster when close |
| **Spirit Lantern** | Necklace | Reveals hidden safe spots on the overworld map within a radius |
| **Warding Charm** | Bracelet | Reduces detection radius — fewer random NPC encounters |
| **Vitality Bead** | Bracelet | Adds 1 starting heart for the next duel (consumed on use) |
| **Forager's Pouch** | Bracelet | Doubles food gathered from foraging spots |

---

## 14.5 Open Questions

- What is the merchant gold price for a Sanctum Stone?
- Is the Sanctum Stone available from the start or gated behind a quest / spirit threshold?
- Can a player carry multiple Sanctum Stones (for more charges), or is it strictly one necklace slot?
- Bracelet slot design: number of charm slots, stacking rules, where charms are acquired.

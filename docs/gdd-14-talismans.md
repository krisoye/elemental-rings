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
When activated at an **Anchorage** in the overworld, the Sanctum Stone **permanently transports** the player's Sanctum to that Anchorage. The Sanctum **physically moves** to that location and **remains there** — the player can then sleep (restoring spirit) and recharge rings, and the Sanctum stays anchored at that spot indefinitely.

The Sanctum stays at its new Anchorage until the player either activates the Stone again at a different Anchorage (relocating it once more) or teleports away from within the Sanctum via the meditation circle. There is no temporary link that closes when the player walks off — the relocation is durable and persists across the expedition.

### Physical form
A polished stone on a chain, worn as a necklace. It glows faintly when near an Anchorage.

### Stats
| Property | Value |
|---|---|
| Slot | Necklace |
| Charges | 3 |
| Where usable | Anchorages only (see §10) |
| Recharge | Automatically when player sleeps at the Sanctum |
| Gold cost (from merchant) | TBD |

### Charge economy
- Charges are pre-loaded before each expedition by sleeping at home.
- Charges do **not** refill in the field — if you run out, you cannot relocate the Sanctum to an Anchorage.
- Sleeping at the Sanctum (25 food) restores all charges at no extra cost.

### Abuse prevention
- Only activatable at Anchorages. The player cannot relocate the Sanctum mid-battle, in a dungeon corridor, or anywhere arbitrary.
- 3 charges per expedition creates a hard ceiling on how many times the Sanctum can be relocated per outing.
- Anchorages are fixed world objects placed intentionally by level design (often near boss approaches but not adjacent to them).

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

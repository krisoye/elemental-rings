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
| **Necklace** | One optional talisman | 1 equipped |
| **Bracelet** | Charm slots — future expansion | TBD |

Talisman slots are independent of the ring carry cap. A player with 10 carried rings can still equip a necklace talisman.

---

## 14.3 Sanctum Summoning (Natural Ability — Not a Talisman)

Sanctum summoning is a **natural spiritual ability**, not a talisman or equippable item. The protagonist can summon the Sanctum to any discovered Anchorage at any time by activating the campfire there. No item, no necklace slot, no acquisition step required.

See **§12.5c** for the full mechanic: spirit cost (equal to the `spiritCost` of the Anchorage where the Sanctum currently sits), the campfire rest → summon recovery sequence, and unlock timing (available from the first discovered Anchorage).

**Why summoning is not a talisman:** Sanctum access is a core expedition mechanic — players would never set out without the Stone if it existed as an item. Tying that to a purchasable necklace slot adds friction without strategic depth and forces the necklace into a mandatory role. As a natural ability, the necklace slot opens up for genuinely optional utility choices.

**The Sanctum's value is what it contains:** reliquary access (ring collection management, aggregate XP) and the meditation circle (long-range teleportation). Neither ring recharging nor sleep requires the Sanctum — both are available in the field.

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

- Bracelet slot design: number of charm slots, stacking rules, where charms are acquired.
- Necklace talisman availability: where and when do the Waystone Compass, Spirit Lantern, etc. become obtainable? Merchant purchase, exploration reward, or quest?
- Should necklace talismans have limited charges that refill on Sanctum sleep (consistent with the design principle in §14.1), or are they passive always-on effects?

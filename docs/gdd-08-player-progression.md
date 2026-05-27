## 8. Player Progression

### 8.1 The Protagonist Has No Independent XP

The protagonist does not accumulate personal experience points. Their power, their spiritual capacity, and their access to the world are all **derived entirely from their ring collection**.

**Player XP = aggregate ring XP** — the sum of XP across every ring the protagonist currently owns (carried and stored in the Sanctum).

- Rings earn XP through use in battle
- Winning a staked ring from an opponent permanently increases aggregate XP
- Losing a ring through staking permanently reduces aggregate XP
- The protagonist's power rises and falls with their collection — there is no floor, no permanent baseline

This is the central design tension: rings are everything, and rings can be lost.

### 8.2 Spirit Gauge Growth

The **spirit gauge maximum** — the protagonist's spiritual capacity — is a direct function of aggregate ring XP (see §12 for the full mechanics).

As aggregate ring XP grows:
- Spirit gauge maximum increases
- Carry capacity increases (more rings can be brought on expedition)
- More Anchorages become affordable to teleport to (spirit_max grows → longer-range travel on a full gauge)
- More ring uses can be restored per sleep cycle

There is no XP milestone UI or level-up screen. Growth is continuous and felt through increased capability — carrying more rings, ranging further, reaching new areas.

### 8.3 World Access Gating

**Waystones** (§10.7) are revelation objects — attuning them reveals distant Anchorages and regions. **Anchorages** (§10.7a) are the actual teleportation destinations, and each carries a `spiritCost` that must be met at the moment of travel (§10.8, §12.5). Higher `spirit_max` (from aggregate XP) makes distant Anchorages affordable to reach.

- Losing significant XP through staking reduces `spirit_max` — long-distance Anchorages may become temporarily unreachable until spirit is rebuilt
- This creates genuine long-term stakes: a catastrophic losing streak is recoverable, but costly
- Players are naturally incentivized to build XP breadth (many rings) rather than depth (few high-XP rings) to protect against catastrophic aggregate loss

### 8.4 Full Inventory (Sanctum Storage)

All rings the protagonist has ever acquired are stored in the Sanctum when not carried. There is no hard cap on total ring ownership — the Sanctum holds everything.

The meaningful limit is **carry capacity** (how many rings are brought on expedition), not total ownership. Carry cap starts at 10 and expands through:
1. Spirit gauge growth (aggregate XP → higher spirit max → higher carry cap baseline)
2. Garments from merchants (expand carry cap beyond the spirit-derived baseline)

A veteran protagonist with a large, diverse ring collection has a wide carry cap, high spirit max, high daily recharge capacity, and access to most of the world. This is the power fantasy the game builds toward — earned through hundreds of duels, not a single big win.

---

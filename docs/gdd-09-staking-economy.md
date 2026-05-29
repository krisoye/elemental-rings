## 9. Staking Economy

### 9.1 Core Rules
- Every duel requires both players to **stake a ring** before the duel begins
- The staked ring is placed in the **Thumb slot** of the loadout — it is one of the five named slots and is held in escrow for the duration of the duel
- The Thumb ring grants a **passive ability** during battle (see §9.3) but is **never pressed in combat**
- **Loser forfeits their staked ring and all XP associated with it**
- **Winner receives the staked ring and its full XP**

> **Design note (v4.2):** Earlier drafts allowed the staked ring to be any ring outside the battle loadout. The current design places the stake in the Thumb slot, making it part of the loadout and always visible to both players.

### 9.2 Changing the Staked Ring
- The staked ring can be changed **freely at any time in the overworld**
- Once the player enters **detection range of an enemy**, the staked ring locks in for that encounter
- The lock releases if the player flees or moves out of detection range without dueling
- This prevents last-second stake-swapping once an opponent has already evaluated the offer

### 9.3 Elemental Passives (Thumb Slot)

The staked ring's **element** determines which passive it provides during battle. The Thumb ring is always visible to both players from detection range, making its element a strategic signal before the duel begins.

Each passive fires at specific moments during battle and **costs the Thumb ring 1 use** when it triggers. A Thumb ring extinguished to 0 uses loses its passive for the rest of the duel. Fused Thumb rings provide no passive — only base-element Thumb rings activate.

---

**🔴 Fire — Kindling (Offensive Aura)**
- **Trigger:** Duel start
- **Effect:** All Fire rings in the battle hand (A1/A2/D1/D2) gain +1 current use
- **Cost:** Thumb ring loses 1 use at duel start
- **Signal:** Aggressive — doubling down on one element to overwhelm

---

**🔵 Water — Wellspring (Defensive Refund)**
- **Trigger:** Successful block (player defends an incoming attack)
- **Effect:** The defending ring's spent use is refunded (capped at max uses); Thumb ring absorbs the cost instead
- **Cost:** Thumb ring loses 1 use per block triggered
- **Signal:** Patient — sustains defense rings through prolonged exchanges

---

**💚 Wood — Deep Roots (Heart Guard)**
- **Trigger:** Player would lose a heart
- **Effect:** The heart loss is redirected — Thumb ring loses 1 use instead of the player losing a heart
- **Cost:** Thumb ring loses 1 use per heart saved
- **Signal:** Durable — hard to finish, but the Thumb ring depletes visibly

---

**🟢 Wind — Tailwind (Momentum)**
- **Trigger:** Player throws an attack
- **Effect:** The thrown attack ring's use is refunded; Thumb ring absorbs the cost instead
- **Cost:** Thumb ring loses 1 use per attack thrown
- **Signal:** Relentless — attack rings stay fresh longer, creating sustained pressure

---

**🟤 Earth — Bulwark (Defensive Aura)**
- **Trigger:** Duel start
- **Effect:** All Earth rings in the battle hand (A1/A2/D1/D2) gain +1 current use; defense slots (D1/D2) are buffed first
- **Cost:** Thumb ring loses 1 use at duel start
- **Signal:** Fortified — stacking extra defense coverage to grind through exchanges

---

> **Future design (Phase 7+):** Fused Thumb rings providing blended passives, and additional jewelry body positions with their own passive archetypes, are flagged for a later design pass once the base elemental passives are tuned.

### 9.4 Staked Ring XP
- The staked ring earns passive XP through its use cost each time its passive triggers
- A ring used as a permanent stake slowly levels up through its passive role
- Higher XP stakes provide more passive durability — a maxed Tier 2 staked ring has more uses than a Tier 1, so its passive triggers more times before the Thumb extinguishes. The passive effect per trigger is the same; the advantage is longevity and the number of times it fires during a duel
- This creates a reason to stake high-value rings even at personal risk

### 9.5 Gold Rewards

Winning a duel pays **50 gold** in addition to the opponent's staked ring. Losing a duel carries no direct gold penalty — only the staked ring is forfeited. Forfeiting (§6.3 Option C) costs the staked ring **plus 25 gold**.

Gold is spent **only at merchants** — not for sleeping or ring recharging.

| Camp resource | Cost |
|---|---|
| Sleep (restores spirit gauge) | 25 food units |
| Ring recharge | 1 spirit unit per use restored |
| Buy food (emergency) | 2× forage value (gold at merchant) |

The economic loop: dueling earns 50g per win; gold buys merchant goods (garments, rings); food enables sleep; spirit enables recharging. A player who can't forage food can't sleep, can't restore spirit, and can't recharge rings — forcing them back toward a food source.

> *Tunable constants: `GOLD_PER_WIN`, `GOLD_FORFEIT_PENALTY`, `FOOD_PER_SLEEP`, `SPIRIT_PER_RING_USE`, `MERCHANT_FOOD_MARKUP` in `server/src/game/constants.ts`.*

### 9.6 Natural Self-Regulation
No artificial matchmaking is needed. The economy self-regulates:
- Experienced players won't challenge weak players — winning a low-XP ring wastes a valuable inventory slot
- Weak players won't challenge strong players — staking a good ring is too risky
- Players naturally gravitate toward dueling others in a similar XP band
- The Thumb ring's element is always visible from detection range — its element signals the opponent's passive before the duel begins

---

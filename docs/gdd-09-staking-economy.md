## 9. Staking Economy

### 9.1 Core Rules
- Every duel requires both players to **stake a ring** before the duel begins
- The staked ring is placed in the **Thumb slot** of the loadout — it is one of the five named slots and is held in escrow for the duration of the duel
- The Thumb ring grants a **passive ability** during battle (see §9.3) but is **never pressed in combat**
- **Loser forfeits their staked ring and all XP associated with it**
- **Winner receives the staked ring and its full XP**
- **Bosses and shrine guardians are no exception** — their stake is their thematic fused thumb, and defeating them transfers that fusion ring to the winner exactly like any duel. The only consequence-free duel is a **training / practice rematch** (re-fighting an already-beaten boss for practice): no stake changes hands.
- **The thumb slot must be assigned to enter a duel:** A player cannot initiate a duel unless they have a ring staked to the thumb slot. A drained stake ring (zero uses remaining) still satisfies this requirement — the ring is present and at risk, though its passive will not fire.

> **Design note (v4.2):** Earlier drafts allowed the staked ring to be any ring outside the battle loadout. The current design places the stake in the Thumb slot, making it part of the loadout and always visible to both players.

### 9.2 Changing the Staked Ring
- The staked ring can be changed **freely at any time in the overworld**
- Once the player enters **detection range of an enemy**, the staked ring locks in for that encounter
- The lock releases if the player flees or moves out of detection range without dueling
- This prevents last-second stake-swapping once an opponent has already evaluated the offer

### 9.3 Elemental Passives (Thumb Slot)

The staked ring's **element** determines which passive it provides during battle. The Thumb ring is always visible to both players from detection range, making its element a strategic signal before the duel begins.

Each passive fires at a specific moment during battle and **spends Thumb ring uses** when it triggers. A Thumb ring extinguished to 0 uses loses its passive for the rest of the duel. Fused Thumb rings provide no passive — only base-element Thumb rings activate.

The three triangle elements (Fire/Water/Wood) share one **all-in setup** archetype that fires once at duel start; Wind and Earth provide reactive passives that fire repeatedly during combat.

---

**🔴 Fire / 🔵 Water / 💚 Wood — All-In Setup (Element Distributor)**
- **Trigger:** Duel start (once)
- **Effect:** The Thumb spends **all** of its current uses, distributing +1 current use at a time to the battle-hand rings (A1/A2/D1/D2) whose **base element matches the Thumb element**. Recipients are filled round-robin from **highest-XP to lowest-XP** (tiebreak: slot order A1→A2→D1→D2) until the Thumb reaches 0. Each grant raises the ring's max uses to match if needed.
- **Guard:** If no matching base-element ring is in the hand, the passive does **not** fire and the Thumb keeps all of its uses.
- **Cost:** The Thumb empties to 0 uses at duel start — it is extinguished and passive for the rest of the duel.
- **Signal:** Front-loaded — a burst of staying power poured into one element's rings before the first exchange. A high-XP Thumb pours more uses; a single matching ring receives the whole pour.
- *Worked examples (Wood Thumb):* 4 uses with Wood A1(800)/A2(600)/D1(500)/D2(500) → +1 to each. 5 uses, same rings → A1 gets +2 (second round goes to the highest-XP ring first), the rest +1. A Fire Thumb with 5 uses and only Fire A1 in hand → A1 +5.

---

**🟢 Wind — Tailwind (Momentum)**
- **Trigger:** Player throws an attack
- **Effect:** The thrown attack ring's use is refunded; Thumb ring absorbs the cost instead
- **Cost:** Thumb ring loses 1 use per attack thrown
- **Signal:** Relentless — attack rings stay fresh longer, creating sustained pressure

---

**🟤 Earth — Precision Parry (Refund on Perfect Timing)**
- **Trigger:** The defender catches an incoming attack within the **PARRY** timing window — **regardless of element matchup** (the trigger is timing alone, not Strong/Neutral/Weak)
- **Effect:** The defending ring's just-spent use is refunded (capped at its max uses); the Earth Thumb pays 1 use instead
- **Cost:** Thumb ring loses 1 use per perfectly-timed parry
- **Signal:** Disciplined — rewards tight defensive timing by keeping the defending ring fresh through prolonged exchanges

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

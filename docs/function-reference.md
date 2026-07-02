# Function Reference — Elemental Rings

Engineering reference for the three most-reused API surfaces: pure game logic modules (`server/src/game/`), shared type definitions (`shared/types.ts`), and the key client UI helper (`client/src/objects/ui/DomLabel.ts`).

This document records the implementation as shipped. For game rules and design intent see the GDD files under `docs/`.

---

## 1. `server/src/game/` — Pure Logic Modules

These modules carry no Colyseus, Express, or SQLite imports. They are safe to unit-test in isolation with plain objects.

> **CLAUDE.md note:** "Canonical values are in `server/src/game/constants.ts`."

---

### `constants.ts`

Re-exports the shared timing constants from `shared/timing.ts` (single source of truth), then adds server-only values. Import from `server/src/game/constants` — do not import timing constants directly from `shared/timing` in server code.

**Timing (re-exported from `shared/timing.ts`)**

| Constant | Type | Value | Description |
|----------|------|-------|-------------|
| `TELEGRAPH_MS` | `number` | 900 (prod) / 150 (E2E_FAST) | Dead-time wind-up before an attack's impact lands. The server shortens this under `E2E_FAST=1`; the catch bands are unchanged. |
| `BLOCK_WINDOW_MS` | `number` | 200 | Width of the catch band after impact. |
| `MIN_COMBO_GAP_MS` | `number` | 200 | Floor of the server-clamped double-attack orb gap. |
| `MAX_COMBO_GAP_MS` | `number` | 600 | Ceiling of the server-clamped double-attack orb gap. |
| `STATUS_THRESHOLD` | `number` | 4 | Triangle gauge value at/above which a status activates. |

**Battle timing (server-only)**

| Constant | Type | Description |
|----------|------|-------------|
| `PARRY_WINDOW_MS` | `number` | 175 ms — the inner catch band; presses within this offset of impact classify as PARRY. |
| `DEFEND_WINDOW_MS` | `number` | `TELEGRAPH_MS + BLOCK_WINDOW_MS` — total window from attack commit to end of catch band. |

**Combat economy**

| Constant | Type | Description |
|----------|------|-------------|
| `STARTING_HEARTS` | `number` | Hearts each player starts a duel with. |
| `STARTING_USES` | `number` | Default uses a ring starts a duel with. |
| `GAUGE_SOFT_CAP` | `number` | 8 — broadcast cap on triangle gauge values (keeps HUD readable). |
| `SHADOW_GAUGE_CAP` | `number` | 5 — hard cap on the shadow gauge; increments clamp here. |
| `GOLD_PER_WIN` | `number` | Gold awarded to the winner of a duel. |
| `STARTER_GOLD` | `number` | Initial gold balance for a new player. |
| `GOLD_FORFEIT_PENALTY` | `number` | Flat gold deducted on forfeit (floored at 0). |

**Ring XP (outcome-based)**

| Constant | Type | Description |
|----------|------|-------------|
| `XP_ATK_HIT` | `number` | 5 — attack ring XP when the attack lands. |
| `XP_ATK_BLOCK` | `number` | 2 — attack ring XP when blocked. |
| `XP_ATK_COUNTER` | `number` | 1 — attack ring XP when countered/parried. |
| `XP_DEF_COUNTER` | `number` | 5 — defense ring XP on a successful parry/counter. |
| `XP_DEF_BLOCK` | `number` | 2 — defense ring XP on a clean block. |
| `XP_DEF_WEAK` | `number` | 1 — defense ring XP when the defense failed (heart lost). |

**Spirit / food economy**

| Constant | Type | Description |
|----------|------|-------------|
| `FOOD_PER_SLEEP` | `number` | Food consumed when sleeping (restores spirit fully). |
| `SPIRIT_PER_RING_USE` | `number` | Spirit units spent per ring use restored at recharge. |
| `MERCHANT_FOOD_MARKUP` | `number` | Merchant sell price multiplier over base forage value. |
| `FORAGE_YIELD` | `number` | Food units gained per forage node harvest. |
| `FORAGE_RESPAWN_DAYS` | `number` | Game-days before a forage node is harvestable again. |
| `FOOD_SELL_PRICE` | `number` | 1 GP — merchant buys food from the player at this price. |
| `FOOD_BUY_PRICE` | `number` | 2 GP — merchant sells food to the player at this price. |

**Merchant ring prices**

| Constant | Type | Description |
|----------|------|-------------|
| `MERCHANT_RING_BUY_PRICE_T1` | `number` | 30 GP — cost to buy a Tier 1 triangle ring. |
| `MERCHANT_RING_BUY_PRICE_NEUTRAL` | `number` | 25 GP — cost to buy a Tier 1 Wind/Earth ring. |
| `MERCHANT_RING_SELL_PRICE_T1` | `number` | 10 GP — player proceeds when selling a Tier 1 triangle ring. |
| `MERCHANT_RING_SELL_PRICE_NEUTRAL` | `number` | 8 GP — player proceeds when selling a Tier 1 Wind/Earth ring. |

**Carry / Reliquary caps**

| Constant | Type | Description |
|----------|------|-------------|
| `CORE_SLOTS` | `number` | 5 — named battle-hand slots (thumb + a1 + a2 + d1 + d2). |
| `SPARE_SLOTS` | `number` | 9 — fixed spare-pouch size. |
| `RELIQUARY_BASE_CAP` | `number` | 9 — Reliquary slot capacity (Shard expansion dormant). |
| `RELIQUARY_SHARD_INCREMENT` | `number` | Increment size for future Shard-based expansion (plumbing preserved, not reachable in-game). |

**Overworld / boss**

| Constant | Type | Description |
|----------|------|-------------|
| `MINI_BOSS_FOOD_DROP` | `number` | 20 — one-time food drop from a permanent mini-boss on first defeat. |
| `BOSS_FOOD_DROP` | `number` | 50 — one-time food drop from a permanent major boss. |
| `AMBUSH_SPIRIT_COST` | `number` | Spirit spent when launching a double-click ambush (first-strike). |

**Boss modifier table**

```ts
export interface BossModifier {
  bonusHearts: number;       // added to STARTING_HEARTS for the AI seat
  sigmaMult: number;         // multiplies the profile's timing sigma (lower = sharper)
  noBlockMult: number;       // multiplies the profile's no-block probability (lower = blocks more)
  bonusUses: number;         // added to every combat ring's maxUses
  thinkMult: number;         // multiplies attacker think-delay (<1 = faster)
  enrageThreshold: number;   // hearts at/below which enrage fires; 0 = disabled
  enrageSigmaMult: number;   // multiplies the (already modified) sigma while enraged
  enrageThinkMult: number;   // multiplies the (already modified) think-delay while enraged
  enrageAggressive: boolean; // when true, enraged boss attacks like AGGRESSIVE personality
  gaugeFillMult: number;     // multiplier on the defender's per-orb gauge credit from a boss hit
  spiritMult: number;        // NPC spirit pool = floor(playerSpiritMax × spiritMult)
}

export const BOSS_MODIFIERS: Record<BossTier, BossModifier>
// Keys: 'major' | 'gate' | 'sub'
```

**Region difficulty floor (#492 — replaces #464 BIOME_BOSS_SPIRIT_BONUS)**

Parameterised spirit floor for all NPC classes (roamers and bosses) across the full biome progression. `BIOME_BOSS_SPIRIT_BONUS` is removed; `spiritFloor`/`floorTier` are the new canonical interface.

```ts
export type NpcClass = 'roamer' | BossTier;  // 'roamer' | 'gate' | 'sub' | 'major'

export const CLASS_OFFSET: Record<NpcClass, number>
// roamer: 0 (LOCKED — forest roamers remain floor-free)
// gate:  15, sub: 25, major: 40

export const BIOME_ORDER: string[] = ['forest', 'snow', 'swamp', 'desert', 'volcano'];
export const REGION_STEP = 25;

export function spiritFloor(biome: string, npcClass: NpcClass): number
// Returns CLASS_OFFSET[npcClass] + REGION_STEP × BIOME_ORDER.indexOf(biome).
// Returns 0 for an unknown biome (safe default).

export function floorTier(biome: string): number
// Returns BIOME_ORDER.indexOf(biome) + 1 (1-indexed tier). Returns 1 for unknown biome.

export const SKILL_BAND: Record<NpcClass, { lo: number; hi: number }>
// roamer: [0.20, 0.70], gate: [0.55, 0.80], sub: [0.70, 0.90], major: [0.90, 1.00]
```

`spiritFloor` is used in `computeNpcSpirit` (see `ai/AILoadout.ts`). Roamers use `max(spiritFloor, personalityBase)`; bosses use additive `personalityBase + spiritFloor`. Reproduced values from the old table: forest/gate=15, forest/sub=25, forest/major=40, snow/gate=40, snow/sub=50, snow/major=65, swamp/gate=65, swamp/sub=75, swamp/major=90, desert/gate=90, desert/sub=100, desert/major=115; plus volcano tier: gate=115, sub=125, major=140.

---

### `shared/chargeConstants.ts`

Charge attack constants shared between client and server (#491, GDD §6.3). The server re-exports these from `server/src/game/constants.ts`; the client imports directly from this file so it never reaches into the server source tree.

| Constant | Type | Value | Description |
|----------|------|-------|-------------|
| `CHARGE_THRESHOLD_MS` | `number` | 450 | Hold below this duration is classified as an instant tap (no arc swing, always horizontal, always hits). Used as the deferred-threshold timer duration on the client. Raised from 150 ms (#506) to absorb the guaranteed-miss dead zone below the first hit-cone entry (~467 ms). |
| `MAX_CHARGE_MS` | `number` | 3000 | Maximum hold duration tracked by the server (clamped). Beyond this the sweep speed/sharpness stay at max. |
| `CHARGE_TELEGRAPH_MIN_MS_PROD` | `number` | 500 | Production telegraph duration at maximum sharpness. Server re-exports as `CHARGE_TELEGRAPH_MIN_MS`; E2E_FAST shortens this to 80 ms server-side only. |
| `SWEEP_RANGE_DEG` | `number` | 45 | Half-sweep angle: orb swings from −45° to +45° (90° total arc). |
| `HIT_CONE_DEG` | `number` | 10 | Half-width of the sweet-spot hit cone in degrees. Release within ±10° of 0° → hit. |
| `BASE_SWEEP_MS` | `number` | 1200 | Duration of the first full sweep (−45° → +45°) in ms. |
| `SWEEP_SPEEDUP` | `number` | 0.75 | Per-reversal duration multiplier: each sweep is 75% the duration of the previous. |
| `MAX_SWEEPS` | `number` | 3 | Sweeps until max speed; beyond this the sweep duration stays fixed at `BASE_SWEEP_MS × SWEEP_SPEEDUP^2`. |

**Server-only charge constants** (in `server/src/game/constants.ts`, not in the shared module):

| Constant | Type | Value | Description |
|----------|------|-------|-------------|
| `CHARGE_TELEGRAPH_MIN_MS` | `number` | 500 (prod) / 80 (E2E_FAST) | Telegraph window at maximum sharpness. Derived from `CHARGE_TELEGRAPH_MIN_MS_PROD`; shortened under `E2E_FAST=1`. |
| `CHARGE_PARRY_COMPRESSION` | `number` | 0.35 | Fractional parry window compression at full sharpness. Formula: `round(PARRY_WINDOW_MS × (1 − sharpness × 0.35))`. Applied by `handleReleaseAttack` on a charge hit. |

---

### `shared/oscillation.ts`

Arc-swing formula suite for the charge attack orb animation (#491, GDD §6.3). The orb swings on a constant-angular-velocity arc from −SWEEP_RANGE_DEG to +SWEEP_RANGE_DEG, speeding up on each reversal up to a maximum speed, and used identically client-side (display) and server-side (hit resolution) so the client cannot spoof the release angle. All functions are pure and parameter-based — they accept sweep speed/duration constants as arguments and compute no state.

```ts
import {
  sweepIndex,
  orbAngle,
  isHitAngle,
  sharpnessFromSweep,
  telegraphDuration,
  sweepHoldMs,
} from 'shared/oscillation';
```

#### `sweepIndex`

```ts
export function sweepIndex(
  holdMs: number,
  sweepDurationMs: number,
  speedup: number,
  maxSweeps: number,
): number
```

Zero-based sweep index the orb is in at `holdMs` of charge. Sweep 0 = first pass (−45°→+45°); each reversal increments the index and speeds up the arc up to `maxSweeps`. Used to compute the orb's playhead position and sharpness tier.

#### `orbAngle`

```ts
export function orbAngle(
  holdMs: number,
  sweepRangeDeg: number,
  sweepDurationMs: number,
  speedup: number,
  maxSweeps: number,
): number
```

The orb's angle in degrees at `holdMs` of charge. Range: `[−sweepRangeDeg, +sweepRangeDeg]` (i.e. [−45, +45]). 0° = sweet spot aimed at the opponent. Both server (hit resolution) and client (display) use this function with the same constants to ensure the display and the authoritative result are always in sync.

#### `isHitAngle`

```ts
export function isHitAngle(
  holdMs: number,
  sweepRangeDeg: number,
  sweepDurationMs: number,
  hitConeDeg: number,
  speedup: number,
  maxSweeps: number,
): boolean
```

True when the orb's angle at the release moment is within the hit cone (`|angle| ≤ hitConeDeg`). The sweet spot is 0° (aimed at the opponent), and ±10° cone is the catch window.

#### `sharpnessFromSweep`

```ts
export function sharpnessFromSweep(
  holdMs: number,
  sweepDurationMs: number,
  speedup: number,
  maxSweeps: number,
): number
```

Sharpness in `{1/3, 2/3, 1.0}` based on sweep index: sweep 0 → 1/3, sweep 1 → 2/3, sweep 2+ → 1.0. A tap (holdMs < CHARGE_THRESHOLD_MS) returns 0 and is handled upstream before this function is called. Used to compute telegraph duration and parry window compression.

#### `telegraphDuration`

```ts
export function telegraphDuration(
  sharpnessVal: number,
  baseTelegraphMs: number,
  chargeTelegraphMinMs: number,
): number
```

Varies from `baseTelegraphMs` (standard, sharpness 0) down to `chargeTelegraphMinMs` (fastest, sharpness 1.0). A tap attack gets the full duration; a maxed charge gets the compressed minimum. Rounded to the nearest millisecond.

#### `sweepHoldMs` (NEW in #493)

```ts
export function sweepHoldMs(
  targetSweep: number,
  releaseDeg: number,
  baseSweepMs: number,
  sweepSpeedup: number,
  sweepRangeDeg: number,
  maxSweeps: number,
): number
```

**Inverse of `orbAngle`.** Given a desired release angle `releaseDeg` (degrees, clamped to ±sweepRangeDeg) and a 1-based `targetSweep`, returns the hold duration (ms) at which the orb reaches that angle within that sweep. The release angle is the angle the orb will be at when `releaseAttack` fires.

Used by the AI to dispatch a charged attack targeting the sweet spot (0°) with Gaussian noise applied to the release angle. The AI samples `releaseDeg = normal(0, profile.chargeReleaseSigmaDeg)` and calls this function to compute the exact `holdMs` at which to schedule the release message so the orb is at the intended angle when the attack lands.

**Example:** `sweepHoldMs(1, 0, 1200, 0.75, 45, 3) = 600ms` — to release at 0° on sweep 1 (the first pass, assuming `BASE_SWEEP_MS=1200` and `SWEEP_SPEEDUP=0.75`), hold for 600 ms.

---

### `ChargeAttack.ts`

Server-side charge attack formula wrappers (#491, GDD §6.3). Thin wrappers that bind the shared arc-swing functions (`shared/oscillation.ts`) to the server's authoritative constants so callers only import this module. All functions are pure and stateless.

```ts
import {
  computeSweepIndex,
  computeOrbAngle,
  computeIsHitAngle,
  computeSharpness,
  computeTelegraphDuration,
} from 'server/src/game/ChargeAttack';
```

#### `computeSweepIndex`

```ts
export function computeSweepIndex(holdMs: number): number
```

Zero-based sweep index the orb is in at `holdMs` of charge. Sweep 0 = first pass (−45°→+45°); each reversal increments the index and speeds up the sweep (up to `MAX_SWEEPS`).

#### `computeOrbAngle`

```ts
export function computeOrbAngle(holdMs: number): number
```

The orb's angle in degrees at `holdMs` of charge. Range: `[−SWEEP_RANGE_DEG, +SWEEP_RANGE_DEG]` (i.e. [−45, +45]). 0° = sweet spot aimed at the opponent. Both server (hit resolution) and client (display) use this function with the same constants.

#### `computeIsHitAngle`

```ts
export function computeIsHitAngle(holdMs: number): boolean
```

True when `|computeOrbAngle(holdMs)| ≤ HIT_CONE_DEG` (±10° sweet-spot cone). The server calls this on the hold duration measured server-authoritatively from `chargeStartTimes`; the client display value is not used for hit classification.

#### `computeSharpness`

```ts
export function computeSharpness(holdMs: number): number
```

Sharpness in `{1/3, 2/3, 1.0}` based on sweep index: sweep 0 → 1/3, sweep 1 → 2/3, sweep 2+ → 1.0. A tap (holdMs < CHARGE_THRESHOLD_MS) returns 0 and is handled upstream before this function is called.

#### `computeTelegraphDuration`

```ts
export function computeTelegraphDuration(holdMs: number): number
```

Variable telegraph duration in ms. Lerps from `TELEGRAPH_MS` (standard, at sharpness 0) down to `CHARGE_TELEGRAPH_MIN_MS` (fastest, at sharpness 1.0). Rounded to the nearest millisecond.

---

### `ElementSystem.ts`

Pentagon matchup and element relationship logic. Imports `ElementEnum` from `shared/types.ts`. Re-exports fusion helpers from `Fusions.ts` (which re-exports from `shared/fusions.ts`).

```ts
import { resolve, counterOf, fusionBeats, Relationship } from 'server/src/game/ElementSystem';
import { isFusion, fusionOf, fusionParents, componentsOf, triangleComponentsOf, TRIANGLE, NEUTRAL } from 'server/src/game/ElementSystem';
```

**Types**

```ts
export type Relationship = 'STRONG' | 'NEUTRAL' | 'WEAK';
```

**Functions**

#### `resolve`

```ts
export function resolve(
  attackerEl: number,
  defenderEl: number,
  role: 'attack' | 'defense',
): Relationship
```

Role-aware element relationship. Returns the STRONG/NEUTRAL/WEAK standing from the perspective of the side named by `role`. `BlockResolver` always calls this with `role='defense'` to get the defender's standing, which is the Block Resolution Table input.

Resolution order:
1. Fusion-vs-fusion: always NEUTRAL.
2. Attacker is fusion: compound offensive matchup — checks whether any triangle parent beats the base defender.
3. Defender is fusion: compound defensive matchup — a fusion has no weakness (STRONG or NEUTRAL only from the defender's view).
4. Shadow asymmetric matchup: Shadow beats Wood; Fire beats Shadow; all other Shadow pairings are NEUTRAL.
5. Base triangle cycle: Fire beats Wood, Wood beats Water, Water beats Fire. Wind defense is always WEAK; Earth defense is always NEUTRAL.

#### `fusionBeats`

```ts
export function fusionBeats(fusionEl: number, targetEl: number): boolean
```

True when `targetEl` is a base element beaten by at least one of `fusionEl`'s triangle parents. Always false when `targetEl` is itself a fusion (fusions have no weakness).

#### `counterOf`

```ts
export function counterOf(el: number): number
```

Returns the single triangle element that beats `el` — the ring a defender picks for a STRONG relationship against an attack of element `el`. Returns `-1` for WIND, EARTH, and all fusions (no single counter exists). Used by the AI.

**Re-exported from `shared/fusions.ts` (via `Fusions.ts`)**

| Export | Signature | Description |
|--------|-----------|-------------|
| `isFusion` | `(el: number): boolean` | True when `el` is one of the 10 fusion indices (5–14). |
| `fusionOf` | `(elA: number, elB: number): number \| null` | The fusion element produced by combining two base elements; null if not a valid pair. Order-independent. |
| `fusionParents` | `(el: number): [number, number] \| null` | A fusion's [first, second] component pair; null for a base element. |
| `componentsOf` | `(el: number): number[]` | A fusion's two components, or `[el]` for a base element. |
| `triangleComponentsOf` | `(el: number): number[]` | Only the triangle (FIRE/WATER/WOOD) components of the element. |
| `TRIANGLE` | `ReadonlySet<number>` | The three triangle base elements: FIRE, WATER, WOOD. |
| `NEUTRAL` | `ReadonlySet<number>` | The two asymmetric neutral base elements: WIND, EARTH. |
| `MIN_FUSION_PARENT_XP` | `500` | Minimum XP for a ring to qualify as a fusion parent (= Tier-1 floor, GDD §4.2). |
| `isFusionEligibleParent` | `(el: number, xp: number): boolean` | True when a ring may serve as a fusion parent: `xp ≥ MIN_FUSION_PARENT_XP && !isFusion(el)`. Used by both server (`fuseRings`) and client (`FusionPanel`, `RingCard` glyph). |

---

### `BlockResolver.ts`

Defense outcome logic. Resolves one exchange under the compound-element model. All timing thresholds come from `constants.ts` — none are hardcoded here.

```ts
import { classifyTiming, resolveBlock } from 'server/src/game/BlockResolver';
```

#### `classifyTiming`

```ts
export function classifyTiming(
  offsetMs: number,
  pressed: boolean,
  parryMs?: number,   // default 70
  blockMs?: number,   // default 180
): 'PARRY' | 'BLOCK' | 'MISTIME' | 'NO_BLOCK'
```

Classifies a defense press by its offset from impact. If `pressed` is false, returns `NO_BLOCK`. Otherwise uses `Math.abs(offsetMs)` against the two thresholds: `≤ parryMs` → PARRY, `≤ blockMs` → BLOCK, else MISTIME. The production `BattleRoom` passes `PARRY_WINDOW_MS` and `BLOCK_WINDOW_MS` from `constants.ts`; the defaults shown match the unit-test baseline.

#### `resolveBlock`

```ts
export function resolveBlock(
  attackerRing: Ring,
  defenderRing: Ring | null,
  timing: 'PARRY' | 'BLOCK' | 'MISTIME' | 'NO_BLOCK',
): BlockResult
```

Resolves a single exchange and returns a `BlockResult` (defined in `shared/types.ts`). `defenderRing` is null when the defender committed no ring; the exchange resolves as NO_BLOCK in that case.

**Outcome rules (four-case gauge model):**

| Timing | Relationship | Effect |
|--------|-------------|--------|
| NO_BLOCK / MISTIME | any | −1 defender heart; each tracked attacker component fills its gauge +1 (MISTIME burns 1 defender use). |
| BLOCK / PARRY | WEAK | −1 defender heart; no gauge movement. |
| BLOCK / PARRY | NEUTRAL | Defender pays 1 use; block gauge deltas: `1 / force(defender.xp)` per tracked defender component. |
| BLOCK | STRONG | Neutral deltas PLUS case-3 decrements on the beaten gauge(s). |
| PARRY | STRONG | Rally continues; all tracked gauges clear (`clearAllGauges = true`). |

---

### `Tiers.ts`

Ring tier logic. Pure: no DB or side effects. The implementation lives in `shared/tiers.ts` (EPIC #511/#512) so the Phaser client can import `force`/`forceFromTier1` without depending on server-only code; `server/src/game/Tiers.ts` is a thin re-export so every existing server import path resolves unchanged.

```ts
import { tierStartXp, tierForXp, naturalMaxUses, force, forceFromTier1 } from 'server/src/game/Tiers';
// or, from client code: import { force, forceFromTier1 } from 'shared/tiers';
```

#### `tierStartXp`

```ts
export function tierStartXp(n: number): number
```

The XP at which tier `n` begins: `250 · n · (n+1)`. Thresholds: T0=0, T1=500, T2=1500, T3=3000, T4=5000, T5=7500.

#### `tierForXp`

```ts
export function tierForXp(xp: number): number
```

The tier a ring of the given XP currently sits in. Solves `250·n·(n+1) ≤ xp` for the largest n using the closed-form quadratic root with boundary-safe correction. Exactly-on-threshold lands in the higher tier.

#### `naturalMaxUses`

```ts
export function naturalMaxUses(tier: number): number
```

Natural ring max uses at a given tier: `3 + tier`. "Natural" means the ring earned its tier through battle XP; fusion rings set `max_uses` explicitly rather than via this formula.

#### `forceFromTier1`

```ts
export function forceFromTier1(tier1: number): number
```

Force scalar as a function of the **1-indexed** tier (Contract A, EPIC #511): `Math.floor((tier1 + 2) / 2)`. This is the single load-bearing arithmetic — both the player path (`force`) and the AI path normalize their own tier indexing to 1-indexed before calling this, so there is exactly one place the Contract A formula lives.

#### `force`

```ts
export function force(xp: number): number
```

Force scalar for a ring of the given XP (Contract A): `forceFromTier1(tierForXp(xp) + 1)`. `tierForXp` is 0-indexed; `+1` normalizes to the 1-indexed convention `forceFromTier1` is defined on. Always ≥ 1. Consumed by `BlockResolver.ts`'s case-2 gauge dampening (`1 / force(defender.xp)`).

---

### `StatusEffects.ts`

Triangle status effect predicates and turn-start application. Pure and Colyseus-free: accepts a structural `PlayerLike` interface so it is unit-testable with plain objects.

```ts
import {
  isBurning, isDrowning, isEntangled, isBlinded,
  applyTurnStart,
  PlayerLike, TurnStartResult,
  SHADOW_GAUGE_CAP,
} from 'server/src/game/StatusEffects';
```

**Exported interface**

```ts
export interface PlayerLike {
  hearts: number;
  fireGauge: number;
  waterGauge: number;
  woodGauge: number;
  shadowGauge: number;
  a1: { currentUses: number; maxUses: number; isExtinguished: boolean };
  a2: { currentUses: number; maxUses: number; isExtinguished: boolean };
  d1: { currentUses: number; maxUses: number; isExtinguished: boolean };
  d2: { currentUses: number; maxUses: number; isExtinguished: boolean };
}
```

**Predicates**

| Function | Signature | Description |
|----------|-----------|-------------|
| `isBurning` | `(ps: PlayerLike, threshold?: number): boolean` | True when `fireGauge >= threshold` (default `STATUS_THRESHOLD`). |
| `isDrowning` | `(ps: PlayerLike, threshold?: number): boolean` | True when `waterGauge >= threshold`. |
| `isEntangled` | `(ps: PlayerLike, threshold?: number): boolean` | True when `woodGauge >= threshold`. |
| `isBlinded` | `(ps: PlayerLike, threshold?: number): boolean` | True when `shadowGauge >= threshold` (default 1 — any stack blinds). |

#### `applyTurnStart`

```ts
export function applyTurnStart(ps: PlayerLike): TurnStartResult
```

Apply start-of-turn status effects. Mutates `ps` in place. Returns:

```ts
export interface TurnStartResult {
  heartLost: boolean;          // Burning fired and removed a heart
  drowningRingKey: string | null; // attack slot drained by Drowning, or null
  entangledRingKey: string | null; // defense slot drained by Entangled, or null
}
```

Burning deducts 1 heart (floored at 0). Drowning drains 1 use from the highest-capacity (by `maxUses`) non-extinguished attack ring. Entangled drains 1 use from the highest-capacity defense ring. Each drain is a no-op when all candidate slots are extinguished.

**Re-exported constant:** `SHADOW_GAUGE_CAP` (sourced from `constants.ts`).

---

### `ringHelpers.ts`

Use-invariant helpers and typed broadcast-payload builders. Typed structurally (`RingUses`) so the same helpers serve both the Colyseus schema paths and the framework-free `StatusEffects` module.

```ts
import {
  consumeUse, setUses,
  wonRingPayload, battleSummaryPayload, rechargeResultPayload,
  RingUses,
} from 'server/src/game/ringHelpers';
```

**Interface**

```ts
export interface RingUses {
  currentUses: number;
  isExtinguished: boolean;
}
```

**Use-invariant helpers**

| Function | Signature | Description |
|----------|-----------|-------------|
| `consumeUse` | `(ring: RingUses): void` | Decrements `currentUses` by 1 (no-op at 0, never negative); re-syncs `isExtinguished`. |
| `setUses` | `(ring: RingUses, n: number): void` | Sets `currentUses` to `max(0, n)`; re-syncs `isExtinguished`. |

**Payload builders**

| Function | Signature | Description |
|----------|-----------|-------------|
| `wonRingPayload` | `(ringId: string, element: number \| undefined, xp: number \| undefined): WonRingPayload` | Builds the `wonRing` broadcast payload; `element`/`xp` default to 0. |
| `battleSummaryPayload` | `(won: boolean, goldGained: number, xpGained: number, aggregateXp: number): BattleSummaryPayload` | Builds the post-duel summary payload for one human client. |
| `rechargeResultPayload` | `(slot: RechargeResultPayload['slot'], restored: number, requested: number, spiritCurrent: number): RechargeResultPayload` | Builds the per-client recharge-result payload. |

---

### `StakeResolver.ts`

Thumb-ring stake passive functions. All functions mutate Colyseus schema objects in place (server-only). Each passive guards on: thumb is not a fusion, thumb has ≥ 1 use, thumb element matches the passive.

```ts
import {
  applySetupPassive, applyEarthParry, applyTailwind,
  applyBossSetupPassive,
  BossPassive, BOSS_PASSIVES,
} from 'server/src/game/StakeResolver';
```

#### `applySetupPassive`

```ts
export function applySetupPassive(ps: PlayerState): number
```

All-in setup distributor (Fire / Water / Wood thumb). Spends ALL thumb uses, distributing +1 `currentUses` at a time round-robin to matching base-element battle rings (A1/A2/D1/D2), highest-XP first (ties broken by slot order). If no matching rings exist the passive does not fire and the thumb keeps its uses. Returns the total uses distributed (0 if passive did not apply). The thumb (staked) ring earns no XP from this passive.

#### `applyEarthParry`

```ts
export function applyEarthParry(ps: PlayerState, defenderRing: Ring): boolean
```

Precision Parry (Earth thumb). Refunds the 1 use `resolveBlock` already spent on the defending ring (capped at `maxUses`), then spends 1 thumb use. Returns true if the passive fired.

#### `applyTailwind`

```ts
export function applyTailwind(ps: PlayerState, _attackRing: Ring): boolean
```

Tailwind (Wind thumb). The thumb pays the attack-ring use cost so the attack ring is NOT charged. Returns true if the passive fired; the caller skips normal ring deduction when true.

#### `applyBossSetupPassive`

```ts
export function applyBossSetupPassive(ps: PlayerState, bossId: string): number
```

Apply the seat-time half of a boss passive. Bulwark adds `+bulwarkDefenseBonus` uses to both defense rings. Returns the Heartwood charge count for the boss (0 when none or when `bossId` has no passive row). Mutates `ps` in place.

**Boss passive data**

```ts
export interface BossPassive {
  heartwoodCharges: number;     // first N heart-losses absorbed by the Thumb (Heartwood)
  bulwarkDefenseBonus: number;  // bonus uses added to d1/d2 at seat time (Bulwark)
}

export const BOSS_PASSIVES: Record<string, BossPassive>
// Keys: 'forest_thornwood_warden', 'forest_bogwood_warden'
```

---

### `DoubleAttack.ts`

Fusion-thumb double-attack eligibility predicate. Pure: reads ring elements and uses; mutates nothing.

```ts
import { canDoubleAttack } from 'server/src/game/DoubleAttack';
```

#### `canDoubleAttack`

```ts
export function canDoubleAttack(attacker: PlayerState): boolean
```

True when all three conditions hold:
1. `thumb.isFusion` is true.
2. `[a1.element, a2.element]` is the same unordered pair as `componentsOf(thumb.element)`.
3. `a1.currentUses > 0 && a2.currentUses > 0 && thumb.currentUses > 0`.

`BattleRoom` re-validates every `selectDoubleAttack` message against this and silently drops ineligible requests.

---

### `ai/AILoadout.ts`

AI opponent loadout and spirit-pool derivation. Pure functions consumed by `BattleRoom` (real fight) and the overworld preview route.

```ts
import { computeNpcSpirit } from 'server/src/game/ai/AILoadout';
```

#### `computeNpcSpirit`

```ts
export function computeNpcSpirit(
  playerSpiritMax: number,
  personality: AIPersonality,
  biome?: string,
  bossTier?: BossTier,
): number
```

The NPC's spirit pool for a duel (#492 — updated formula).

- **Boss path** (`bossTier` supplied): `floor(playerSpiritMax × spiritMult) + spiritFloor(biome, bossTier)`. The additive formula preserves the boss's player-scaled base and stacks the region floor on top.
- **Roamer path** (`bossTier` absent): `max(spiritFloor(biome, 'roamer'), floor(playerSpiritMax × mult))`. The floor acts as a minimum, not an addend, so forest roamers (floor=0) remain fully player-scaled while late-game biome roamers gain a minimum challenge floor.
- Returns 0 for unknown or missing biome (safe default).

Signature is unchanged from #464 — existing callers (`BattleRoom.onJoin`, `GET /api/overworld/npcs`) require no update. Both call with `getSpiritAndFood(playerId).spirit_max`, so the overworld SP preview equals the in-battle value.

#### `effectiveTier`

```ts
export function effectiveTier(biome: string, personality: AIPersonality, playerBattleHandAvgXp: number): number
```

Effective encounter tier used by `scaleProfileByTier`. Returns `max(floorTier(biome), tierForXp(playerXp))` so the biome always sets a minimum tier floor.

#### `skillRoll`

```ts
export function skillRoll(spawnId: string, npcClass: NpcClass): number
```

Seeded uniform skill draw in `SKILL_BAND[npcClass]`. Uses djb2 (`hashId`) to convert `spawnId` to a uint32 seed for `makeRng`, guaranteeing the same NPC always rolls the same skill. Do not use `Math.random()` for skill rolls.

#### `scaleProfileByTier`

```ts
export function scaleProfileByTier(base: AIProfile, effectiveTier: number, skill: number): AIProfile
```

Returns a new `AIProfile` with `timingSigmaMs`, `lowHeartTimingSigmaMs`, and `elementMistakeProb` scaled by tier and skill. Higher tier and higher skill both reduce timing sigma (sharper AI) and reduce mistake probability. Floors: `timingSigmaMs ≥ 10`, `elementMistakeProb ≥ 0`. Applied to ALL NPC profiles in `BattleRoom` (both bosses and roamers).

### `AIProfile` — Charged Attack Fields (NEW in #493)

The `AIProfile` interface carries four new charge-attack parameters controlling AI behavior on the charged attack path:

| Field | Type | Description |
|-------|------|-------------|
| `chargeAttemptProb` | `number` (0–1) | Probability the AI chooses a charged attack over a tap on its attack turn. |
| `targetSweep` | `1 \| 2 \| 3` | Which sweep (1-based; 1=sweep 0) the AI aims to release on. Sweep 1 → sharpness 1/3, sweep 2 → 2/3, sweep 3+ → 1.0. |
| `chargeReleaseSigmaDeg` | `number` (degrees) | Standard deviation of Gaussian noise applied to the release angle. Sampled as `normal(0, sigma)` to add variance around the targeted sweet spot (0°). |
| `lowHeartChargeAttemptProb?` | `number` (0–1) | Override for `chargeAttemptProb` when hearts ≤ `lowHeartThreshold` (RESILIENT personality only). |
| `lowHeartTargetSweep?` | `1 \| 2 \| 3` | Override for `targetSweep` when hearts ≤ `lowHeartThreshold` (RESILIENT personality only). |

**Dispatch mechanism** (`AIController.scheduleAttack`, #493):

When the AI decides to charge (probability `chargeAttemptProb`), `AIController` calls `handleChargeStart`, then schedules a delayed `handleReleaseAttack` via `sweepHoldMs`:

1. Call `room.handleChargeStart(aiId, { slot })`.
2. Sample `releaseDeg = normal(0, profile.chargeReleaseSigmaDeg)` (Gaussian noise).
3. Compute `holdMs = sweepHoldMs(targetSweep, releaseDeg, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS)`.
4. Subtract the server back-date offset: `waitMs = max(0, holdMs - CHARGE_THRESHOLD_MS)`.
5. Schedule `handleReleaseAttack` to fire after `waitMs`, so the server's back-dated timestamp reads the target `holdMs`.

**E2E_FAST fallback:** Under `E2E_FAST=1` (test suite), the AI falls through to the instant-tap path (`handleSelectAttack`) to complete duels deterministically within the test timeout, bypassing the real charge path.

---

## 2. `shared/types.ts` — Shared Type Definitions

Types imported by both the Colyseus server and the Phaser client.

---

### `ElementEnum`

```ts
export enum ElementEnum {
  FIRE    = 0,
  WATER   = 1,
  EARTH   = 2,
  WIND    = 3,
  WOOD    = 4,
  // Fusions (indices 5–14) — every distinct pair of base elements (5C2):
  STEAM     = 5,   // Fire + Water
  WILDFIRE  = 6,   // Fire + Wood
  INFERNO   = 7,   // Fire + Wind
  MAGMA     = 8,   // Fire + Earth
  TIDAL     = 9,   // Water + Wood
  STORM     = 10,  // Water + Wind
  MUD       = 11,  // Water + Earth
  THORNADO  = 12,  // Wood + Wind
  BLOOM     = 13,  // Wood + Earth
  DUST      = 14,  // Wind + Earth
  // Shadow sits outside the pentagon; indexed after DUST so no base index shifts.
  SHADOW  = 15,
}
```

---

### `PhaseType`

```ts
export type PhaseType = 'WAITING' | 'ATTACK_SELECT' | 'DEFEND_WINDOW' | 'RESOLVE' | 'ENDED';
```

---

### Slot types

```ts
export const SLOT_KEYS = ['thumb', 'a1', 'a2', 'd1', 'd2'] as const;
export type SlotKey   = (typeof SLOT_KEYS)[number]; // 'thumb'|'a1'|'a2'|'d1'|'d2'
export type AttackSlot  = 'a1' | 'a2';
export type DefenseSlot = 'd1' | 'd2';
```

`SLOT_KEYS` is the canonical slot iteration order used by the client Hand/BattleHandOverlay/CampScene and by `PlayerRepo`.

---

### Player-configuration types

```ts
export type AIPersonality = 'AGGRESSIVE' | 'DEFENSIVE' | 'STATUS_HUNTER' | 'RESILIENT';
export type DifficultyTier = 'wanderer' | 'seeker' | 'ascendant' | 'ascetic' | 'void';
export type BossTier = 'major' | 'gate' | 'sub';

export const DIFFICULTY_MULTIPLIERS: Record<DifficultyTier, number>;
// { wanderer: 5, seeker: 4, ascendant: 3, ascetic: 2, void: 1 }
// Scales spirit_max = floor(sum_of_reliquary_maxUses × multiplier).

export function isDifficultyTier(v: unknown): v is DifficultyTier
// Runtime type guard for incoming difficulty tier values.
```

---

### Message payload interfaces

#### `SelectAttackPayload`

```ts
export interface SelectAttackPayload {
  slot: AttackSlot; // 'a1' | 'a2'
}
```

Sent by the attacker when selecting a normal single attack.

#### `SelectDoubleAttackPayload`

```ts
export interface SelectDoubleAttackPayload {
  first: AttackSlot;
  second: AttackSlot;
  gapMs: number; // held duration; server clamps to [MIN_COMBO_GAP_MS, MAX_COMBO_GAP_MS]
}
```

Sent once on chord completion for a fusion-thumb double attack. Server re-validates via `canDoubleAttack` and silently drops if ineligible.

#### `SubmitDefensePayload`

```ts
export interface SubmitDefensePayload {
  slot: DefenseSlot;  // 'd1' | 'd2'
  pressTime: number;  // retained for future lag compensation; server ignores for timing authority
}
```

Sent by the defender. The server timestamps on message arrival for authoritative timing classification.

#### `RechargePayload`

```ts
export interface RechargePayload {
  slot: AttackSlot | DefenseSlot; // combat ring to recharge (never the Thumb)
}
```

#### `BattleRoomOptions`

Options passed to a `BattleRoom` on creation. PvP rooms pass nothing; `battle-ai` rooms pass at minimum `{ vsAI: true, personality }`.

Notable fields (full interface in source):

| Field | Type | Description |
|-------|------|-------------|
| `vsAI` | `boolean?` | Seat a virtual AI player. |
| `personality` | `AIPersonality?` | AI combat profile. |
| `npcId` | `string?` | Overworld NPC id; triggers `recordNpcDefeat` on win. |
| `firstStrike` | `boolean?` | Ambush first-strike; server spends `AMBUSH_SPIRIT_COST`. |
| `isPracticeRematch` | `boolean?` | Skips all economy (gold, XP, ring-use drain, stake transfer). |
| `aiHearts` / `aiUses` | `number?` | E2E-only deterministic overrides. |
| `aiHeartwoodCharges` | `number?` | E2E-only: override boss Heartwood charge count. |

---

### Broadcast payload interfaces

#### `DoubleAttackStartPayload`

```ts
export interface DoubleAttackStartPayload {
  first: AttackSlot;
  second: AttackSlot;
  firstElements: number[];   // component elements of the first fired ring
  secondElements: number[];  // component elements of the second fired ring
  gapMs: number;             // server-clamped gap
}
```

Broadcast the moment a double attack commits, so the client can schedule both orb telegraphs up front.

#### `DoubleAttackCancelledPayload`

```ts
export interface DoubleAttackCancelledPayload {
  orb: 2; // always 2 — orb-1 PARRY or KO cancelled orb-2
}
```

#### `ExchangeResultPayload`

```ts
export interface ExchangeResultPayload {
  attackerId: string;
  defenderId: string;
  attackerSlot: string;       // 'a1'|'a2' for a normal attack; 'd1'|'d2' for a rally volley; '' when none
  defenderSlot: string;
  attackerElements: number[]; // component elements (1 for base, 2 for fusion)
  timing: 'PARRY' | 'BLOCK' | 'MISTIME' | 'NO_BLOCK';
  relationship: 'STRONG' | 'NEUTRAL' | 'WEAK';
  defenderHeartLost: boolean; // pre-absorption verdict — may differ from actual hearts when a boss passive absorbs
  rallyContinues: boolean;
  volleyedElement: number;
}
```

#### `RechargeResultPayload`

```ts
export interface RechargeResultPayload {
  slot: AttackSlot | DefenseSlot;
  restored: number;      // uses actually restored (0 = none)
  requested: number;     // uses the ring was missing
  spiritCurrent: number; // post-spend spirit balance
}
```

#### `BattleSummaryPayload`

```ts
export interface BattleSummaryPayload {
  won: boolean;
  goldGained: number;   // GOLD_PER_WIN if this client won, else 0
  xpGained: number;     // sum of xpAccumulator deltas across all slots this session
  aggregateXp: number;  // post-award total from PlayerRepo.getSpiritStats
}
```

#### `WonRingPayload`

```ts
export interface WonRingPayload {
  ringId: string;
  element: number;
  xp: number;
}
```

#### `BlockResult`

```ts
export interface BlockResult {
  timing: 'PARRY' | 'BLOCK' | 'MISTIME' | 'NO_BLOCK';
  relationship: 'STRONG' | 'NEUTRAL' | 'WEAK';
  defenderHeartLost: boolean;
  attackerHeartLost: boolean;
  rallyContinues: boolean;
  volleyedElement: number;
  hitGaugeElements: number[];                       // gauge elements filled on an uncontested hit
  blockGaugeDeltas: { element: number; delta: number }[]; // per-tracked-component deltas on NEUTRAL/STRONG catch
  blockedGaugeElement: number[];                    // gauge element(s) decremented on a strong block
  clearAllGauges: boolean;                          // true on a STRONG parry
}
```

#### `MeState`

```ts
export interface MeState {
  player: Record<string, unknown>; // broad index map of the players row
  rings: unknown[];
  loadout: Record<string, string | null> | null;
}
```

Shape of `GET /api/me`. Callers narrow as needed; the type is intentionally permissive.

---

## 3. Key Client UI Helpers — `client/src/objects/ui/DomLabel.ts`

DOM-overlay text rendering for crisp HiDPI UI labels (EPIC #361). The module docstring explains the full motivation; the excerpt below is the authoritative carve-out rule quoted from source.

> "NOTE ON DEPTH: Phaser DOM elements ALWAYS composite above the entire WebGL canvas — they cannot be occluded by canvas sprites. `setDepth` only orders DOM elements relative to each other, not against canvas content. DomLabel therefore only suits text that never needs to sit BEHIND a canvas sprite (see the carve-out rule in EPIC #361)."

For the full architectural reasoning see `docs/architecture-overview.md`.

---

### Constants

```ts
export const DOM_LABEL_FONT_FAMILY: string
// "'Courier New', Courier, monospace"
// Default monospace stack — matches Phaser's default canvas font (parity rule).

export const DOM_LABEL_CLASS: string
// 'er-dom-label'
// Stable class on every DomLabel node; Playwright/E2E selects on this.
```

---

### `DomLabelStyle` interface

```ts
export interface DomLabelStyle {
  fontPx: number;              // logical px; matches the old fontSize (e.g. 14)
  color: string;               // CSS color, e.g. '#ddeeff'
  weight?: number | string;    // font weight; default 400
  align?: 'left' | 'center' | 'right'; // default 'center' (matches canvas setOrigin(0.5))
  family?: string;             // font family; default monospace stack — do not change typeface (parity rule)
  shadow?: boolean;            // text-shadow for legibility over a busy background
  lineHeight?: number;         // line height in px, for two-row labels
  background?: string;         // CSS background, e.g. 'rgba(0,0,0,0.6)'
  padding?: string;            // CSS padding shorthand, e.g. '5px 8px'
  id?: string;                 // stable data-label attribute for test targeting; no rendering effect
}
```

---

### `addDomLabel`

```ts
export function addDomLabel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  style: DomLabelStyle,
): Phaser.GameObjects.DOMElement
```

Creates a crisp, screen-fixed DOM text label layered over the WebGL canvas. Uses `scene.add.dom(x, y, node)` internally. The returned `DOMElement` behaves like any other Phaser GameObject (`setVisible`, `setDepth`, `destroy`); the underlying text lives at `el.node.textContent`.

- `pointerEvents` is set to `'none'` so the label never intercepts canvas clicks.
- `setScrollFactor(0)` pins the label to screen space.
- Origin aligns with `align`: left→`(0, 0.5)`, right→`(1, 0.5)`, center→`(0.5, 0.5)`.
- Depth is set to 10 000 to maintain stable ordering relative to other DOM elements.

Use `'\n'` in `text` for two-row labels (the node uses `white-space: pre`).

---

### `setDomLabelText`

```ts
export function setDomLabelText(
  el: Phaser.GameObjects.DOMElement | null,
  text: string,
): void
```

Updates a DomLabel's text. Null-safe: a null `el` or missing `el.node` is a no-op rather than a crash, simplifying call-site guards.

Calls `el.updateSize()` after mutating `textContent` so Phaser re-measures the DOM node's bounding rect. Without this call, the cached size from creation time is stale after a text change, causing right/center-aligned labels to overflow their intended edge.

---

### `crispCanvasText`

```ts
export function crispCanvasText(
  text: Phaser.GameObjects.Text,
): Phaser.GameObjects.Text
```

Best-effort mitigation for DOM-ineligible canvas text — text inside scrolling/masked containers, camera/world-space labels, or anything that must interleave in depth with canvas sprites.

Calls `text.setResolution(Math.ceil(window.devicePixelRatio))` and `text.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)`.

**This is the ONLY intentional `setResolution` call site post-revert.** It is always paired with the LINEAR filter. Do not scatter raw `setResolution` calls elsewhere. The module docstring quoted from source:

> "LINEAR+setResolution(ceil) is the accepted ceiling for canvas text on fractional DPI (smoother, not DOM-crisp). This is the ONLY intentional setResolution call site post-revert, and it is ALWAYS paired with the LINEAR filter — never scatter raw setResolution calls elsewhere."

Returns the same text object for chaining.

---

**Carve-out rule (when to use DomLabel vs `crispCanvasText`):**

| Situation | Use |
|-----------|-----|
| Screen-fixed HUD text that never needs to sit behind a canvas sprite | `addDomLabel` |
| Text inside a masked/scrolling container, world-space labels, or anything that must interleave in depth with canvas sprites | `crispCanvasText` |

For full architectural reasoning see `docs/architecture-overview.md`.

---

## 4. `shared/waystones.ts` — Anchorage Catalog

The single source of truth for **teleport destinations**. Each `WaystoneDef` is
`{ id, name, biome, spiritCost }`; `spiritCost` is the absolute spiritual distance
from `forest_entry` (cost 0), and the actual teleport cost is the absolute difference
between origin and destination. Anchorage ids referenced by map `anchorage` objects
MUST exist here (asserted by the `waystones.spec.ts` catalog-drift test).

### `WAYSTONES`

```ts
export const WAYSTONES: WaystoneDef[]
```

Catalog of anchorages across biomes: Forest (`forest_entry` 0, `forest_glade` 3,
`forest_depths` 6, `forest_hidden_anchor` 15), Swamp (`swamp_anchor_1` 8,
`swamp_anchor_2` 10), and Snow (`snow_anchor_1` "Snow Fields" 9, **`snow_anchor_2`
"Frozen Lake" 12**). Adding a biome anchorage requires an entry here plus the matching
`anchorage` object on that biome's map.

### `getWaystone`

```ts
export function getWaystone(id: string): WaystoneDef | undefined
```

Look up an anchorage by id, or `undefined` if not in the catalog.

### `canTeleport`

```ts
export function canTeleport(
  spiritCurrent: number, id: string, currentAnchorId?: string,
): boolean
```

Teleport-gate predicate: true when the player holds at least the relative spirit cost
from `currentAnchorId` to `id`. Unknown destinations are never teleportable; falls back
to the absolute cost when no current anchor is given.

# Changelog

This document tracks all releases and major changes to elemental-rings.

---

## [Unreleased]

## 2026-07-05

### Added

- **Separate spare/reliquary cap model.** The spare grid now has its own per-player cap (`spare_ring_max`, default 9), independent of the 5 battle-hand slots. Clearing a battle slot no longer frees spare capacity.
- **WON ring overflow carry.** A ring won in battle immediately enters the spare grid as a one-slot overflow (`in_carry=1, pending=1`). The player must resolve the overflow by assigning the ring to a battle or heart slot, accepting it as a permanent spare (only when a spare slot is freed), or discarding it.
- **`PUT /api/rings/:ringId/accept`** — new endpoint to accept the pending WON ring as a regular spare ring. Returns 400 `'spare grid still full'` when the overflow has not yet been resolved.
- **`/api/me` new fields:** `spare_ring_max` (the per-player spare cap) and `pending_ring_id` (the WON ring's id, or `null` when none pending).


- Field "Manage Battle Rings" modal (BattleHandOverlay) now renders all slot cards using the shared `RingCard` component (70×90) with full two-tone `FusedCardFill` for fused rings — identical to the reliquary and battle hand. Fused rings (e.g. Mud = Water + Earth) no longer appear as a single muddy block in the field modal.
- Spare grid in the field modal replaced with the canonical `InventoryGrid` (3-column, scrollable with ▲/▼) sorted by element → XP desc → id — same order as the reliquary.
- Modal panel widened to 760×500 (matching reliquary geometry), with a three-part Spirit / ♥ HP / Total XP header.


- Separate **Spirit** (`n/max` resting rings) and **Bench** (`n/max` carried rings) counters in the ring-management header, replacing the combined loadout counter.


- `BenchHealthCombat` component (`client/src/objects/ui/BenchHealthCombat.ts`): shared right-half render
  for all ring-management overlay modes (BENCH / HEALTH / COMBAT columns), eliminating right-column
  drift between field and sanctum views.
- `RingManagementOverlayClass.ts`: Phaser overlay class split from the pure-helper module so Vitest
  unit tests can import the contract without triggering a browser environment.
- `isPickupBlockedByFullBench()` pure function: symmetric-swap guard replacing the old asymmetric
  reliquary pick-up block; allows net-zero bench swaps regardless of pick-up order.
- `'fusion'` variant added to `RingMgmtMode` type (Sub-B rendering wired in Sub-B).
- Single `[RECHARGE]` button in both field and sanctum modes, replacing the old `[Recharge]` /
  `[Recharge All]` pair. Both modes now delegate to `BenchHealthCombat` for the right half.


- Fusion mode in unified ring-management overlay (`RingManagementOverlay` with `mode:'fusion'`):
  R1 / R2 parent slots, FR fused-result preview, eligibility gate via `isFusionEligibleParent`,
  and `[FUSE]` button calling `POST /api/fuse` — all within the canonical 760×500 frame.
- `filterElement` param on the overlay passes through the Shrine Fusion Shrine pre-filter so
  only recipes matching the shrine's element are offered.
- `window.__fusionState` hook preserved in fusion mode (compatible with sanctum-zones E2E harness).


- **Visual capture harness** (`tests/e2e/visual-capture.spec.ts`): parameterized Playwright spec that captures any screen or overlay to a PNG on demand. Driven by `CAPTURE_TARGET` and `CAPTURE_OUT` env vars. Target grammar: `overlay:field | overlay:sanctum | overlay:fusion | screen:<screen_id> | camp`. Registered in a new `visual` Playwright project (never runs in CI).
- **`visual-rendering` skill** (`.claude/skills/visual-rendering/SKILL.md`): invocation reference for all capture targets, canonical geometry constants (viewport 1024×600, modal frame 760×500, column x-bands, depth layers), and when-to-capture guidance.
- **Map reference folder** (`docs/maps/references/`): convention for storing design-time concept art and neighbor-screen captures used by the map-designer agent.

- WON ring slot now visible in all overlay modes (field, sanctum, shrine fusion) at position (837, 193) in the shared BenchHealthCombat component; shows a ghost rectangle when no pending ring exists
- DISCARD slot now visible in all overlay modes at position (659, 291) in BenchHealthCombat, giving sanctum and shrine fusion a ring discard path for the first time
- Bench ghost placeholder always visible when bench is below capacity (removed the old `emptySpareActionable` gate that required an active selection)
- SPIRIT ghost placeholder in the Reliquary grid when the reliquary pool is below cap; clicking with a ring selected moves it to the reliquary
- New `DiscardConfirm` shared class extracted from `BattleHandOverlay` for reuse across field, sanctum, and shrine fusion discard flows


- `PUT /api/rings/swap` — capacity-free two-ring exchange across all position pairs (spare, slot, heart, pending, reliquary). Swapping does not add to any pool, so no carry or reliquary cap is ever exceeded. Heart swaps recompute `spirit_max`; pending (WON) swaps transfer `pending=1` to the displaced ring.


- Ring Merge at shrines (GDD §4.7): two same-element rings (including identical
  fusion elements, e.g. Steam + Steam) can be consolidated into a single ring at
  any unsealed shrine via `POST /api/rings/merge`. The merged ring's XP is
  additive; tier and max uses follow the standard `3 + tier` rule.
- `RingManagementOverlay` merge mode (`'merge'`) with `COLUMN_LABELS['merge'] =
  ['MERGE', 'BENCH', 'HEALTH', 'COMBAT']` and dedicated `[MERGE]` button in gold.
- Shrine interactable at fusion shrines now shows `[E] FUSE / [M] MERGE` blink
  prompts; pressing M opens the merge overlay when at an unsealed shrine.


- World Map now shows all 9 Snow Mountain screens as manifest-derived nodes (from `SNOW_SCREENS`),
  replacing the previous single static `snow_entry` node. Intra-Snow edges are derived from
  each screen's reciprocal exits — adding a Snow screen now only requires a `coord` in the manifest.
- World Map opens at `OPEN_ZOOM` (≈ 0.81×, readable label scale) centered on the player's current
  screen, using focal-point zoom for mouse wheel and keyboard ± keys, and free drag-pan at any zoom.
- Sealed exit guard in `BaseBiomeScene.tryBiomeExit()`: exits whose destination Phaser scene is not
  yet registered show a "The path forward is sealed." barrier message instead of crashing.


- Per-ring RECHARGE slot in BenchHealthCombat HEALTH column: select a ring, then click
  the gold RECHARGE rectangle (below DISCARD) to recharge only that ring. Available in
  field and sanctum overlay modes; not rendered in fusion/merge modes.


- `POST /api/me/reset` — authenticated players can wipe their own account back
  to a brand-new start (gold, rings, loadout, attunements, NPC defeats, forage
  nodes, and shrine unlocks reset; username and password preserved). Response
  is identical in shape to `GET /api/me`.

- Restart Game button in Camp Settings (difficulty modal) — a clearly-labelled
  destructive action in a "Danger" section below the difficulty tier list. Tapping
  it opens an irreversible-wipe confirm dialog; confirming calls POST /api/me/reset
  and refreshes all camp state in-place without a page reload. Cancel closes the
  dialog with no side effects. Errors surface as a transient toast.

- The overworld detection readout now shows an enemy's **spirit pool (SP)** alongside
  its XP — e.g. `FIRE duelist  185 XP / 56 SP  —  Approach [E]`. The SP value is the
  spirit the enemy will actually field in the duel (it matches the real fight,
  including the per-biome boss spirit bonus), giving a fuller read on an opponent's
  endurance before committing to approach.
- Charge attack mechanic: holding an attack button spawns an oscillating orb whose Y position follows a deterministic sine wave (tightening with hold duration). Release within ±`HIT_CONE_PX` of the centre line hits; outside misses. A miss costs 1 ring use and skips the defender phase entirely (WHIFF feedback). A hit compresses the telegraph window based on charge sharpness — up to 44% shorter at maximum charge.
- Fusion ring charge interaction (§6.3a): holding A1 while tapping A2 Y-checks the held orb at the tap moment; the tapped orb always fires horizontal. A miss on A1 still lets A2 land, creating genuine attacker skill pressure on fusion double-attacks. Sub-threshold fusion tap-tap routes through `handleSelectDoubleAttack` for standard combo economy.
- Defender visibility: server broadcasts `chargeOrbStart { attackerId, slot, startTime }` when a hold begins and `chargeOrbEnd { attackerId }` on release. The defending client spawns a mirrored idle orb and oscillates it locally using `Date.now() - startTime` against the shared formula — no per-frame server traffic.
- `shared/oscillation.ts` — pure deterministic oscillation formula shared by client and server, preventing Y-spoofing.
- `shared/chargeConstants.ts` — shared charge constants (threshold, amplitude, periods, etc.).
- `server/src/game/ChargeAttack.ts` — server-bound formula wrappers with integrated constants.
- `chargeStart` + `releaseAttack` + `chargeOrbStart` + `chargeOrbEnd` server message handlers; `chargeMiss` broadcast event.
- `Orb.spawnIdle()` — stationary idle orb for charge display; tints gold inside hit zone, dims outside.


- Biome difficulty floor: `spiritFloor(biome, npcClass)` and `floorTier(biome)` replace the removed `BIOME_BOSS_SPIRIT_BONUS` table. Roamers now use a max-floor formula (forest roamers remain floor-free); bosses use additive formula. Fully parameterised via `CLASS_OFFSET`, `BIOME_ORDER`, and `REGION_STEP=25` — all five biomes (Forest through Volcano) are covered.
- Seeded NPC skill roll: each NPC draws a deterministic skill score from a class-specific band (`SKILL_BAND`) seeded from its spawn ID via djb2 + mulberry32 — major bosses always draw from a high-skill band, roamers from a wide low band.
- `scaleProfileByTier(base, tier, skill)` scales `timingSigmaMs` and `elementMistakeProb` for all NPCs (bosses and roamers) based on encounter tier and skill score.
- `effectiveTier(biome, personality, playerXp)` returns `max(floorTier(biome), playerXpTier)` so the biome always sets a minimum tier floor.
- `elementMistakeProb` field added to `AIProfile`; when non-zero the AI occasionally picks a suboptimal ring (seeded, deterministic).


- AI combatants can now throw charged attacks. Each persona has characteristic
  charge behavior: AGGRESSIVE always charges to the deepest sweep with near-perfect
  aim; DEFENSIVE never charges; STATUS_HUNTER charges occasionally with moderate
  aim noise; RESILIENT activates charging at low heart count.
- `sweepHoldMs()` pure helper in `shared/oscillation.ts` converts a desired release
  angle and target sweep to the `holdDuration` at which the arc orb hits that angle.
- GDD §6.10 documents AI charge behavior and the Gaussian noise skill model.

### Changed

- **WON ring is server-authoritative.** The `er_pending_ring` localStorage key is removed; `pending_ring_id` from `/api/me` is the single source of truth. The field modal WON slot now survives a browser page-reload.
- **`/api/me` `spareCapacity` field removed** (was a deprecated alias for `spare_ring_max`).
- The field Manage Battle Rings modal routes WON ring acceptance through `PUT /api/rings/:ringId/accept` instead of the old carry-then-stake flow.


- Card stat text (element, pips, XP, tier) in `RingCard` and `InventoryGrid` is now rendered via `crispCanvasText` — card stats are crisp at fractional-DPI screen scaling everywhere these components appear (field modal, reliquary, battle hand).

- All remaining `scene.add.text` / `this.add.text` call sites (~80 across 17 files) converted to `crispCanvasText` or `addDomLabel` — text quality is now consistent across the entire game on fractional-DPI Windows displays (125%/150% scaling)
- The "ELEMENTAL RINGS" title on the login screen is now a DOM overlay label (`addDomLabel`) — perfectly crisp at any DPR
- World-space labels (Waystone names, Merchant NPC tag, interaction prompts, shrine labels) converted to `crispCanvasText` — labels scroll correctly with the camera and remain crisp
- HUD, modal, duelist gauge/HP, encounter, and camp scene text all converted to `crispCanvasText`

- The field "Manage Battle Rings" and Sanctum "Reliquary" screens now share one layout: BENCH / HEALTH / COMBAT columns are identical on both; the left column is Spirit (Sanctum) or Loot (field). The "Spares" column is now labelled **Bench**.
- Ring cards no longer display a Tier (T0/T1…) row.

- Ring fusion no longer requires both parents to be the same tier. Any two rings at or above 500 XP whose elements form a valid fusion pair can now fuse. A fused ring can no longer be fused again. Fusion-eligible rings show an eligibility glyph on their card.

- `BattleHandOverlay.ts` reduced to a ≤200-line thin field-mode adapter wrapping `RingManagementOverlay`
  in `'field'` mode; all render logic delegated to the shared overlay class.
- `CampScene.openRingwallOverlay()` migrated to a sanctum-mode adapter: instantiates
  `RingManagementOverlay(scene, 'sanctum', ...)` and removes the bespoke sanctum render. The overlay
  class owns the single `SlotSwapManager`; `CampScene` receives a reference via `getSwap()`. All
  sanctum E2E hooks (`__reliquarySelect`, `__reliquaryMove`, `__campSanctumScroll`, etc.) are wired
  through the overlay's unified controller.
- `BenchHealthCombat.build()` bench filter aligned to the canonical `benchSpareCount` predicate from
  `RingManagementOverlay.ts`, eliminating divergence risk if the server schema changes.
- `BattleHandOverlay` catch blocks now call `onStatus?.()` on network errors rather than silently
  discarding them; `RingManagementOverlayOpts.onStatus` wired through the overlay class.
- `CampScene.ts` asymmetric reliquary pick-up guard replaced by `isPickupBlockedByFullBench()`
  (symmetric: spare-first pick-up order at full bench now completes the net-zero swap).

- Sanctum `[RECHARGE]` now also tops off rings resting in the Reliquary (`in_carry=0`,
  `heart_slot=0`, not escrowed), recharging them last in priority after all carried rings,
  most-depleted first. Field and Fusion `[RECHARGE]` scope is unchanged (carried rings only).
- `POST /api/spirit/recharge-all` accepts an opt-in `includeReliquary: true` body flag;
  omitting the flag preserves the existing behavior exactly.

- `package.json` `test:e2e` script now pins `--project solo --project pvp` so `npm run test:e2e` never inadvertently runs the visual capture harness.

- Field overlay panel narrows from 760 px to 560 px (right-aligned to the same right edge) now that the LOOT left column is gone
- `COLUMN_LABELS.field` updated from `['LOOT', 'BENCH', 'HEALTH', 'COMBAT']` to `['BENCH', 'HEALTH', 'COMBAT']`
- Merchant ring purchases now route through the same bench/WON overflow model as duel wins: a purchase with a full bench mints the ring as the pending WON ring (one overflow allowed); buying while a won ring is already pending is rejected before gold is deducted. The old aggregate carry-cap rejection (`Carry cap full`) is removed

- Ring management is now swap-first: clicking an occupied bench card, battle slot, or reliquary card while a ring is selected performs a capacity-free swap instead of a rejected insertion. Ghost/drop-label paths (empty slots) remain capacity-checked as before.
- Bench cards no longer dim at full bench; the SPIRIT grid no longer locks when the spare pool is full (`__reliquaryLocked` bench-full path removed). Pool insertions (drop into an empty slot or ghost) are still rejected at capacity.

- FUSE column header Y-position corrected to align with BENCH/HEALTH/COMBAT
  headers at `BENCH_GRID_TOP_Y - 20` (was `MODAL_TOP + 40`).

- `MIN_ROW` in the World Map extended from −5 (Forest only) to −8 to accommodate `snow_blizzard_peak`
  (Snow coord y=5 → render row −8); `GRID_ROWS`, `CONTENT_H`, and `FIT_SCALE` update automatically.
- Drag-pan on the World Map is now available at all zoom levels (removed the ZOOM_MIN scale gate).
- Arrow keys (←↑↓→) pan the World Map by half a grid cell per keypress.

- `[RECHARGE]` button renamed to `[RECHARGE ALL]` and repositioned to y=487 (below the
  new RECHARGE slot) to clarify that it tops off all carried rings at once.

- Boss-tier NPCs now receive a flat spirit bonus stacked on top of the base spirit
  formula, scaling with biome progression: Forest gate +15 / sub +25 / major +40;
  Snow +40/+50/+65; Swamp +65/+75/+90; Desert +90/+100/+115. Roamer NPCs are
  unaffected. This creates a structural danger gradient across the world map.

- The staked (thumb) ring no longer earns passive XP. Only the attack (a1/a2) and
  defense (d1/d2) slots gain XP, awarded from the outcome of each exchange. Thumb
  passives (setup buffs, Tailwind, Earth Precision Parry) still fire — they simply
  no longer mint XP for the staked ring. This closes an XP-economy loophole and
  aligns ring growth with active combat participation.

- Recharge gesture is now R-key (or "↻ Recharge" touch button) then a ring-card or
  slot-key press, replacing the fragile double-tap. All four combat rings recharge via
  the same two-step gesture; attack and defense rings no longer differ.
- Tap-vs-charge discrimination now uses a 150 ms deferred-threshold timer on keydown;
  `selectAttack` fires on key-up (not after a deferral window). Attacks are snappier.


- Replaced the floating blue "↻ Recharge" button in the Hand HUD with a gold
  RECHARGE slot card at `x=512, y=510` (left of the Thumb slot), matching the
  existing RECHARGE slot styling from the ring-management overlay. Gold fill
  `0x443300`/alpha `0.6`, stroke `0xffcc44` width 2, 'RECHARGE' label 11px.
  A vertical divider at `x=546` separates it from the five ring slots.
- Extracted gold RECHARGE styling constants (`RECHARGE_FILL`, `RECHARGE_ALPHA`,
  `RECHARGE_STROKE`, `RECHARGE_STROKE_WIDTH`) into `client/src/Constants.ts` so
  `Hand.ts` and `BenchHealthCombat.ts` share a single source of truth. Also adds
  `RECHARGE_SLOT_X = 512` and `RECHARGE_DIVIDER_X = 546` as named layout constants.

- Charge attack orb now swings in a constant-angular-velocity arc (−45° to +45°,
  pivoting at spawn) instead of oscillating vertically (Y-sine). The sweet spot is
  0° (aimed at the opponent). Speed steps up on each reversal (3 sweeps to max speed
  via `SWEEP_SPEEDUP = 0.75`). Sharpness tracks sweeps: 1/3 → 2/3 → 1.0.
- Hit cone is now ±10° around 0° (`HIT_CONE_DEG`), replacing the old ±20 px cone.
- `ChargeOrbStartPayload` now includes `startAngle: number` (always −45), enabling
  clients to reconstruct the arc angle at any time from a shared formula.


- `computeNpcSpirit` updated: roamer path now applies `max(spiritFloor, personalityBase)` instead of no floor; boss path keeps the additive formula. Signature unchanged — existing callers require no update.
- `BattleRoom` now applies `scaleProfileByTier` to all NPC profiles (previously only boss profiles were modified); `profileOverride` is always set.

- Rings now carry a tier-derived **force** stat that scales two things: how
  much raw damage an attack pushes, and how much a heart ring's own force
  can absorb of it. Heart loss from a landed or caught attack is now an
  uncapped integer count instead of a flat 1 heart — a high-force attacker
  can cost you more than 1 heart in a single exchange if your heart ring's
  force can't keep up, while a strong heart ring mitigates proportionally
  more.
- Earth's Neutral defense — and Neutral catches generally — are no longer
  unconditionally heart-safe. A Neutral block or parry now subtracts the
  defending ring's force from the attacker's force and only the leftover
  passes through to your hearts, so a significantly outmatched Earth (or any
  Neutral) defense can still bleed when the attacker is high enough force.
  The only outcome that stays flat-safe every time is a Strong parry, which
  triggers a rally instead.
- A weak block or parry (catching with the wrong element) now fills the
  defending ring's own gauge, reversed from the previous behavior where a
  weak catch moved no gauge at all.

- Blocking with a ring now dampens its own defense-gauge fill at `1 / force`
  (its `force` scalar, derived from tier) instead of the old `1 / 2^tier`
  exponential curve. The two formulas coincide at the lowest two tiers, so
  low-tier play is unaffected; higher-tier rings dampen their own gauge fill
  less aggressively than before (e.g. a Tier-3 defender now fills at 0.5
  instead of 0.25).

- Internal: the battle-exchange result payload's heart-loss field changed from
  a boolean (`defenderHeartLost`) to an integer count (`defenderHeartsLost`),
  preparing for force-scaled multi-heart exchanges. No gameplay behavior
  changed in this release — the count is still always 0 or 1.

- Heart loss is now force-scaled (Contract B, EPIC #511). A single exchange can cost multiple
  hearts: no-block / mistime / weak-catch lose `max(1, ceilDiv(atkForce, hpForce))`, while a
  neutral block, neutral parry, or strong block loses `max(0, ceilDiv(max(0, atkForce − defForce), hpForce))`
  — the defending ring's force is a real subtractive shield (zero credit on a weak catch), and the
  defender's heart-ring force (`hpForce`) mitigates. A large enough force gap can one-shot-KO in one
  exchange (uncapped by design). `resolveBlock` gains an `hpForce` parameter; `atkForce`/`defForce`
  are derived internally.
- Thornwood's "Heartwood" now absorbs an entire multi-heart exchange with one charge (OQ-4): a single
  charge negates the whole N-heart delta for that exchange (zero hearts lost, one charge spent), never
  one-heart-per-charge. The AI defender's `hpForce` is an interim `1` pending the AI-force wiring (#517).

- A weak block/parry now fills the defending ring's own gauge at `1/def_force` per tracked
  component — the same rate as a neutral catch — even though the catch still gives zero
  heart-mitigation credit (§7.1). Previously a weak catch moved no gauge at all; the defender
  committed the ring, so it now charges just as it would on a neutral catch. The attacker's-element
  gauge is still never filled on any catch, and the weak-catch heart-loss formula is unchanged.

- The AI/NPC defender now mitigates heart loss with a real, tier-derived `hp_force` (EPIC #511
  Contract E) instead of the #514 interim `hpForce = 1`. The AI has no HP-slot heart ring, so its
  `hp_force` is derived from the encounter's effective tier via a new indexing-normalized helper,
  `effectiveTier1Indexed(biome, personality, playerBattleHandAvgXp)`, run through the same
  `forceFromTier1` primitive the player path uses — so the AI and a player ring of matched XP
  mitigate identically, with no off-by-one.


- Ring cards now show use count as a compact fraction (`3/5`) instead of dot
  pips, plus the ring's `force` stat (`⚡2`) in the same label — e.g. `3/5 ⚡2`.
  Bounded-width at any tier, unlike the old dot display which overflowed at
  higher tiers.

- A player's spirit_max now scales with the *tier* of their Reliquary rings,
  not just how many uses those rings hold: each ring contributes
  `max_uses × force` (its tier-derived `force` scalar) instead of `max_uses`
  alone. A starter Reliquary of Tier-1 rings is unchanged, but higher-tier
  rings are worth far more — a Tier-10 ring now contributes six times what it
  did before. This raises the whole spirit economy for advanced players: a
  larger spirit gauge in vsAI battles and a bigger blink/teleport budget in the
  overworld, rewarding a Reliquary built up to high tiers. The inflation is
  intentional and uncapped.

- NPC and boss spirit pools now track the inflated Reliquary-tier spirit range
  from the previous change: because an NPC's spirit derives from the player's
  `spirit_max`, roamers keep exactly the same relative difficulty (the "several
  roamers before you must rest" pacing is unchanged), while high-biome boss
  fights that used to run *longer than the player's own spirit gauge* are pulled
  back toward their intended length. No NPC tuning constants were changed — the
  self-correction falls out of the spirit-formula change, and this was verified
  across every biome, boss tier, and difficulty rather than left to chance.

- Ring Merge (GDD §4.7) no longer imposes a minimum-XP floor on either parent
  before merging. Two same-element rings of any XP — including 0-XP
  rings — can now be merged at an unsealed shrine via `POST
  /api/rings/merge`. Merge remains purely additive (`xp = parent1.xp +
  parent2.xp`), so consolidating low-XP rings trades total ring capacity for a
  single higher-XP ring rather than granting a power gain. Fusion
  (`POST /api/fusion/combine`) is unaffected and keeps its own per-parent
  minimum-XP requirement.

### Removed

- `FusionPanel.ts` standalone overlay class retired; `CampScene.openFusionPanel()` and
  `BaseBiomeScene.openShrineFusion()` now delegate to the unified `RingManagementOverlay`.
  The BENCH / HEALTH / COMBAT right half is now identical across field, sanctum, and fusion modes.

- `tests/e2e/screenshot-overlays.spec.ts`: absorbed verbatim into `visual-capture.spec.ts`; all three overlay capture sequences are preserved under the new parameterized harness.
- Field-mode LOOT left column (WON card and DISCARD slot) removed from `RingManagementOverlayClass`; both elements now live in BenchHealthCombat and are shared across all modes


- Retired Y-sine oscillation constants (`Y_AMPLITUDE_PX`, `BASE_PERIOD_MS`,
  `PERIOD_DECAY_MS`, `HIT_CONE_PX`) from `shared/chargeConstants.ts`.
- Removed `oscillationPeriod`, `yOffset`, `isHit`, `sharpness` (Y-sine variants)
  from `shared/oscillation.ts`.

### Fixed

- Heart↔spare ring swap in the field Manage Battle Rings modal now works correctly when the spare grid is at carry capacity. Previously the server incorrectly rejected the swap with "carry cap exceeded" because the carry-cap guard counted the incoming spare before removing it, double-counting a net-zero operation.
- Spare ring cards in the field modal no longer grey out or lose the hand cursor when a heart, battle-slot, or pending won ring is held — the swap is valid and the cards now read as interactive targets.

- Battle-slot ring → heart swap at full spare grid now correctly enforces the spare cap (`+1` net change) instead of silently bypassing it.

- Canvas UI text wrapped in `crispCanvasText` (ring-card stats, the reliquary header, the SPIRIT label, counters) no longer degrades to blurry after a `setText`/`setColor` update — the crisp filter is re-applied on every re-render.
- The Reliquary (SPIRIT) grid is no longer locked out when the battle loadout is full but the bench still has room — the lock now tracks the spare-grid cap (`spare_ring_max`) instead of the aggregate carry cap. A pending WON ring no longer blocks pulling rings from the resting pool.

- Leaving the Sanctum while anchored at the Snow Fields waystone now correctly
  spawns the player in the Snow biome instead of the Forest.

- Anchorage campfire modal: ESC now properly closes the modal instead of leaving it visible while corrupting the `overlayOpen` state. The ESC keyboard handler now checks for `campfireModal?.isOpen()` before falling through to the battle-hand overlay branch, preventing the state corruption that caused the X button to fail after rest or summon actions.
- **Snow bridges walkable**: Removed `'non-empty'` collision override for `SnowScene`'s `behind` layer; bridge tiles from `ts_snow` placed in that layer now use `'property'` mode (no collision unless `collides: true` is set), so the player can cross bridges in the Snow biome.
- **Forest-to-snow bridge walkable**: Fixed `forest_snow_gate` bridge tiles (ts_snow planks in the `behind` layer) being impassable. `ForestScene` now uses `'property'` collision mode for that screen's `behind` layer; obstacle tiles (`berry_and_trees`, `terrain_plains_fantasy`) were tagged `collides: true` in the map JSON so walls/trees still block while bridge planks remain walkable.

- Bench ring clicks in the field, sanctum, and fusion ring-management overlays now
  correctly route through the swap controller — selecting a bench card shows the yellow
  selection stroke and a subsequent click on a combat slot completes the swap.
- SPIRIT ↔ battle-slot swaps no longer blocked by a spurious "Bench is full" error
  when the bench is at capacity; the guard now fires only when the actual drop target
  is the bench ('spare'), not at pick-up time.

- Campfire modal now opens correctly when pressing E at an anchorage: the
  `updateActiveZone` priority now prefers campfire zones over `sanctum_return`
  when both overlap (the 16×16 campfire zone sits inside the 64×64 sanctum_return
  rectangle, silently routing every E press to CampScene instead).
- Replaced 13 broken close-gesture E2E tests (modal was never opened due to a
  `!== null` vs `!= null` guard bug) with 6 real-input Playwright scenarios that
  verify ESC and ✕ close the campfire modal before and after REST/SUMMON actions.

- Winning a duel with a full bench (9/9) no longer deadlocks ring management: the
  pending WON ring can again be slotted into a battle slot or equipped to the Heart
  slot, draining the overflow. The redundant outer spare-grid gate on `PUT
  /api/loadout` that rejected every loadout change while the bench was over capacity
  has been removed; the delta-aware guard inside `saveLoadout` remains authoritative.
- Rejected ring moves in the field Manage Battle Rings overlay now surface a clear
  message ("Bench is full — discard a ring or move one to a battle slot first")
  instead of silently deselecting. The held ring stays selected on failure so the
  move can be retried against a different target.

- Reliquary modal (sanctum mode): SPIRIT column header is now a crisp DOM label matching
  the BENCH / HEALTH / COMBAT headers — same y=128 row, 12px font, center-anchored.
- Removed legacy canvas `BENCH  ↓` / `SPIRIT  ↓` labels that duplicated the BHC DOM
  header, causing a second header to appear just below the centered DOM label.
- Bench column header now reads `BENCH: n / max` (uppercase) to match `HEALTH` / `COMBAT`.
- Equalised Reliquary modal column gaps to 28 / 29 / 29 px: bench grid origin 370→388,
  HEALTH column 659→660; `HP_X` in the field overlay now imports `COL_HEALTH_X` so the
  HP label cannot drift from the HEALTH column again.

- SPIRIT ghost slot now refreshes immediately after a ring drop — consecutive drops
  into the Reliquary work without closing and reopening the modal. Ghost is now a
  first-class tracked cell managed by `InventoryGrid.setGhost()`, rebuilt on every
  `populate()` call at the correct next-free index (#434).

- Overworld spirit HUD now repaints after clicking [RECHARGE] in the field
  ring-management modal (#460). Previously `BattleHandOverlay.onRecharge`
  refreshed only the overlay, leaving the top-right resource HUD showing a
  stale spirit value; the overlay now accepts an `onAfterRecharge` callback
  through which `BaseBiomeScene` triggers `refreshHud()`.

- Re-staking a thumb ring in a biome after forfeiting a duel is now recognized by
  the NPC fight gate. Previously the overworld "Stake a ring to fight" prompt would
  persist even after assigning a new ring via the Tab battle-hand overlay, because
  the overlay never synced the biome-scene's loadout cache (`window.__campState`)
  after its loadout round-trip.

- Recharging a single ring via the RECHARGE slot now clears the ring selection once
  the recharge completes, in both the Sanctum Ringwall overlay and the field (Tab)
  overlay. Previously the recharged ring stayed selected, so the next click was
  interpreted as a swap target and could accidentally move the ring. A failed
  recharge still keeps the selection held so the action can be retried.

- Swapping the Heart-slot ring in the Reliquary (Sanctum) modal now works in both
  directions. Previously, picking up the Heart ring first and then clicking a
  Reliquary ring unequipped the Heart ring instead of swapping the two; players had
  to select the destination ring first. Both orders now perform the same atomic
  two-ring swap.

- A player's spirit pool (`spirit_max`) now stays correct after fusing, merging, or
  discarding a ring in the Reliquary. Previously these actions changed the rings that
  determine `spirit_max` without recomputing the stored value, so the HUD and the
  next battle could use a stale spirit pool until some unrelated action (a battle or
  difficulty change) re-synced it. The fix also clamps `spirit_current` so it can no
  longer exceed a freshly-lowered `spirit_max`.

- Thornwood Warden now correctly blocks the north exit of `forest_boss_clearing`
  (the gate to the deep forest / `forest_verdant_descent`). The boss was spawning
  near the south edge (`ty: 19`) instead of the north passage (`ty: 2`), and the
  map's `behind` layer was missing the collision wall along the north border, so
  the player could walk straight through. Added the tree-wall blocking tiles at
  rows 2–3 (cols 1–12 and 16–26), leaving the 3-tile passage at cols 13–15 that
  funnels the player through the warden's collider — mirroring the working swamp
  gate.
- Parry window now correctly compresses on charged hits: `parryWindowMs = round(PARRY_WINDOW_MS × (1 − sharpness × CHARGE_PARRY_COMPRESSION))`. The constant was previously imported but not applied.
- Server exclusively uses its own wall-clock timestamp for hold duration; absent or spoofed client `holdDuration` cannot affect hit/miss resolution.
- `chargeStartTimes` entries are cleared when a new attack begins and on turn advance, preventing stale entries from misclassifying the next turn's timing.
- Fusion charge gated on `canDoubleAttack()` eligibility; thumb use consumed correctly (matching standard combo economy).
- Client sends exactly one `releaseAttack` per release (single-message path). Sub-threshold holds send `holdDuration: 0`; server routes them through the existing tap path.

- Charge orb spawns in front of the attacker (toward the opponent) instead of behind.
- Defender-view orb spawns in front of the opponent (toward the player) instead of behind.

- Charge orb arc now opens toward the opponent instead of behind the attacker.
  Added a `facing` parameter to `Orb.spawnIdle` derived from `Math.sign(targetX − pivotX)`;
  player arc opens leftward (toward `OPPONENT_X`), opponent arc opens rightward (toward `PLAYER_X`).
  Client render only — server formula and 0° sweet-spot convention unchanged.

- Charged attacks now resolve in sync with the projectile animation. The server
  broadcasts the (charge-compressed) telegraph duration to the client via
  `state.telegraphMs`, so the orb's flight time matches the moment the server
  resolves impact. Previously a charged hit landed damage — and closed the
  block window — while the orb was still visually mid-flight, making the AI's
  charged attacks effectively unblockable and causing defenders to be hit
  before the projectile reached them.

- Charge-attack misses now send the whiff orb off-angle toward the opponent instead of
  flying behind the attacker. Player-side charge misses previously launched the orb
  off-screen in the wrong direction (a hardcoded rightward offset); the direction is now
  derived from the attacker's facing toward the opponent.

- Raise `CHARGE_THRESHOLD_MS` from 150 ms to 450 ms, eliminating the guaranteed-miss
  dead zone where holds of 150–467 ms were charged (entering the arc path) but always
  outside the hit cone (first reachable at ~467 ms), causing intended simple attacks to
  silently whiff on natural firm presses.
- The attacker's charge orb (and its gold hit-zone glow) now animate from key-down,
  matching the server's authoritative hit timing. Previously the visual lagged the
  server by the charge threshold, so the gold "in-the-cone" indicator was misleading —
  releasing on the glow could still miss. (This lag was tolerable at the old 150 ms
  threshold but would have made charged hits unlandable at 450 ms.)

- Closed an indexing mismatch in the AI's effective-tier derivation: `floorTier(biome)` is
  1-indexed (forest=1…volcano=5) while `tierForXp(xp)` is 0-indexed. The pre-existing
  `effectiveTier` mixes the two directly, which is fine for the σ / mistake-probability transfer
  functions it drives (unchanged by this fix), but would silently under-power an AI `hp_force`
  derived the same way whenever the `tierForXp` branch won. `effectiveTier1Indexed` normalizes both
  operands to 1-indexed before the `max`, closing the gap for the new AI `hp_force` wiring.

- Newly registered and reset players now start with their spirit gauge topped
  off (`spirit_current` raised to match the Reliquary-derived `spirit_max`).
  Previously the gauge was left at the schema-default `50`, under-crediting
  new and reset accounts relative to their actual spirit capacity (`60` for the
  standard starter Reliquary on seeker).

- Merged and fused rings now stay where their source rings were. Previously a ring
  created by merging (at a shrine) or fusing two carried rings would silently drop
  into the Reliquary instead of remaining in your battle hand or bench, and could
  push the Reliquary past its capacity cap. The crafted ring now inherits the carry
  location of the first parent ring.

## 2026-06-03

### Added

- Test entry for changelog compilation verification.


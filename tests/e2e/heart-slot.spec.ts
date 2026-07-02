import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// EPIC #302 (#306) — the Heart-slot restructure of the Reliquary modal. The modal
// gains a dedicated Heart card above A1, a three-part live header (Spirit | ♥ |
// Total XP/Avg Battle XP), a SPIRIT ↓ left-column label (was RELIQUARY ↓), and the
// Thumb passive moves from a permanent strip to a hover tooltip. Every assertion
// reads REAL server state (/api/me) and live Phaser scene objects — no mocks. The
// harness mirrors reliquary-modal.spec.ts: register a fresh player, seed the JWT,
// walk to the RINGWALL zone, open the overlay, and drive moves via the
// programmatic __reliquaryMove hook (no pixel hit-testing).
const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

/** Reliquary wall zone center from client/public/assets/maps/sanctum.json. */
const RINGWALL = { x: 128, y: 56 };

async function registerAndToken(): Promise<string> {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: `heart_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      password: 'pw',
    }),
  });
  return (await res.json()).token;
}

async function getMe(token: string): Promise<any> {
  const res = await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

async function putCarry(token: string, ringIds: string[]): Promise<void> {
  await fetch(`${API_URL}/api/carry`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ringIds }),
  });
}

/**
 * Seed a SPIRIT-pool ring (in_carry = 0, heart_slot = 0): a fresh player starts
 * with only the 5 battle-hand rings carried and the heart ring equipped — the
 * Reliquary is empty. Drop one battle ring back to the Reliquary so a movable
 * spirit ring exists. Returns its id.
 */
async function seedSpiritRing(token: string): Promise<string> {
  const me = await getMe(token);
  const carried = me.rings.filter((r: any) => r.in_carry === 1).map((r: any) => r.id);
  const dropped = carried[0];
  await putCarry(token, carried.slice(1)); // uncarry the first → it falls to spirit
  return dropped;
}

async function loadSanctum(page: Page): Promise<void> {
  await page.goto(URL);
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 10000 });
  await page.waitForFunction(() => (window as any).__campState !== undefined, { timeout: 10000 });
  await page.waitForFunction(() => typeof (window as any).__sanctumInteract === 'function', {
    timeout: 10000,
  });
}

/** Walk to the Reliquary wall zone, open the modal, and wait for it. */
async function openReliquary(page: Page): Promise<void> {
  await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [
    RINGWALL.x,
    RINGWALL.y,
  ]);
  await page.waitForFunction(
    () => ((window as any).__sanctumZones ?? []).includes('ringwall'),
    undefined,
    { timeout: 5000 },
  );
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__sanctumOverlayOpen === 'ringwall', {
    timeout: 5000,
  });
  await page.waitForFunction(() => typeof (window as any).__reliquaryMove === 'function', {
    timeout: 5000,
  });
}

/** Read a scene Text object's text by name (searches nested containers, 3 deep). */
async function campTextByName(page: Page, name: string): Promise<string | null> {
  return page.evaluate((n) => {
    const scene = (window as any).__scene as Phaser.Scene;
    const found = scene.children
      .getAll()
      .flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]))
      .flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]))
      .flatMap((c: any) => (c.getAll ? [c, ...c.getAll()] : [c]))
      .find((o: any) => o.name === n);
    return found ? (found as any).text ?? null : null;
  }, name);
}

// ── Scenario 1: three-part header; no Reliquary/Loadout counts ────────────────
test('heart: header is three-part (Spirit | ♥ | Total/Avg XP) with no Reliquary/Loadout counts', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const me = await getMe(token);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  const left = await campTextByName(page, 'reliquary-header-left');
  const center = await campTextByName(page, 'reliquary-header-center');
  const right = await campTextByName(page, 'reliquary-header-right');

  // Left segment: Spirit cur/max + bracketed difficulty. No Loadout/Reliquary count.
  expect(left).toContain(`Spirit: ${me.player.spirit_current} / ${me.player.spirit_max}`);
  expect(left).not.toContain('Loadout');
  expect(left).not.toContain('Reliquary');
  // Center segment: ♥ cur/max from the equipped heart ring.
  const heart = me.player.heart_ring;
  const hp = heart ? `${heart.current_uses}/${heart.max_uses}` : '0/0';
  expect(center).toBe(`♥ ${hp}`);
  // Right segment: Total XP + Avg Battle XP — neither a Reliquary nor a Loadout count.
  expect(right).toContain('Total XP:');
  expect(right).toContain('Avg Battle XP:');
  expect(right).not.toContain('Reliquary');
  expect(right).not.toContain('Loadout');

  // The single legacy combined header no longer exists.
  expect(await campTextByName(page, 'reliquary-header')).toBeNull();
  await ctx.close();
});

// ── Scenario 2: left-column label reads SPIRIT ↓ ──────────────────────────────
test('heart: the left column label reads SPIRIT (was RELIQUARY)', async ({ browser }) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // #426 — reliquary-label canvas text removed; SPIRIT header is now a DOM label.
  const spiritLabel = await page.evaluate(() => {
    for (const n of Array.from(document.querySelectorAll('.er-dom-label'))) {
      const el = n as HTMLElement;
      if (el.dataset['label'] === 'spirit-header') return el.textContent ?? null;
    }
    return null;
  });
  expect(spiritLabel).not.toBeNull();
  expect(spiritLabel).toContain('SPIRIT');
  expect(spiritLabel).not.toContain('RELIQUARY');
  await ctx.close();
});

// ── Scenario 3: four-column header (SPIRIT↓|BENCH↓|HEALTH|COMBAT), no ATK/DEF ──
// #347 — the modal moved to a four-column read. #389 — the middle column is now
// labelled BENCH (was SPARES). The HEALTH header (over the relocated Heart card)
// and the COMBAT label (was "BATTLE HAND") are present; the old ATTACK/DEFENSE
// row labels are gone.
test('heart: four column headers render and ATTACK/DEFENSE labels are gone', async ({ browser }) => {
  const token = await registerAndToken();
  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // All four column headers present, left → right.
  // #426 — SPIRIT header is now a DOM label; BENCH header was already a DOM label.
  const domLabelTexts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.er-dom-label')).map(
      (n) => (n as HTMLElement).textContent ?? '',
    ),
  );
  expect(domLabelTexts.some((t) => t.startsWith('SPIRIT:'))).toBe(true);
  // #426 — BENCH header is uppercase BENCH: (not the old SPARES).
  const benchHeaderTxt = domLabelTexts.find((t) => /^BENCH:/.test(t));
  expect(benchHeaderTxt).toBeTruthy();
  expect(benchHeaderTxt).not.toContain('SPARES');
  expect(domLabelTexts).toContain('HEALTH');
  expect(domLabelTexts).toContain('COMBAT');

  // The retired ATTACK / DEFENSE row labels no longer exist anywhere in the modal.
  expect(await campTextByName(page, 'attack-row-label')).toBeNull();
  expect(await campTextByName(page, 'defense-row-label')).toBeNull();
  await ctx.close();
});

// ── Scenario 4: Heart card exists in the HEALTH column with the ring's HP pips ─
test('heart: a Heart card renders in the HEALTH column with the equipped ring HP pips', async ({ browser }) => {
  const token = await registerAndToken();
  const me = await getMe(token);
  // A fresh player starts with a heart ring equipped (PlayerRepo seed).
  expect(me.player.heart_ring).toBeTruthy();

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // The heart card is a RingCard added to the overlay container; its pips row shows
  // the equipped ring's current/max uses + force badge. Read the heartCard.pipsText getter.
  // #511 — pips format is now fraction+force: "${current}/${max} ⚡${force}"
  const pips = await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    return scene.heartCard ? scene.heartCard.pipsText : null;
  });
  const heart = me.player.heart_ring;
  // Compute force from XP using the same logic as the shared force() helper
  // force(xp) = forceFromTier1(tierForXp(xp) + 1) = floor((tier1 + 2) / 2)
  const tierForXp = (xp: number): number => {
    if (xp < 0) return 0;
    let n = Math.floor((-1 + Math.sqrt(1 + xp / 62.5)) / 2);
    const tierStartXp = (tier: number) => 250 * tier * (tier + 1);
    while (tierStartXp(n + 1) <= xp) n++;
    while (n > 0 && tierStartXp(n) > xp) n--;
    return n;
  };
  const forceValue = Math.floor((tierForXp(heart.xp) + 1 + 2) / 2);
  const expected = `${heart.current_uses}/${heart.max_uses} ⚡${forceValue}`;
  expect(pips).toBe(expected);

  // #347 — the card x-origin is the HEALTH column origin (between SPARES and COMBAT).
  const heartX = await page.evaluate(() => (window as any).__scene.heartCard?.x);
  expect(heartX).toBe(624);
  await ctx.close();
});

// ── Scenario 5: any Reliquary ring → heart slot move works ────────────────────
test('heart: moving a Reliquary (spirit) ring into the heart slot equips it', async ({
  browser,
}) => {
  const token = await registerAndToken();
  const before = await getMe(token);
  const oldHeartId = before.player.heart_ring?.id ?? null;
  // Seed a movable SPIRIT-pool ring (a fresh player's Reliquary is empty).
  const spiritId = await seedSpiritRing(token);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(
    (id) => (window as any).__campState.atSanctum.some((r: any) => r.id === id),
    spiritId,
    { timeout: 8000 },
  );
  await openReliquary(page);

  await page.evaluate((id) => (window as any).__reliquaryMove(id, 'heart'), spiritId);
  await page.waitForFunction(
    (id) => (window as any).__campState.heart_ring?.id === id,
    spiritId,
    { timeout: 8000 },
  );

  const after = await getMe(token);
  // The new ring is the heart ring. /api/me excludes heart_slot=1 rings from the
  // `rings` array (EPIC #378) — the heart ring is surfaced exclusively via
  // player.heart_ring, which returns the full ring row including heart_slot and
  // in_carry. Assert against that object directly.
  expect(after.player.heart_ring.id).toBe(spiritId);
  // player.heart_ring is the full RingRow (SELECT r.* JOIN players) — heart_slot
  // and in_carry are available here without searching after.rings.
  expect(after.player.heart_ring.heart_slot).toBe(1);
  expect(after.player.heart_ring.in_carry).toBe(0);
  // The previous heart ring was released back to the Reliquary (heart_slot cleared,
  // appears in after.rings since it is no longer heart_slot=1).
  if (oldHeartId && oldHeartId !== spiritId) {
    const old = after.rings.find((r: any) => r.id === oldHeartId);
    expect(old.heart_slot).toBe(0);
  }
  await ctx.close();
});

// ── Scenario 6: the equipped heart ring is absent from the SPIRIT grid ────────
test('heart: the equipped heart ring does not appear in the SPIRIT grid', async ({ browser }) => {
  const token = await registerAndToken();
  const me = await getMe(token);
  expect(me.player.heart_ring).toBeTruthy();

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // atSanctum (the SPIRIT grid source) excludes the heart ring even though it rests
  // outside carry (in_carry = 0).
  const inGrid = await page.evaluate(
    (id) => (window as any).__campState.atSanctum.some((r: any) => r.id === id),
    me.player.heart_ring.id,
  );
  expect(inGrid).toBe(false);
  await ctx.close();
});

// ── Scenario 7: the ♥ header updates after a heart move ───────────────────────
test('heart: the ♥ center header updates after equipping a different ring', async ({ browser }) => {
  const token = await registerAndToken();
  // Seed a movable SPIRIT-pool ring, then equip it into the heart slot. The ♥
  // center header must re-render from the new authoritative heart ring after the
  // move (the heart-ring identity changes even if HP happens to match).
  const spiritId = await seedSpiritRing(token);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(
    (id) => (window as any).__campState.atSanctum.some((r: any) => r.id === id),
    spiritId,
    { timeout: 8000 },
  );
  await openReliquary(page);

  await page.evaluate((id) => (window as any).__reliquaryMove(id, 'heart'), spiritId);
  await page.waitForFunction(
    (id) => (window as any).__campState.heart_ring?.id === id,
    spiritId,
    { timeout: 8000 },
  );

  const after = await getMe(token);
  expect(after.player.heart_ring.id).toBe(spiritId);
  const center = await campTextByName(page, 'reliquary-header-center');
  expect(center).toBe(`♥ ${after.player.heart_ring.current_uses}/${after.player.heart_ring.max_uses}`);
  await ctx.close();
});

// ── Scenario 8b (#474): heart swap pick-up-first — heart ring held, then click Reliquary ──
//
// Covers the asymmetric heart-swap bug: picking up the Heart ring first (source='heart')
// then clicking a Reliquary ring used moveTo('reliquary') (one-way unequip), NOT the
// swap path. The fix re-seats selection on the Reliquary ring so moveTo('heart') routes
// through reliquaryMove → swapRingsMutation → atomic PUT /api/rings/swap.
//
// Parameterized alongside Scenario 5 (normal-ring-first direction) to test both directions.
for (const [label, pickUpHeartFirst] of [
  ['reliquary-ring-first (existing direction, regression guard)', false],
  ['heart swap pick-up-first (new direction, #474 fix)', true],
] as const) {
test(`heart swap: atomic two-ring swap works in both directions — ${label}`, async ({ browser }) => {
  // #474 adversarial: pick-up-heart-first previously called moveTo('reliquary')
  // (one-way unequip) instead of moveTo('heart') (atomic swap), leaving the
  // Reliquary ring untouched. The fix re-seats selection to route through swapRingsMutation.
  const token = await registerAndToken();
  const before = await getMe(token);
  const oldHeartId = before.player.heart_ring?.id ?? null;
  expect(oldHeartId, 'test requires a player with an equipped heart ring').not.toBeNull();

  // Seed a movable SPIRIT-pool ring in the Reliquary.
  const spiritId = await seedSpiritRing(token);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(
    (id) => (window as any).__campState.atSanctum.some((r: any) => r.id === id),
    spiritId,
    { timeout: 8000 },
  );
  await openReliquary(page);

  if (pickUpHeartFirst) {
    // ── Heart-ring-first path (the #474 bug path) ────────────────────────────
    // Step 1: click the Heart card to pick up the heart ring (source='heart').
    // Heart card in CampScene: HEART_CARD_X=624, HEART_CARD_Y=148 (top-left), card center +35.
    // The RingCard body renders at x+35; interactive area is the card bg centered on the card.
    // Use __reliquarySelect hook to drive selection, then assert source='heart'.
    await page.evaluate(
      (id) => (window as any).__reliquarySelect(id, 'heart'),
      oldHeartId,
    );
    await page.waitForFunction(
      () => ((window as any).__scene as any)?.swapManager?.selection?.source === 'heart',
      { timeout: 5000 },
    );
    const selAfterPickup = await page.evaluate(
      () => ((window as any).__scene as any)?.swapManager?.selection,
    );
    expect(selAfterPickup?.source, '#474: picking up the heart card must set source=heart').toBe('heart');
    expect(selAfterPickup?.ringId, '#474: selection ringId must be the heart ring id').toBe(oldHeartId);

    // Step 2: click the Reliquary ring as the swap target.
    await page.evaluate(
      (id) => (window as any).__reliquaryMove(id, 'heart'),
      spiritId,
    );
  } else {
    // ── Normal-ring-first path (existing direction — regression guard) ────────
    // Step 1: click the Reliquary ring to pick it up.
    await page.evaluate((id) => (window as any).__reliquaryMove(id, 'heart'), spiritId);
  }

  // Wait for the swap to commit (selection cleared = round-trip done).
  await page.waitForFunction(
    (id) => (window as any).__campState.heart_ring?.id === id,
    spiritId,
    { timeout: 8000 },
  );

  const after = await getMe(token);
  // The Reliquary ring is now in the Heart slot.
  expect(after.player.heart_ring.id, '#474: former Reliquary ring must now occupy the Heart slot').toBe(spiritId);
  expect(after.player.heart_ring.heart_slot, '#474: heart_slot must be 1').toBe(1);
  // The former heart ring is now in the Reliquary (heart_slot cleared, not in carry,
  // visible in after.rings since heart_slot=1 rings are excluded from that list).
  const old = after.rings.find((r: any) => r.id === oldHeartId);
  expect(old, '#474: former heart ring must appear in Reliquary (returned to after.rings)').toBeDefined();
  expect(old?.heart_slot, '#474: former heart ring must have heart_slot=0 after swap').toBe(0);

  // No selection must be held after the committed swap.
  const selAfterSwap = await page.evaluate(
    () => ((window as any).__scene as any)?.swapManager?.selection ?? null,
  );
  expect(selAfterSwap, '#474: selection must be null after swap commits').toBeNull();

  await ctx.close();
});
}

// ── Phase 2 (#474): implementation branch coverage ─────────────────────────────
//
// Two branches in CampScene.onRingClicked lines 1361–1391 that Phase 1 did not
// exercise:
//
//   A. Same-ring re-click deselect guard (line 1361) fires BEFORE the heart branch
//      at line 1371 — clicking the held heart ring on its own Heart card must
//      deselect, NOT enter the heart-swap path.
//
//   B. The else branch (line 1378): a non-heart ring is held and the user clicks the
//      Heart card (source='heart', sel.source !== 'heart'). Neither leg is
//      "sel.source === 'heart' && source !== 'heart'", so it falls into the else
//      branch → moveTo(source) = moveTo('heart'). This equips the held ring to the
//      Heart slot.

test('heart swap: clicking the held heart ring on its own Heart card deselects (does not self-swap)', async ({ browser }) => {
  // #474 impl-branch: the same-ring re-click guard (line 1361) must fire BEFORE
  // the heart-swap branch (line 1371). Previously an off-by-branch bug could allow
  // a self-to-self swap to reach the server. Assert no PUT fires and selection clears.
  const token = await registerAndToken();
  const before = await getMe(token);
  const heartId = before.player.heart_ring?.id ?? null;
  expect(heartId, 'test requires an equipped heart ring').not.toBeNull();

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // Step 1: pick up the heart ring (source='heart').
  await page.evaluate((id) => (window as any).__reliquarySelect(id, 'heart'), heartId);
  await page.waitForFunction(
    () => ((window as any).__scene as any)?.swapManager?.selection?.source === 'heart',
    { timeout: 5000 },
  );

  // Intercept any swap/loadout mutations — none must fire on the re-click.
  const mutationsFired: string[] = [];
  page.on('request', (req) => {
    if (
      (req.url().includes('/api/rings/swap') ||
        req.url().includes('/api/loadout') ||
        req.url().includes('/api/heart-slot')) &&
      ['PUT', 'POST'].includes(req.method())
    ) {
      mutationsFired.push(req.url());
    }
  });
  const mutationsBefore = mutationsFired.length;

  // Step 2: click the same heart ring again on the Heart card (source='heart').
  // This triggers the same-ring re-click guard at line 1361 → clearReliquarySelection().
  await page.evaluate((id) => (window as any).__reliquarySelect(id, 'heart'), heartId);

  await page.waitForTimeout(300);

  // Core assertion: selection is cleared, no network call fired.
  const selAfter = await page.evaluate(
    () => ((window as any).__scene as any)?.swapManager?.selection ?? null,
  );
  expect(
    selAfter,
    '#474 branch A: re-clicking the held heart ring must deselect (same-ring guard at line 1361)',
  ).toBeNull();
  expect(
    mutationsFired.length,
    '#474 branch A: no swap/loadout/heart-slot mutation must fire on same-ring re-click',
  ).toBe(mutationsBefore);

  // Server state must be unchanged — heart ring still in the Heart slot.
  const after = await getMe(token);
  expect(
    after.player.heart_ring?.id,
    '#474 branch A: heart ring must remain equipped after a self-deselect',
  ).toBe(heartId);

  await ctx.close();
});

test('heart swap: holding a bench ring and clicking the Heart card equips it to the Heart slot (else branch)', async ({ browser }) => {
  // #474 impl-branch: the else branch at line 1378 — `sel.source !== 'heart'` and
  // `source === 'heart'`. The held ring is from the SPIRIT pool (bench), and the
  // user clicks the Heart card. This must call moveTo('heart'), equipping the bench
  // ring and releasing the old heart ring to the bench's pool.
  const token = await registerAndToken();
  const before = await getMe(token);
  const oldHeartId = before.player.heart_ring?.id ?? null;
  expect(oldHeartId, 'test requires an equipped heart ring').not.toBeNull();

  // Seed a spare bench ring in the SPIRIT pool so there is something to pick up.
  const spiritId = await seedSpiritRing(token);

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await page.waitForFunction(
    (id) => (window as any).__campState?.atSanctum?.some((r: any) => r.id === id),
    spiritId,
    { timeout: 8000 },
  );
  await openReliquary(page);

  // Step 1: pick up the SPIRIT-pool ring (source='reliquary').
  await page.evaluate((id) => (window as any).__reliquarySelect(id, 'reliquary'), spiritId);
  await page.waitForFunction(
    () => ((window as any).__scene as any)?.swapManager?.selection?.source === 'reliquary',
    { timeout: 5000 },
  );

  // Step 2: move to the Heart slot — triggers the else branch → moveTo('heart').
  await page.evaluate((id) => (window as any).__reliquaryMove(id, 'heart'), spiritId);

  // Wait for the swap to commit.
  await page.waitForFunction(
    (id) => (window as any).__campState?.heart_ring?.id === id,
    spiritId,
    { timeout: 8000 },
  );

  const after = await getMe(token);
  expect(
    after.player.heart_ring?.id,
    '#474 branch B (else): SPIRIT-pool ring must now occupy the Heart slot',
  ).toBe(spiritId);
  // Old heart ring released to the ring pool (no longer heart_slot=1).
  const released = after.rings.find((r: any) => r.id === oldHeartId);
  expect(
    released,
    '#474 branch B (else): old heart ring must appear in rings after equip-swap',
  ).toBeDefined();
  expect(
    released?.heart_slot,
    '#474 branch B (else): old heart ring heart_slot must be 0 after release',
  ).toBe(0);
  // Selection cleared after the move commits.
  const selAfter = await page.evaluate(
    () => ((window as any).__scene as any)?.swapManager?.selection ?? null,
  );
  expect(selAfter, '#474 branch B (else): selection must be null after equip completes').toBeNull();

  await ctx.close();
});

// ── Scenario 8: the Thumb passive shows only on hover (tooltip, not a strip) ───
test('heart: the Thumb passive is a hover tooltip, not a permanent strip', async ({ browser }) => {
  const token = await registerAndToken();
  const me = await getMe(token);
  // A fresh player has a Thumb ring staked, so a passive exists.
  expect(me.loadout.thumb).toBeTruthy();

  const ctx = await browser.newContext();
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await openReliquary(page);

  // The legacy permanent passive strip no longer exists.
  expect(await campTextByName(page, 'staked-passive-strip')).toBeNull();

  // Before hover, no tooltip label is in the scene (depth-5000 white-on-black box).
  const tooltipBefore = await page.evaluate(() => {
    const scene = (window as any).__scene as Phaser.Scene;
    return scene.children.getAll().some((o: any) => o.depth === 5000 && o.visible && o.text);
  });
  expect(tooltipBefore).toBe(false);

  // Fire the STATUS (Thumb) card bg pointerover — the tooltip appears with the
  // passive text. #389 — the STATUS card is now an overlay-scoped RingCard in the
  // converged COMBAT cluster (scene.combatCards), replacing the retired StakePanel.
  await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    const bg = scene.combatCards.get('thumb').bg;
    bg.emit('pointerover', { x: 800, y: 200 } as any);
  });
  const tooltipText = await page.evaluate(() => {
    const scene = (window as any).__scene as Phaser.Scene;
    const lbl = scene.children
      .getAll()
      .find((o: any) => o.depth === 5000 && o.visible && o.text) as any;
    return lbl ? lbl.text : null;
  });
  expect(tooltipText).toBeTruthy();
  expect((tooltipText as string).length).toBeGreaterThan(0);

  // pointerout hides it again.
  await page.evaluate(() => {
    const scene = (window as any).__scene as any;
    scene.combatCards.get('thumb').bg.emit('pointerout');
  });
  const tooltipAfter = await page.evaluate(() => {
    const scene = (window as any).__scene as Phaser.Scene;
    return scene.children.getAll().some((o: any) => o.depth === 5000 && o.visible && o.text);
  });
  expect(tooltipAfter).toBe(false);
  await ctx.close();
});

import { test, expect } from '@playwright/test';
import { seedAuthToken, enterForestScreen } from './helpers';
import type { Page } from '@playwright/test';

/**
 * #87 Parts A/B/C — short-range blink, the §10.8 spirit teleport gate, and ambush
 * first-strike.
 *
 * Blink (Part A): double-clicking (or window.__blink(zoneName)) an interaction
 * zone within BLINK_MAX_RANGE spends spirit (server-computed, cost = ceil(distance
 * / 100)) to snap the player onto the zone + fire its interact(). The server (POST
 * /api/spirit/blink) is the authoritative spirit guard; an out-of-range gesture is
 * a no-op (no POST). Teleport (Part B): POST /api/teleport now spends the
 * destination's spiritCost and rejects when the player can't afford it. Ambush
 * (Part C): a vsAI join with firstStrike:true spends AMBUSH_SPIRIT_COST and grants
 * the joining human the opening attack — ignored (server guard) when unaffordable.
 *
 * Every assertion reads real state — window.__player, GET /api/me, the live room
 * state — never mocks.
 */

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

/** AMBUSH_SPIRIT_COST mirrored from server/src/game/constants.ts. */
const AMBUSH_SPIRIT_COST = 5;
/** BLINK_MAX_RANGE mirrored from client/src/Constants.ts. */
const BLINK_MAX_RANGE = 600;

async function loadSanctum(page: Page): Promise<void> {
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 10000 });
  await page.waitForFunction(() => typeof (window as any).__sanctumInteract === 'function', {
    timeout: 10000,
  });
}

/**
 * 8E (#107) — enter the forest_glade screen and wait for the blink hook + the Glade
 * Anchorage zone to be registered, then return its world center (the blink target).
 * Replaces the old hardcoded overworld.json glade coordinate.
 */
async function enterGladeForBlink(page: Page): Promise<{ x: number; y: number }> {
  await enterForestScreen(page, 'forest_glade');
  await page.waitForFunction(() => typeof (window as any).__blink === 'function', { timeout: 8000 });
  await page.waitForFunction(() => !!(window as any).__zoneCenters?.forest_glade, { timeout: 8000 });
  return page.evaluate(() => (window as any).__zoneCenters.forest_glade as { x: number; y: number });
}

/** GET /api/me spirit_current straight from the server. */
async function serverSpirit(page: Page): Promise<number> {
  return page.evaluate(async ([api]) => {
    const token = localStorage.getItem('er_token');
    const res = await fetch(`${api}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    return body.player.spirit_current as number;
  }, [API_URL] as const);
}

/** Drain the player's spirit to 0 via the test route. */
async function drainSpirit(page: Page): Promise<void> {
  const status = await page.evaluate(
    async ([api]) => {
      const token = localStorage.getItem('er_token');
      const res = await fetch(`${api}/api/test/drain-spirit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.status;
    },
    [API_URL] as const,
  );
  expect(status).toBe(200);
}

// ── Scenario 1: Blink onto an in-range zone spends spirit ∝ distance ──────────
test('blink: double-clicking an in-range zone snaps onto it and spends spirit', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx); // fresh player → 50 spirit
  const page = await ctx.newPage();
  await loadSanctum(page);
  const glade = await enterGladeForBlink(page);

  // Stand exactly 300px west of the Glade Anchorage: cost = ceil(300/100) = 3. The
  // west-exit dirt path is walkable floor, so the player won't drift off a wall.
  await page.evaluate(
    ([x, y]) => (window as any).__player.setPosition(x, y),
    [glade.x - 300, glade.y] as const,
  );
  const spiritBefore = await serverSpirit(page);

  const moved = await page.evaluate(() => (window as any).__blink('forest_glade'));
  expect(moved).toBe(true);

  // Player snapped to the zone center.
  await page.waitForFunction(
    ([cx, cy]) => {
      const p = (window as any).__player;
      return !!p && Math.hypot(p.x - cx, p.y - cy) <= 8;
    },
    [glade.x, glade.y] as const,
    { timeout: 5000 },
  );

  // Spirit dropped by the distance-derived cost (3). The __blink promise resolves
  // only after the server's 200, so the spend is already persisted.
  expect(await serverSpirit(page)).toBe(spiritBefore - 3);

  // interact() fired in the same gesture → forest_glade is now attuned.
  await page.waitForFunction(
    () =>
      (window as any).__waystones?.waystones?.find((w: any) => w.id === 'forest_glade')?.attuned ===
      true,
    { timeout: 5000 },
  );
  await ctx.close();
});

// ── Scenario 2: Insufficient spirit → 400, no move ────────────────────────────
test('blink: an in-range blink with no spirit is rejected and does not move the player', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  const glade = await enterGladeForBlink(page);
  await drainSpirit(page);

  const start = { x: glade.x - 300, y: glade.y };
  await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [start.x, start.y]);

  const moved = await page.evaluate(() => (window as any).__blink('forest_glade'));
  expect(moved).toBe(false);

  // Player did not move and spirit is still 0.
  const pos = await page.evaluate(() => {
    const p = (window as any).__player;
    return { x: p.x, y: p.y };
  });
  expect(Math.hypot(pos.x - start.x, pos.y - start.y)).toBeLessThanOrEqual(2);
  expect(await serverSpirit(page)).toBe(0);

  // The "Not enough spirit" feedback is visible (DOM-free scene lookup).
  const hasFeedback = await page.evaluate(() => {
    const scene = (window as any).__scene as { children: { getByName: (n: string) => any } };
    const fb = scene.children.getByName('blink-feedback');
    return !!fb && /spirit/i.test(fb.text ?? '');
  });
  expect(hasFeedback).toBe(true);
  await ctx.close();
});

// ── Scenario 3: Out-of-range blink is a no-op (no POST, no move, no spend) ─────
test('blink: a double-click beyond BLINK_MAX_RANGE is a no-op', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  const glade = await enterGladeForBlink(page);

  // A clear floor tile 621px from the Glade — beyond BLINK_MAX_RANGE (600) → no POST.
  // (glade-512x, glade-352y) is on floor with no adjacent wall, so physics won't
  // drift the player back into range before the synchronous blink distance check.
  const start = { x: glade.x - 512, y: glade.y - 352 };
  expect(Math.hypot(start.x - glade.x, start.y - glade.y)).toBeGreaterThan(BLINK_MAX_RANGE);
  await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [start.x, start.y]);
  const spiritBefore = await serverSpirit(page);

  const moved = await page.evaluate(() => (window as any).__blink('forest_glade'));
  expect(moved).toBe(false);
  // Physics will drift the player slightly between frames, so we don't assert
  // the exact position — we assert the blink didn't fire (moved===false) and
  // that no spirit was spent (server confirms no deduction).
  expect(await serverSpirit(page)).toBe(spiritBefore); // unchanged — no spend
  await ctx.close();
});

// ── Scenario 4: Long-range teleport spends spirit (§10.8, Part B) ─────────────
test('teleport: traveling to an attuned waystone spends its spiritCost', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx); // fresh player → 50 spirit
  const page = await ctx.newPage();
  await loadSanctum(page);

  // Attune forest_glade, then teleport — the server spends its spiritCost.
  const before = await serverSpirit(page);
  const result = await page.evaluate(
    async ([api]) => {
      const token = localStorage.getItem('er_token');
      await fetch(`${api}/api/waystones/attune`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ waystoneId: 'forest_glade' }),
      });
      const res = await fetch(`${api}/api/teleport`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ waystoneId: 'forest_glade' }),
      });
      return { status: res.status, body: await res.json() };
    },
    [API_URL] as const,
  );
  expect(result.status).toBe(200);
  expect(result.body.spiritCost).toBeGreaterThan(0);
  expect(await serverSpirit(page)).toBe(before - result.body.spiritCost);

  // Drain spirit, then a repeat teleport is rejected (can't afford the cost).
  await drainSpirit(page);
  const denied = await page.evaluate(
    async ([api]) => {
      const token = localStorage.getItem('er_token');
      const res = await fetch(`${api}/api/teleport`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ waystoneId: 'forest_glade' }),
      });
      return res.status;
    },
    [API_URL] as const,
  );
  expect(denied).toBe(400);
  await ctx.close();
});

// ── Scenario 5: Ambush grants the human first strike + spends AMBUSH_SPIRIT_COST ─
test('ambush: firstStrike grants the opening attack and spends AMBUSH_SPIRIT_COST', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx); // 50 spirit ≥ AMBUSH_SPIRIT_COST
  const page = await ctx.newPage();
  await loadSanctum(page);
  const before = await serverSpirit(page);

  // Join a vsAI room with firstStrike:true — the server spends the spirit and sets
  // the human (onJoin seat) as currentAttackerId (instead of the default AI seat).
  await page.evaluate(async ([api]) => {
    const token = localStorage.getItem('er_token') ?? '';
    await (window as any).connectToRoom('battle-ai', {
      vsAI: true,
      personality: 'AGGRESSIVE',
      token,
      firstStrike: true,
    });
  }, [API_URL] as const);

  await page.waitForFunction(
    () =>
      (window as any).__room?.state?.phase === 'ATTACK_SELECT' ||
      (window as any).__room?.state?.phase === 'ENDED',
    { timeout: 10000 },
  );

  const attackerIsHuman = await page.evaluate(() => {
    const room = (window as any).__room;
    return room?.state?.currentAttackerId === room?.sessionId;
  });
  expect(attackerIsHuman).toBe(true);
  expect(await serverSpirit(page)).toBe(before - AMBUSH_SPIRIT_COST);
  await ctx.close();
});

// ── Scenario 6: Ambush ignored when broke — default initiative, no spend ──────
test('ambush: firstStrike is ignored when the player cannot afford it', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await drainSpirit(page); // 0 spirit < AMBUSH_SPIRIT_COST

  await page.evaluate(async ([api]) => {
    const token = localStorage.getItem('er_token') ?? '';
    await (window as any).connectToRoom('battle-ai', {
      vsAI: true,
      personality: 'AGGRESSIVE',
      token,
      firstStrike: true,
    });
  }, [API_URL] as const);

  await page.waitForFunction(
    () =>
      (window as any).__room?.state?.phase === 'ATTACK_SELECT' ||
      (window as any).__room?.state?.phase === 'ENDED',
    { timeout: 10000 },
  );

  // The flag was ignored: the human did NOT get first strike (default = AI seat),
  // and no spirit was spent — the duel proceeds normally.
  const attackerIsHuman = await page.evaluate(() => {
    const room = (window as any).__room;
    return room?.state?.currentAttackerId === room?.sessionId;
  });
  expect(attackerIsHuman).toBe(false);
  expect(await serverSpirit(page)).toBe(0);
  await ctx.close();
});

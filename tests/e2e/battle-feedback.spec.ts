import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { seedAuthToken, campToEncounter, waitForEncounter, setupBattle, closeBattle } from './helpers';

/**
 * #313 — battle-feedback consistency.
 *
 * Part A — the duel battler must match the overworld marker on BOTH launch paths.
 *   The link between an overworld sprite and its battler is encoded only in
 *   MONSTER_OW_REGISTRY (one canonical variant per element): each row pairs an
 *   overworld `key` with a `battleKey` (= `battle-monster-${element}-${index}`).
 *   The E-key approach (handleInteract) previously omitted `battleKey`, so
 *   BattleScene.create() rolled a RANDOM per-element variant; the double-click
 *   ambush (onNpcClick) threaded it. Both paths now thread it.
 *
 * Part B — the AI's finite spirit pool is broadcast onto the AI seat
 *   (spiritCurrent/spiritMax) and rendered as ⚡ current/max on the opponent panel,
 *   gated on spiritMax > 0. PvP humans broadcast spiritMax = 0, so the readout
 *   stays hidden between players.
 *
 * Every assertion reads authoritative state (window.__room.state), the rendered
 * battler texture key off the live OpponentDuelist container, or the published
 * opponent HUD readout (window.__hudView.oppSpirit) — never pixels.
 *
 * Element enum (shared/types.ts): FIRE=0, WATER=1, EARTH=2, WIND=3, WOOD=4.
 */

const URL = 'http://localhost:8090';
const WOOD = 4;

/** Sanctum door zone center (16px grid; mirrors npc-population / sprite specs). */
const SANCTUM_DOOR = { x: 87, y: 152 };

/**
 * The canonical MONSTER_OW_REGISTRY pairing for WOOD (the family forest_anchorage
 * seeds). Mirrored here so the test owns the expected key↔battleKey relationship
 * and proves the registry is the single source of the overworld↔battler link.
 */
const WOOD_OW = { key: 'npc-ow-wood', battleKey: 'battle-monster-4-0' };

/** A forest_anchorage monster whose element (WOOD) is in its personality's thumb set. */
const FOREST_NPC_3 = { id: 'forest_npc_3', element: WOOD };

async function loadSanctum(page: Page): Promise<void> {
  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', { timeout: 10000 });
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 10000 });
  await page.waitForFunction(() => typeof (window as any).__sanctumInteract === 'function', {
    timeout: 10000,
  });
}

/** Place the live player at a point and wait for the named Sanctum zone to register. */
async function walkToZone(page: Page, p: { x: number; y: number }, zone: string): Promise<void> {
  await page.evaluate(([zx, zy]) => (window as any).__player.setPosition(zx, zy), [p.x, p.y]);
  await page.waitForFunction((z) => ((window as any).__sanctumZones ?? []).includes(z), zone, {
    timeout: 5000,
  });
}

/** Enter the Forest overworld (forest_anchorage) via the Sanctum door + NPC roster. */
async function enterOverworld(page: Page): Promise<void> {
  await walkToZone(page, SANCTUM_DOOR, 'door');
  await page.evaluate(() => (window as any).__sanctumInteract());
  await page.waitForFunction(() => (window as any).__activeScene === 'ForestScene', { timeout: 8000 });
  await page.waitForFunction(() => !!(window as any).__player, { timeout: 8000 });
  await page.waitForFunction(() => Array.isArray((window as any).__overworldNpcs), { timeout: 8000 });
}

/** Look up a published overworld NPC's world center by id. */
async function npcCenter(page: Page, id: string): Promise<{ x: number; y: number }> {
  const center = await page.evaluate((nid) => {
    const npc = ((window as any).__overworldNpcs ?? []).find((n: any) => n.id === nid);
    return npc ? { x: npc.x, y: npc.y } : null;
  }, id);
  if (!center) throw new Error(`npcCenter: ${id} not in published roster`);
  return center;
}

/** Read the overworld marker texture key for a given monster element off ForestScene. */
async function overworldMarkerKey(page: Page, owKey: string): Promise<string | null> {
  return page.evaluate((key) => {
    const scene = (window as any).__scene;
    const marker = (scene?.children?.list ?? []).find((o: any) => o?.texture?.key === key);
    return marker ? (marker.texture.key as string) : null;
  }, owKey);
}

/**
 * Read the RENDERED opponent battler texture key off the live OpponentDuelist
 * container (the monster battler Image is `battle-monster-N-M`). Walks the
 * container's child list rather than scene.children (container children are not
 * top-level display objects).
 */
async function battlerTextureKey(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const scene = (window as any).__scene;
    const panel = (scene as any)?.opponentDuelist;
    const children = panel?.list ?? [];
    const img = children.find((o: any) => typeof o?.texture?.key === 'string' && o.texture.key.startsWith('battle-monster-'));
    return img ? (img.texture.key as string) : null;
  });
}

/**
 * Wait until BattleScene has mounted (it reassigns window.__scene and owns the
 * opponentDuelist panel) and the room has reached a stable battle phase. The
 * battler texture is resolved in BattleScene.create(), so once opponentDuelist
 * exists the battler key is readable.
 */
async function waitForBattle(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      !!(window as any).__scene?.opponentDuelist &&
      ((window as any).__room?.state?.phase === 'ATTACK_SELECT' ||
        (window as any).__room?.state?.phase === 'ENDED'),
    { timeout: 12000 },
  );
}

// ── Scenario 1: E-approach battler matches the overworld marker ───────────────
test('E-key approach: duel battler matches the overworld marker (key ↔ battleKey)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  // The overworld marker for WOOD renders the registry `key`.
  expect(await overworldMarkerKey(page, WOOD_OW.key)).toBe(WOOD_OW.key);

  // Walk onto the NPC, wait for detection, then fire the real E-key dispatcher.
  const center = await npcCenter(page, FOREST_NPC_3.id);
  await page.evaluate(([x, y]) => (window as any).__player.setPosition(x, y), [center.x, center.y]);
  await page.waitForFunction((id) => (window as any).__detectedNpc?.id === id, FOREST_NPC_3.id, {
    timeout: 5000,
  });
  await page.evaluate(() => (window as any).__sanctumInteract());
  await waitForBattle(page);

  // The battler texture is the registry's battleKey — NOT a random variant.
  expect(await battlerTextureKey(page)).toBe(WOOD_OW.battleKey);
  await ctx.close();
});

// ── Scenario 2: double-click ambush battler still matches (regression) ────────
test('double-click ambush: duel battler matches the overworld marker (no regression)', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await loadSanctum(page);
  await enterOverworld(page);

  // Fire two pointerdowns within DOUBLE_CLICK_MS on the WOOD marker → onNpcClick.
  const launched = await page.evaluate((owKey) => {
    const scene = (window as any).__scene;
    const marker = (scene.children.list as any[]).find((o) => o?.texture?.key === owKey);
    if (!marker) return false;
    marker.emit('pointerdown');
    marker.emit('pointerdown');
    return true;
  }, WOOD_OW.key);
  expect(launched).toBe(true);

  await waitForBattle(page);
  expect(await battlerTextureKey(page)).toBe(WOOD_OW.battleKey);
  await ctx.close();
});

// ── Part B helpers ────────────────────────────────────────────────────────────

/** Seat auth, navigate Camp → Encounter, select a vsAI personality. Returns the page. */
async function startAIDuel(ctx: BrowserContext, personality = 'AGGRESSIVE'): Promise<Page> {
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);
  await campToEncounter(page);
  await waitForEncounter(page);
  await page.evaluate((p) => (window as any).__encounterSelect(p), personality);
  await page.waitForFunction(() => (window as any).__room !== null, { timeout: 8000 });
  await page.waitForFunction(() => (window as any).__hudView !== undefined, { timeout: 8000 });
  return page;
}

/** Read the AI seat's broadcast spirit (current / max). */
async function readAiSpirit(page: Page): Promise<{ current: number; max: number }> {
  return page.evaluate(() => {
    const ai = (window as any).__room.state.players.get('AI');
    return { current: ai.spiritCurrent as number, max: ai.spiritMax as number };
  });
}

/** Seed the AI seat's per-slot uses (target:'opponent' = the AI in a vsAI room). */
async function setAiUses(page: Page, uses: Record<string, number>): Promise<void> {
  await page.evaluate((u) => {
    (window as any).__room.send('__testSetState', { target: 'opponent', uses: u });
  }, uses);
}

/**
 * Keep the duel rolling from the human side AND keep the AI's attack rings drained,
 * so the AI's recharge policy fires repeatedly and the spirit pool is spent down.
 * Returns stop() to clear the interval. Mirrors ai-recharge-policy.driveHuman.
 */
function driveAndDrainAi(page: Page): () => void {
  const driver = setInterval(() => {
    void page.evaluate(() => {
      const room = (window as any).__room;
      if (!room || room.state.phase === 'ENDED') return;
      // Re-deplete the AI's attack rings each tick so its policy keeps recharging.
      // Keep both seats alive (top up hearts) so the duel can't end before the
      // finite AI spirit pool drains — this scenario is about spirit, not hearts.
      room.send('__testSetState', { target: 'opponent', hearts: 9, uses: { a1: 0, a2: 0 } });
      room.send('__testSetState', { target: 'self', hearts: 9 });
      if (room.state.phase === 'ATTACK_SELECT' && room.state.currentAttackerId === room.sessionId) {
        const me = room.state.players.get(room.sessionId);
        room.send('selectAttack', { slot: me.a1.isExtinguished ? 'a2' : 'a1' });
      } else if (
        room.state.phase === 'DEFEND_WINDOW' &&
        room.state.currentAttackerId !== room.sessionId
      ) {
        room.send('submitDefense', { slot: 'd1' });
      }
    });
  }, 120);
  return () => clearInterval(driver);
}

// ── Scenario 3: boss/AI spirit visible at full, decrements on recharge ────────
test('vsAI duel: opponent spirit renders ⚡N/M (N==M at start) and decrements on AI recharge', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await startAIDuel(ctx, 'AGGRESSIVE');

  // The AI seat carries a finite pool → spiritMax > 0 and current == max at start.
  await page.waitForFunction(
    () => {
      const ai = (window as any).__room?.state?.players?.get('AI');
      return ai?.spiritMax > 0 && ai?.spiritCurrent === ai?.spiritMax;
    },
    { timeout: 8000 },
  );
  const start = await readAiSpirit(page);
  expect(start.max).toBeGreaterThan(0);
  expect(start.current).toBe(start.max);

  // The opponent panel renders ⚡ current/max (read the published rendered string).
  await page.waitForFunction(
    (m) => (window as any).__hudView?.oppSpirit === `${m}/${m}`,
    start.max,
    { timeout: 8000 },
  );

  // Drive the duel + drain the AI's attack rings so it recharges and spends spirit.
  const stop = driveAndDrainAi(page);
  try {
    await page.waitForFunction(
      (startCur) => {
        const ai = (window as any).__room?.state?.players?.get('AI');
        return (
          (window as any).__room?.state?.phase !== 'ENDED' && ai?.spiritCurrent < startCur
        );
      },
      start.current,
      { timeout: 20000 },
    );
  } finally {
    stop();
  }

  const after = await readAiSpirit(page);
  expect(after.current).toBeLessThan(start.current); // decremented live
  expect(after.max).toBe(start.max); // max is constant mid-duel

  // The rendered readout reflects the post-recharge balance (max unchanged).
  await page.waitForFunction(
    (s) => (window as any).__hudView?.oppSpirit === s,
    `${after.current}/${after.max}`,
    { timeout: 5000 },
  );
  await ctx.close();
});

// ── Scenario 4: spirit-exhaustion → ⚡0/M rendered in red ──────────────────────
test('vsAI duel: opponent spirit reaching 0 renders ⚡0/M in red', async ({ browser }) => {
  const ctx = await browser.newContext();
  // AGGRESSIVE has the smallest spirit mult (0.25) → smallest pool → fastest drain.
  const page = await startAIDuel(ctx, 'AGGRESSIVE');

  await page.waitForFunction(
    () => (window as any).__room?.state?.players?.get('AI')?.spiritMax > 0,
    { timeout: 8000 },
  );
  const start = await readAiSpirit(page);

  // Repeatedly drain the AI's attack rings so every AI turn spends spirit recharging
  // until the finite pool hits 0 (or the duel ends first).
  const stop = driveAndDrainAi(page);
  try {
    await page.waitForFunction(
      () => {
        const room = (window as any).__room;
        const ai = room?.state?.players?.get('AI');
        return room?.state?.phase === 'ENDED' || ai?.spiritCurrent === 0;
      },
      { timeout: 40000 },
    );
  } finally {
    stop();
  }

  const drained = await readAiSpirit(page);
  // If the duel ended before the pool emptied, this scenario can't assert exhaustion;
  // the pool is calibrated to drain within the window, so assert it reached 0.
  expect(drained.current).toBe(0);
  expect(drained.max).toBe(start.max);

  // Rendered as ⚡0/M, and the readout text color is the depleted red (#ff4444).
  await page.waitForFunction(
    (m) => (window as any).__hudView?.oppSpirit === `0/${m}`,
    drained.max,
    { timeout: 5000 },
  );
  const color = await page.evaluate(() => {
    const panel = (window as any).__scene?.opponentDuelist;
    const spiritText = panel?.list?.find(
      (o: any) => typeof o?.text === 'string' && o.text.startsWith('⚡'),
    );
    return spiritText?.style?.color ?? null;
  });
  expect(color).toBe('#ff4444');
  await ctx.close();
});

// ── Scenario 5: PvP privacy — no opponent spirit readout between humans ───────
test('PvP duel: neither human renders an opponent spirit readout (spiritMax=0)', async ({
  browser,
}) => {
  const handles = await setupBattle(browser);
  const { p1, p2 } = handles;

  // Both seats are token humans whose spirit is mirrored onto their OWN seat only;
  // the opponent's broadcast spiritMax stays 0, so the gated readout never shows.
  for (const page of [p1, p2]) {
    const oppSpiritMax = await page.evaluate(() => {
      const room = (window as any).__room;
      const oppId = Array.from(room.state.players.keys()).find((id: any) => id !== room.sessionId);
      return (room.state.players.get(oppId as string)?.spiritMax as number) ?? -1;
    });
    expect(oppSpiritMax).toBe(0);

    // The published rendered opponent readout is undefined (panel text hidden).
    const oppSpirit = await page.evaluate(() => (window as any).__hudView?.oppSpirit);
    expect(oppSpirit).toBeUndefined();
  }

  await closeBattle(handles);
});

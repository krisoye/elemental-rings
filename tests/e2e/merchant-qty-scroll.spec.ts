/**
 * E2E spec for #193 — merchant modal: owned-qty display, ×1/×25 food buttons,
 * scrollable item list.
 */
import { test, expect } from '@playwright/test';
import { seedAuthToken, enterForestScreen } from './helpers';

const URL = 'http://localhost:8090';
const API_URL = 'http://localhost:2568';

function authJson(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function mintToken(): Promise<{ token: string }> {
  const res = await fetch(`${API_URL}/api/test/mint-token`, { method: 'POST' });
  if (!res.ok) throw new Error(`mint-token failed (${res.status})`);
  return res.json() as Promise<{ token: string }>;
}

// Scenario 1 — owned qty shown on Buy tab.
test('merchant-qty: Buy tab shows own: and have: labels', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();
  await page.goto(URL);

  // Wait for CampScene to boot.
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });

  // Navigate to forest_anchorage which has a merchant.
  await enterForestScreen(page, 'forest_anchorage');

  // Open merchant modal via API-seeded merchant zone interaction hook.
  await page.evaluate(() => {
    const game = (window as any).__game;
    const scene = game?.scene?.getScene('ForestScene');
    // Trigger the merchant modal open via the internal merchantModal singleton.
    if (scene?.merchantModal) {
      void scene.merchantModal.open();
    }
  });

  // Wait for merchant modal to open.
  await page.waitForFunction(() => (window as any).__merchantModalOpen === true, {
    timeout: 5000,
  });

  // Scan all text objects in the modal container for our labels.
  const texts = await page.evaluate(() => {
    const game = (window as any).__game;
    const scene = game?.scene?.getScene('ForestScene');
    if (!scene?.merchantModal?.container) return [];
    return scene.merchantModal.container.getAll().flatMap((obj: any) => {
      if (obj.type === 'Container') {
        return obj.getAll()
          .filter((c: any) => c.type === 'Text')
          .map((c: any) => c.text as string);
      }
      return obj.type === 'Text' ? [obj.text as string] : [];
    });
  });

  const allText = texts.join('\n');
  // Food row should have "(have:" label.
  expect(allText).toContain('have:');
  // Ring rows should have "(own:" label.
  expect(allText).toContain('own:');

  await ctx.close();
});

// Scenario 2 — ×25 food buy works.
test('merchant-qty: x25 food buy increases food_units by 25 and deducts gold', async () => {
  const { token } = await mintToken();

  const catalog = await (await fetch(`${API_URL}/api/merchant/catalog`)).json() as {
    food: { buyPrice: number };
  };
  const buyPrice = catalog.food.buyPrice;

  const meBefore = await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
  ).json() as { player: { gold: number; food_units: number } };

  const res = await fetch(`${API_URL}/api/merchant/buy`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ item: 'food', quantity: 25 }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { gold: number; food_units: number };
  expect(body.food_units).toBe(meBefore.player.food_units + 25);
  expect(body.gold).toBe(meBefore.player.gold - 25 * buyPrice);
});

// Scenario 3 — ×1 food sell works.
test('merchant-qty: x1 food sell decreases food_units by 1 and adds gold', async () => {
  const { token } = await mintToken();

  // Ensure we have food to sell.
  await fetch(`${API_URL}/api/merchant/buy`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ item: 'food', quantity: 5 }),
  });

  const catalog = await (await fetch(`${API_URL}/api/merchant/catalog`)).json() as {
    food: { sellPrice: number };
  };
  const sellPrice = catalog.food.sellPrice;

  const meBefore = await (
    await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
  ).json() as { player: { gold: number; food_units: number } };

  const res = await fetch(`${API_URL}/api/merchant/sell`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ item: 'food', quantity: 1 }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { gold: number; food_units: number };
  expect(body.food_units).toBe(meBefore.player.food_units - 1);
  expect(body.gold).toBe(meBefore.player.gold + sellPrice);
});

// Scenario 4 — Sell tab scroll: assert modal does not truncate rings.
test('merchant-qty: sell tab does not truncate rings beyond visible area', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedAuthToken(ctx);
  const page = await ctx.newPage();

  // Seed > 8 rings via API.
  const token = await page.evaluate(() => localStorage.getItem('er_token'));
  if (token) {
    // Buy 9 fire rings so the sell tab list exceeds 8 rows.
    for (let i = 0; i < 9; i++) {
      await fetch(`${API_URL}/api/merchant/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ item: 'ring', element: 'fire', tier: 1 }),
      });
    }
  }

  await page.goto(URL);
  await page.waitForFunction(() => (window as any).__activeScene === 'CampScene', {
    timeout: 10000,
  });
  await enterForestScreen(page, 'forest_anchorage');

  // Open merchant modal and switch to sell tab.
  await page.evaluate(() => {
    const game = (window as any).__game;
    const scene = game?.scene?.getScene('ForestScene');
    if (scene?.merchantModal) {
      void scene.merchantModal.open().then(() => {
        // Switch to sell tab after open.
        scene.merchantModal.switchTab?.('sell');
      });
    }
  });

  await page.waitForFunction(() => (window as any).__merchantModalOpen === true, {
    timeout: 5000,
  });

  // The modal should be open and ring count should match inventory (no silent cap).
  const ringCount = await page.evaluate(() => {
    const game = (window as any).__game;
    const scene = game?.scene?.getScene('ForestScene');
    if (!scene?.merchantModal) return 0;
    const allRings: any[] = scene.merchantModal.allRings ?? [];
    const loadout: Record<string, string | null> = scene.merchantModal.loadout ?? {};
    const slottedIds = new Set(Object.values(loadout).filter(Boolean));
    return allRings.filter((r: any) => r.element <= 4 && !slottedIds.has(r.id)).length;
  });

  // There should be > 8 rings available and modal must be open (not crashed or truncated).
  expect(ringCount).toBeGreaterThan(8);
  expect(await page.evaluate(() => (window as any).__merchantModalOpen)).toBe(true);

  await ctx.close();
});

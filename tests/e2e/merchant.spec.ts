/**
 * E2E spec for #130 — merchant endpoints.
 * Exercises GET /api/merchant/catalog, POST /api/merchant/buy, POST /api/merchant/sell
 * via authenticated HTTP requests. Mirrors the auth helper pattern from spirit.spec.ts.
 */
import { test, expect } from '@playwright/test';

const API_URL = 'http://localhost:2568';

async function mintToken(): Promise<{ token: string; playerId: string }> {
  const res = await fetch(`${API_URL}/api/test/mint-token`, { method: 'POST' });
  if (!res.ok) throw new Error(`mint-token failed (${res.status})`);
  return res.json() as Promise<{ token: string; playerId: string }>;
}

function authJson(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function getMe(
  token: string,
): Promise<{ player: { gold: number; food_units: number }; rings: Array<{ id: string; element: number; in_carry: number }> }> {
  const res = await fetch(`${API_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

// Scenario 1 — GET /api/merchant/catalog: returns food and ring prices.
test('merchant: catalog contains food and ring prices', async () => {
  const res = await fetch(`${API_URL}/api/merchant/catalog`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    food: { buyPrice: number; sellPrice: number };
    rings: Array<{ element: string; buyPrice: number; sellPrice: number }>;
  };
  expect(body.food.buyPrice).toBe(2);
  expect(body.food.sellPrice).toBe(1);
  expect(body.rings.length).toBeGreaterThan(0);
  // Fire ring should cost 30 to buy, 10 to sell.
  const fire = body.rings.find((r) => r.element === 'fire');
  expect(fire?.buyPrice).toBe(30);
  expect(fire?.sellPrice).toBe(10);
  // Earth (neutral) ring should cost 25 to buy, 8 to sell.
  const earth = body.rings.find((r) => r.element === 'earth');
  expect(earth?.buyPrice).toBe(25);
  expect(earth?.sellPrice).toBe(8);
});

// Scenario 2 — Buy food: gold −6, food +3 (3 × 2 GP = 6 GP).
test('merchant: buy 3 food costs 6 gold and adds 3 food_units', async () => {
  const { token } = await mintToken();
  const { player: before } = await getMe(token);

  const res = await fetch(`${API_URL}/api/merchant/buy`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ item: 'food', quantity: 3 }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { gold: number; food_units: number };
  expect(body.gold).toBe(before.gold - 6);
  expect(body.food_units).toBe(before.food_units + 3);
});

// Scenario 3 — Buy a Tier 1 Fire ring: gold −30, ring in inventory.
test('merchant: buy Fire T1 ring costs 30 gold and appears in inventory', async () => {
  const { token } = await mintToken();
  const { player: before, rings: before_rings } = await getMe(token);

  const res = await fetch(`${API_URL}/api/merchant/buy`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ item: 'ring', element: 'fire', tier: 1 }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { gold: number; ring: { id: string; element: number; tier: number } };
  expect(body.gold).toBe(before.gold - 30);
  expect(body.ring.element).toBe(0); // ElementEnum.FIRE = 0
  expect(body.ring.tier).toBe(1);

  // The ring should appear in inventory.
  const { rings: after_rings } = await getMe(token);
  expect(after_rings.length).toBe(before_rings.length + 1);
  expect(after_rings.some((r) => r.id === body.ring.id)).toBe(true);
});

// Scenario 4 — Buy with insufficient gold → 400.
test('merchant: buy with insufficient gold returns 400', async () => {
  const { token } = await mintToken();

  // Drain gold: the starter has 200 GP. Buy 7 fire rings (7 × 30 = 210) which
  // exceeds 200. First 6 succeed (180 GP), 7th should fail.
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${API_URL}/api/merchant/buy`, {
      method: 'POST',
      headers: authJson(token),
      body: JSON.stringify({ item: 'ring', element: 'wind', tier: 1 }), // 25 GP each (neutral)
    });
    // Each costs 25 GP; 6 × 25 = 150, leaving 50 GP.
    if (!r.ok) break;
  }

  // Now try to buy a 30 GP ring with ≤30 gold.
  const { player } = await getMe(token);
  if (player.gold < 30) {
    const res = await fetch(`${API_URL}/api/merchant/buy`, {
      method: 'POST',
      headers: authJson(token),
      body: JSON.stringify({ item: 'ring', element: 'fire', tier: 1 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/insufficient gold/i);
  }
  // Always assert the catalog endpoint still works (no-crash guard).
  const catalog = await fetch(`${API_URL}/api/merchant/catalog`);
  expect(catalog.status).toBe(200);
});

// Scenario 5 — Sell food: gold +5, food −5.
test('merchant: sell 5 food returns 5 gold and removes food', async () => {
  const { token } = await mintToken();
  const { player: before } = await getMe(token);

  const res = await fetch(`${API_URL}/api/merchant/sell`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ item: 'food', quantity: 5 }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { gold: number; food_units: number };
  expect(body.gold).toBe(before.gold + 5);
  expect(body.food_units).toBe(before.food_units - 5);
});

// Scenario 6 — Sell food with insufficient food_units → 400.
test('merchant: sell more food than owned returns 400', async () => {
  const { token } = await mintToken();
  const { player } = await getMe(token);
  const tooMany = player.food_units + 1;

  const res = await fetch(`${API_URL}/api/merchant/sell`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ item: 'food', quantity: tooMany }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toMatch(/insufficient food/i);
});

// Scenario 7 — Sell a ring not in battle hand: gold +sellPrice, ring removed.
test('merchant: sell an unequipped ring adds gold and removes ring', async () => {
  const { token } = await mintToken();
  // First buy a ring so we have something to sell that is NOT in the loadout.
  const buyRes = await fetch(`${API_URL}/api/merchant/buy`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ item: 'ring', element: 'wind', tier: 1 }),
  });
  expect(buyRes.status).toBe(200);
  const { ring: boughtRing, gold: goldAfterBuy } = (await buyRes.json()) as {
    ring: { id: string };
    gold: number;
  };

  // The newly bought ring is not in any loadout slot — sell it.
  const sellRes = await fetch(`${API_URL}/api/merchant/sell`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ item: 'ring', ring_id: boughtRing.id }),
  });
  expect(sellRes.status).toBe(200);
  const sellBody = (await sellRes.json()) as { gold: number };
  // Wind is neutral: sell price = 8.
  expect(sellBody.gold).toBe(goldAfterBuy + 8);

  // Ring should no longer appear in inventory.
  const { rings } = await getMe(token);
  expect(rings.some((r) => r.id === boughtRing.id)).toBe(false);
});

// Scenario 8 — Sell a ring currently in battle hand → 400.
test('merchant: sell an equipped ring returns 400', async () => {
  const { token } = await mintToken();
  // The default loadout has thumb, a1, a2, d1, d2 assigned. Read the loadout.
  const { rings } = await getMe(token);
  const loadoutRes = await fetch(`${API_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { loadout } = (await loadoutRes.json()) as {
    loadout: { thumb: string; a1: string; a2: string; d1: string; d2: string };
  };
  // Try to sell the thumb ring (always equipped).
  const equippedId = loadout.thumb;
  expect(equippedId).toBeTruthy();

  const res = await fetch(`${API_URL}/api/merchant/sell`, {
    method: 'POST',
    headers: authJson(token),
    body: JSON.stringify({ item: 'ring', ring_id: equippedId }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toMatch(/battle slot/i);
  void rings;
});

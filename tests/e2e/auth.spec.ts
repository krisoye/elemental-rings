import { test, expect, type Page } from '@playwright/test';

// Usernames are UNIQUE in the SQLite store and persist across runs, so every
// registration must use a fresh handle. This generator guarantees uniqueness
// within and across test runs.
function uniqueUsername(): string {
  return `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

const PASSWORD = 'pw_correct_horse';

/** Wait until LoginScene is the active Phaser scene. */
async function waitForLoginScene(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__game?.scene?.isActive('LoginScene'), {
    timeout: 8000,
  });
}

/** Wait until CampScene is the active Phaser scene (post-auth target). */
async function waitForCampScene(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__game?.scene?.isActive('CampScene'), {
    timeout: 8000,
  });
}

/** Fill the login form's username + password inputs. */
async function fillCredentials(page: Page, username: string, password: string): Promise<void> {
  await page.fill('#er-username', username);
  await page.fill('#er-password', password);
}

test('scenario 1: register a new user routes to CampScene with a stored token', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/');
  await waitForLoginScene(page);

  const username = uniqueUsername();
  await fillCredentials(page, username, PASSWORD);

  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/auth/register') && r.status() === 201,
    ),
    page.click('#er-register-btn'),
  ]);
  expect(resp.status()).toBe(201);

  await waitForCampScene(page);
  const token = await page.evaluate(() => localStorage.getItem('er_token'));
  expect(typeof token).toBe('string');
  expect(token!.length).toBeGreaterThan(0);

  await ctx.close();
});

test('scenario 2: an existing user can log in', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/');
  await waitForLoginScene(page);

  // Register first via the form, then clear the token and return to LoginScene.
  const username = uniqueUsername();
  await fillCredentials(page, username, PASSWORD);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/register') && r.status() === 201),
    page.click('#er-register-btn'),
  ]);
  await waitForCampScene(page);

  await page.evaluate(() => localStorage.removeItem('er_token'));
  await page.reload();
  await waitForLoginScene(page);

  // Now log in with the same credentials.
  await fillCredentials(page, username, PASSWORD);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/login') && r.status() === 200),
    page.click('#er-login-btn'),
  ]);
  expect(resp.status()).toBe(200);

  await waitForCampScene(page);

  await ctx.close();
});

test('scenario 3: a wrong password is rejected and stays on LoginScene', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/');
  await waitForLoginScene(page);

  // Register a user, then clear the token and reload back to LoginScene.
  const username = uniqueUsername();
  await fillCredentials(page, username, PASSWORD);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/register') && r.status() === 201),
    page.click('#er-register-btn'),
  ]);
  await waitForCampScene(page);

  await page.evaluate(() => localStorage.removeItem('er_token'));
  await page.reload();
  await waitForLoginScene(page);

  // Attempt login with a WRONG password → expect a 401.
  await fillCredentials(page, username, 'wrong_password');
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/login')),
    page.click('#er-login-btn'),
  ]);
  expect(resp.status()).toBe(401);

  // The in-scene error text should be visible, and we should still be on
  // LoginScene (CampScene must NOT be active).
  await page.waitForFunction(
    () => {
      const game = (window as any).__game;
      const scene = game?.scene?.getScene?.('LoginScene');
      const errObj = scene?.children?.getByName?.('er-error');
      return !!errObj && typeof errObj.text === 'string' && errObj.text.length > 0;
    },
    { timeout: 5000 },
  );
  const campActive = await page.evaluate(
    () => (window as any).__game?.scene?.isActive('CampScene'),
  );
  const loginActive = await page.evaluate(
    () => (window as any).__game?.scene?.isActive('LoginScene'),
  );
  expect(campActive).toBeFalsy();
  expect(loginActive).toBeTruthy();

  await ctx.close();
});

test('scenario 4: a stored token persists across a page refresh', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/');
  await waitForLoginScene(page);

  const username = uniqueUsername();
  await fillCredentials(page, username, PASSWORD);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/register') && r.status() === 201),
    page.click('#er-register-btn'),
  ]);
  await waitForCampScene(page);

  // Reload: BootScene should see the token and route straight to CampScene.
  await page.reload();
  await waitForCampScene(page);
  const loginActive = await page.evaluate(
    () => (window as any).__game?.scene?.isActive('LoginScene'),
  );
  expect(loginActive).toBeFalsy();

  await ctx.close();
});

test('scenario 5: no token routes to LoginScene', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/');
  // Fresh context has no token; ensure it and reload.
  await page.evaluate(() => localStorage.removeItem('er_token'));
  await page.reload();

  await waitForLoginScene(page);
  const campActive = await page.evaluate(
    () => (window as any).__game?.scene?.isActive('CampScene'),
  );
  expect(campActive).toBeFalsy();

  await ctx.close();
});

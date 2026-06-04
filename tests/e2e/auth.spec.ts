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

// ── #382 Phase 2: LoginScene.ts addDomLabel site ─────────────────────────────
//
// LoginScene is the ONE file in the sweep that uses addDomLabel (the title
// "ELEMENTAL RINGS"). All other scene-level non-Container non-occluded text sites
// are either already DOM labels (from #361/363) or were converted to crispCanvasText.
// The implementation-specific tests below verify:
//   1. The [data-label="login-title"] DOM node exists with correct text while
//      LoginScene is active.
//   2. The node carries .er-dom-label (the contract class).
//   3. After the scene transitions to CampScene (shutdown fires), the DOM node
//      is removed (shutdown handler calls this.titleLabel?.destroy()).

// #382 impl: LoginScene.ts line 37 uses addDomLabel with id:'login-title'.
// The DOM node must appear with the exact string 'ELEMENTAL RINGS' while on
// the login screen. If the wrong text arg or wrong id was used, this fails.
test('#382 LoginScene: [data-label="login-title"] exists with text "ELEMENTAL RINGS" on login screen', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Start without a token so BootScene routes to LoginScene.
  await page.evaluate(() => localStorage.removeItem('er_token'));
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__game?.scene?.isActive('LoginScene'), {
    timeout: 8000,
  });

  // Wait for the DOM label to appear (it is created in create(), which runs after
  // the scene becomes active).
  await page.waitForFunction(
    () => !!document.querySelector('[data-label="login-title"]'),
    { timeout: 5000 },
  );

  const { text, hasClass } = await page.evaluate(() => {
    const node = document.querySelector('[data-label="login-title"]') as HTMLElement | null;
    if (!node) return { text: null, hasClass: false };
    return {
      text: node.textContent?.trim() ?? null,
      hasClass: node.classList.contains('er-dom-label'),
    };
  });

  expect(
    text,
    '#382: LoginScene title DOM label must have textContent "ELEMENTAL RINGS" — addDomLabel text arg must not be mutated',
  ).toBe('ELEMENTAL RINGS');
  expect(
    hasClass,
    '#382: LoginScene title DOM label must carry the .er-dom-label class (DOM_LABEL_CLASS)',
  ).toBe(true);

  await ctx.close();
});

// #382 impl: LoginScene.ts line 62 registers a shutdown listener that calls
// this.titleLabel?.destroy(). If that listener is missing or the call is wrong,
// the DOM node persists after LoginScene shuts down and overlaps CampScene content.
test('#382 LoginScene: [data-label="login-title"] DOM node is removed after transition to CampScene', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Navigate to LoginScene (no token).
  await page.evaluate(() => localStorage.removeItem('er_token'));
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__game?.scene?.isActive('LoginScene'), {
    timeout: 8000,
  });
  await page.waitForFunction(
    () => !!document.querySelector('[data-label="login-title"]'),
    { timeout: 5000 },
  );

  // Register + login with a fresh user to trigger the LoginScene → CampScene transition.
  const username = `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await page.fill('#er-username', username);
  await page.fill('#er-password', 'pw_correct_horse');
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/register') && r.status() === 201),
    page.click('#er-register-btn'),
  ]);

  // Wait for CampScene to become active (LoginScene has shut down).
  await page.waitForFunction(() => (window as any).__game?.scene?.isActive('CampScene'), {
    timeout: 10000,
  });

  // #382 impl adversarial: the shutdown handler must have called destroy() on the
  // title label. If it did not, the DOM node persists in #game-container after
  // the scene transition — the old "ELEMENTAL RINGS" title sits over the camp UI.
  const loginTitleStillPresent = await page.evaluate(
    () => !!document.querySelector('[data-label="login-title"]'),
  );
  expect(
    loginTitleStillPresent,
    '#382: [data-label="login-title"] DOM node must be removed after LoginScene shuts down (shutdown handler must call titleLabel.destroy())',
  ).toBe(false);

  await ctx.close();
});

// #382 impl: LoginScene.ts line 48 wraps errorText in crispCanvasText. The error
// text object must still accept setText() at runtime — crispCanvasText returns
// the same Phaser.Text instance, so the setText() call on the wrapper is
// equivalent to calling it on the original. This guards against a regression
// where crispCanvasText returns a different object and the setText call silently
// goes to a stale reference.
test('#382 LoginScene: crispCanvasText errorText still updates via setText on wrong-password', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.evaluate(() => localStorage.removeItem('er_token'));
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__game?.scene?.isActive('LoginScene'), {
    timeout: 8000,
  });

  // Register a user, then come back and use a wrong password to trigger errorText.setText().
  const username = `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await page.fill('#er-username', username);
  await page.fill('#er-password', 'pw_correct_horse');
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/register') && r.status() === 201),
    page.click('#er-register-btn'),
  ]);
  await page.waitForFunction(() => (window as any).__game?.scene?.isActive('CampScene'), {
    timeout: 10000,
  });
  await page.evaluate(() => localStorage.removeItem('er_token'));
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene?.isActive('LoginScene'), {
    timeout: 8000,
  });

  // Attempt login with wrong password — this calls errorText.setText(msg) via the
  // crispCanvasText-wrapped reference.
  await page.fill('#er-username', username);
  await page.fill('#er-password', 'wrong_password');
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/login')),
    page.click('#er-login-btn'),
  ]);

  // #382 impl: the crispCanvasText wrapper must not break the setText() chain.
  // The error text must be non-empty after a failed login (setText was called).
  await page.waitForFunction(
    () => {
      const scene = (window as any).__game?.scene?.getScene?.('LoginScene') as any;
      const errObj = scene?.children?.getByName?.('er-error');
      return !!errObj && typeof errObj.text === 'string' && errObj.text.length > 0;
    },
    { timeout: 5000 },
  );

  const errorText = await page.evaluate(() => {
    const scene = (window as any).__game?.scene?.getScene?.('LoginScene') as any;
    return scene?.children?.getByName?.('er-error')?.text ?? null;
  });

  expect(
    errorText,
    '#382: crispCanvasText-wrapped errorText must accept setText() — the wrapper must return the same Phaser.Text instance',
  ).toBeTruthy();
  expect(
    errorText!.length,
    '#382: errorText must be non-empty after a failed login (setText called by submit())',
  ).toBeGreaterThan(0);

  await ctx.close();
});

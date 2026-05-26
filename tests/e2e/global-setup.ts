import { chromium } from '@playwright/test';

// Port 8090 = the Playwright client webServer (avoids prod's 8080).
const CLIENT_URL = 'http://localhost:8090';

/**
 * Pre-warm the Vite/Phaser pipeline once before the suite runs (#66). Playwright
 * starts the webServer stack before globalSetup, so the page loads here; the
 * first real page load in a worker would otherwise pay Vite's cold dependency
 * pre-bundle + Phaser boot cost, adding seconds to whichever test ran first.
 * Warming the bundle once amortizes that across the whole parallel run.
 *
 * Resilient by design: a warmup FAILURE must never fail the suite. We always
 * close the browser (finally) and swallow any error — the worst case is the
 * first test pays the cold cost it would have paid anyway.
 */
export default async function globalSetup(): Promise<void> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(CLIENT_URL);
    // __game is published by main.ts once the Phaser game is constructed, which
    // is the signal that the bundle has compiled and the client is interactive.
    await page.waitForFunction(() => !!(window as any).__game, undefined, { timeout: 20000 });
  } catch (err) {
    // Non-fatal: log and continue so a transient warmup hiccup never blocks tests.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[global-setup] warmup skipped (non-fatal): ${msg}`);
  } finally {
    if (browser) await browser.close();
  }
}

import type { Page } from '@playwright/test';

/**
 * #212 — leave the ENDED BattleScene via the persistent end-of-battle modal.
 *
 * The modal replaced the old 2s auto-route timer: on ENDED the BattleScene now
 * shows a modal that NEVER auto-dismisses, so a test that drove a duel to ENDED
 * must explicitly choose where to go. These helpers wait for the modal then fire
 * the same handler a button click would, using the stable window hooks
 * (__battleEndModalOpen / __battleEndChoice). They do NOT weaken any assertion —
 * they only make the previously-implicit auto-return explicit.
 */

/** Wait for the end-of-battle modal to appear (BattleScene reached ENDED). */
async function waitForEndModal(page: Page, timeout = 8000): Promise<void> {
  await page.waitForFunction(
    () => (window as any).__battleEndModalOpen === true && typeof (window as any).__battleEndChoice === 'function',
    { timeout },
  );
}

/**
 * Choose [Return to Overworld]: route to the same destination the auto-return
 * used (biome scene or EncounterScene hub) WITHOUT opening the battle-hand overlay.
 * Equivalent to the old implicit auto-return for tests that only need the duel to
 * end and the post-battle scene to load.
 */
export async function returnFromBattle(page: Page, timeout = 8000): Promise<void> {
  await waitForEndModal(page, timeout);
  await page.evaluate(() => (window as any).__battleEndChoice('overworld'));
}

/**
 * Choose [Manage Battle Hand]: route to the same destination WITH the
 * Manage Battle-Hand overlay open (window.__battleHandOpen becomes true).
 */
export async function manageHandFromBattle(page: Page, timeout = 8000): Promise<void> {
  await waitForEndModal(page, timeout);
  await page.evaluate(() => (window as any).__battleEndChoice('managehand'));
}

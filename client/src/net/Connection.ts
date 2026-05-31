import { Client, Room } from '@colyseus/sdk';
import type { BattleRoomOptions, BattleSummaryPayload } from '../../../shared/types';

declare const __SERVER_URL__: string;

// Use the build-time override when set (Playwright passes ws://localhost:2568);
// otherwise derive the server from the page's own hostname so any LAN machine
// loading the page from the host IP connects back to the right server.
const SERVER_URL = __SERVER_URL__ || `ws://${window.location.hostname}:2567`;

/**
 * Join (or create) a Colyseus room by name. A fresh `Client` is created per call
 * (no module-level cache) so distinct scenes / room names never share a socket.
 * The joined room is published on `window.__room` so the BattleScene and the E2E
 * harness can reach the authoritative server state and message senders.
 *
 * @param roomName 'battle' for PvP, 'battle-ai' for a vsAI duel.
 * @param opts     room-create options (e.g. { vsAI, personality } for AI rooms).
 */
export async function connectToRoom(
  roomName: string,
  opts?: BattleRoomOptions,
): Promise<Room<any>> {
  const client = new Client(SERVER_URL);
  const room = await client.joinOrCreate<any>(roomName, opts);
  window.__room = room;
  // #212 — clear any won-ring stash from a prior duel so the end-of-battle modal
  // never names a ring won in an earlier battle (er_pending_ring is independently
  // cleared by the carry prompt on consumption).
  window.__lastWonRing = null;

  // Capture a won ring at the connection level rather than in BattleScene: a
  // duel can end (e.g. an instant forfeit) before BattleScene mounts, so the
  // listener must live for the room's whole lifetime. The server is
  // authoritative — it decides the ring id; we only stash it for CampScene's
  // post-battle prompt (#40).
  room.onMessage('wonRing', (payload: { ringId?: string; element?: number }) => {
    if (payload?.ringId) {
      localStorage.setItem('er_pending_ring', payload.ringId);
      // #212 — keep the element alongside the id so the end-of-battle modal can
      // name the won ring ("Won: FIRE Ring"). The er_pending_ring key (carry
      // prompt) is unchanged; this is an additive read-only stash.
      window.__lastWonRing = { ringId: payload.ringId, element: payload.element ?? 0 };
    }
  });

  // Capture the post-battle reward summary (#78 ②) at the connection level for
  // the same reason as wonRing: the server sends it after the ENDED patch, and a
  // duel can end before/around BattleScene's listener registration. Stashing it
  // on the window lets the E2E harness read it regardless of timing. BattleScene
  // registers its own handler too, to render the lines while the banner shows.
  room.onMessage('battleSummary', (payload: BattleSummaryPayload) => {
    window.__lastBattleSummary = payload;
  });

  return room;
}

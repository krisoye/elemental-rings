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

  // Capture a won ring at the connection level rather than in BattleScene: a
  // duel can end (e.g. an instant forfeit) before BattleScene mounts, so the
  // listener must live for the room's whole lifetime. The server is
  // authoritative — it decides the ring id; we only stash it for CampScene's
  // post-battle prompt (#40).
  room.onMessage('wonRing', (payload: { ringId?: string }) => {
    if (payload?.ringId) localStorage.setItem('er_pending_ring', payload.ringId);
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

import { Client, Room } from '@colyseus/sdk';
import type { BattleRoomOptions } from '../../../shared/types';

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
  return room;
}

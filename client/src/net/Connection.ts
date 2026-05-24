import { Client, Room } from '@colyseus/sdk';

declare const __SERVER_URL__: string;

let room: Room<any> | null = null;

/**
 * Join (or create) the single `battle` room. Idempotent: repeated calls return
 * the already-established room instead of opening a second connection. The room
 * is also published on `window.__room` so the BattleScene and E2E harness can
 * reach the authoritative server state and message senders.
 */
export async function joinOrCreate(): Promise<Room<any>> {
  if (room) return room;
  const client = new Client(__SERVER_URL__);
  room = await client.joinOrCreate('battle');
  (window as any).__room = room;
  return room;
}

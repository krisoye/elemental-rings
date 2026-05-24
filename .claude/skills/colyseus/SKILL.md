---
name: colyseus
description: "Use this skill when implementing Colyseus 0.17 game server features. Covers Room lifecycle, @Schema state, ArraySchema/MapSchema, onMessage handlers, client connection, and Playwright-based integration testing without a UI client."
---

# Colyseus 0.17 — Authoritative Game Server

> Colyseus is a multiplayer game server framework for Node.js. A `Room` owns authoritative state, exposes WebSocket message handlers, and broadcasts schema diffs to all connected clients. Version 0.17 is the current stable release.

**Docs:** https://docs.colyseus.io  
**Package:** `colyseus@0.17` (server) + `colyseus.js@0.17` (browser client)  
**Schema:** `@colyseus/schema@4.x`

---

## Quick Start

```typescript
// server/index.ts
import { createServer } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { BattleRoom } from './src/rooms/BattleRoom';

const port = Number(process.env.PORT || 2567);
const server = createServer({
  transport: new WebSocketTransport()
});
server.define('battle', BattleRoom);
server.listen(port).then(() => console.log(`Colyseus listening on ${port}`));
```

---

## @Schema — State broadcast to clients

Every field you want clients to receive must be annotated with `@type()`. Unannotated fields are server-private.

```typescript
import { Schema, type, ArraySchema, MapSchema } from '@colyseus/schema';

// Primitive types: 'string', 'number', 'boolean',
//   'int8','uint8','int16','uint16','int32','uint32','int64','uint64','float32','float64'
// Use the smallest type that fits: uint8 for 0-255, int8 for -128-127

export class Ring extends Schema {
  @type('uint8') element: number = 0;       // ElementEnum (0-4)
  @type('uint8') currentUses: number = 3;
  @type('uint8') maxUses: number = 3;
  @type('boolean') isExtinguished: boolean = false;
}

export class PlayerState extends Schema {
  @type('string')  playerId: string = '';
  @type('uint8')   hearts: number = 3;
  @type([Ring])    hand = new ArraySchema<Ring>();  // Array of nested @Schema
  @type('int8')    selectedSlot: number = -1;       // -1 = none
}

export class BattleState extends Schema {
  @type('string')              phase: string = 'WAITING';
  @type('string')              currentAttackerId: string = '';
  @type('int8')                attackerSelectedSlot: number = -1;
  @type('int8')                defenderSelectedSlot: number = -1;
  @type('uint8')               volleyedElement: number = 0;
  @type('boolean')             rallyActive: boolean = false;
  @type('string')              winnerId: string = '';
  @type({ map: PlayerState })  players = new MapSchema<PlayerState>();
}
```

**ArraySchema** — ordered list of nested schemas:
```typescript
@type([Ring]) hand = new ArraySchema<Ring>();
hand.push(new Ring());   // add
hand.splice(i, 1);       // remove
hand[i].currentUses--;   // mutate in place — diff is sent automatically
```

**MapSchema** — keyed collection:
```typescript
@type({ map: PlayerState }) players = new MapSchema<PlayerState>();
players.set(client.sessionId, new PlayerState());  // add
players.delete(client.sessionId);                  // remove
players.get(id)!.hearts--;                         // mutate — auto-diffed
```

---

## Room Lifecycle

```typescript
import { Room, Client } from 'colyseus';

export class BattleRoom extends Room<BattleState> {

  onCreate(options: any) {
    // Called once when room is first created.
    this.setState(new BattleState());

    // Register message handlers
    this.onMessage<SelectAttackPayload>('selectAttack', (client, data) => {
      this._handleSelectAttack(client, data);
    });
    this.onMessage<SubmitDefensePayload>('submitDefense', (client, data) => {
      this._handleSubmitDefense(client, data);
    });

    // Set max clients (2 for a duel)
    this.maxClients = 2;
  }

  onJoin(client: Client, options: any) {
    // Called each time a client joins. client.sessionId is unique per connection.
    const player = new PlayerState();
    player.playerId = client.sessionId;
    this.state.players.set(client.sessionId, player);

    if (this.state.players.size === 2) {
      this._startBattle();
    }
  }

  onLeave(client: Client, consented: boolean) {
    // Called when client disconnects. consented = true if client called room.leave().
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    // Called when room is disposed (all clients left + no one rejoining).
    // Clear any running timers here.
    if (this._windowTimer) clearTimeout(this._windowTimer);
  }

  // Server-private fields (not @type — never sent to clients)
  private _impactTime: number = 0;
  private _windowTimer: NodeJS.Timeout | null = null;
  private _attackerRing: Ring | null = null;
  private _defenderPressTime: number = 0;
}
```

---

## Message Handlers

```typescript
// Typed handler — payload type inferred
this.onMessage<{ slot: number }>('selectAttack', (client, data) => {
  // Validate sender
  if (client.sessionId !== this.state.currentAttackerId) return;
  if (this.state.phase !== 'ATTACK_SELECT') return;
  if (data.slot < 0 || data.slot > 4) return;

  // Mutate state — clients see the diff automatically
  this.state.attackerSelectedSlot = data.slot;
  this.state.phase = 'DEFEND_WINDOW';
});
```

**Important:** Colyseus batches state diffs and sends them at the end of each frame. Mutations are synchronous — no need to manually broadcast.

---

## Server-side Timers

Use `setTimeout` directly in the room. Clear in `onDispose()`.

```typescript
private _openDefendWindow() {
  const WINDOW_MS = 900 + 180; // TELEGRAPH + BLOCK_WINDOW
  this._windowTimer = setTimeout(() => {
    this._windowTimer = null;
    this._resolveExchange();
  }, WINDOW_MS);
}
```

---

## Broadcasting to Specific Clients

```typescript
// Broadcast to all clients in the room (happens automatically via state diffs)
// For one-time events not in state (e.g. sound cue):
this.broadcast('sfx', { name: 'impact', element: 0 });

// Send to one client only:
client.send('error', { message: 'Not your turn' });
```

---

## Seeding Default Loadout

```typescript
function seedHand(): ArraySchema<Ring> {
  const hand = new ArraySchema<Ring>();
  const elements = [0, 1, 2, 3, 4]; // FIRE, WATER, EARTH, WIND, WOOD
  for (const el of elements) {
    const ring = new Ring();
    ring.element = el;
    ring.currentUses = 3;
    ring.maxUses = 3;
    hand.push(ring);
  }
  return hand;
}
```

---

## Client-side (Browser / Playwright)

```typescript
// In test-harness.html or future Phaser client:
import { Client } from 'colyseus.js'; // or CDN: https://cdn.jsdelivr.net/npm/colyseus.js@0.17/dist/colyseus.js

const client = new Client('ws://localhost:2567');
const room = await client.joinOrCreate('battle');

// Listen for state changes (called every time a diff arrives)
room.onStateChange((state) => {
  console.log('Phase:', state.phase);
  console.log('Hearts:', state.players.get(room.sessionId).hearts);
});

// Send messages
room.send('selectAttack', { slot: 0 });
room.send('submitDefense', { slot: 1, pressTime: Date.now() });

// Leave
room.leave();
```

---

## Playwright E2E Pattern (Phase 1 — no Phaser client)

Phase 1 has no browser UI. Tests use a thin `test-harness.html` page to host the Colyseus client:

```html
<!-- tests/e2e/test-harness.html -->
<script src="https://cdn.jsdelivr.net/npm/colyseus.js@0.17/dist/colyseus.js"></script>
<script>
  let room;
  window.connectRoom = async (name) => {
    const client = new Colyseus.Client('ws://localhost:2567');
    room = await client.joinOrCreate(name);
    return room.sessionId;
  };
  window.sendAttack  = (slot) => room.send('selectAttack', { slot });
  window.sendDefense = (slot, pressTime) => room.send('submitDefense', { slot, pressTime });
  window.roomState   = () => JSON.parse(JSON.stringify(room.state));
  window.waitForPhase = (phase) =>
    new Promise(res => {
      const unsub = room.onStateChange(s => {
        if (s.phase === phase) { unsub(); res(s); }
      });
    });
</script>
```

```typescript
// tests/e2e/battle-flow.spec.ts
import { test, expect } from '@playwright/test';

test('FIRE+WATER PARRY triggers rally', async ({ browser }) => {
  const p1 = await (await browser.newContext()).newPage();
  const p2 = await (await browser.newContext()).newPage();
  await p1.goto('http://localhost:8080/tests/e2e/test-harness.html');
  await p2.goto('http://localhost:8080/tests/e2e/test-harness.html');

  const p1id = await p1.evaluate(() => window.connectRoom('battle'));
  await p2.evaluate(() => window.connectRoom('battle'));

  // Get the impact time once attack is sent
  await p1.evaluate(() => window.sendAttack(0)); // FIRE slot
  const impactTime = Date.now() + 900;

  // P2 defends with WATER at PARRY timing (+30ms of impact)
  await new Promise(r => setTimeout(r, 870)); // wait until T+870
  await p2.evaluate((t) => window.sendDefense(1, t), impactTime + 30);

  // Wait for resolve
  const state = await p2.evaluate(() => window.waitForPhase('DEFEND_WINDOW'));
  expect(state.rallyActive).toBe(true);
  expect(state.volleyedElement).toBe(1); // WATER
});
```

---

## Common Gotchas

- **@Schema fields must be initialized** — `= 0`, `= ''`, `= false`, `= new ArraySchema()`. Uninitialised fields are undefined and won't diff correctly.
- **Don't replace ArraySchema** — mutate in place (`push`, `splice`, `hand[i].prop = x`). Replacing with `= new ArraySchema()` breaks client tracking.
- **MapSchema keys are strings** — `players.set(client.sessionId, ...)`. sessionId is always a string.
- **Private server state is never annotated** — `_impactTime`, `_attackerRing`, etc. No `@type`. These are never sent to clients.
- **State diffs are batched per frame** — multiple mutations in one handler send a single diff. No manual `broadcast` needed for state.
- **`onMessage` handler runs synchronously** — do all state mutations in the handler; no async unless you `await` and handle re-entrancy carefully.

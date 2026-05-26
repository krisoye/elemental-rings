import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import { BattleRoom } from './src/rooms/BattleRoom';
import { apiRouter } from './src/api/routes';
// Importing db initializes the SQLite connection + applies schema.sql at startup.
import './src/persistence/db';

const port = Number(process.env.PORT) || 2567;

// Express handles the HTTP side (auth + persistence REST API); Colyseus attaches
// its WebSocket upgrade handler to the SAME httpServer below, so one port serves
// both. CORS is required because the client runs on a different origin/port.
const app = express();
app.use(cors());
app.use(express.json());
app.use(apiRouter);

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// Two room names on one class. Colyseus matchmaking is scoped per room name:
// `battle` is PvP (two real clients); `battle-ai` seats a virtual AI on create
// and locks immediately, so a `joinOrCreate('battle')` never lands in an AI room.
//
// E2E ONLY: filterBy(['e2eRoomId']) makes joinOrCreate('battle', { e2eRoomId })
// match only rooms created with the same id, so parallel Playwright workers each
// pair into their own isolated room instead of cross-pairing in the global pool
// (#67). Gated on E2E_TEST_ROUTES so production keeps the pure global pool with
// zero behavior change (the field is absent in prod, so filterBy would be moot —
// but we gate it anyway to eliminate any risk).
if (process.env.E2E_TEST_ROUTES === '1') {
  gameServer.define('battle', BattleRoom).filterBy(['e2eRoomId']);
} else {
  gameServer.define('battle', BattleRoom);
}
gameServer.define('battle-ai', BattleRoom);

gameServer.listen(port).then(() => {
  console.log(`Colyseus listening on ws://localhost:${port}`);
});

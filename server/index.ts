import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { createServer } from 'http';
import { BattleRoom } from './src/rooms/BattleRoom';

const port = Number(process.env.PORT) || 2567;
const httpServer = createServer();
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// Two room names on one class. Colyseus matchmaking is scoped per room name:
// `battle` is PvP (two real clients); `battle-ai` seats a virtual AI on create
// and locks immediately, so a `joinOrCreate('battle')` never lands in an AI room.
gameServer.define('battle', BattleRoom);
gameServer.define('battle-ai', BattleRoom);

gameServer.listen(port).then(() => {
  console.log(`Colyseus listening on ws://localhost:${port}`);
});

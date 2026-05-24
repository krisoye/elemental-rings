## 2. Tech Stack & Architecture

### 2.1 Stack Overview

| Layer | Technology | Role |
|---|---|---|
| **Client** | Phaser.js (TypeScript) | Browser canvas rendering, input handling, animation |
| **Server** | Colyseus (Node.js + TypeScript) | Authoritative game state, battle logic, matchmaking |
| **Testing** | Playwright | Browser-driven E2E tests — presses real keys at real timings |
| **Dev server** | Vite | Hot-reload dev server for the Phaser client |
| **Deployment** | game-da-god (192.168.4.140) | LAN-accessible Colyseus server + static Phaser client |
| **Mobile** | Capacitor | Wraps Phaser as a native iOS/Android app |
| **Desktop/Steam** | Electron + Greenworks | Wraps Phaser as a native desktop app for Steam distribution |

### 2.2 Architecture Principle: Server is Authoritative

All game logic — the battle state machine, BlockResolver, ElementSystem, timing classification, rally chain, gauge updates — runs **on the Colyseus server**. Clients are dumb renderers:

```
Browser (Phaser)                   Colyseus server (game-da-god)
─────────────────                  ──────────────────────────────
Player presses key 2     →  WS     BattleRoom receives move
                                   Server resolves exchange
                                   Server validates timing
                                   Server computes relationship
                                   Server advances state machine
Render orb + outcome     ←  WS     Server broadcasts new state
```

Neither client can cheat timing, spoof element matchups, or manipulate rally state — the server has the only copy of truth.

### 2.3 Multiplayer Modes

| Mode | Description |
|---|---|
| **Human vs Human (LAN)** | Two devices on the home network, Phase 1 target |
| **Human vs Human (online)** | Port-forward game-da-god or move Colyseus to a VPS |
| **Human vs NPC** | AI opponent runs as a server-side bot in the same BattleRoom |
| **Spectate** | Any connected client can observe an ongoing room (future) |

### 2.4 Development Workflow

During development everything runs on **small-boss** — both the Colyseus server and the Vite dev server. Production deployment pushes the server to game-da-god as a systemd service (same pattern as existing MCP services). Any device on the LAN opens `http://192.168.4.140:8080` in a browser to play.

### 2.5 Testing Philosophy

Because the client runs in a real browser, **Playwright can simulate actual gameplay** — press a key at a specific time, wait for the orb animation, assert on DOM state, read game state from JavaScript. This replaces headless Godot testing and gives genuine end-to-end coverage of the full stack including timing-sensitive input.

---

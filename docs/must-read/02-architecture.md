# Architecture & Data Flow

This is the end-to-end picture: how a player's action becomes a server state change and comes back as
pixels. Read [`01-project-overview.md`](01-project-overview.md) first for the process map.

## The big picture

```
Browser (React + BabylonJS)
   │  HTTP (login, /me, game list, join)
   ▼
Auth server  ──────────────►  SQLite (accounts, sessions, games, versions)
   │  issues sf_session cookie
   │
   │  WebSocket (?gameId=…, cookie auth)
   ▼
[ Orchestrator gateway :8787 ]  ──proxies──►  Game server process for the game's version
                                                   │
                                                   ▼
                                          RuntimeContext + GameState (in memory)
                                                   │  tick loop ~every 100ms
                                                   │  save when dirty (every 5s)
                                                   ▼
                                          server/state/games/<id>/game-state.json
```

The orchestrator is optional: in plain dev the client's WebSocket talks to the game server directly
on `:8787`. With the orchestrator running, `:8787` is a gateway that forwards to the correct
version's internal process. Clients don't know the difference.

## Client connect & session

1. The React app boots ([`src/App.tsx`](../../src/App.tsx)) and checks the session via the auth
   server ([`src/auth/client.ts`](../../src/auth/client.ts) → `getCurrentSession()`).
2. The player picks/joins a game on the home page; the auth server records membership and the game in
   SQLite ([`server/auth-store.ts`](../../server/auth-store.ts)).
3. Navigating to a game runs [`src/game/boot.ts`](../../src/game/boot.ts), which opens a
   `GameServerClient` ([`src/game/GameServerClient.ts`](../../src/game/GameServerClient.ts)) WebSocket
   to the game server (`VITE_WS_URL`, default `ws://localhost:8787`), carrying the `sf_session`
   cookie.
4. The game server validates the cookie (against the auth store) and origin, then attaches a client
   session and immediately sends a full **snapshot** (`attachClient` in
   [`server/index.ts`](../../server/index.ts)).

## The authoritative loop (server)

The game server is the single source of truth. Each game is one `RuntimeContext` holding a mutable
`GameState`. A timer drives `tick(now)` roughly every `SERVER_TICK_INTERVAL_MS` (100ms,
[`server/game/constants.ts`](../../server/game/constants.ts)):

1. `advanceState(now)` ([`server/index.ts`](../../server/index.ts)) advances the clock and runs every
   simulation phase (fleet movement, combat, leaders/government, construction, economy, market,
   shortages, population, situations, events). It returns a `Set<ServerUpdateField>` naming what
   changed.
2. `broadcastUpdates(...)` sends each connected client an **update** containing only the changed
   fields, **filtered to that client's perspective** (fog of war / ownership redaction).
3. If state is dirty and at least 5s have passed since the last save, it persists to disk.

See [`server/runtime-and-tick.md`](../server/runtime-and-tick.md) for the full phase ordering and
[`server/protocol-and-snapshots.md`](../server/protocol-and-snapshots.md) for snapshot/update shapes.

## The render loop (client)

`GameServerClient` caches the latest snapshot and merges updates into it. Two BabylonJS scenes
consume that state:

- **GalaxyScene** ([`src/scenes/GalaxyScene.ts`](../../src/scenes/GalaxyScene.ts)) — the galaxy map:
  stars, hyperlanes, ownership overlay, fleet/starbase icons.
- **SystemScene** ([`src/scenes/SystemScene.ts`](../../src/scenes/SystemScene.ts)) — a single system
  in 3D: planets, starbases, fleet movement and combat.

`SceneManager` ([`src/SceneManager.ts`](../../src/SceneManager.ts)) owns the engine and the render
loop. On top of the canvas sits a set of **DOM overlay panels** (`src/ui/*Panel.ts`) — the HUD,
planet operations, fleet manager, market, tech tree, etc. — which are plain HTML, not React. See
[`client/scenes-and-rendering.md`](../client/scenes-and-rendering.md) and
[`client/ui-panels.md`](../client/ui-panels.md).

## Commands back to the server

User actions become `ClientCommand` messages
([`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts)) sent over the same WebSocket
(`GameServerClient.send`). The server validates each command against the sender's perspective
(observers are read-only; faction players can only act on what they own/can see), mutates state,
marks it dirty, and broadcasts the resulting field changes. The client then sees the effect on the
next update.

```
click "move fleet" ──► ClientCommand { type: "move", … } ──► server handleCommand
                                                                  │ validate perspective + ownership
                                                                  │ mutate GameState, mark dirty
                                                                  ▼
                                              broadcastUpdates(["fleets","visibility", …])
                                                                  │
clientside scene updates ◄── GameUpdate { changed:[…] } ◄─────────┘
```

## Detail subscriptions (the "second channel")

Big or panel-specific payloads (a planet's full economy breakdown, a starbase's queues, ship design
catalogs, market history) are **not** in the main snapshot. Panels **subscribe** to a scope+id and
the server sends a `detail` payload, re-sending only when a revision hash changes
(`subscribeDetail` in [`src/game/GameServerClient.ts`](../../src/game/GameServerClient.ts);
server side in [`server/game/detail-payloads.ts`](../../server/game/detail-payloads.ts)). This keeps
the per-tick update small. See [`client/server-client-and-details.md`](../client/server-client-and-details.md).

## Persistence & versioning at a glance

- State persists to `server/state/games/<gameId>/game-state.json` and is stamped with the writing
  build's identity ([`server/game/persistence.ts`](../../server/game/persistence.ts)).
- On load, state is **normalized** rather than migrated by hand: normalizers backfill defaults and
  coerce shapes, which *is* the migration mechanism
  ([`server/game/state-bootstrap.ts`](../../server/game/state-bootstrap.ts),
  [`src/data/Economy.ts`](../../src/data/Economy.ts) and friends).
- Each build advertises a `schemaVersion`/`protocolVersion` via
  [`server/versionManifest.ts`](../../server/versionManifest.ts). The orchestrator uses these to gate
  version updates. **This is the part most likely to bite you — read
  [`03-versioning-and-schema.md`](03-versioning-and-schema.md) and
  [`04-backward-compatibility.md`](04-backward-compatibility.md).**

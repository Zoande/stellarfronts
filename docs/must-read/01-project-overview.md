# Project Overview

StellarFronts is a browser-based, multiplayer **4X-style space-strategy prototype**: claim a country,
explore a procedurally generated galaxy, expand with starbases and colonies, run an economy and
research tree, trade on a market, conduct diplomacy, and fight fleet battles. The emphasis is on
logistics, expansion, and command rather than a pure-combat sandbox. **Balance and content are
work-in-progress.**

## The core loop

Join a game → claim or resume a country → explore outward through the hyperlane network (fog of war
lifts as you go) → build starbases and planetary districts/buildings → grow population and run jobs →
research technologies that unlock buildings, ships, and bonuses → trade, ally, or fight other
factions → repeat at a larger scale.

The simulation runs **continuously on the server** (a real-time tick, not turn-based) and streams
state to connected clients.

## Three processes

StellarFronts is not one server — it is three cooperating pieces (plus the browser client):

| Process | Entry point | Default port | Responsibility |
| --- | --- | --- | --- |
| **Client** | `src/index.tsx` → [`src/App.tsx`](../../src/App.tsx) | `5173` (Vite) | React UI for login/home/dev, plus the BabylonJS in-game command view. |
| **Auth server** | [`server/auth-server.ts`](../../server/auth-server.ts) | `8788` | HTTP: accounts, sessions, game catalog, progression, news/messages, dev panel. SQLite-backed. |
| **Game server** | [`server/index.ts`](../../server/index.ts) | `8787` | WebSocket: the live game simulation and per-client snapshots. One game = one runtime. |
| **Orchestrator** | [`server/orchestrator.ts`](../../server/orchestrator.ts) | `8790` control, `8787` gateway | Optional. Hosts multiple **code versions** as git worktrees and proxies clients to the right one. |

In plain local dev you run the client + auth + game server (`npm run dev:all`). The orchestrator is a
separate mode used for multi-version hosting — see [`server/orchestrator-and-lifecycle.md`](../server/orchestrator-and-lifecycle.md).

## Repository layout

```
src/                     Client + shared gameplay data/logic (bundled into the browser AND imported by the server)
  App.tsx, index.tsx     React entry + routing
  hooks/                 App-flow state machine (useAppFlow.ts)
  components/, pages/     React UI shells (login, home, dev, news, loading)
  game/                  Client/server shared: GameProtocol, GameServerClient, GameTime, boot, combat helpers
  data/                  Shared gameplay model: Economy, Technology, Starbase, ShipDesigns, Government, Leaders, Species, Market, Diplomacy, StarMap, Factions, …
  scenes/, systems/       BabylonJS scenes (galaxy/system) and rendering subsystems
  ui/                    DOM-overlay panels (HUD, planet, fleet, market, tech, …)
  flags/                 Procedural faction-flag generation
  auth/                  Auth client + types

server/                  Node game + auth servers and orchestration
  index.ts               Game server entry: tick loop + command handling
  auth-server.ts         HTTP auth server
  auth-store.ts          SQLite store (accounts, sessions, games, versions, news/messages, progression)
  orchestrator.ts        Multi-version host + gateway
  versionManifest.ts     This build's schema/protocol identity
  game-state-path.ts     Resolves the on-disk state directory
  game/                  Server-side simulation: clock, economy-tick, fleet-combat, research, persistence, snapshot, state-bootstrap/normalization, …
  tests/                 Node test suite (npm run server:test)

scripts/control.ts       CLI for the orchestrator control API
docs/                    This documentation
versions/                Orchestrator-managed git worktrees (one per registered version)
public/, resources/      Static assets (ship/starbase GLBs, textures, flags, banners)
```

## A crucial structural fact: `src/` is shared

The `server/` code **imports gameplay logic directly from `src/data/` and `src/game/`** (e.g.
[`server/game/economy-tick.ts`](../../server/game/economy-tick.ts) imports from
[`src/data/Economy.ts`](../../src/data/Economy.ts)). There is no duplicated "server model" — the same
TypeScript files define the economy, tech tree, ship designs, etc. for both the browser bundle and
the Node server.

This is the single most important thing to internalize before changing anything, because it means a
change to a shared file affects **both** the client bundle and the server build. It is also the
reason backward compatibility needs care: a new client and an older server are both running *some*
version of these shared files. See [`04-backward-compatibility.md`](04-backward-compatibility.md).

## What's mature vs. WIP

- **Mature:** economy/population, technology/research, galaxy generation & field-level intelligence,
  ships/starbases/fleets, combat, market, diplomacy, government & species/rights, account
  progression/news/messaging.
- **In progress:** the events/situations *catalog* (the framework exists; few scenarios), leader
  pool generation / legendary offers, OAuth login (endpoints return `501`), and email verification
  (UI shell only).

## Where to go next

- How everything connects end-to-end: [`02-architecture.md`](02-architecture.md)
- The rules you must not break: [`03-versioning-and-schema.md`](03-versioning-and-schema.md) and
  [`04-backward-compatibility.md`](04-backward-compatibility.md)
- Making your first change: [`05-contributing-rules.md`](05-contributing-rules.md)
- Running it locally: [`06-local-dev-and-environments.md`](06-local-dev-and-environments.md)

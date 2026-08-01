# Protocol & Snapshots

The wire format between game server and client. Message types are defined in
[`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts) (shared); the server builds them in
[`server/game/snapshot.ts`](../../server/game/snapshot.ts) and
[`server/game/detail-payloads.ts`](../../server/game/detail-payloads.ts); the low-level send/accept/
reject helpers are in [`server/game/socket-io.ts`](../../server/game/socket-io.ts).

## Message types

Server → client:

- **`snapshot`** (`GameSnapshot`) — the full, perspective-filtered state, sent once on connect
  (`attachClient` in [`server/game-runtime.ts`](../../server/game-runtime.ts)). Carries `protocolVersion` (8),
  sourced from `VERSION_MANIFEST` rather than a snapshot-local literal.
- **`update`** (`GameUpdate`) — an incremental message with `changed: ServerUpdateField[]` and only
  those fields. Sent every tick that changes something.
- **`detail`** — a scoped payload for a specific panel/entity (see below).
- Plus `serverInfo`, command results (`accept`/`reject`), and account-resource updates
  (`accountResources`) for account-scoped balances such as Dark Matter.

Client → server: `ClientCommand` (the union in
[`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts)) — movement, building, diplomacy,
research, leaders, market, detail subscriptions, admin, etc.

Protocol 8 adds optional `requestId` correlation to normal gameplay commands and command results.
The protocol-8 server requires a 1-128 character ID before executing a normal mutation. Join,
detail-subscription, and admin flows retain their specialized response mechanisms. The browser
accepts protocols `[5, 6, 7, 8]`; protocols 5-7 remain fire-and-forget and absent legacy fields are
defaulted defensively.

## `ServerUpdateField`

The set of fields an `update` can carry: `clock`, `visibility`, `planetStates`,
`habitedPlanetSystems`, `factionEconomies`, `ships`, `shipDesigns`, `fleets`, `starbases`,
`technologies`, `leaders`, `governments`, `species`, `diplomacy`, `market`, `combatContacts`,
`combatProjectiles`, `combatReports`, `situations`, `events`, and `tradeAlerts`. `advanceState` adds
the ones it touched; only those are rebuilt and sent.

## Perspective filtering (fog of war)

Every message is built **per client perspective** (`GalaxyPerspective`: `faction` with an id, or
`observer`). The snapshot builders in [`server/game/snapshot.ts`](../../server/game/snapshot.ts)
materialize field-level intelligence (see
[`../systems/galaxy-map-and-visibility.md`](../systems/galaxy-map-and-visibility.md)) to:

- send current or stale known star/system fields while leaving unknown fields redacted;
- expose only observed fleets, ships, starbases, and lanes at the fidelity granted by sensor bundles;
- show last-observed ownership through the stored system-owner field; and
- restrict faction-private economies, technologies, governments, designs, and events to their owner,
  while observers/admins receive broader read-only truth.

Because a new field is simply absent for an older server, clients must read defensively — see
[`../must-read/04-backward-compatibility.md`](../must-read/04-backward-compatibility.md).

## Detail subscriptions

Large or panel-specific payloads are **not** in the main snapshot. A client subscribes to a
`GameDetailScope` + id (e.g. `system`, `planet`, `starbase`, `fleet`, `fleetManager`,
`planetManager`, `market`, `technology`, …) via `subscribeDetails`; the server builds the payload in
[`server/game/detail-payloads.ts`](../../server/game/detail-payloads.ts) and attaches a **revision
hash** (`createRevision`). It re-sends only when the hash changes, so an open panel updates without
bloating every tick. Client side: `subscribeDetail` in
[`src/game/GameServerClient.ts`](../../src/game/GameServerClient.ts) — see
[`../client/server-client-and-details.md`](../client/server-client-and-details.md).

## How to extend / rules

- **Add a snapshot/update field:** add it to `GameSnapshot`/`ServerUpdateField` in
  [`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts), build it in
  [`server/game/snapshot.ts`](../../server/game/snapshot.ts), and emit the field from the relevant
  tick phase. If the change is incompatible with old clients, bump `protocolVersion` and widen
  `SUPPORTED_SERVER_PROTOCOL_VERSIONS`.
- **Add a detail scope:** extend `GameDetailScope` and add a branch in
  [`server/game/detail-payloads.ts`](../../server/game/detail-payloads.ts); subscribe from the panel.
- Respect perspective: never leak another faction's private data into a snapshot.

## Key files

- Types: [`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts).
- Builders: [`server/game/snapshot.ts`](../../server/game/snapshot.ts),
  [`server/game/detail-payloads.ts`](../../server/game/detail-payloads.ts).
- Send helpers: [`server/game/socket-io.ts`](../../server/game/socket-io.ts).
- Tests: [`server/tests/system-view.test.ts`](../../server/tests/system-view.test.ts).

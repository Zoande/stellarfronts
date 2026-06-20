# Protocol & Snapshots

The wire format between game server and client. Message types are defined in
[`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts) (shared); the server builds them in
[`server/game/snapshot.ts`](../../server/game/snapshot.ts) and
[`server/game/detail-payloads.ts`](../../server/game/detail-payloads.ts); the low-level send/accept/
reject helpers are in [`server/game/socket-io.ts`](../../server/game/socket-io.ts).

## Message types

Server → client:

- **`snapshot`** (`GameSnapshot`) — the full, perspective-filtered state, sent once on connect
  (`attachClient` in [`server/index.ts`](../../server/index.ts)). Carries `protocolVersion` (2).
- **`update`** (`GameUpdate`) — an incremental message with `changed: ServerUpdateField[]` and only
  those fields. Sent every tick that changes something.
- **`detail`** — a scoped payload for a specific panel/entity (see below).
- Plus `serverInfo` and command results (`accept`/`reject`).

Client → server: `ClientCommand` (the union in
[`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts)) — movement, building, diplomacy,
research, leaders, market, detail subscriptions, admin, etc.

## `ServerUpdateField`

The set of fields an `update` can carry: `clock`, `visibility`, `planetStates`,
`habitedPlanetSystems`, `factionEconomies`, `ships`, `shipDesigns`, `fleets`, `starbases`,
`technologies`, `leaders`, `governments`, `species`, `diplomacy`, `market`, `combatContacts`,
`situations`, `events`. `advanceState` adds the ones it touched; only those are rebuilt and sent.

## Perspective filtering (fog of war)

Every message is built **per client perspective** (`GalaxyPerspective`: `faction` with an id, or
`observer`). The snapshot builders in [`server/game/snapshot.ts`](../../server/game/snapshot.ts) use
the visibility sets (see [`../systems/galaxy-map-and-visibility.md`](../systems/galaxy-map-and-visibility.md))
to:

- Include full data only for **visible** systems; emit redacted "unknown" stars
  (`createRedactedStar`) for discovered-but-not-visible ones; omit the rest.
- Filter fleets/starbases/hyperlanes by visibility.
- Show last-known ownership for fog'd systems.
- Restrict faction-private data (own economies, technologies, governments, designs, events) to the
  owning faction; observers/admins get a broader read-only view.

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

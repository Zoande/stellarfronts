# Server Client & Detail Subscriptions

[`src/game/GameServerClient.ts`](../../src/game/GameServerClient.ts) is the client's single connection
to the game server: it owns the WebSocket, caches state, and exposes subscriptions and a command
sender. The wire types are shared in [`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts); the
server side is documented in [`../server/protocol-and-snapshots.md`](../server/protocol-and-snapshots.md).

## Connecting

`connect()` opens the WebSocket (`VITE_WS_URL` + `?gameId=…`, cookie auth), sends `{ type: "join" }`,
and resolves with the first `GameSnapshot`. It validates `protocolVersion` against
`SUPPORTED_SERVER_PROTOCOL_VERSIONS` (`[4]`) and rejects an unsupported server with a clear message.
Connections reuse a cached snapshot if already connected.

## State caching

The client keeps `latestSnapshot` and merges each incremental `update` into it field-by-field (only
the fields the update carries, defaulting to the prior value). Snapshot handlers
(`snapshotHandlers`) are notified on each snapshot/merge so scenes and panels can re-render. Clock
fields are synced for smooth local interpolation (`withClientClockSync`).

Account-scoped resources do not belong in `GameSnapshot`: `accountResources` events update the live
Dark Matter balance, while the periodic player-profile refresh in `boot.ts` remains a fallback.

## Detail subscriptions

The main snapshot stays small; panels pull large/scoped data on demand:

- `subscribeDetail(scope, id, handler)` registers a handler and tells the server to start sending that
  scope's `detail` payload (`subscribeDetails` command). The server attaches a revision hash and
  re-sends only when it changes; the client serves the cached payload otherwise.
- The returned releaser unsubscribes; when the last subscriber for a scope/id goes away, the client
  sends `unsubscribeDetails`.

Scopes include `system`, `planet`, `starbase`, `fleet`, `fleetManager`, `planetManager`, `market`,
`technology`, and more (`GameDetailScope`). This is the channel each UI panel uses for its data — see
[ui-panels.md](ui-panels.md).

## Sending commands

`send(command)` serializes a `ClientCommand` to the socket. Commands are **requests**: the server
validates, applies, and broadcasts the result; the client observes the effect on the next
snapshot/update/detail. There is no optimistic authoritative mutation (local previews are fine).

## How to extend / rules

- A new panel data feed = a new detail scope (server side) + a `subscribeDetail` call (client side),
  not a new top-level snapshot field, unless the data is small and globally relevant.
- Read merged snapshot fields defensively — an older server won't send your new field (default it; see
  [`../must-read/04-backward-compatibility.md`](../must-read/04-backward-compatibility.md)).
- Always release detail subscriptions on panel close to avoid leaks and unnecessary server work.

## Key files

- Client: [`src/game/GameServerClient.ts`](../../src/game/GameServerClient.ts).
- Protocol types: [`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts).
- Server builders: [`server/game/detail-payloads.ts`](../../server/game/detail-payloads.ts),
  [`server/game/snapshot.ts`](../../server/game/snapshot.ts).

# Server Client & Detail Subscriptions

[`GameServerClient`](../../src/game/GameServerClient.ts) owns the browser's one WebSocket connection,
canonical snapshot cache, detail subscriptions, and command sender.

## Connection and protocol adaptation

The client connects to the fixed public gateway with `?gameId=...` and sends `join`. The first
snapshot must declare protocol 5, 6, or 7.

[`ProtocolAdapter`](../../src/game/ProtocolAdapter.ts) runtime-validates message envelopes and
converts every supported protocol into the current canonical `GameSnapshot`. Collections introduced
after an older protocol default centrally in the adapter. Unsupported, undeclared, malformed, or
mid-session protocol changes close the connection with a clear error.

## Canonical snapshot reducer

Updates pass through one reducer. It copies only fields actually present on the update, preserves
omitted fields, and respects explicit `null` values such as visibility sets. Panels and scenes never
need protocol-specific branches.

When adding or retaining a protocol:

- add its defaults/transform in `ProtocolAdapter`;
- add a recorded fixture test;
- keep `SUPPORTED_SERVER_PROTOCOL_VERSIONS` aligned with tested adapters.

## Detail subscriptions

Large or scoped panel data stays out of the main snapshot:

- `subscribeDetail(scope, id, handler)` opens a server subscription;
- revisions suppress unchanged payloads;
- `notModified` reuses the canonical cached payload;
- releasing the final local subscriber sends `unsubscribeDetails`.

Scopes include systems, planets, starbases, fleets, management panels, market, technology,
government, leaders, society, and diplomacy.

## Commands

The client sends typed requests but never owns authoritative state. The server runtime-validates the
command envelope, checks perspective and ownership, performs the mutation, marks mutating commands
durable through the mutation coordinator, and broadcasts canonical changes.

## Key files

- Client/cache: [`src/game/GameServerClient.ts`](../../src/game/GameServerClient.ts)
- Adapter/reducer: [`src/game/ProtocolAdapter.ts`](../../src/game/ProtocolAdapter.ts)
- Wire types: [`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts)
- Server command codec: [`server/game/client-command-codec.ts`](../../server/game/client-command-codec.ts)
- Server detail builders: [`server/game/detail-payloads.ts`](../../server/game/detail-payloads.ts)

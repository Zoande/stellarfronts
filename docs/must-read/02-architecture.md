# Architecture & Data Flow

The production topology deliberately has one current client and potentially many backend versions:

```text
Cloudflare-hosted React client
       │ HTTPS auth / developer operations
       ▼
Raspberry Pi auth server ───────────────► SQLite control-plane catalog
       │ internal control requests
       ▼
Raspberry Pi orchestrator
       ├── WebSocket gateway :8787 ─────► version A game process
       │                                ► version B game process
       └── control API :8790
                                          │
                                          ▼
                              isolated per-game JSON state
```

The client deployment remains singular. Protocol adapters let that client communicate with the
supported backend protocols. The orchestrator selects a backend from the game's catalog entry, so
players never select an internal version endpoint.

## Operational boundary

Only auth is publicly exposed over HTTP. The orchestrator control API and game-version processes bind
to loopback by default. Auth forwards authenticated developer operations using `CONTROL_TOKEN`; the
browser never receives that token. Cloudflare Tunnel should expose auth and the WebSocket gateway,
not the internal control port.

The `/dev` panel is the normal operating surface. It reports orchestrator and gateway health,
immutable artifacts, process crashes/quarantine, runtime tick and save state, owner locks, and
verified backups. It also supports version registration and game create/start/stop/retry/update/
rollback/reset/archive/delete operations. Routine administration therefore does not require shell
access to the Pi.

## Client connection

1. [`src/App.tsx`](../../src/App.tsx) checks the auth session.
2. A player selects a game from the auth catalog.
3. [`src/game/GameServerClient.ts`](../../src/game/GameServerClient.ts) opens the gateway WebSocket
   with the session cookie and game ID.
4. The gateway resolves the currently assigned version and proxies with bounded retry, queue, and
   backpressure limits.
5. The game server authenticates the session and sends a snapshot.
6. [`src/game/ProtocolAdapter.ts`](../../src/game/ProtocolAdapter.ts) validates and converts the
   negotiated protocol to the current client model.

## Authoritative runtime

Each game has one `RuntimeContext` and one exclusive owner token. The version process ticks every
active game independently. A load or tick failure quarantines only that game; siblings continue.
State-changing commands pass through the mutation coordinator so persistence dirtiness and ordered
refresh effects cannot be forgotten.

Snapshots carry broadly useful state. Large panel-specific state travels through detail
subscriptions and revision hashes. This keeps routine updates small and avoids recomputing details
that no connected client requested.

## Persistence and versions

Saves use exclusive ownership, unique temporary files, fsync, and atomic rename. Corrupt files fail
closed rather than being replaced. Explicit schema migrations run before normalization. Destructive
lifecycle operations create checksummed, version-aware backups.

Registered versions are commit-pinned worktrees with lockfile-pinned dependencies and static version
manifests. Historical runtime code is prevented from initializing or migrating the shared auth
catalog. See [`03-versioning-and-schema.md`](03-versioning-and-schema.md) and
[`server/orchestrator-and-lifecycle.md`](../server/orchestrator-and-lifecycle.md).

## Client rendering and payload

The auth/home/dev routes and game route are split into separate chunks. The authored BabylonJS
authentication background remains part of the login experience and intentionally carries its
renderer and model-loading cost. The production build enforces a budget only for the initial
application entry so unrelated route code cannot silently return to that entry.

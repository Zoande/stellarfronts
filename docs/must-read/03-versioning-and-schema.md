# Versioning & Schema

StellarFronts can run multiple game-server versions simultaneously while Cloudflare serves one
current client. Saved games must survive code changes, so persisted schema compatibility and wire
protocol compatibility are separate, explicit contracts.

## Current contracts

The checked-in [`server/version-manifest.json`](../../server/version-manifest.json) is the canonical
artifact metadata:

- `schemaVersion: 27` describes the persisted `GameState`.
- `protocolVersion: 7` describes WebSocket messages.
- `runtimeApiVersion: 1` describes the stable control-plane/runtime integration.
- `migratesFromSchema: [23, 24, 25, 26, 27]` lists schemas this build can load.

[`server/versionManifest.ts`](../../server/versionManifest.ts) exposes the same values to runtime
code. A drift test fails if the TypeScript constants and static manifest disagree.

The orchestrator reads the static manifest directly from each registered worktree. It never executes
untrusted or historical server code merely to discover compatibility. `--print-version` remains a
diagnostic command, not the orchestrator's source of truth.

## Immutable version artifacts

Registering a version creates a git worktree pinned to the selected commit and installs dependencies
from that worktree's lockfile. The lockfile hash is stamped and reported in `/dev`. A version process
uses that exact worktree's `tsx` loader and dependencies instead of the root installation.

Historical game code is loaded with the runtime module guard. Imports of the old auth-store module
are redirected to the current runtime-safe catalog implementation, with catalog initialization,
DDL, and account seeding disabled. This prevents an old backend from running old control-plane
migrations against the shared auth database.

## Loading and migrations

[`server/game/state-bootstrap.ts`](../../server/game/state-bootstrap.ts) distinguishes a missing save
from an invalid save:

- `ENOENT` creates a new game.
- malformed JSON, an invalid envelope, or an unsupported schema aborts startup and preserves the
  original file.

[`server/game/state-migrations.ts`](../../server/game/state-migrations.ts) owns the explicit
23→24→25→26→27 migration chain. Current normalizers then fill safe additive defaults and enforce the
current domain shape. A schema bump must add the corresponding explicit migration step; normalization
alone is not a substitute for a declared migration.

Saves are stamped with the writing code version and protocol. Atomic persistence, exclusive owner
locks, and verified backups are described in
[`state-persistence-and-normalization.md`](../server/state-persistence-and-normalization.md).

## Wire compatibility

The current client accepts server protocols 5, 6, and 7 through
[`src/game/ProtocolAdapter.ts`](../../src/game/ProtocolAdapter.ts). Every initial snapshot is
validated and adapted to the current canonical client model before entering the UI. Updates are
validated against the negotiated protocol and reduced with explicit missing-versus-null semantics.

Compatibility is never bypassed for the development version. The same static manifest and migration
checks apply to `dev` and immutable versions.

## Updates and rollback

Before reset, update, rollback, or deletion, the orchestrator creates or verifies a version-aware
backup. An update is accepted only when the target manifest can migrate the recorded save schema and
the runtime API is supported.

Rollback is state-and-code coordinated: `/dev` selects an exact verified backup, the orchestrator
checks that the target version can load it, restores it atomically, assigns the source backend, and
starts that backend. A partial state-only rollback is not considered successful.

## Change checklist

| Change | Required work |
| --- | --- |
| Persisted shape requiring a marker | Bump schema, add an explicit migration, update the static and TypeScript manifests, and add migration tests. |
| Wire shape older clients cannot interpret | Bump protocol, add or update a client adapter, update both manifests, and add fixture tests. |
| Runtime/control-plane integration | Bump `runtimeApiVersion` and update the stable runtime boundary. |
| Purely additive normalized field | Add a safe normalizer default; bump schema only when an explicit persisted marker is useful. |

Run `npm run server:test`, `npm run server:typecheck`, and `npm run build` before registering a
version.

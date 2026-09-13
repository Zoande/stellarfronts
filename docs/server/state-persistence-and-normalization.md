# State Persistence & Normalization

How a game's `GameState` is created, migrated, saved, and protected. Versioning policy is in
[`../must-read/03-versioning-and-schema.md`](../must-read/03-versioning-and-schema.md).

## Storage

- Live save: `server/state/games/<gameId>/game-state.json`.
- Exclusive owner: `server/state/games/<gameId>/.owner`.
- Verified backups: `server/state/games/<gameId>/backups/*.state.json` plus matching manifests.
- `SF_STATE_DIR` overrides the root for the Raspberry Pi deployment.

## Fresh state versus failed state

`createInitialState` creates schema 30 only when the save file does not exist. `loadState` never
turns a parse, validation, normalization, or compatibility error into a new galaxy. Instead it throws
a `GameStateLoadError`; the version host releases ownership, quarantines that game, reports the
failure to the dev panel, and leaves the original bytes untouched.

## Migration pipeline

Loading proceeds in this order:

1. Read and decode JSON.
2. Validate the durable envelope (`schemaVersion`, clock, and required root collections).
3. Check `VERSION_MANIFEST.migratesFromSchema`.
4. Reject every schema other than 30; schema 29 has no Army-identity migration.
5. Run domain normalizers for planets, fleets, starbases, armies, ground battles, species,
   governments, markets, leaders, intelligence, and other entity details.
6. Rebuild derived adjacency, ownership, discovery, and economies.
7. Mark normalized state dirty so it is persisted in the current shape.

Explicit steps make supported version paths auditable. Domain normalization remains responsible for
entity-level defaults and derived data.

## Durable saves

`saveState` is single-flight. It stamps `codeVersion` and `protocolVersion`, writes a unique temporary
file, fsyncs it, atomically renames it over the live save, and fsyncs the containing directory on
Linux. The catalog stamp is updated only after the file replacement succeeds.

Dirty games save at most every five seconds. A graceful version shutdown stops ticks, closes clients,
flushes every healthy runtime, and releases ownership before exiting.

## Exclusive ownership

Ownership uses atomic exclusive file creation. The record contains `{ versionId, pid, token,
startedAt }`. A second live owner is rejected even when it has the same version ID or operating-system
process. Release requires the matching random token. Dead or invalid locks may be reclaimed.

## Backups and rollback

Backups contain the state plus a manifest with game ID, reason, source backend version, schema,
protocol, byte size, SHA-256 checksum, and creation time. Retention defaults to 30 per game and is
configured with `GAME_BACKUP_RETENTION_COUNT`. The legacy
`GAME_BACKUP_RETENTION` name remains accepted for older deployments.

Reset, update, rollback, deletion, and manual backup first quiesce the game and wait for ownership to
be released. Rollback verifies the checksum and schema, requires the source backend to be registered,
restores both state and backend assignment, and creates a backup of the state being replaced.

## Key files

- Bootstrap and load: [`server/game/state-bootstrap.ts`](../../server/game/state-bootstrap.ts)
- Explicit migrations: [`server/game/state-migrations.ts`](../../server/game/state-migrations.ts)
- Saving and ownership: [`server/game/persistence.ts`](../../server/game/persistence.ts)
- Backups: [`server/game-backups.ts`](../../server/game-backups.ts)
- Lifecycle: [`server/orchestrator.ts`](../../server/orchestrator.ts)

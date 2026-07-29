# Versioning & Schema

StellarFronts can run **multiple code versions at once** (a new game on new code while an old game
stays on its original code), and saved games must survive code changes. Two version numbers make
that safe. Get these wrong and you can corrupt saves or wedge an update — so this is required reading
before you touch persisted state or the wire protocol.

## The two version numbers

Both live in [`server/versionManifest.ts`](../../server/versionManifest.ts):

```ts
export const CURRENT_SCHEMA_VERSION = 24;   // shape of the persisted GameState on disk
export const CURRENT_PROTOCOL_VERSION = 4;  // shape of the client/server wire messages
```

- **`protocolVersion`** describes the **wire format** — the `GameSnapshot` / `GameUpdate` / `detail`
  messages in [`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts). The client refuses to run
  against a server whose protocol it doesn't list in `SUPPORTED_SERVER_PROTOCOL_VERSIONS`
  ([`src/game/GameServerClient.ts`](../../src/game/GameServerClient.ts), currently `[4]`).
- **`schemaVersion`** describes the **persisted `GameState`** on disk. It gates whether a build is
  allowed to load (and thus migrate) a given save.

The `VERSION_MANIFEST` object combines them with `migratesFromSchema` — the list of prior schema
versions this build can load:

```ts
migratesFromSchema: [23, CURRENT_SCHEMA_VERSION]
```

This build accepts schemas **23 and 24 only**. Schema 24 introduced the current field-level
intelligence model; older discovery/visibility saves deliberately start fresh instead of being
silently converted into incomplete intelligence.

## How a build advertises itself: `--print-version`

The orchestrator probes each registered worktree by running its game server with `--print-version`,
which prints `VERSION_MANIFEST` and exits ([`server/index.ts`](../../server/index.ts), the
`process.argv.includes("--print-version")` branch). That is how the orchestrator learns a version's
`protocolVersion`, `schemaVersion`, and `migratesFromSchema` without booting a full game
([`probeManifest`](../../server/orchestrator.ts)).

## How saves are stamped

On every save, [`server/game/persistence.ts`](../../server/game/persistence.ts) writes the state plus
the **writing build's identity**:

```ts
const stamped = { ...nextState, codeVersion: SF_VERSION_ID, protocolVersion: VERSION_MANIFEST.protocolVersion };
// …and records (gameId, nextState.schemaVersion, protocolVersion) into the auth store catalog.
```

So each `game-state.json` knows which code last wrote it, and the catalog tracks each game's schema.

## How loading is gated (and why migration is "free")

On load, [`server/game/state-bootstrap.ts`](../../server/game/state-bootstrap.ts) reads
`parsed.schemaVersion` and refuses the save if this build can't migrate it:

```ts
if (Number.isFinite(onDiskSchema) && !canMigrateFromSchema(VERSION_MANIFEST, onDiskSchema)) {
  throw new Error(`… schema ${onDiskSchema} is not loadable by version …`);
}
```

If accepted, **normalization is the migration**: the loader backfills missing collections, drops
removed fields (e.g. legacy `battles`), and re-runs the shared normalizers
(`createPlanetStateFromConfig`, `normalizeFleet`, `normalizeStarbase`, government/species/market
normalizers, …). There are **no hand-written migration functions** — every normalizer must coerce a
loose/old object into the current shape with sensible defaults. This is why adding a field is usually
safe across versions: old saves simply don't have it, and the normalizer fills it in.

## The orchestrator update gate

When you move a game to another version, the orchestrator checks the *target* version's accepted
range against the *game's* recorded schema ([`server/orchestrator.ts`](../../server/orchestrator.ts)):

```ts
// dev accepts everything; a tagged version gates on its migratesFromSchema.
return target.migratesFromSchema.includes(game.schemaVersion);
```

Use `npm run control compat --to <versionId>` for a dry run before updating. State is backed up
before resets/updates so rollback is possible.

## When to bump what

| You changed… | Bump |
| --- | --- |
| A `GameSnapshot` / `GameUpdate` / `detail` field in a way old clients can't parse | `CURRENT_PROTOCOL_VERSION` **and** widen `SUPPORTED_SERVER_PROTOCOL_VERSIONS` on the client |
| The persisted `GameState` shape in a way that needs a migration marker | `CURRENT_SCHEMA_VERSION` and the corresponding `GameState`/bootstrap normalization values |
| Added a purely additive field a normalizer backfills | Usually **nothing** — normalization handles it. Bump schema only if you want an explicit marker. |

Bumping a version number is **not** a substitute for actually handling old data. The normalizer/
backfill is what makes the change safe; the number just records that a change happened and lets the
orchestrator reason about compatibility.

## Current schema alignment

`VERSION_MANIFEST.schemaVersion`, new-game initialization, and load normalization all write schema
24. `GameState.schemaVersion` temporarily accepts the literal union `23 | 24` so the loader can type
the one supported predecessor before normalizing it to 24. Keep these locations aligned whenever the
schema changes.

## See also

- The discipline that keeps a *new client* working against an *older server*:
  [`04-backward-compatibility.md`](04-backward-compatibility.md).
- The full save/load/normalize flow: [`server/state-persistence-and-normalization.md`](../server/state-persistence-and-normalization.md).
- The version lifecycle and the control CLI: [`server/orchestrator-and-lifecycle.md`](../server/orchestrator-and-lifecycle.md).

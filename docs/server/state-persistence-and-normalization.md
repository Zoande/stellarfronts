# State Persistence & Normalization

How a game's `GameState` is created, loaded, saved, and kept consistent across code changes. The
versioning *rules* are in [`../must-read/03-versioning-and-schema.md`](../must-read/03-versioning-and-schema.md);
this doc is the mechanism.

## Where state lives

- Saves: `server/state/games/<gameId>/game-state.json` (one JSON file per game) plus a `.owner` lock.
- The directory is resolved by [`server/game-state-path.ts`](../../server/game-state-path.ts)
  (`getGameStateDirectory`), honoring `SF_STATE_DIR` (the orchestrator sets it for child processes).

## Creating a fresh game

`createInitialState` ([`server/game/state-bootstrap.ts`](../../server/game/state-bootstrap.ts))
generates a new galaxy (stars, planets, factions, home starbases + starter ships) and initializes
every subsystem's state (economies, technologies, governments, species/rights, diplomacy, market,
leaders), stamping `schemaVersion` and aligning the clock to `GAME_START_YEAR`.

## Loading & normalization (the migration mechanism)

On load, [`server/game/state-bootstrap.ts`](../../server/game/state-bootstrap.ts):

1. Reads and JSON-parses the save (falling back to a fresh galaxy on parse failure).
2. **Schema gate:** rejects the save if `canMigrateFromSchema(VERSION_MANIFEST, parsed.schemaVersion)`
   is false (a last-line guard; the orchestrator gates updates up front).
3. **Normalizes:** drops removed fields (e.g. legacy `battles`), backfills missing collections
   (`adjacency`, `intelligenceByFaction`, `startingIntelligenceSeeded`, …), and re-runs the shared normalizers
   (`createPlanetStateFromConfig`/`createPlanetStateFromSeed`, fleet/starbase/government/species/
   market normalizers).
4. **Derived sync:** `syncFleetMembership`, `syncSystemOwnershipFromStarbases`, `refreshDiscovery`,
   and economy recalculation.
5. Marks state dirty if anything changed, so the next save persists the normalized shape.

There are **no hand-written migration functions** — normalization *is* migration. Every persisted
field must have a normalizer default; that is what lets old saves (and an older server's data) load
on new code. See [`../must-read/04-backward-compatibility.md`](../must-read/04-backward-compatibility.md).

## Saving

`saveState` ([`server/game/persistence.ts`](../../server/game/persistence.ts)) writes the state plus
the writing build's identity (`codeVersion`, `protocolVersion`) and records the game's schema/protocol
into the auth-store catalog. The tick loop saves at most every `SAVE_INTERVAL_MS` (5s) and only when
`hasDirtyState`. `dispose` flushes a final save on shutdown.

## Exclusive ownership

`acquireOwnership` / `releaseOwnership` ([`server/game/persistence.ts`](../../server/game/persistence.ts))
write a `.owner` lock (`{ versionId, pid, startedAt }`). A different *live* version's process is
refused ownership of the same game — belt-and-suspenders during the brief window of a version update,
on top of the orchestrator's version filter.

## How to extend / rules

- New persisted field → type it, initialize it in `createInitialState`, and **backfill it on load**.
- Decide on a schema bump per [`../must-read/03-versioning-and-schema.md`](../must-read/03-versioning-and-schema.md)
  and keep the manifest, `GameState` type, fresh-state value, and load normalization aligned.
- Don't read a persisted field without a fallback; old saves may predate it.

## Key files

- Bootstrap/load/normalize: [`server/game/state-bootstrap.ts`](../../server/game/state-bootstrap.ts),
  [`server/game/state-normalization.ts`](../../server/game/state-normalization.ts).
- Save/ownership: [`server/game/persistence.ts`](../../server/game/persistence.ts).
- Paths: [`server/game-state-path.ts`](../../server/game-state-path.ts).
- Manifest: [`server/versionManifest.ts`](../../server/versionManifest.ts).
- Tests: [`server/tests/state.test.ts`](../../server/tests/state.test.ts),
  [`server/tests/versioning.test.ts`](../../server/tests/versioning.test.ts).

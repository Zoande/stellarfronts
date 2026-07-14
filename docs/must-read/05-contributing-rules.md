# Contributing Rules & Recipes

How to make changes that compile, stay backward compatible, and pass the test suite. Read
[`03-versioning-and-schema.md`](03-versioning-and-schema.md) and
[`04-backward-compatibility.md`](04-backward-compatibility.md) first — the recipes below assume them.

## Ground rules

- **`src/` is shared** by client and server. A change there rebuilds both. Don't assume a "server
  only" edit.
- **Match the surrounding code.** This codebase favors plain functions, exhaustive `Record<Enum, …>`
  maps (which make the compiler catch missing cases), and explicit normalizers. Follow the local
  idiom rather than introducing new patterns.
- **The server is authoritative.** Validate every command against the sender's perspective and
  ownership; never trust client-supplied state.
- **Gates before you're done:**
  - `npm run server:typecheck` — type-checks server + shared files.
  - `npx tsc --noEmit` — type-checks the client + shared files.
  - `npm run server:test` — the Node test suite. Several tests assert exact economy/building layouts,
    so behavior changes legitimately require test updates — update them deliberately, don't delete
    them.

## Recipe: add a planetary building

Worked end-to-end by the Planetary Capital change; see
[`04-backward-compatibility.md`](04-backward-compatibility.md).

1. **Define it** in `BUILDING_DEFINITIONS` and add the kind to the `BuildingKind` union in
   [`src/data/Economy.ts`](../../src/data/Economy.ts). Fill in cost, build days, `compatibility`
   (which district/sub-district slots), `housing`, and `jobs`.
2. **Update exhaustive maps** the compiler points you to: `BUILDING_ICON_BY_KIND` in
   [`src/ui/CelestialObjectPanel.ts`](../../src/ui/CelestialObjectPanel.ts), and any other
   `Record<BuildingKind, …>`.
3. **Tech-gate it** in [`src/data/Technology.ts`](../../src/data/Technology.ts): add an
   `unlock_building` effect (level 1) and/or include it in the level-unlock building lists. A building
   with no `unlock_building` effect is always available — the guardrail test in
   [`server/tests/technology.test.ts`](../../server/tests/technology.test.ts) requires one unless the
   building is `autoPlaced`.
4. **Server validation** already iterates `BUILDING_KINDS` in `handleBuildPlanetBuilding`
   ([`server/index.ts`](../../server/index.ts)) — confirm cost/compatibility/tech checks behave. If
   the building is special (auto-placed, non-buildable), add the guard there.
5. **Tests:** update economy/state tests that assert starter layouts if your building shifts them.

## Recipe: add a job

1. Append the kind to `JobKind`, `JOB_KINDS`, and `JOB_FILL_ORDER` (fill order = upper→lower
   priority), and add it to `JOB_CLASS_BY_KIND`, `JOB_DEFINITIONS`, and the `JobCapacity` interface +
   `emptyJobCapacity()` in [`src/data/Economy.ts`](../../src/data/Economy.ts).
2. Add a job icon entry to the `Record<JobKind, …>` in
   [`src/ui/CelestialObjectPanel.ts`](../../src/ui/CelestialObjectPanel.ts).
3. **Backward compat:** route any client read of `economy.jobCapacity[job]` through a `?? 0` default
   so a snapshot from an older server (which lacks the new key) doesn't yield `NaN`.

## Recipe: add a client command

1. **Define the message** as a new `*Command` interface and add it to the `ClientCommand` union in
   [`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts).
2. **Dispatch it** in `handleCommand` ([`server/index.ts`](../../server/index.ts)) — add an
   `if (command.type === "yourCommand")` branch that calls your handler.
3. **In the handler:** resolve and validate the faction perspective (observers are read-only — see
   `validateCommandPerspective`/`validatePlanetCommand`), check ownership/visibility via
   [`server/game/state-queries.ts`](../../server/game/state-queries.ts), and gate on tech with
   `requireUnlocked` if relevant.
4. **Mutate, then signal:** mutate `ctx.state`, set `ctx.hasDirtyState = true`, call `accept(socket,
   msg)` / `reject(socket, msg)`, and `broadcastUpdates([...changedFields])` with the relevant
   `ServerUpdateField`s. Planet edits can reuse `commitPlanetState`, which recalculates economy,
   marks dirty, accepts, and broadcasts for you.
5. **Send it from the client** via `GameServerClient.send({ type: "yourCommand", … })`, wired to the
   relevant UI panel.

## Recipe: add a field to persisted `GameState`

1. **Type it** on the relevant interface ([`server/game/types.ts`](../../server/game/types.ts) for
   top-level `GameState`, or the appropriate shared type).
2. **Initialize it** for new games in `createInitialState`
   ([`server/game/state-bootstrap.ts`](../../server/game/state-bootstrap.ts)).
3. **Backfill it** on load — give the normalizer a default (`parsed.newField = parsed.newField ?? …`)
   so old saves don't arrive missing it. Normalization *is* the migration.
4. **Decide on a schema bump.** Additive fields with a backfill usually need none. If you do bump
   `CURRENT_SCHEMA_VERSION`, keep the `GameState.schemaVersion` literal in lockstep — see the known
   inconsistency in [`03-versioning-and-schema.md`](03-versioning-and-schema.md).
5. **Send it to clients** only if needed: add it to the snapshot/update builders and (if the wire
   shape changes incompatibly) bump `protocolVersion`.

## Recipe: add / change a technology

1. Edit `TECHNOLOGY_DEFINITIONS` in [`src/data/Technology.ts`](../../src/data/Technology.ts):
   prerequisites, `positionInTree`, `cost`, `researchModifiers`, and `effects` (unlock buildings/
   levels/ship parts, apply bonuses).
2. The guardrail test expects every non-`autoPlaced` building, every ship hull/module/section to have
   a tech mapping ([`server/tests/technology.test.ts`](../../server/tests/technology.test.ts)) — keep
   that satisfied.

## Don't

- Don't rename or remove persisted fields/enum members without a migration story.
- Don't compute authoritative game state on the client (previews are fine; truth comes from the
  server).
- Don't skip the normalizer default for a new persisted field.
- Don't bump a version number and assume it "handles" old data — the normalizer does that.

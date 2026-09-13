# Glossary

Domain terms used across the codebase and these docs.

### Time & simulation

- **Tick** — one iteration of the server loop, ~every `SERVER_TICK_INTERVAL_MS` (100ms,
  [`server/game/constants.ts`](../../server/game/constants.ts)). Each tick runs `advanceState` and
  broadcasts changes. Distinct from *game time*.
- **Game year / clock** — in-game time, starting at `GAME_START_YEAR` (2100). A game year is
  `GAME_DAYS_PER_YEAR` = 360 days (30 days × 12 months). Helpers in
  [`src/game/GameTime.ts`](../../src/game/GameTime.ts).
- **Tick size / tick speed** — `tickSizeDays` game-days advanced per real `tickSpeedSeconds`;
  together they yield `speedMultiplier` ([`server/game/clock.ts`](../../server/game/clock.ts)).
- **Hour / week / day index** — integer indices derived from the fractional game year, used to fire
  the economy (hourly), population growth (weekly), and leader/event (daily) phases exactly once each.

### Map & visibility

- **System / star** — a star and its planets. Most gameplay happens within a system or across the
  lane network between systems.
- **Hyperlane** — an undirected connection between two stars; fleets travel only along lanes. Stored
  as `hyperlanes` pairs with a derived `adjacency` list.
- **Current / stale / unknown intel** — each known entity field has its own observation status.
  Active sensors make it current; remembered observations become stale; never-observed fields remain
  unknown. See [`../systems/galaxy-map-and-visibility.md`](../systems/galaxy-map-and-visibility.md).
- **Command link** — the authority-and-relay sensor network that permits remote orders. Seeing an
  entity does not by itself guarantee command access.

### Economy & planets

- **District** — a planetary land-use category (city, generator, mining, agriculture) with a build
  limit; provides base jobs and building slots.
- **Building** — a structure occupying a district (or urban sub-district) slot that adds jobs/housing.
  The five-tier planetary capital is **auto-placed** and cannot be queued, disabled, downgraded, or
  demolished.
- **Urban sub-district** — a specialization layer inside city space (residential, research campus,
  industry variants) with its own building slots and compatibility rules.
- **Job** — work a unit of population performs (e.g. farmer, researcher, ruler), with output, upkeep,
  and amenity/crime effects, organized into upper/middle/lower **classes**.
- **Job lock** — a persisted per-job snapshot of every species allocation working that productive
  job. Targets reserve assignment and protect actually staffed workers from outbound migration.
- **Amenities / happiness / crime / stability** — derived planet metrics that drive population growth
  and production multipliers. See [`../systems/population-and-planets.md`](../systems/population-and-planets.md).

### Fleets & combat

- **Fleet** — a group of ships sharing a position, speed (the slowest member), and orders.
- **Colonization order** — a persistent fleet order that moves to an eligible planet, revalidates on
  arrival, and consumes one colonization ship only after successful founding.
- **Phase** — a fleet's movement state (idle, departing, jumping, arriving); see `ShipTransitPhase`.
- **Range band** — discrete distance bucket used to resolve weapon effectiveness in combat.
- **Doctrine / stance / retreat policy** — tactical behavior settings governing how a fleet engages
  and when it retreats ([`src/game/CombatTypes.ts`](../../src/game/CombatTypes.ts)).
- **Dark Matter** — an account-scoped progression reward spent on 10× fleet travel boosts and
  immediate planetary construction completion. It carries across games.

### Protocol & state

- **Snapshot** — the full, perspective-filtered game state sent to a client on connect
  (`GameSnapshot`).
- **Update** — an incremental message carrying only the `ServerUpdateField`s that changed this tick.
- **Detail subscription** — a per-panel channel for large/scoped payloads (planet, starbase, market,
  …) re-sent only when a revision hash changes.
- **Perspective** — a client's view mode: `faction` (a specific country, can issue commands) or
  `observer` (read-only). Drives fog-of-war redaction and command validation.
- **Schema version / protocol version** — the persisted-state and wire-format version numbers in
  [`server/versionManifest.ts`](../../server/versionManifest.ts). See
  [`../must-read/03-versioning-and-schema.md`](../must-read/03-versioning-and-schema.md).

### Versioning & hosting

- **Version** — a registered git ref the orchestrator checks out as an isolated worktree and runs as
  its own game-server process.
- **Orchestrator / gateway** — the process that hosts multiple versions and proxies client
  WebSockets to the right one ([`server/orchestrator.ts`](../../server/orchestrator.ts)).
- **Normalization** — coercing loaded/old state into the current shape with defaults; this *is* the
  save migration mechanism (there are no hand-written migrations).

# Ships, Fleets & Starbases

This is the military/expansion layer: starbases project power and build ships, ships are assembled
from modular designs, and fleets are groups of ships that move and fight. Definitions are in
[`src/data/Starbase.ts`](../../src/data/Starbase.ts) and
[`src/data/ShipDesigns.ts`](../../src/data/ShipDesigns.ts); server construction/spawning in
[`server/game/fleet-factory.ts`](../../server/game/fleet-factory.ts) and
[`server/game/ship-designs.ts`](../../server/game/ship-designs.ts).

## Starbases

A starbase has a `StarbaseLevel` — `outpost` → `starbase` → `starhold` → `starFortress`
(`STARBASE_LEVEL_ORDER`) — with increasing combat stats, building slots, and economy
(`STARBASE_LEVEL_DEFINITIONS`). Building kinds (`StarbaseBuildingKind`): `shipyard`, `solarArray`,
`hydroponicsBay`, `orbitalFabricator`, `alloyAssemblyDock`, `researchAnnex`, `logisticsDepot`
(`STARBASE_BUILDING_DEFINITIONS`). A `shipyard` enables the ship build queue.

Starbases are built from a construction ship, upgraded through the level order, and have construction
queues (`StarbaseConstructionQueueItem`) and ship queues (`StarbaseShipQueueItem`, kinds `build` /
`upgrade`). Server-side: `processStarbaseConstruction`, `processStarbaseRepairs`,
`processStarbaseShipQueues` (called from `advanceState` in [`server/index.ts`](../../server/index.ts)).
Repair rates and alloy/energy costs are in [`server/game/constants.ts`](../../server/game/constants.ts)
(`STARBASE_*_REPAIR_*`).

## Ship designs (modular)

Ships are built from designs (`ShipDesign`). The building blocks in
[`src/data/ShipDesigns.ts`](../../src/data/ShipDesigns.ts):

- **Hulls** (`SHIP_HULL_DEFINITIONS`, keyed by `StarbaseShipKind`): `corvette`, `destroyer`, `cruiser`,
  `battleship`, plus the non-combat `constructionShip` and `colonizationShip`. Hulls define base
  stats and how many **sections** they take.
- **Sections** (`SHIP_SECTION_MODULE_DEFINITIONS`): paired weapon/defense sections that slot into a
  hull (`weaponSection` / `defenseSection`).
- **Modules** (`SHIP_MODULE_DEFINITIONS`): weapon/defense/utility components that fill a section's
  hardpoints; defense modules come in `shield` / `armor` / `hull` kinds, weapons in `small`/`medium`/
  `large` slot sizes.

Players assemble and save designs in the Fleet Manager; designs are stored per faction in
`GameState.shipDesigns` and validated server-side against unlocked tech
([`server/game/research.ts`](../../server/game/research.ts) helpers).

## Ships & fleets

A ship instance (`GameShip`/`ServerShip`) carries its design reference and live shield/armor/hull. A
**fleet** (`GameFleet`/`ServerFleet`) groups ships sharing a system position, a movement `phase`
(idle / departing / jumping / arriving), and orders/stance. Fleet speed is the slowest member;
in-system movement uses `SYSTEM_FLEET_SPEED_UNITS_PER_DAY` and orbit/tactical constants from
[`server/game/constants.ts`](../../server/game/constants.ts). Fleet movement, hyperlane traversal,
merging, orbiting, and retreat are handled in
[`server/game/fleet-combat.ts`](../../server/game/fleet-combat.ts) (`advanceFleet`, `startMoveOrder`,
`findRoute`, …).

Moving fleets can spend account-scoped Dark Matter for a 10× travel boost. Activation prepays one
moving day and the server bills each later day boundary until arrival, deactivation, or insufficient
funds. Route retiming preserves the current position. See
[account-progression-and-dark-matter.md](account-progression-and-dark-matter.md).

## How to extend / rules

- **Add a ship hull/module/section:** add to the relevant `Record` in
  [`src/data/ShipDesigns.ts`](../../src/data/ShipDesigns.ts) and give it an unlocking tech (the
  guardrail test requires one — see [technology-research.md](technology-research.md)).
- **Add a starbase building/level:** extend `STARBASE_BUILDING_DEFINITIONS` /
  `STARBASE_LEVEL_DEFINITIONS` and add an `unlock_starbase_building` tech effect where appropriate.
- Construction is server-authoritative and tech-gated; validate in the relevant command handler.
- New fields on ships/fleets/starbases need normalizer defaults (`normalizeFleet`/`normalizeStarbase`)
  so old saves load.
- Recurring movement modifiers must retime the remaining authoritative movement plan; changing only
  client interpolation or `phaseProgress` will desynchronize arrival.

## Key files

- Starbases: [`src/data/Starbase.ts`](../../src/data/Starbase.ts).
- Ship designs: [`src/data/ShipDesigns.ts`](../../src/data/ShipDesigns.ts).
- Server: [`server/game/fleet-factory.ts`](../../server/game/fleet-factory.ts),
  [`server/game/ship-designs.ts`](../../server/game/ship-designs.ts),
  [`server/game/fleet-combat.ts`](../../server/game/fleet-combat.ts).
- UI: [`src/ui/FleetManagerPanel.ts`](../../src/ui/FleetManagerPanel.ts),
  [`src/ui/StarbasePanel.ts`](../../src/ui/StarbasePanel.ts).
- Tests: [`server/tests/ship-designs.test.ts`](../../server/tests/ship-designs.test.ts).
  Dark Matter movement coverage is in
  [`server/tests/dark-matter.test.ts`](../../server/tests/dark-matter.test.ts).

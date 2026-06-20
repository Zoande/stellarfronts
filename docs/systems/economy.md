# Economy

The economy turns **population working jobs** into **resources**, balanced against **upkeep**, on a
per-planet basis that rolls up into per-faction stockpiles. The model is the largest shared file in
the project: [`src/data/Economy.ts`](../../src/data/Economy.ts). Server processing is
[`server/game/economy-tick.ts`](../../server/game/economy-tick.ts) and
[`server/game/economy-market.ts`](../../server/game/economy-market.ts).

## Resources

Six kinds (`ResourceKind`): `food`, `minerals`, `energy`, `goods`, `alloys`, `research`. Stockpiles
and per-faction monthly deltas live in `FactionEconomyState`. Energy doubles as the market's
settlement currency (see [market.md](market.md)).

## Districts

A planet has four district kinds (`DistrictKind`): `city`, `generator`, `mining`, `agriculture`. Each
has a build limit (`districtLimits`) and grants base jobs plus building slots. City also hosts **urban
sub-districts** (residential, research campus, mixed/civilian/heavy industry) — a specialization layer
with its own slots and compatibility rules.

## Jobs

Population is assigned to jobs (`JobKind`) in `JOB_FILL_ORDER` (upper → lower priority): `ruler`,
`administrator`, `researcher`, `enforcer`, `entertainer`, `artisan`, `metallurgist`, `farmer`,
`miner`, `technician`, `clerk`, plus the derived `criminal` and `unemployed`. Each job has an `output`,
`upkeep`, optional `amenities`, and optional `crimeReduction` in `JOB_DEFINITIONS`, and a class
(upper/middle/lower) used for goods-upkeep tiers. Population is measured in people; economic math runs
per `PEOPLE_PER_MONTHLY_UNIT` (1,000,000) unit.

## Buildings

Buildings (`BuildingKind`) occupy district or sub-district slots and add jobs/housing, scaling with
level (1–5) via `BUILDING_LEVEL_EFFECT_MULTIPLIERS`. Definitions (cost, build days, compatibility,
jobs, housing) live in `BUILDING_DEFINITIONS`. Notable:

- **`planetaryCapital`** is `autoPlaced`: the simulation anchors it to the first city slot of every
  habited planet (`ensureCapitalBuilding`), it can't be queued or demolished, and its higher levels
  are gated by both tech and a **population threshold**
  (`CAPITAL_UPGRADE_POPULATION_THRESHOLDS`). See
  [`../must-read/04-backward-compatibility.md`](../must-read/04-backward-compatibility.md) for the
  full worked example.
- Most buildings are tech-gated via `unlock_building` / level-unlock effects in
  [`src/data/Technology.ts`](../../src/data/Technology.ts).

## The per-planet calculation

`calculatePlanetEconomy(state, districtLimits, externalModifiers, speciesContext)` in
[`src/data/Economy.ts`](../../src/data/Economy.ts) is the heart of the model. Roughly:

1. Sum **job capacity** from districts, sub-districts, and buildings (with modifiers).
2. Compute **housing** from city districts/sub-districts/buildings.
3. **Assign population** to jobs in fill order, respecting species work eligibility; leftovers become
   unemployed, some of which convert to `criminal` under crime pressure.
4. Derive **amenities, happiness, crime, stability** from the assignment (and habitability, housing,
   employment).
5. Produce **resources and upkeep** per pop group, scaled by habitability and stability multipliers.
6. Compute **population growth** (`calculatePopulationGrowth`). Details:
   [population-and-planets.md](population-and-planets.md).

`PlanetModifier`s (from planet features, technologies, government laws, leaders) apply additive/
multiplicative adjustments to targeted things — housing, amenities, crime, stability, job
output/upkeep/capacity, construction speed, per-species habitability, etc. (`PlanetModifierTarget`).

## Per-tick flow (server)

`processEconomyHours` ([`server/game/economy-tick.ts`](../../server/game/economy-tick.ts)) runs on the
hourly index: it recalculates planet economies, applies research progression (see
[technology-research.md](technology-research.md)), and accrues monthly deltas into faction stockpiles.
Construction queues advance via `processPlanetConstruction`. Deficits don't push stockpiles negative;
sustained deficits feed **shortage situations** (see [events-and-situations.md](events-and-situations.md)).

## How to extend / rules

- **Add a building or job:** follow the recipes in
  [`../must-read/05-contributing-rules.md`](../must-read/05-contributing-rules.md). Update *every*
  exhaustive `Record<BuildingKind|JobKind, …>` (the compiler enforces this) and tech-gate as needed.
- **Keep normalizers total:** `PlanetState` is normalized on load via `createPlanetStateFromSeed` /
  `recalculatePlanetStateEconomy`; new fields need defaults so old saves load.
- **Server is authoritative:** clients render `planetState.economy`; they don't compute authoritative
  economy. Optimistic previews are fine but truth comes from the next snapshot.
- **Backward-compat reads:** a new job key may be absent in an older server's `jobCapacity` — default
  reads to `0`.
- **Tests assert layouts:** several economy/state tests check exact starter buildings and job counts;
  update them deliberately when your change shifts them.

## Key files

- Model: [`src/data/Economy.ts`](../../src/data/Economy.ts) (resources, jobs, districts, buildings,
  `calculatePlanetEconomy`, `createPlanetStateFromSeed`, `ensureCapitalBuilding`).
- Tick: [`server/game/economy-tick.ts`](../../server/game/economy-tick.ts),
  [`server/game/economy-market.ts`](../../server/game/economy-market.ts).
- UI: [`src/ui/CelestialObjectPanel.ts`](../../src/ui/CelestialObjectPanel.ts) (planet economy view),
  [`src/ui/PlanetOperationsPanel.ts`](../../src/ui/PlanetOperationsPanel.ts) (construction).
- Tests: [`server/tests/economy.test.ts`](../../server/tests/economy.test.ts).

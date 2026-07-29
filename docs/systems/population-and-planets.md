# Population & Planets

Population is the engine of the economy: it fills jobs, consumes housing and food, and grows or
shrinks based on quality-of-life metrics. This doc covers the planet lifecycle and the derived social
metrics. The model lives alongside the economy in [`src/data/Economy.ts`](../../src/data/Economy.ts);
population growth ticks weekly in [`server/game/population.ts`](../../server/game/population.ts).

## `PlanetState` lifecycle

A planet's persisted state (`PlanetState`) holds `builtDistricts`, `buildings` (per-district slot
arrays), `urbanSubDistricts`, `constructionQueue`, `speciesPopulations`, `features`, `modifiers`, and
a computed `economy: PlanetEconomySummary`.

- **Creation/normalization:** `createPlanetStateFromSeed` (via `createPlanetStateFromConfig` in
  [`src/data/StarMap.ts`](../../src/data/StarMap.ts)) builds/normalizes a planet — applying starter
  infrastructure, anchoring the auto-placed capital, and computing the economy. This runs at galaxy
  bootstrap, on save-load normalization, and on colonization, which is why every habited planet has a
  consistent shape (see [`../must-read/04-backward-compatibility.md`](../must-read/04-backward-compatibility.md)).
- **Recalculation:** `recalculatePlanetStateEconomy` re-normalizes and recomputes after any change
  (the server's `commitPlanetState` uses it).

## Species populations

A planet's people are split by species (`speciesPopulations`). Each species has habitability, growth,
upkeep, and happiness/crime modifiers and a **work eligibility** that limits which job classes it can
fill — see [species-and-rights.md](species-and-rights.md). Job assignment respects these per species.

## Derived social metrics

Computed inside `calculatePlanetEconomy`:

- **Housing** — supplied by city districts/residential sub-districts/housing buildings; demand scales
  with population and per-species housing-use multipliers. Shortfall depresses happiness and growth.
- **Amenities** — supplied by entertainer/ruler/clerk jobs; demand is `getAmenityNeed(population)`
  (per-unit `AMENITY_NEED_PER_UNIT`). Shortfall lowers happiness.
- **Happiness** — blended from habitability, housing, amenities, employment, stability, and per-job
  penalties (unemployed/criminal).
- **Crime** — rises with unhappiness, reduced by enforcer/ruler `crimeReduction`; high crime converts
  some unemployed into `criminal` jobs.
- **Stability** — blended from happiness, crime, housing/amenity/employment shortfalls; scales
  production via a stability multiplier.

## Population growth

`calculatePopulationGrowth` produces a per-quarter rate from a base rate times factors for housing,
amenities, stability, crime, employment, and **capacity pressure** (population vs.
`calculatePlanetCapacity`). Growth is applied incrementally; the server advances it on the weekly
population index (`processPopulationWeeks`), which also handles **migration** between planets/factions
(rates and gating in [`server/game/constants.ts`](../../server/game/constants.ts), e.g.
`MIGRATION_*`). Internal migration is active. Cross-faction migration is currently disabled by the
legacy `haveFactionsMet` compatibility predicate after the old first-contact model was removed;
open-border and migration-pact tiers remain defined but cannot currently produce a foreign flow.

## How to extend / rules

- Tune metrics via the helper functions in [`src/data/Economy.ts`](../../src/data/Economy.ts)
  (happiness/crime/stability/growth helpers) rather than scattering magic numbers.
- New `PlanetState` fields need a normalizer default (old saves won't have them).
- Population is server-authoritative and advanced weekly; don't simulate growth on the client.
- Migration constants live in [`server/game/constants.ts`](../../server/game/constants.ts). If
  foreign migration is re-enabled, replace the legacy first-contact gate deliberately and cover the
  baseline/open-border/pact tiers together.

## Key files

- Model + metrics: [`src/data/Economy.ts`](../../src/data/Economy.ts).
- Growth/migration tick: [`server/game/population.ts`](../../server/game/population.ts).
- Constants: [`server/game/constants.ts`](../../server/game/constants.ts).
- Planet seed/normalization: [`src/data/StarMap.ts`](../../src/data/StarMap.ts).
- Tests: [`server/tests/economy.test.ts`](../../server/tests/economy.test.ts).

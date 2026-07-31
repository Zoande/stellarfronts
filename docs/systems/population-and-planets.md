# Population & Planets

Population fills jobs, consumes housing and food, grows naturally, migrates between worlds, and can
decline during famine. Shared formulas and demographic view types live in
[`src/data/Population.ts`](../../src/data/Population.ts); the economy supplies housing, jobs,
amenities, happiness, stability, crime, and food inputs.

## State and cadence

`PlanetState` persists species populations and a `populationMigration` ledger. Its
`PlanetEconomySummary` exposes three independent views:

- `populationGrowth`: nonnegative natural births per game week.
- `populationDecline`: projected famine deaths per game month.
- `migration`: current attractiveness/intake capacity plus actual inbound and outbound movement from
  the last completed month.

The demographic coordinator is [`server/game/population.ts`](../../server/game/population.ts).
Catch-up is chronological. Weekly growth runs first at a coincident boundary, followed by famine,
economy recalculation, and migration. Old saves initialize the monthly index and an empty ledger at
their current month so load never creates retrospective deaths or migration.

## Natural growth

The neutral base is `0.00025` (0.025%) per week:

`base × population pressure × quality of life × populationGrowth modifiers × species growth`

Population pressure is 1.30 through 50% occupancy, 1.00 at 100%, 0.20 at 150%, and 0.05 at 200% and
above, with linear interpolation between anchors. Quality of life equally weights normalized
housing satisfaction, amenity satisfaction, stability, and safety (`1 − crime`) and maps the result
to 0.70–1.30. The final rate is clamped nonnegative, so breeder traits, living standards, leaders,
technology, and nebula effects modify births only.

Planet capacity is deliberately hidden from the player. It blends:

- 35% maximum productive jobs from the best level-1 use of all district and compatible building
  slots.
- 35% maximum housing from the best level-1 housing layout.
- 30% currently vacant productive jobs.

Potential layouts ignore technology. `planetCapacity` modifiers apply after blending and the
technical minimum is 1M.

## Migration

Migration runs monthly and conserves total population. Attractiveness is scored 0–100 from 25%
happiness, 20% stability, 15% safety, 15% amenity satisfaction, and 25% vacant jobs; the jobs
component reaches its maximum at vacancies equal to 20% of population.

Monthly intake is `5M / 10M / 20M / 40M / 80M` for capital levels 1–5 plus 2.5M per built city
district. Cohorts are processed as unemployed, productive lower class (criminals use this tier),
middle class, then upper class. Unemployed residents need any compatible vacancy. Employed cohorts
need a matching-class vacancy and an attractiveness improvement of +10/+20/+30 respectively.
Allocation is deterministic and proportional across eligible sources, limited by intake and
vacancies.

Destinations require at least 20 species habitability. Habitability and nearby-first hyperlane
distance affect destination weight, not the displayed attractiveness score. Internal movement
requires `Internal Only` or `Free Migration`. Foreign movement requires `Free Migration` in both
empires and an active, unsuspended migration pact; open borders alone are insufficient.

## Founding colonies

Colonization is a persistent fleet order, not an instant remote action. The server accepts it only
when the system is owned, the world is uninhabited and permitted by its planet type, founding-species
effective habitability is above zero, the route and command link are valid, and the fleet has a
surviving colonization ship. The fleet travels into the target planet's orbit and revalidates all
conditions on arrival. Success consumes exactly one colonization ship. Failure preserves the ship,
clears the order, and leaves the fleet orbiting; therefore competing orders are safe and the first
successful arrival wins.

`PlanetTypeConfig.colonizableByDefault` is false for Gaseous, Methane, Barren, Dusty, and Martian
worlds, and true for Snowy, Arid, Grassland, Jungle, Marshy, Sandy, and Tundra. The shared eligibility
predicate has an explicit future override hook, but no unlocking technology exists yet. Existing
colonies on restricted types remain valid.

New colonies begin with 500M founding-species population, a tier-1 Colony Headquarters, and zero
built districts. No rule forces a two-city minimum in planet state or mirrored star metadata.
Homeworld starter infrastructure remains seeded, and existing saves retain districts already built.
Planet abandonment and capture behavior are unchanged.

For ten exact game years, newly founded colonies receive the visible **Frontier Settlement**
modifier: +20 migration attractiveness (final score still clamps to 0–100), +20M monthly migration
intake, +10 stability, +25% district/building construction speed, and +25% natural growth. It gives
no resource, housing, or habitability bonus. Existing saves receive no retroactive modifier.

Planet Operations enumerates planets by owned **system**, including its uninhabited worlds. Each
entry carries the system owner, founding-species id/name/effective habitability, and a typed
eligibility result so the UI can distinguish `Colonizable`, `Restricted world`, and `Unsuitable`
(for example, `Human — 65%`).

## Famine

A planet is in famine while empire food-shortage progress is at least 34 and its local monthly food
net is negative. It recovers when either condition ends.

`deficitRatio = (food upkeep − food production) / food upkeep`

`crisisFactor = (shortage progress − 34) / 66`

At full deficit and crisis, monthly deaths are 0.20% for non-farmer lower class, 0.05% for middle
class, and 0.002% for farmers. Upper class is immune while any lower or middle residents exist at
the start of the tick; afterward its rate is 0.02%. Deaths are allocated across affected species and
never reduce a habited planet below the universal 1M floor.

## Key files

- Shared formulas/types: [`src/data/Population.ts`](../../src/data/Population.ts).
- Economy inputs/state: [`src/data/Economy.ts`](../../src/data/Economy.ts).
- Weekly births: [`server/game/population-growth.ts`](../../server/game/population-growth.ts).
- Monthly famine: [`server/game/population-famine.ts`](../../server/game/population-famine.ts).
- Monthly migration: [`server/game/population-migration.ts`](../../server/game/population-migration.ts).
- Colonization eligibility: [`src/data/Colonization.ts`](../../src/data/Colonization.ts).
- Server founding: [`server/game/colonization.ts`](../../server/game/colonization.ts).
- UI: [`src/ui/CelestialObjectPanel.ts`](../../src/ui/CelestialObjectPanel.ts).
- Tests: [`server/tests/population.test.ts`](../../server/tests/population.test.ts).

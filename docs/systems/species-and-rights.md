# Species & Rights

Species define a population's innate traits; rights define how a faction treats each species. Both
feed directly into the economy (habitability, births, upkeep, happiness, crime, work eligibility).
Model: [`src/data/Species.ts`](../../src/data/Species.ts); economy hooks live in
[`src/data/Economy.ts`](../../src/data/Economy.ts).

## Species

`SpeciesState` carries an archetype (`SpeciesArchetypeId`: `humanoid`, `avian`, `reptilian`,
`aquatic`, `fungoid`) and a set of traits (`SpeciesTraitId`). Traits (`SPECIES`-trait definitions)
are 10 positive (`adaptive`, `intelligent`, `rapidBreeders`, `industrious`, `agrarian`, `ingenious`,
`communal`, `charismatic`, `conservationist`, `resilient`) and 5 negative (`nonadaptive`,
`slowBreeders`, `wasteful`, `unruly`, `delicate`), chosen within a point budget validated by
`SpeciesTraitValidation` (see `SpeciesSetup`). Human is the default founding species.

## Rights

Per faction, per species (`FactionSpeciesRightsState` → `SpeciesRights`), across four categories
(`SpeciesRightsCategory`):

- **Living standard** (`LivingStandardId`): `luxurious` → `comfortable` → `basic` → `subsistence` →
  `oppressed` — trades upkeep against happiness.
- **Citizenship** (`CitizenshipStatusId`): `fullCitizenship`, `residence`, `limitedRights`,
  `nonCitizen` — affects happiness/crime.
- **Migration** (`MigrationRightsId`): `notAllowed`, `internalOnly`, `free`. Happiness effects are
  -4/-2/0; migration rights do not modify natural growth.
- **Work eligibility** (`WorkEligibilityId`): `allJobs`, `noAuthority`, `laborOnly` — limits which job
  classes the species can fill (enforced during job assignment in
  [`src/data/Economy.ts`](../../src/data/Economy.ts) via `canRightsWorkJob`).

## Economy effects

`getSpeciesEconomyEffects` / `getSpeciesJobOutputMultiplier`
([`src/data/Species.ts`](../../src/data/Species.ts)) turn traits + rights into multipliers the
economy applies: habitability add, growth, housing-use, amenities, goods-upkeep, and happiness/crime/
stability adjustments. The planet economy receives these via a `PlanetEconomySpeciesContext`.

## Law constraints

Government laws (especially `speciesPolicy`, `civilRights`, and `migrationPolicy`) constrain which rights are legal — e.g.
pluralist protections block `oppressed`/restricted work, stratified codes allow harsher settings.
Normalization (`normalizeSpeciesRights`) clamps rights to the allowed range. See
[government-and-leaders.md](government-and-leaders.md).

Migration Policy is an eligibility controller: Free Movement permits Internal Only/Free; Managed
Migration permits all three; Migration Controls permits Not Allowed/Internal Only; Closed Movement
permits only Not Allowed. Legacy saves map `prohibited → notAllowed`, `controlled → internalOnly`,
and `free → free`.

## How to extend / rules

- **Add a trait:** add to `SpeciesTraitId` + the trait definitions with its economy effect and point
  cost; the exhaustive maps force completeness.
- **Add a rights option:** extend the relevant id union and the options/normalization, and apply its
  effect in `getSpeciesEconomyEffects` / job-eligibility checks.
- Rights are validated against current laws on change and on load — keep `normalizeSpeciesRights`
  total.
- Job assignment must respect `canRightsWorkJob`; don't bypass it when adding jobs.

## Key files

- Model + effects: [`src/data/Species.ts`](../../src/data/Species.ts).
- Economy integration: [`src/data/Economy.ts`](../../src/data/Economy.ts).
- UI: [`src/ui/SocietyPanel.ts`](../../src/ui/SocietyPanel.ts).
- Tests: [`server/tests/species.test.ts`](../../server/tests/species.test.ts).

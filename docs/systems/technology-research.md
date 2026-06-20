# Technology & Research

Research unlocks buildings, ship parts, and bonuses, gating progression. The tree and effects are in
[`src/data/Technology.ts`](../../src/data/Technology.ts); per-faction research is advanced in
[`server/game/research.ts`](../../server/game/research.ts).

## The tree

`TECHNOLOGY_DEFINITIONS` is a flat list of `TechnologyDefinition`s, each with an `id`, `name`,
`category` (`agriculture`, `industry`, `military`, `logistics`, `energy`, `computing`, `society`),
`tier`, `cost`, `prerequisites`, `positionInTree` (for the UI grid), optional `defaultUnlocked`,
`researchModifiers`, and `effects`. `TECHNOLOGY_BY_ID` indexes them.

**Effects** (`TechnologyEffect`) include: `unlock_building`, `unlock_building_level`,
`unlock_starbase_building`, `unlock_ship_hull`/`unlock_ship_module`/`unlock_ship_section`, plus
output/construction/research bonuses. The `getRequiredTechIdsFor*` helpers resolve which techs gate a
given building/ship part — used by both the UI (to show "Requires X") and the server (to validate
construction via `requireUnlocked`).

## Per-faction progress

`FactionTechState` tracks `completedTechIds`, the active tech, and per-tech `TechProgress` (total /
active / passive). The split is fixed by `ACTIVE_RESEARCH_FRACTION` (0.8) and
`PASSIVE_RESEARCH_FRACTION` (0.2); passive progress on any single tech is capped at
`DEFAULT_PASSIVE_RESEARCH_CAP_FRACTION` (0.8) of its cost so you can't finish a tech passively.

## How research advances

Each economy hour, [`server/game/research.ts`](../../server/game/research.ts):

1. Computes research points/hour from a baseline (`BASELINE_RESEARCH_PER_HOUR` = 0.25) plus economic
   income, times the government's research-speed multiplier.
2. Builds a `ResearchContext` (job counts, fleet power, at-war, food status, labs, …) and evaluates
   each tech's `researchModifiers` against it, yielding a per-tech multiplier clamped between
   `MIN_TECH_RESEARCH_MULTIPLIER` (1) and `MAX_TECH_RESEARCH_MULTIPLIER` (2).
3. Spends the **active** pool on the current tech (auto-advancing to the next available tech when one
   completes) and distributes the **passive** pool across available techs by their passive affinity,
   each capped.
4. On completion, the tech's effects apply (buildings/ship parts become constructible, bonuses take
   hold).

Government laws can shift the active/passive allocation and research speed — see
[government-and-leaders.md](government-and-leaders.md).

## How to extend / rules

- **Add a tech:** append to `TECHNOLOGY_DEFINITIONS` with prerequisites, cost, position, and effects.
- **Gating guardrail:** the test in
  [`server/tests/technology.test.ts`](../../server/tests/technology.test.ts) requires every ship hull/
  module/section and every non-`autoPlaced` building to have at least one unlocking tech — keep it
  satisfied when adding content.
- Server-side construction must check `isUnlockedByAnyRequiredTech` / `requireUnlocked`; don't rely on
  the client to enforce gating.

## Key files

- Model + tree + helpers: [`src/data/Technology.ts`](../../src/data/Technology.ts).
- Research tick: [`server/game/research.ts`](../../server/game/research.ts).
- UI: [`src/ui/TechnologyPanel.ts`](../../src/ui/TechnologyPanel.ts).
- Tests: [`server/tests/technology.test.ts`](../../server/tests/technology.test.ts).

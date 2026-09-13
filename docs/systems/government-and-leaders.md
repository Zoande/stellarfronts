# Government & Leaders

Government laws set empire-wide policy and modifiers; leaders fill government positions and command
planets/fleets for level-scaled bonuses. Models: [`src/data/Government.ts`](../../src/data/Government.ts)
and [`src/data/Leaders.ts`](../../src/data/Leaders.ts). Server processing (daily leader/government
effects, events) in [`server/game/leaders-events.ts`](../../server/game/leaders-events.ts).

## Government

`FactionGovernmentState` records the chosen option per law and the leaders in each position. Laws
(`GovernmentLawId`): `economicPolicy`, `civilRights`, `speciesPolicy`, `migrationPolicy`,
`policingDoctrine`, `researchCharter`, `militaryDoctrine`. Each `GovernmentLawDefinition`
(`GOVERNMENT_LAW_DEFINITIONS`) offers several `GovernmentLawOption`s, each carrying `GovernmentEffect`s:

- **Planet modifiers** (job output, construction, happiness, crime, stability — the same
  `PlanetModifier` targets the economy uses).
- **Fleet modifiers** (`GovernmentFleetModifierTarget`: `attack`, `speed`, `shield`, `upkeep`,
  `evasion`).
- **Research** allocation/speed adjustments (shifting the active/passive split and multiplier).
- **Empire stats** (`GovernmentEmpireStat`) and **flags** that unlock special mechanics.
- **Leader-trait interactions** (`GovernmentLeaderTraitEffect`).

Options can be tech-gated and can conflict with certain species rights (see
[species-and-rights.md](species-and-rights.md)). Positions (`GovernmentPositionId`): `president`,
`headOfResearch`, `headOfDevelopment`, `ministerOfDefense` (`GOVERNMENT_POSITION_DEFINITIONS`), each
requiring a leader of the right class and applying level-scaled effects.

Command: `setGovernmentLaw` ([`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts)); applied
server-side.

Migration Policy controls which per-species migration rights are legal; it does not multiply
migration rates. Foreign movement additionally requires Free Migration rights on both sides and an
active migration pact.

## Leaders

`LeaderState` ([`src/data/Leaders.ts`](../../src/data/Leaders.ts)) has a `LeaderClass`
(`civilian`/`military`), `LeaderStatus` (`pool`/`recruited`/`dead`), XP/level
(`calculateLeaderLevel`, `LEADER_MAX_LEVEL` = 100, `LEADER_XP_LEVEL_FACTOR` = 220), traits
(`LeaderTraitId`, `LEADER_TRAIT_DEFINITIONS`), and an optional `LeaderAssignment`
(`planet`/`fleet`/`government`). Traits apply `LeaderPlanetEffect`s or `LeaderFleetEffects` depending
on assignment. `LEADER_POOL_PER_CLASS` (3) governs the recruitable pool size; legendary trait sets
exist via `getLegendaryClassTraits`.

Commands: `recruitLeader`, `assignLeader`, `dismissLeader`. The server advances leader effects/XP on
the daily leader index (`processLeaderDays` in
[`server/game/leaders-events.ts`](../../server/game/leaders-events.ts), called from `advanceState`).

> **Maturity:** the law/position/assignment systems are mature; leader **pool generation and
> legendary offers** are still being filled in.

## How to extend / rules

- **Add a law option / position:** extend the relevant `Record`/definition arrays; wire any new
  `GovernmentEffect` target through the place that applies effects (planet/fleet/research).
- **Add a leader trait:** add to `LeaderTraitId` and `LEADER_TRAIT_DEFINITIONS` with its planet/fleet
  effect; the exhaustive `Record` will force you to define it.
- Government/leader effects reuse the economy's `PlanetModifier` machinery — prefer that over bespoke
  hooks.
- New government/leader state needs normalizer defaults.

## Key files

- Government: [`src/data/Government.ts`](../../src/data/Government.ts).
- Leaders: [`src/data/Leaders.ts`](../../src/data/Leaders.ts), UI helper
  [`src/ui/leaderEvents.ts`](../../src/ui/leaderEvents.ts).
- Server: [`server/game/leaders-events.ts`](../../server/game/leaders-events.ts).
- UI: [`src/ui/GovernmentPanel.ts`](../../src/ui/GovernmentPanel.ts),
  [`src/ui/LeadersPanel.ts`](../../src/ui/LeadersPanel.ts).
- Tests: [`server/tests/government.test.ts`](../../server/tests/government.test.ts).

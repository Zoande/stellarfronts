# Combat

Combat is continuous and tactical: fleets engage within a system across discrete range bands, and
damage resolves through shields → armor → hull. Types live in
[`src/game/CombatTypes.ts`](../../src/game/CombatTypes.ts) and
[`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts); power math in
[`src/game/combatPower.ts`](../../src/game/combatPower.ts) and
[`src/game/tacticalFormation.ts`](../../src/game/tacticalFormation.ts); resolution on the server in
[`server/game/combat.ts`](../../server/game/combat.ts) and
[`server/game/fleet-combat.ts`](../../server/game/fleet-combat.ts).

## Range bands

Distance between combatants maps to a `RangeBand` (`RANGE_BANDS`): `pointBlank`, `close`, `medium`,
`long`, `extreme`, `outOfRange` ([`src/game/CombatTypes.ts`](../../src/game/CombatTypes.ts)). Weapon
kinds (`WeaponKind`: `laser`, `missile`, `pointDefense`, `railgun`, `plasma`,
`WEAPON_KIND_DEFINITIONS` in [`src/data/Starbase.ts`](../../src/data/Starbase.ts)) are effective in
different bands and have different penetration vs. shields/armor — a soft rock-paper-scissors.

## Damage model

Ships and starbases share a shield/armor/hull layout (`CombatStats`). Damage applies to shields
first, then armor, then hull. Shields regenerate when out of combat; armor/hull are repaired with
alloys/energy (starbase repair via `processStarbaseRepairs`; rates in
[`server/game/constants.ts`](../../server/game/constants.ts)). Destroyed ships are removed; a fleet
reduced past its retreat threshold disengages.

## Tactical behavior

Fleets carry combat settings from [`src/game/CombatTypes.ts`](../../src/game/CombatTypes.ts):

- `CombatStance`, `FleetBehavior` (`artillery`, `line`, `brawler`, `swarm`, `defender`),
  `FleetChasePolicy`, and `FleetRetreatPolicy` (`none`/`low`/`medium`/`high`, thresholds in
  `FLEET_RETREAT_THRESHOLDS`).
- `FleetTacticalOrderType` (`move`, `attack`, `hold`, `guard`, `retreat`) and `CombatTargetKind`
  (`fleet` / `starbase`).
- Formation spread/evasion come from [`src/game/tacticalFormation.ts`](../../src/game/tacticalFormation.ts)
  and `FORMATION_EVASION_BONUS` in [`server/game/constants.ts`](../../server/game/constants.ts).

## Resolution loop

`processContinuousFleetCombat` ([`server/game/fleet-combat.ts`](../../server/game/fleet-combat.ts))
runs each tick: it positions fleets, computes range bands, fires ready weapons, applies damage,
checks retreat, and records `recentCombatContacts` (bounded by `RECENT_COMBAT_CONTACT_HISTORY`).
Emergency retreats can damage/scatter a fleet (`EMERGENCY_RETREAT_*` constants) and send ships
"missing in action" (`processMissingInActionFleets`). Combat contact between factions also triggers
first-contact ("met") and can change ownership — feeding diplomacy and visibility.

`combatPower` ([`src/game/combatPower.ts`](../../src/game/combatPower.ts)) computes a composite fleet
strength used for previews and as a research-context input.

## How to extend / rules

- Tune weapon behavior via `WEAPON_KIND_DEFINITIONS` and the range-band tables, not scattered
  literals.
- Keep combat **server-authoritative**: the client renders effects (see
  [`../client/scenes-and-rendering.md`](../client/scenes-and-rendering.md)) but never resolves damage.
- New fleet combat settings need normalizer defaults so old saves and older-server snapshots stay
  valid.

## Key files

- Types: [`src/game/CombatTypes.ts`](../../src/game/CombatTypes.ts).
- Power/formation: [`src/game/combatPower.ts`](../../src/game/combatPower.ts),
  [`src/game/tacticalFormation.ts`](../../src/game/tacticalFormation.ts).
- Server: [`server/game/combat.ts`](../../server/game/combat.ts),
  [`server/game/fleet-combat.ts`](../../server/game/fleet-combat.ts).
- Tests: [`server/tests/combat.test.ts`](../../server/tests/combat.test.ts),
  [`server/tests/tactical-formation.test.ts`](../../server/tests/tactical-formation.test.ts).

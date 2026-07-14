# Data Model Reference

The authoritative shape of a game's persisted state. The canonical type is `GameState` in
[`server/game/types.ts`](../../server/game/types.ts); each field is defined by a shared type under
`src/data/` or `src/game/`. This page is a lookup index — follow the links for the real definitions.

## `GameState` (top level)

From [`server/game/types.ts`](../../server/game/types.ts):

| Field | Type / source | What it is |
| --- | --- | --- |
| `schemaVersion` | literal `20` | On-disk schema marker (see note below). |
| `stars` | `StarData[]` ([`StarMap.ts`](../../src/data/StarMap.ts)) | Every star and its planet configs. |
| `planetStates` | `PlanetState[]` ([`Economy.ts`](../../src/data/Economy.ts)) | Per-planet economy: districts, buildings, population, computed `economy` summary. |
| `factionEconomies` | `FactionEconomyState[]` ([`Economy.ts`](../../src/data/Economy.ts)) | Per-faction stockpiles and monthly deltas. |
| `factionTechnologies` | `FactionTechState[]` ([`Technology.ts`](../../src/data/Technology.ts)) | Per-faction research progress, active tech, completed techs. |
| `governments` | `FactionGovernmentState[]` ([`Government.ts`](../../src/data/Government.ts)) | Per-faction laws, positions, effects. |
| `species` | `SpeciesState[]` ([`Species.ts`](../../src/data/Species.ts)) | Species definitions (archetype, traits). |
| `speciesRights` | `FactionSpeciesRightsState[]` ([`Species.ts`](../../src/data/Species.ts)) | Per-faction rights per species. |
| `diplomacy` | `DiplomacyState` ([`Diplomacy.ts`](../../src/data/Diplomacy.ts)) | Wars, treaties, proposals, border policies, messages. |
| `market` | `MarketState` ([`Market.ts`](../../src/data/Market.ts)) | Prices, pressure, auto-trades, history. |
| `leaders` | `LeaderState[]` ([`Leaders.ts`](../../src/data/Leaders.ts)) | Leader pool and assignments. |
| `situations` | `ActiveSituation[]` ([`Situations.ts`](../../src/data/Situations.ts)) | Ongoing monitored conditions. |
| `events` | `ActiveEvent[]` ([`Events.ts`](../../src/data/Events.ts)) | Pending per-faction decision events. |
| `factionModifiers` | `FactionModifierState[]` ([`GameEffects.ts`](../../src/data/GameEffects.ts)) | Timed empire-wide modifiers. |
| `hyperlanes` | `Array<[number, number]>` | Undirected star-id pairs (the lane graph). |
| `adjacency` | `number[][]` | Adjacency list derived from `hyperlanes`. |
| `factions` | `FactionInfo[]` ([`Factions.ts`](../../src/data/Factions.ts)) | Faction identity (name, color, home star). |
| `starOwnership` | `number[]` | Owner faction id per star index (`-1` = unowned). |
| `starbases` | `ServerStarbase[]` ([`GameProtocol.ts`](../../src/game/GameProtocol.ts)) | All starbases with level, buildings, combat stats, queues. |
| `shipDesigns` | `ShipDesign[]` ([`ShipDesigns.ts`](../../src/data/ShipDesigns.ts)) | Saved per-faction ship designs. |
| `ships` | `GameShip[]` | All ships (hp/shield/armor/hull, design ref). |
| `fleets` | `GameFleet[]` | Fleets (ship membership, position, phase, orders). |
| `recentCombatContacts` | `ServerCombatContact[]` | Rolling combat-event log. |
| `discoveredByFaction` | `Record<string, number[]>` | Stars each faction has ever discovered. |
| `metByFaction` | `Record<string, number[]>` | Symmetric first-contact record (monotonic). |
| `lastKnownOwnershipByFaction` | `Record<string, number[]>` | Each faction's last-seen ownership snapshot (fog of war). |
| `clock` | `GameClock & {...}` ([`GameProtocol.ts`](../../src/game/GameProtocol.ts)) | Year, speed, paused, plus last-processed indices. |

> **Schema note.** `GameState.schemaVersion` is a literal `20`, distinct from
> `VERSION_MANIFEST.schemaVersion`. See the known inconsistency in
> [`../must-read/03-versioning-and-schema.md`](../must-read/03-versioning-and-schema.md).

## Frequently referenced nested types

- **`PlanetState`** ([`Economy.ts`](../../src/data/Economy.ts)) — `builtDistricts`, `buildings`
  (per-district slot arrays), `urbanSubDistricts`, `constructionQueue`, `speciesPopulations`, and a
  computed `economy: PlanetEconomySummary` (production/upkeep/net, `jobCapacity`, `popGroups`,
  housing/amenities/happiness/crime/stability/growth).
- **`ServerFleet` / `GameFleet`** ([`GameProtocol.ts`](../../src/game/GameProtocol.ts),
  [`types.ts`](../../server/game/types.ts)) — ship ids, system position, `phase`
  (idle/departing/jumping/arriving), order, combat stance/retreat policy. `GameFleet` adds
  `phaseElapsedMs` for server-side phase timing.
- **`ServerStarbase`** ([`GameProtocol.ts`](../../src/game/GameProtocol.ts)) — level, `status`
  (online/building), shield/armor/hull, weapon cooldowns, construction queues.
- **`FactionEconomyState`** ([`Economy.ts`](../../src/data/Economy.ts)) — `stockpiles`,
  `monthlyDelta`, `marketMonthlyDelta`, `lastProcessedMonth/Hour`.
- **`GameClock`** ([`GameProtocol.ts`](../../src/game/GameProtocol.ts)) — `year`, `tickSizeDays`,
  `tickSpeedSeconds`, `paused`, `speedMultiplier`, `syncedAtMs`. Time helpers and constants live in
  [`src/game/GameTime.ts`](../../src/game/GameTime.ts).

## Wire types (not persisted, but mirror the model)

The client never sees raw `GameState`. It receives a **perspective-filtered** `GameSnapshot` and
incremental `GameUpdate`s, both defined in
[`src/game/GameProtocol.ts`](../../src/game/GameProtocol.ts). The set of fields an update can carry is
the `ServerUpdateField` union. See
[`../server/protocol-and-snapshots.md`](../server/protocol-and-snapshots.md).

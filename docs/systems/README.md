# Gameplay Systems

Each system has a shared model under `src/data/` (used by both client and server) and a server-side
processor under `server/game/` that advances it each tick. These docs pair the two and end with *How
to extend / rules* and *Key files*.

## The docs

| Doc | System |
| --- | --- |
| [economy.md](economy.md) | Resources, jobs, districts, buildings, the per-planet economy calculation. |
| [population-and-planets.md](population-and-planets.md) | Population, housing, amenities, happiness, crime, stability, growth, planet lifecycle. |
| [technology-research.md](technology-research.md) | Tech tree, prerequisites, unlock effects, active/passive research, modifiers. |
| [galaxy-map-and-visibility.md](galaxy-map-and-visibility.md) | Galaxy generation, hyperlanes, sensor suites, field-level intelligence, command links. |
| [ships-fleets-starbases.md](ships-fleets-starbases.md) | Starbases, ship designs (hulls/sections/modules), fleets, build queues. |
| [combat.md](combat.md) | Range bands, shield/armor/hull, tactical orders/formation, resolution. |
| [diplomacy.md](diplomacy.md) | Border policies, wars, treaties, proposals, peace, messaging. |
| [government-and-leaders.md](government-and-leaders.md) | Laws, positions, leaders, traits, assignments. |
| [species-and-rights.md](species-and-rights.md) | Archetypes, traits, rights, law constraints, economy effects. |
| [market.md](market.md) | Tradeable resources, price-pressure model, auto-trade, snapshots. |
| [events-and-situations.md](events-and-situations.md) | Situations, events, notifications (framework + current catalog). |
| [account-progression-and-dark-matter.md](account-progression-and-dark-matter.md) | Account XP, levels, achievements, quests, and cross-game Dark Matter spending. |

## How systems connect

The server runs them in a fixed order each tick (`advanceState` in
[`server/index.ts`](../../server/index.ts)) — see [`../server/runtime-and-tick.md`](../server/runtime-and-tick.md).
The main couplings:

| Drives | … into | Via |
| --- | --- | --- |
| Economy (researcher jobs) | Technology | research points per hour |
| Technology | Buildings / ships / bonuses | `unlock_*` effects + job/output modifiers |
| Ships/starbases | Combat | composition + module stats → combat power |
| Combat / movement | Intelligence / ownership | sensor coverage, contacts, and system control changes |
| Government laws | Economy / research / fleets | planet, research-allocation, and fleet modifiers |
| Leaders | Government / economy / fleets | filling positions, planet/fleet effects |
| Species traits & rights | Economy | habitability, growth, upkeep, happiness, crime, work eligibility |
| Economy ↔ Market | Stockpiles | trades and internal supply/demand pressure |
| Economy deficits | Situations → Events | shortage thresholds → crisis events |
| Account progression | Dark Matter boosts | achievement/quest rewards → fleet and construction acceleration |

## Maturity

Mature: economy, population, technology, galaxy/visibility, ships/starbases/fleets, combat, market,
diplomacy, government, species. WIP: the **events/situations catalog** (framework solid, few
scenarios) and parts of **leaders** (pool/legendary generation).

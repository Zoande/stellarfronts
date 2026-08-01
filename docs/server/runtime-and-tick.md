# Runtime & Tick

The game server runs one `RuntimeContext` per game and advances it on a fast timer. Games sharing a
version process are failure-isolated. This doc is the authoritative description of the loop and time
model.

## `RuntimeContext`

Defined in [`server/game/types.ts`](../../server/game/types.ts), `RuntimeContext` holds the mutable
`state: GameState`, the connected `clients`, dirty/save bookkeeping (`hasDirtyState`, `lastSaveAt`),
and a set of hoisted callbacks wired up in `createGameRuntime` (e.g. `recalculatePlanetEconomies`,
`refreshFactionEconomyDeltas`, `refreshDiscovery`, `broadcastUpdates`, `createInitialState`). The
runtime exposes the `GameRuntime` interface: `attachClient`, `tick`, `save`, `dispose`, `getStats`.

## The timer

`tick(now)` ([`server/index.ts`](../../server/index.ts)) runs roughly every
`SERVER_TICK_INTERVAL_MS` (100ms, [`server/game/constants.ts`](../../server/game/constants.ts)). Each
tick:

1. `const changed = advanceState(now)` — advance the simulation, collecting changed fields.
2. `broadcastUpdates(Array.from(changed))` — send each client a perspective-filtered update.
3. `flushPlanetDetailRefreshes()` — push any queued planet detail updates to subscribers.
4. Save if dirty and `now - lastSaveAt >= SAVE_INTERVAL_MS` (5s).

The version host catches failures per game. A load or tick failure releases that game's ownership,
disconnects its clients, records a diagnostic heartbeat, and quarantines only that game. Healthy
games on the same version continue. The dev panel exposes load failures, last-save time, and
current/maximum tick duration.

## Time model

Time helpers and constants live in [`src/game/GameTime.ts`](../../src/game/GameTime.ts); clock
normalization in [`server/game/clock.ts`](../../server/game/clock.ts).

- The clock starts at `GAME_START_YEAR` (2100). A game **year** is `GAME_DAYS_PER_YEAR` = 360 days
  (30 days × 12 months); a **day** is 24 hours; `REAL_MS_PER_GAME_HOUR` = 1000.
- `tickSizeDays` / `tickSpeedSeconds` set the pace; `computeSpeedMultiplier` = `tickSizeDays * 24 /
  tickSpeedSeconds` (0 when paused). Defaults: `DEFAULT_TICK_SIZE_DAYS` = 1/24 (one game hour) per
  `DEFAULT_TICK_SPEED_SECONDS` = 1 real second.
- `advanceState` converts elapsed real-ms into elapsed game days/hours, advances `clock.year`
  continuously, and derives integer **indices** (`gameYearToHourIndex`, `gameYearToWeekIndex`,
  leader-day index) so periodic phases fire exactly once each.

## The `advanceState` pipeline

`advanceState(now)` ([`server/index.ts`](../../server/index.ts)) returns a
`Set<ServerUpdateField>` of what changed. If paused, it just syncs clock timestamps and returns. The
phases run in this order — each adds fields to the `changed` set:

1. **Dark Matter fleet billing + clock** — bill moving-day boost boundaries up to the target time,
   retime exhausted fleets, then advance `clock.year`; add `clock`/`fleets`.
2. **Intelligence and fleet movement** — refresh sensor intelligence, stop/recover fleets that lost
   their command link, run `advanceFleet`, and refresh intelligence again if anything moved.
3. **Missing-in-action** — `processMissingInActionFleets` (emergency-retreat recovery).
4. **Continuous combat** — `processContinuousFleetCombat` → ships/fleets/starbases/combatContacts/
   visibility.
5. **Leaders & government** — `processLeaderDays` on the daily index → leaders/governments/economy/
   fleets/technologies.
6. **Construction & repairs** — `processPlanetConstruction`, `processStarbaseConstruction`,
   starbase/ship/construction repairs, and `processStarbaseShipQueues`.
7. **Economy** — `processEconomyHours` on the hourly index → factionEconomies, and research →
   technologies.
8. **Market** — `processMarketTicks` → market / tradeAlerts / factionEconomies.
9. **Shortages** — `processShipShortageEffects` (resource deficits degrade ships/starbases).
10. **Population** — `processPopulationPeriods` advances weekly births and monthly famine/migration
    chronologically → factionEconomies / habitedPlanetSystems.
11. **Situations & events** — `processSituations`, `processRandomEvents`, `processEventTimeouts`.

The order matters: economy deltas feed situations (with a deliberate one-tick lag), research consumes
economy output, and intelligence is refreshed whenever movement/combat changes the map.

## How to extend / rules

- Add a phase as `processX(ctx, …)` in `server/game/` and call it from `advanceState` at the right
  point, adding the right `ServerUpdateField`s.
- Gate periodic work on the game-time **index**, not wall-clock, so it fires deterministically.
- Authoritative commands run through `runAuthoritativeCommand`, which guarantees mutating commands
  become durable. Use `applyMutationEffects` for ordered recalculation, discovery/intelligence,
  detail invalidation, dirty state, and broadcasts.

## Key files

- Loop + pipeline: [`server/index.ts`](../../server/index.ts).
- Clock: [`server/game/clock.ts`](../../server/game/clock.ts),
  [`src/game/GameTime.ts`](../../src/game/GameTime.ts).
- Constants: [`server/game/constants.ts`](../../server/game/constants.ts).
- Context/types: [`server/game/types.ts`](../../server/game/types.ts).

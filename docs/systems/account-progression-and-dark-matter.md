# Account Progression & Dark Matter

Progression belongs to the **account**, not to a faction or saved game. XP, levels, achievements,
quests, and Dark Matter persist in the auth SQLite database, so the same balance follows a player
between games. Definitions are shared in [`src/auth/types.ts`](../../src/auth/types.ts) and
[`server/game/progression.ts`](../../server/game/progression.ts); persistence and reward claims are
implemented by [`server/auth-store.ts`](../../server/auth-store.ts).

## XP, achievements, and quests

The profile has 20 named levels driven by cumulative XP. Achievements cover account activity,
participation, quest completion, and selected in-game milestones. Weekly and three-day quest pools
track news-comment and vote actions. `GET /api/player/profile` returns the assembled profile and
`POST /api/player/quests/:questId/claim` claims a completed quest window exactly once.

In-game damage, stable economies, and market profit award capped XP through the control-token-gated
`POST /api/internal/game-xp` endpoint. News comments, votes, game joins, and quest claims update their
own counters directly through the auth store. `checkAndUnlockAchievements` inserts each achievement
once and grants its XP and Dark Matter reward on the successful insert.

## Dark Matter storage and rewards

`player_progression.dark_matter` is the canonical balance. Every achievement and quest definition
has a `darkMatterReward`; current reward generation grants at least 1 and otherwise rounds roughly
one Dark Matter per 50 XP.

The auth store exposes:

- `addPlayerDarkMatter` for rewards;
- `getPlayerDarkMatter` for profile/HUD reads;
- `spendPlayerDarkMatter` for an atomic conditional debit; and
- `getAccountIdForGameFaction` so periodic game simulation can bill an offline faction owner.

Dark Matter is deliberately absent from `GameState.factionEconomies`: it is not a per-country
stockpile and is not reset when starting another game.

## Fleet travel boost

A moving owned fleet can enable a 10× travel-speed boost with
`setFleetDarkMatterBoost`. Activation prepays 1 Dark Matter. Each additional in-game **moving day**
crossed before arrival costs 1 more; partial final days do not create an additional boundary charge.
If the balance cannot cover the next boundary, the server restores normal travel speed at that exact
game time. Arrival and stop orders clear the boost automatically, while manual deactivation does not
refund the prepaid day.

`darkMatterBoostActive` and `darkMatterBoostPaidUntilYear` live on the fleet because the simulation
must persist active timing across saves. They are normalized to disabled/null for legacy fleet
records. Route activation/deactivation uses `rescaleFleetMovementPlan`, which preserves the
authoritative current position and retimes only untravelled segments.

The selected-fleet panel shows destination, progress, arrival date, days remaining, and a purple
boost toggle. Both galaxy and system scenes show the same confirmation explaining the effect and
ongoing cost.

## Instant planetary construction

Each planetary construction queue entry can be completed immediately with
`skipPlanetConstruction`. The cost is:

```text
max(1, ceil(remainingDays × 0.05))
```

That is 1 Dark Matter per 20 remaining days, rounded up. The server validates planet ownership,
command link, queue membership, and whether the target can still be completed before debiting the
account. `completePlanetConstructionQueueItem` applies the district/building/upgrade and recalculates
the planet economy. The client does not optimistically remove the queue item.

## Balance synchronization

The game server emits an `accountResources` event after a spend and on connection. Every connected
session for that account receives the new balance. `GameServerClient` forwards it to `boot.ts`, which
updates the compact Dark Matter HUD resource; a periodic player-profile fetch remains a fallback.

## How to extend / rules

- Keep account currency in the auth store; do not add it to faction economies or game saves.
- Debit through `spendPlayerDarkMatter`, never with read-then-write arithmetic.
- Validate and prepare an authoritative result before debiting whenever an operation can become
  invalid.
- For recurring costs, bill game-time boundaries and persist the paid-through time.
- Broadcast `accountResources` after every game-server debit so multiple open games stay consistent.
- Keep formulas and constants in [`src/game/DarkMatter.ts`](../../src/game/DarkMatter.ts), shared by
  server validation, client warnings, and tests.

## Key files

- Definitions/formulas: [`server/game/progression.ts`](../../server/game/progression.ts),
  [`src/game/DarkMatter.ts`](../../src/game/DarkMatter.ts).
- Account persistence: [`server/auth-store.ts`](../../server/auth-store.ts).
- Server spends: [`server/index.ts`](../../server/index.ts),
  [`server/game/fleet-combat.ts`](../../server/game/fleet-combat.ts).
- Client: [`src/game/GameServerClient.ts`](../../src/game/GameServerClient.ts),
  [`src/game/boot.ts`](../../src/game/boot.ts),
  [`src/ui/HudOverlay.ts`](../../src/ui/HudOverlay.ts),
  [`src/ui/SelectionPanel.ts`](../../src/ui/SelectionPanel.ts),
  [`src/ui/CelestialObjectPanel.ts`](../../src/ui/CelestialObjectPanel.ts).
- Tests: [`server/tests/dark-matter.test.ts`](../../server/tests/dark-matter.test.ts),
  [`server/tests/auth-store.test.ts`](../../server/tests/auth-store.test.ts),
  [`server/tests/economy.test.ts`](../../server/tests/economy.test.ts).

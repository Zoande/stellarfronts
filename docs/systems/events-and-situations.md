# Events & Situations

Two related framework systems drive emergent moments: **situations** are ongoing monitored conditions,
and **events** are discrete decisions presented to a faction. **Notifications** are non-blocking
indicators. Models: [`src/data/Situations.ts`](../../src/data/Situations.ts),
[`src/data/Events.ts`](../../src/data/Events.ts),
[`src/data/Notifications.ts`](../../src/data/Notifications.ts). Server processing:
[`server/game/leaders-events.ts`](../../server/game/leaders-events.ts).

> **Maturity: the framework is solid but the catalog is small.** Expect to add scenarios. A few core
> ones exist (e.g. `resourceShortage` situation, `resourceShortageCrisis`, `leaderRecruitmentOffer`,
> `lostInTransit` events).

## Situations

`SituationDefinition` (`SITUATION_DEFINITIONS`, categories `economic`/`stability`/`anomaly`/`military`)
describes a monitored condition with `SituationThreshold`s. An `ActiveSituation` tracks progress for a
faction (and optional subject, e.g. a resource). The canonical example is `SHORTAGE_SITUATION_ID`
(`resourceShortage`): sustained resource deficits raise its progress (`SHORTAGE_PROGRESS_RISE_PER_DAY`
vs. `SHORTAGE_PROGRESS_FALL_PER_DAY` after a `SHORTAGE_GRACE_MONTHS` grace, in
[`server/game/constants.ts`](../../server/game/constants.ts)), which then applies penalties and can
escalate into an event. `processSituations` runs on the daily index from `advanceState`.

Food-shortage progress also drives planetary famine. At progress 34 or higher, a planet with a
negative local monthly food balance projects and applies class-weighted deaths during the monthly
population pass. Food-shortage penalties cap at -40 happiness, -22 stability, -15% job output, and
-8% fleet speed/weapon damage; shortage progress no longer applies a population-growth penalty.

## Events

`EventDefinition` (`EVENT_DEFINITIONS`, `EventCategory`) has a title/body (with token substitution),
optional timeout, and `EventChoice`s, each with effects (resource deltas, modifiers, leader grants,
…). An `ActiveEvent` is a pending decision for a faction. The player resolves it with the
`resolveEvent` command; timeouts auto-resolve (`processEventTimeouts`). `RANDOM_EVENT_DEFINITIONS` is
the pool eligible for random spawning (`processRandomEvents`).

## Notifications

`deriveIndicators` ([`src/data/Notifications.ts`](../../src/data/Notifications.ts)) turns active
events/situations/alerts into `NotificationIndicator`s (`IndicatorKind` = `event`/`situation`/`alert`)
that the HUD surfaces. These are informational, not blocking.

## How to extend / rules

- **Add a situation:** define it in `SITUATION_DEFINITIONS` with thresholds; wire its trigger into the
  daily situation pass and (if it escalates) link it to an event id.
- **Add an event:** define it in `EVENT_DEFINITIONS` with choices/effects; add it to
  `RANDOM_EVENT_DEFINITIONS` if it should spawn randomly. Keep body tokens resolvable from context.
- Events/situations are per-faction state on `GameState`; they need normalizer defaults.
- Effects should reuse existing modifier/resource machinery rather than mutating state ad hoc.

## Key files

- Models: [`src/data/Situations.ts`](../../src/data/Situations.ts),
  [`src/data/Events.ts`](../../src/data/Events.ts),
  [`src/data/Notifications.ts`](../../src/data/Notifications.ts).
- Server: [`server/game/leaders-events.ts`](../../server/game/leaders-events.ts).
- UI: [`src/ui/EventModal.ts`](../../src/ui/EventModal.ts),
  [`src/ui/SituationModal.ts`](../../src/ui/SituationModal.ts).
- Tests: [`server/tests/events.test.ts`](../../server/tests/events.test.ts).

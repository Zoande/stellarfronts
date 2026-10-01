# AI foundations and simulation laboratory

Stage 1 provides shared authoritative actions, fair observations, deterministic runtime services,
and scripted experiments. It does not enable live AI controllers or AFK transitions.

## Runtime and action boundary

`createGameCore(game, authPort, options)` constructs an in-memory game without opening sockets,
SQLite, save files, or ownership locks. `createGameRuntime` wraps it with production startup and
persistence. The existing server runtime API and protocol 11 remain unchanged.

The core issues frozen, game-bound human, AI, and observer actors. Human actors must still own their
country in the injected account service. Browser commands cannot issue actors. AI actors need no
account and cannot spend Dark Matter. Observers cannot execute gameplay actions.

`executeGameCommand(actor, action)` returns `CommandOutcome`. Gameplay handlers use a transport-free
reply object; the WebSocket adapter owns request correlation and sends the resulting command result.
The mutation coordinator collects effects during a command and applies notifications, dirty flags,
and requested recalculation after success. All protocol commands have explicit field decoders.
Connection, subscription, administration, and time controls remain adapter operations.

## Determinism and observations

Schema-30 saves gain additive `determinism` state: versioned combat/leader/event RNG streams and an
ID counter. Production initializes private random state independently of its public map seed.
Existing saves initialize their missing state once on upgrade. Authentication tokens and filesystem
lock IDs continue using cryptographic randomness independently of simulation randomness.

The reproducibility contract requires the same checkpoint, action sequence, and elapsed tick
sequence. Different tick sizes or offline catch-up intervals can change outcomes. Save restoration
preserves recorded intelligence and leader-pool timestamps; the next simulation refresh updates intel.

`createAiObservation` combines the existing faction snapshot and permitted management, market,
society, and diplomacy details. It returns a detached, recursively frozen object with current/stale/
unknown intel. Known fleets, ships, and starbases are enumerated from remembered intelligence,
so hidden losses do not erase stale contacts. Private RNG and global truth are not supplied to controllers.

`getAiCandidates(observation)` uses those observations and public catalogs. It provides focused
economy, research, repair, movement, expansion, and colonization candidates. Candidates are advisory:
ordinary command validation still decides legality. This is not an exhaustive strategic action space.

## Headless API

`createHeadlessGame` accepts world/simulation seeds, virtual epoch, tick duration, optional initial
world dimensions, isolated in-memory account balances/ownership, or a checkpoint. The API offers
actor issuance, `act`, `observe`, `step`, `digest`, and `exportCheckpoint`. Controller callbacks should
receive only faction observations and an action submission interface. Checkpoints and full-state
diagnostics are for laboratory orchestration and debugging.

`controllerAccess(factionId)` returns only that country's `observe` and `executeGameCommand`
methods. `runScenario` also accepts an optional decision callback `(day, observation) => actions`;
it records these actions and outcomes for replay in the same way as the supplied scripts.

Time uses integer virtual milliseconds. Defaults are 100 ms ticks at the normal production speed,
without wall-clock sleeps. Full state digests use SHA-256 of authoritative JSON serialization;
checkpoint property order is preserved, and replay uses the recorded tick schedule.

## CLI

```powershell
npm run ai:simulate -- batch
npm run ai:simulate -- scenario --scenario shortage-recovery --seeds 19 --days 30
npm run ai:simulate -- long-economy
npm run ai:simulate -- long-economy --step-ms 100
npm run ai:simulate -- batch --scenarios expansion,combat-repair --seeds 19
npm run ai:simulate -- replay .cache/ai-lab/shortage-recovery-19.jsonl
```

Routine defaults: seeds 19/42/71, 30 game days, 12 stars and 2 countries. Compact worlds make repeated
checks practical and retain the production pipeline and gameplay rules. They do not establish
production-scale balance. The headless API itself defaults to the full production galaxy; use
`--stars 500 --countries 15` for production-size CLI experiments. Generation may place fewer stars
when minimum spacing prevents the requested count; actual dimensions appear in reports.
Routine runs use 100 ms virtual ticks. `long-economy` defaults to 60,000 ms virtual ticks (2.5 game
days per tick) to make the year-long sweep fast; pass `--step-ms 100` for exact routine cadence.
Different tick schedules can change gameplay outcomes, so compare runs only on the same schedule.

Scenarios cover idle economy, shortage recovery, construction/research, expansion/colonization, and
combat/repair. Scenario setup is explicit: shortage recovery starts without agriculture and with
zero food and buys food while queuing agriculture, expansion starts with a normal colony ship and
a habitable home-system target, and combat places opponents at war in a linked neutral system
(or the home system when no neutral system is linked). Home-system battles include normal starbase
defense. Decisions thereafter use ordinary AI actors, filtered observations, and normal costs.

Output defaults to ignored `.cache/ai-lab/`: per-run JSON metrics, JSONL replay logs, aggregate metrics,
and `findings.md`. Headers record revision (including a source hash for dirty worktrees), initial checkpoint,
tick configuration, and scenario. Replay reports the first differing tick/action; runtime timings
are diagnostic and are not part of reproducibility comparisons.
Dirty-worktree runs also retain `source.patch` and `untracked-source.json` beside their reports,
so the implementation can be reconstructed from its base revision. Failed actions/ticks retain
the attempted operation and exception; replay can confirm the same failure. Out-of-order or
truncated logs are rejected.

Metrics include stockpiles/income/minima, shortage duration, population and observed loss, famine
exposure, completed construction/research, systems/colonies, ship losses, rejected actions, and tick
runtime. Population loss may include migration or combat; famine exposure is measured separately.
Resource shortage duration requires a deficit or an active shortage situation; zero research by
itself is not a shortage. Ship losses count recorded combat losses, excluding consumed colony ships.
Construction completion counts queue removals in these scripts, which never cancel construction.
Hourly diagnostic sampling can miss a shortage shorter than an hour. Newly queued districts take
180–240 game days under current rules, so a 30-day routine run tests progress rather than completion.
Correctness findings require reproductions and regression tests. Balance changes require a separate
decision.

## Later controller stages

Unclaimed countries: passive for 72 real hours, then active. Claimed countries: human until 48 hours
AFK, caretaker until day 5, passive until day 7, then active. Meaningful activity in that game resets
AFK time; an unattended connection does not. Ownership remains with the player and control returns
immediately on their return. These rules are agreed design targets, not enabled behavior in Stage 1.

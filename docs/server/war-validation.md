# War and army validation

Run an isolated, reproducible three-country war:

```sh
npm run ai:simulate -- war --days 1800
```

The default uses every production 100 ms tick without sleeps. It creates nine
systems, three active countries, and two matched developed planets per country.
All three countries begin mutually at war, with equal stocks, crew, ordinary
24-corvette fleets and unmodified starbase defenses. Each expedition starts at
a rival colony outpost with a normal attack order. Home shipyards remain
available. No mobile armies are supplied; the AI must train and deploy them.
Identical planet layouts and worker allocations produce positive starting
resource flows, including starting military upkeep. This is a prepared war
fixture, not a representative new-game economy or a test of natural declarations.

Use `--out path/to/new-directory` and `--seed 42` for repeatable output. Existing
output directories with run metadata cannot be overwritten. Opening
`timelapse.html` shows borders and country histories. Full checkpoints preserve
the isolated world, while `actions.jsonl` contains every attempted command.
`decisions.jsonl` includes fleet readiness, ground objectives, estimated defenses,
required attack power, completed/pending troops and controller cooldowns.
`ground.jsonl` preserves daily unit HP, manpower, location, battle membership and
planet owners. `development.jsonl` records recruitment, losses and battle endings.
Use `--checkpoint path/to/year-1.checkpoint.json` with a new output directory
to continue a saved war under the current implementation. Source archives and
run metadata distinguish the two segments.

For a **functional diagnostic only**, `--step-ms 24000` processes daily integration
intervals much faster. Every game day and daily ground resolution still executes,
but movement, projectiles, naval combat and other timing-sensitive systems can
differ substantially from production. Do not use this mode for combat balance or
pace conclusions. `npm run grandsimulation` retains strict 100 ms updates.

## Army policy

Active AI uses ordinary player commands and restricted faction observations.
Enemy unit records stay hidden until participating in battle. Estimates use
observed fortresses, terrain combat width and habitability, with uncertainty and
reserve margins. Missing building observations never mean zero defenses.

Recruitment scales to a useful expedition instead of stopping at two armies.
Species population caps, technology, trained crew, queued construction costs,
recurring upkeep and essential resource reserves constrain purchases. Troop
orders have their own 14-day cadence and share normal shipyards with the navy.
The planner uses actually active shipyards, including their required buildings.
With the declaration tag enabled, a peaceful country can prepare one observed
border invasion once its navy can meet that system's estimated space defenses.
An inhabited-system declaration requires an assembled navy and a single ready
transport force with enough estimated attack power for the observed colonies,
both able to reach an owned staging system. Queued troops alone never qualify.
Treaties, unknown defenses, economy recovery and protected expansion funds retain
their safeguards. The default disabled tag does not enable conquest preparation.

Transports merge and regroup through known legal routes. Invasions require a
controlled system without currently observed armed enemy fleets, enough landed
attack power, and the normal orbital/invasion validation. Support ships alone
do not block landings. Existing friendly battles can receive reinforcements;
badly losing attacks can request the normal delayed withdrawal. Injured units
land on safe owned planets, recover using normal crew supplies, and re-embark
when healthy. Persistent army IDs and their transports survive reuse.

Fleet assembly considers independent co-located groups, so a scout trapped
behind closed borders cannot strand a stronger home navy. Existing combat,
orders, emergency defense and repairs retain priority.
Completed orbit and tactical movement labels do not strand otherwise available
fleets; actual travel, repair, construction, merge and retreat commitments remain
busy. Captured planet and starbase queues intentionally remain exactly intact,
including their progress and reserved crew, as the selected gameplay rule.

AI war declarations remain disabled by default in real games. This fixture
enables the tag only in its own in-memory world. It opens no database, auth
service, orchestrator, socket or real-game save.

## Validation boundaries

The focused tests cover ordinary recruitment and crew reservation, persistent
transport merging, a fortified invasion against ten authored garrisons, daily
ground losses, ownership capture, recovery and re-embarkation. The ground
lifecycle component test runs every training and battle day through production
processors; it explicitly stages the post-naval arrival rather than simulating
naval travel. Full-runtime war recordings separately exercise naval physics.

Compare results only with the same starting checkpoint and integration schedule.
Keep the exact run's source archive and metadata when investigating an old run:
already running simulations do not pick up edits to the controller.

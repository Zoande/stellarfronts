# Active AI and accelerated campaigns

Active AI is a deterministic player-like controller. It receives the same detached faction observations as the other controllers and submits ordinary authoritative commands. It has no private rival state, free resources, account currency, or simulation controls.

Production enables caretaker, passive, and active control. Unclaimed countries start passive and become active after 72 real hours from game creation. Claimed countries become caretaker after 48 hours without meaningful activity, passive after five days, and active after seven days. Verified player activity returns control immediately and retains accepted gameplay orders. Episodes, queue receipts, research, and cooldowns survive saves and laboratory checkpoints.

## War declaration tag

AI war declarations are **off by default**. The persisted server-owned setting is `state.aiSettings.allowWarDeclarations`. The command executor enforces this for every AI actor, including custom controllers. Human declarations are unaffected. Disabling it does not end existing wars or prevent defense, attacks in an existing war, or peace negotiations.

Use the existing admin console:

```text
ai_wars status
ai_wars on
ai_wars off
```

Keep it off in player games. Turn it on for isolated balance experiments. Normal client commands cannot change the tag.

## Policy

The controller inherits emergency economy recovery, research selection, repair, and sustainable expansion from passive AI. Active growth has shorter accepted-order cooldowns (seven days for outposts, development, and ships; thirty days for colonies) and a military upkeep ceiling of 40% of recurring energy/alloy production, compared with passive's 20%. It retains construction funds and six months of recurring deficits, or two months of imported inputs when conservative recurring export income and liquid reserves can support them. Inventory sales alone do not establish sustainable trade.

It builds missing research labs and, when trained crew drops below 50,000, the fortress/barracks prerequisites for replenishment. It scouts with science ships or its starting navy, remembers explored destinations, regroups separated military reinforcements through known legal routes, attacks known wartime territory, retreats from stronger visible fleets, handles diplomatic proposals and peace, and recruits small expeditionary forces to invade known enemy colonies after naval control. Rejected scouting routes are avoided for ninety game days. A permitted declaration requires healthy reserves, useful adjacent border territory, no active treaty, observed defenses, a favorable local force estimate with uncertainty allowances, and a cooldown. There is no arbitrary 2,000-point declaration gate. Unobserved defenses do not imply an undefended target. These are heuristics, not a competitive strategic optimizer; ship redesign, weapon matchup assessment, sophisticated diplomatic offers, and strong ground-war planning remain improvement areas.

War planning remembers only the country's own borders. AI can negotiate status quo peace to retain useful conquests or end an exhausted war; it declines net territorial losses while healthy and avoids status quo that strands its own inhabited colony under occupation. White peace remains useful for recovering lost borders. Transfers and enforced treaty articles are not accepted without evaluation. The private global pre-war ownership map is never exposed to controllers. Existing wars still allow defense and peace when the declaration tag is off.

During peace, an affordable reachable adjacent outpost precedes discretionary military purchases. While saving for that outpost, one military ship order is allowed between accepted outpost orders. Existing wars or a stronger currently visible fleet near the border override this savings policy. Support ships retain their separate priorities. Development forecasts reject projects whose nominal capacity would remain unstaffed or whose inputs are poorly funded. Housing receives priority near its current limit, and affordable productive building upgrades are considered.

Active recovery addresses recurring input shortages before elective growth or a new war. It can fund an entire productive district plus its construction horizon, or a productive unlocked processing upgrade when useful raw district capacity is exhausted. Purchases include a buffer beyond the retained resource floor, avoiding daily ration trades. It sells surplus food/goods/alloys while retaining reserves and tries available sustainable exports before treating a cash-floor crossing as a structural production crisis. It can temporarily disable optional factories or labs when a marginal forecast improves the scarce resource. Wartime recovery protects alloy foundries and larger alloy reserves. It only restarts buildings paused by that AI episode, after thirty days, with projected input buffers and sufficient cash, when domestic production or conservative recurring trade can support them. Forecasts use visible planet data and public economy rules; government/species modifiers can affect the estimate, so this is a conservative heuristic with reserve margins. No prices, job priorities, production rates, or outpost defenses were changed for this policy.

Worker recovery also uses ordinary player controls. Job locks retain current staff and cannot directly fill empty jobs. Pausing optional industry, labs, or resource processing can free workers; a structural shortage with no effective affordable construction option receives this relief before repeated peaceful market sales. Before construction or a paused-building restart, AI can lock essential workers that new job capacity would otherwise displace. Only locks installed by that episode may be released automatically. Development cannot bypass a paused factory by constructing another copy. Food, goods, and other basic reserves constrain changes, and wartime alloy production is protected. A lock is not an arbitrary population transfer and does not change the shared automatic job order.

Passive AI shares this economic recovery and workforce protection, including simultaneous shortages, buffered imports, emergency food batches and funding useful housing before unstaffed production. Recovery can sell mineral stocks too, preserving queued ship commitments and long buffers for resources with negative income. A crowded planet may convert an empty urban sub-district to residential use when the resulting economy can support its trade needs; existing buildings, queued work and wartime alloy losses prevent that conversion. Pause/lock ownership persists across passive/active handoffs.

Active investment also handles healthy economies with unequal abundance. It compares stocks with consumption, queue commitments, essential floors and expansion savings, then considers less abundant production or research. Protected surpluses can finance unlocked useful projects through ordinary market trades. Optional development has a ninety-day cooldown, and existing ship assignment receipts remain intact. This is a resource-allocation heuristic, not an attempt to equalize commodity quantities; profitable exports retain value. Allocation thresholds and relative abundance are logged on every laboratory decision for evaluation.

## Isolated campaign

```powershell
# Short smoke test, daily virtual updates
npm run ai:simulate -- active --stars 24 --countries 4 --active 2 --days 30 --allow-wars true --out .cache/ai-lab/smoke-new

# Ten-year production-size balance sweep, adaptive schedule
npm run ai:simulate -- active --stars 500 --countries 15 --active 10 --days 3600 --step-ms 24000 --allow-wars true --out .cache/ai-lab/campaign-new

# Continue a saved isolated game for another five years
npm run ai:simulate -- active --checkpoint .cache/ai-lab/campaign-new/final.checkpoint.json --countries 15 --active 10 --days 1800 --allow-wars true --out .cache/ai-lab/continuation-new

# Compare small scripted fixtures against production cadence; analyze saved logs
npm run ai:simulate -- calibrate --out .cache/ai-lab/calibration-new.json
npm run ai:simulate -- analyze .cache/ai-lab/campaign-new
```

The game runs in memory, without sockets, the account database, production saves, or real-time sleeps. It runs as fast as the ordinary production pipeline can process the chosen virtual schedule. Ten countries are pinned active and the other five passive for the whole experiment; simulated wall-clock progression does not change this assignment. The game generator may place fewer systems than requested because of minimum spacing; reports record the actual count.

Default campaign settings are seed 42, 500 requested systems, 15 countries, 10 active countries, 3,600 game days, adaptive daily peace updates (`--step-ms 24000`), and war declarations disabled. The CLI also supports `--checkpoint` and `--adaptive false` for explicitly fixed-step experiments. Checkpoint continuation preserves its world and clock; seed and requested world size do not regenerate that world. Its day counter starts at zero for the continuation, and the viewer displays the actual game year. Source archives identify the implementation loaded at each run's start; later code edits do not update a running process.

Adaptive updates use at most one game day during peace, bound known movement, AI decision, project and estimated research transitions, and switch to production's 100 ms cadence during hostile system contact or ground combat. There are no wall-clock waits. This retains combat cadence rather than extrapolating a whole battle. Peaceful daily integration can still differ from production updates, especially near stockouts, population changes, and estimated research boundaries. The calibration command measures error in explicit scripted fixtures; it does not prove whole-campaign equivalence or natural war behavior. Compare balance runs on the same schedule and reproduce sensitive findings at finer cadence. All timing choices are recorded.

Each output directory contains:

- `timelapse.html`: self-contained interactive ownership map and economic charts, refreshed at each monthly sample and finalized at completion. A browser refresh loads new samples. Dashed chart lines are passive countries. Map cells illustrate ownership around systems; they are not the game's territorial geometry.
- `summary.json` and `findings.md`: final metrics, command rejections, shortages, famine, ownership changes, wars, and recorded combat losses.
- `timeline.jsonl`: monthly ownership and per-country economic/population/research history.
- `actions.jsonl`: every attempted AI action, outcome, mode, faction, and tick/day.
- `decisions.jsonl`: every controller turn, including idle turns, selected actions, visible threats and border objectives, resource runway, stressed recurring trade estimates, candidate counts and cooldowns. Newer records include shipyard/crew availability, split versus available navy health, paused-building counts and shipyard material shortfalls. These records use the same restricted faction observation as the planner.
- `economies.jsonl` and `planets.jsonl`: monthly production and consumption, research progression, trained crew, realized market statistics, population, housing, worker allocations and locks, building states and queues.
- `market.jsonl`: every observed realized transaction, volume, quote, fees and energy delta, including distinct transactions with identical timestamps.
- `development.jsonl`: queued and departed projects, completed technology, ship creation/removal, colony changes, armies and ground-battle boundaries. Queue departure is not automatically completion; ship removal is not automatically a combat loss.
- `performance.jsonl`: every integration interval, scheduling reason and elapsed runtime. Runtime is elapsed time, not CPU time; host suspension and competing work can inflate it.
- `analysis.json` and `analysis.md`: streaming log analysis, realized trade flows by resource, decision frequency, idle-turn fractions, accepted milestones and yearly development endpoints. Generated at completion or by the analyze command while a run is in progress.
- `events.jsonl`: ownership changes, war state changes, and unique combat reports observed at tick resolution.
- `initial.checkpoint.json`, yearly checkpoints, and `final.checkpoint.json`: complete game state and controller configuration for continuation and diagnosis.
- `run.json`, `progress.json`, `ticks.jsonl`, and source archives: configuration, progress, sampled digests, base revision, and reconstructable modified source. These diagnostic files use a different format from the older scripted-scenario replay log.

Existing run directories are protected from overwrite. Failed ticks retain a failure checkpoint and exception. Metrics sample state at tick boundaries and can miss shorter shortages or combat reports already evicted within a very coarse tick. Full checkpoints and event history are laboratory-only; controllers never receive them.

## Confirmed issues corrected during implementation

1. Fresh empires had zero trained crew and no research-producing infrastructure. New worlds now start with 100,000 crew and a staffed homeworld research lab. Restoring a save does not refill crew or replace player buildings; new colonies keep their normal small starting infrastructure.
2. Fleet travel and ship construction normally finish in orbit, but AI candidates and defense/assembly policies required the literal `idle` phase. Orbiting fleets now remain available, matching normal player order rules. This fixes builders stopping after one outpost, unused completed colony ships, and scouts stopping after their first destination.
3. Science hulls and two utility components charged research, which cannot be stockpiled under the current direct-to-technology research system. Those impossible research ingredients were removed; their ordinary material, goods, alloy, energy, crew, technology, and construction requirements still apply.
4. The peace heuristic counted only idle navies, so a fleet traveling or executing another order could incorrectly trigger peace. It now checks all surviving mobile military fleets. Combat and declaration assignments also reserve their fleet for that decision, preventing a scout order from overriding them.
5. Mineral-deficit countries repeatedly bought small rations without accumulating construction funds. The user approved conditional factory pauses and funding lasting supply, with wartime alloy production protected; the active recovery policy implements this without altering the shared economy balance.
6. Healthy countries repeatedly bought ships ahead of outposts; others added unstaffed resource capacity or ignored housing pressure. Expansion savings and staffing-aware development address these distinct causes. The detailed investigation and run comparisons are in [active-ai-expansion-diagnosis.md](active-ai-expansion-diagnosis.md).
7. Daily leader-pool replacement left expired owner-roster leaf fields in the intelligence ledger indefinitely. Own current rosters now prune departed candidates while preserving recruited leaders and foreign remembered facts. A dense-world checkpoint had grown to 133 MB after one year; later checkpoints after cleanup were about 23–26 MB over the next several years.
8. Faction snapshots deliberately omit global planet states. AI used that empty list to classify inhabited war objectives and select invasion targets. It now uses permitted inhabited-system identities and the planet-manager view. The manager also retains owned colonies under occupation and uses restricted details for rival colonies inside controlled systems.
9. Early naval scouting could leave reinforcements separated from the main fleet. Idle ships now regroup through observed legal routes before offensive assignments, while emergency defense and repair retain priority.

Intelligence observations reuse views only during synchronous read-only assembly, detach the final graph, and freeze it before planning. Compact metadata retains the contact fields controllers consume; materialized gameplay views remain complete. Shared sensor source sets preserve exact field values and source identities. Regression fixtures compare full and compact planner decisions, cached and uncached observations, and shared versus unshared intelligence digests. Logging hooks also preserve exact commands, RNG counters and state digests in deterministic fixtures.

Continuous combat now caches public ship-design calculations within each update, including its internal substeps. The cache is discarded before the next update, so later design, technology, and state changes remain visible. Cached and uncached combat produce identical full-state digests, effects, and RNG counters in regression fixtures. A saved year-six checkpoint benchmark measured 812.5 ms uncached versus 243.7 ms cached for the same 24 combat hours; this is a component benchmark, not a guaranteed campaign speedup.

Regression tests cover the startup flow, science-ship availability, preservation of restored player layouts, orbiting candidates, deterministic continuation, fair observations, AFK boundaries, claim races, human handback, the war tag at both planner and command boundaries, moving navies, peaceful factory pauses, wartime mine funding, and conservative restart of AI-paused buildings.

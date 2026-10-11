# Expanded active AI testing

These are isolated in-memory games with ten active and five passive countries. AI war declarations are explicitly enabled in the lab and remain off by default in player games. No costs, production rates, worker priorities, or outpost defenses were changed in this expansion of the tests.

The local artifact server at `http://127.0.0.1:8124/` exposes the experiment index. `dense-history/timelapse.html` joins the dense game's chronological map and economy history across checkpoints. It identifies the policy-change years; it is not a claim that one unchanged AI implementation played the whole game. Individual segment directories retain their source archives, full checkpoints and logs. Refresh the viewer for new monthly frames.

## Experiment lineage

| Segment | World | Initial year | Purpose and disposition |
| --- | --- | --- | --- |
| `long-dense-v8` | 48 systems, seed 42 | 2100 | Fresh dense frontier game. First-year checkpoint retained; superseded after detecting owner-roster metadata growth. |
| `long-dense-v10` | Same dense world | 2101 | Bounded owner roster and expanded telemetry. Six continuation years retained; the next policy segment branches from its year-five checkpoint at game year 2106. |
| `long-dense-v11` | Same dense world | 2106 | Processing-upgrade funding, fair status quo peace and safe naval regrouping. Two-year checkpoint at game year 2108 retained; superseded after finding restart and tiny-trade churn. |
| `long-dense-v12` | Same dense world | 2108 | Cash-floor export recovery, restart buffers and meaningful import batches. Four-year checkpoint at game year 2112 retained for the next policy segment. |
| `long-dense-v13` | Same dense world | 2112 | Portfolio investment and shared passive economic recovery. Eight-year continuation target, reaching game year 2120. Consult `run.json` for current completion status. |
| `long-standard-v10` | 422 systems, seed 42 | 2103 | Ten-year continuation from the earlier completed three-year game. Earlier recovery policy, useful as a comparison; consult `run.json` for current status. |

The combined history cuts each older segment at the checkpoint used by its successor. Later discarded branch activity is not included in combined command or ownership counts. Full uncut source logs remain available. New code edits do not change an already running process.

## Confirmed findings

- The owner's daily leader-pool metadata grew indefinitely despite the actual roster remaining small. The dense first-year checkpoint reached 133 MB. Pruning expired owner-roster leaves reduced later checkpoints to roughly 23–26 MB over several years. Recruited leaders and foreign remembered facts remain intact.
- Some economies can sustain imports through recurring exports. Low cash alone does not establish structural insolvency. Earlier recovery paused buildings immediately on crossing its cash floor, even with available profitable exports; it could then restart them after the cooldown and repeat.
- Import targets stopped at the same stockpile floor that triggered recovery. Recurring consumers therefore bought one or two units almost every day. Targets now include the floor **plus** an input buffer, with construction costs added when funding supply.
- A matched 60-day comparison from the identical game-year-2108 checkpoint recorded 60 active-country market commands and nine building toggles under v11, versus two market commands and no toggles under v12. Both ordered one ship and one fleet merge in that interval. This demonstrates reduced controller churn, not whole-game economic balance.
- Early naval scouts could remain separated from newly constructed ships. Safe regrouping now uses ordinary movement and merge commands. Available local fleet strength, total navy health and trained crew are logged separately so fleet fragmentation can be distinguished from weak production.
- Faction snapshots omit global planet states. Using that empty list misclassified inhabited war objectives and prevented invasion target selection. The planner now uses restricted inhabited-system identities and the planet-manager view. The manager retains owned colonies under occupation and hides private rival worker controls inside captured systems.
- Natural wars had not occurred through the early continuation samples. A basic outpost has 2,800 combined defenses; the planner's conservative health estimate requires about thirteen starting corvettes. The user chose to retain defenses and measure military buildup. Crew training, shipyard funding, economic reserves and fleet assembly are therefore relevant pacing measurements. Scripted calibration combat must not be counted as a natural campaign war.

## Accuracy and performance

### Portfolio investment and passive recovery

Active investment now compares stocks against six months of ordinary consumption, essential floors, queued ship installments and reachable peace expansion costs. An economy with positive income in every commodity can still diversify toward less abundant output or research. Optional investment has a ninety-day cooldown, leaving opportunities for military spending. Useful projects can sell protected surplus stocks and buy whole missing inputs using ordinary market commands. Their forecast recurring costs must remain affordable through domestic income or sustainable trade. The planner can release its own worker locks when unusually abundant output can become useful research or other production; player locks and wartime alloys remain protected. `decisions.jsonl` records resource thresholds, surplus amounts, relative abundance and income for later allocation analysis.

Passive AI now shares active economic recovery: productive construction forecasts, workforce protection, safe pauses/restarts, surplus sales, meaningful import buffers and emergency food purchases. Recovery considers simultaneous shortages rather than waiting for the worst resource to have a standalone solution. Housing takes precedence over adding unstaffed production. Empty urban sub-districts can become residential when the forecast improves recovery and supports the resulting trade needs. Existing buildings and queued projects prevent that rezoning; wartime alloy losses prevent it too. AI pause/lock ownership survives passive/active handoffs. No shared job priority, production rate or construction price was changed.

`portfolio-passive-smoke-v3` is a completed sixty-day recovery experiment from the unchanged game-year-2110 checkpoint, with 198 accepted commands and zero rejections. The older passive countries were already in a severe crisis. Recorded endpoints were:

| Passive country | Initial food/month | Final food/month | Initial energy/month | Final energy/month |
| --- | --- | --- | --- | --- |
| 11 | -71.2 | +96.3 | -81.2 | +131.2 |
| 12 | -33.6 | -2.7 | -31.2 | +197.5 |
| 13 | -85.8 | -18.5 | -76.5 | +154.0 |
| 14 | -119.1 | +8.7 | -81.4 | +182.1 |

Country 14 finished with 16.2 food rather than zero; its positive income is still small. Countries 12 and 13 retain food deficits, and the short result does not establish long-run balance. Later code adds meaningful partial import batches when a full project buffer cannot yet be financed; that additional change is exercised in `long-dense-v13`, not retroactively attributed to the completed smoke run. The long continuation starts from the older v12 checkpoint at game year 2112, preserving the original test world's history rather than substituting the smoke branch.

The adaptive lab executes the ordinary production pipeline without wall-clock waits. Peace advances by at most one game day, bounded by known AI, travel and construction transitions and estimated research completion. Hostile system contact and ground battles use the production 100 ms cadence.

`cadence-calibration-v9.json` compares four explicit one-game-day fixtures against production cadence: idle economy, construction/research, expansion and combat/repair. The largest absolute stockpile difference was approximately 0.238 units; population was identical in these fixtures. Combat health and reports were identical, with 240 updates in both schedules. These short fixtures do not prove long-run equivalence. Daily peace integration can still affect resource stockouts, population and transition timing.

Measured peaceful component runs improved from 124.7 seconds to 40.5 seconds for the same initial sixty-day dense fixture after scoped observation assembly and compact metadata. Both recorded 85 accepted commands and no rejections. Later multi-process measurements are affected by competing work. Long-run wall time also includes a host suspension; it must not be reported as uninterrupted hardware throughput. `performance.jsonl` retains per-integration elapsed timing and schedule reasons; it is not CPU time.

## Evidence to inspect

`analysis.md` and `analysis.json` summarize per-country idle turns, accepted actions per game year, realized import spending and export receipts, fees, resource volumes, accepted milestones, local opportunity assessments and annual development endpoints. Forecast trade capacity and actual exports are separate measurements.

Every controller turn is in `decisions.jsonl`, including idle turns. Monthly planet records retain population, jobs, locks, housing, disabled buildings and queues. Monthly economy records include production, consumption, crew, active research and completed technologies. Market transactions and development transitions are saved individually. War, border and combat reports remain in `events.jsonl`. Queue departure is not necessarily completion; ship removal is not necessarily a combat loss. Full checkpoints permit detailed diagnosis and continuation.

Latest validation: all 374 server tests passed, including the shared recovery, portfolio investment, worker safeguards and handoff regressions. Server typechecking passed. The client build and bundle budget passed earlier; these follow-up changes affect server code only. The viewer's JavaScript was exercised for every chart metric and both timeline endpoints with finite canvas coordinates. This is functional validation, not a visual browser inspection.

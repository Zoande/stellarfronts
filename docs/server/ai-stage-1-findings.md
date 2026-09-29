# Stage 1 AI laboratory findings

The laboratory ran the production simulation pipeline for five scripted scenarios on world seeds 19, 42, and 71. Each routine run lasted 30 game days in a compact 12-star, two-country world. Idle economy, construction/research, expansion, and combat/repair used 100 ms virtual ticks (7,200 ticks each). The corrected shortage-recovery runs used 1-second ticks (720 ticks each). Each run records its exact schedule, starting checkpoint, ordered actions and outcomes, state digests, source revision, JSON metrics, and JSONL replay under `.cache/ai-lab/`.

These are controlled correctness and balance diagnostics. Compact worlds and different tick schedules limit direct balance comparisons. Wall-clock runtime measurements are included in JSON, but some runs overlapped with host suspension and other tests, so the timing figures are not comparable benchmarks.

## Routine 30-day results

| Scenario | Seed 19 | Seed 42 | Seed 71 | Finding |
| --- | --- | --- | --- | --- |
| Idle economy | 0/0 actions; food 3,170.7 | 0/0; food 3,119.4 | 0/0; food 3,033.4 | No resource shortage, famine signal, or population loss in any seed. |
| Shortage recovery | 4/0; food 85.7 | 4/0; food 80.7 | 4/0; food 80.7 | Food shortage lasted 3.83 game days in each seed. Food was purchased before an agriculture district was queued; no population loss. |
| Construction/research | 3/0; 0 completions | 3/0; 0 completions | 3/0; 0 completions | Technology selection, district construction, and a building upgrade were accepted. Their long production/research horizons exceed this 30-day window. |
| Expansion | 2/0; 2 colonies | 1/0; 2 colonies | 2/0; 2 colonies | Every seed founded a second colony. Seeds 19 and 71 also accepted an outpost order, but ownership had not changed by day 30. |
| Combat/repair | 5/0; 200 reports | 1/0; 1 report | 5/0; 200 reports | Seeds 19 and 71 accepted an attack and four repair orders. No ships were lost. |

Accepted/rejected command counts refer to faction 0. The report count is retained history, capped at 200; reaching the cap means there may have been more. No routine run showed a famine signal or population loss. Full faction stockpiles, monthly income, minima, shortages, construction, research, losses, and runtime are in the per-run JSON reports.
The first idle-economy JSON reports predate the metric fix that stopped treating an empty research stockpile as a shortage; their `research: 30` shortage entry is an instrumentation artifact. Later reports and regression tests use the corrected definition.

## 360-day unattended economy

<!-- LONG_ECONOMY_RESULTS -->

## Findings and reproductions

- **Food construction has a food prerequisite.** At zero food, an agriculture district is unaffordable even when materials and energy are available. The recovery script originally bought food but never queued agriculture because its action query ran before the purchase. It now buys on day 3, queues agriculture from the next observation on day 4, and buys again on days 10 and 20. All four actions were accepted in each corrected run. Food stockpiles were positive on day 30, but monthly food income remained negative (about 183-188 units) while construction was pending. A longer recovery run would show whether the new district fixes that deficit in time. Reproduce with `npm run ai:simulate -- scenario --scenario shortage-recovery --seeds 19,42,71 --days 30 --step-ms 1000`.
- **Neutral-system combat may churn reports.** The combat scenario on seeds 19 and 71 filled the 200-report history cap in 30 days without destroying a ship; seed 42 produced one report. The scripts and initial checkpoints are in `current-combat-{seed}/combat-repair-{seed}.jsonl`. This needs a focused investigation of engagement endings, range, and repairs before treating it as a balance problem or changing constants.
- **Correctness bugs found during foundation work were fixed and covered by regression tests.** Rejected replacement and multi-source merge orders now leave ships, orders, resources, counters, and dirty state unchanged. Checkpoint restoration preserves leader-pool timing and in-progress combat/colonization/construction. Stale enemy fleets and starbases remain remembered until a scan can reveal their absence; private rival discoveries and prewar ownership no longer leak through observations. Combat contacts use recorded locations, and an empty research stockpile is no longer counted as a shortage. Legacy save upgrades mark their new deterministic state dirty for persistence.

No game balance constants were changed. The combat report cap and persistent food deficit are investigation targets, not confirmed balance diagnoses.

## Validation and scope

The server and client typechecks, production build, client bundle budget, and all 288 server tests passed. Coverage was 82.54% lines, 75.72% branches, and 76.83% functions, above required thresholds. A full 7,200-tick final-code combat replay matched its authoritative digest. Tests also cover human/AI action parity, malformed and unauthorized actions, immutable fair observations, hidden-state invariance, deterministic interleaving and checkpoint continuation, legacy saves, and replay divergence detection.

The [implementation guide](ai-foundations-and-laboratory.md) documents the headless API and CLI. Live caretaker/passive/active controllers, AFK tracking, transitions, development UI, and worker/LLM planning remain later stages. The next development step is to use this laboratory to build a conservative caretaker policy, while separately reproducing the combat report churn and testing whether queued food production resolves sustained shortages.

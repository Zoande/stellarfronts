# Active AI campaign results

Final implementation: seed 42, 422 actual systems (500 requested), ten active and five passive countries. The final same-world comparison ran 1,080 days (three game years) in 197.8 seconds, with 333 accepted commands and 0 rejected commands. The v2 baseline completed 3,600 days (ten game years); comparisons below use its matching day 1,080, not its ten-year endpoint.

Initial world, homeworld state, resources, designs and ships match across these runs: True. All use monthly virtual updates with no wall-clock sleeps. Code versions and source archives are saved per run. The experiments are isolated from real games.

10/10 active countries expanded, versus 1/10 at the same date in v2. Active countries hold 29 systems in total.

| Country | V2 systems at year 3 | Final systems | Colonies | Energy/month | Minerals/month | Food/month | Goods/month |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Color 1 (ID 0) | 2 | 3 | 2 | 58.1 | 158.4 | 98.9 | 22.1 |
| Color 2 (ID 1) | 1 | 2 | 1 | -0.6 | -36.7 | 6.1 | 27.3 |
| Color 3 (ID 2) | 1 | 3 | 1 | -0.4 | -1.1 | -3.4 | 26.9 |
| Color 4 (ID 3) | 1 | 3 | 1 | 6.9 | -27.2 | 44.0 | -3.7 |
| Color 5 (ID 4) | 1 | 3 | 1 | -2.0 | -28.0 | -6.5 | 29.3 |
| Color 6 (ID 5) | 1 | 4 | 1 | 43.9 | 63.5 | 27.2 | 22.0 |
| Color 7 (ID 6) | 1 | 3 | 1 | -6.1 | -33.0 | -17.5 | 17.8 |
| Color 8 (ID 7) | 1 | 3 | 1 | 1.3 | -12.4 | 34.5 | 28.1 |
| Color 9 (ID 8) | 1 | 3 | 1 | 6.9 | -27.2 | 75.0 | -3.7 |
| Color 10 (ID 9) | 1 | 2 | 1 | 128.0 | -82.2 | -45.1 | 12.4 |

## What caused the stalled expansion

- Eight active countries in the v2 year-eight checkpoint failed economic reserve gates despite still having construction ships. Small recurring trades did not fund lasting supply or an outpost.
- A healthy country repeatedly purchased corvettes ahead of outposts. The approved peace-time savings policy now permits limited military purchases while preserving an expansion goal; wars and visible threats override it.
- Housing pressure lowered happiness and output. Additional resource districts often added empty jobs because industry, farming, and mining consumed workers before technicians. Nominal capacity was not actual production.
- Temporary pauses could be undermined by another copy of the same factory; construction could also displace essential workers. Final safeguards prevent those behaviors.

## Recovery and remaining limits

The final run has 4 active countries with negative energy income and 8 with negative mineral income. These recurring deficits remain findings for further strategy/balance work; expansion alone does not establish economic health. No active country recorded a sampled zero-stock deficit or famine in this three-year run. Samples can miss brief shortages. Passive countries retain their earlier controller and can still suffer shortages.

The remaining mineral deficits are not all empty mining jobs. At the final checkpoint, Color 2 has its full 2.5 billion miners working, producing 219.6 minerals/month against 256.3 upkeep. Color 5 also has 2.5 billion miners, producing 229.5 against 257.5 upkeep. Color 10 fills its 1.75-billion mining capacity but produces only 167.8 against 250 upkeep. These countries need additional effective supply, lower industrial demand, or sustained trade; worker allocation alone cannot create missing capacity. The detailed breakdown is saved in `expansion-diagnosis/final-mineral-capacity.json`. No mining yields or industrial consumption rates were changed.

Active-only market trades at the matching three-year endpoint: v2 46, expansion/housing v5 83, workforce v6 24, final v7 58. Policy revisions interact; these figures do not establish a single change's isolated effect.

A separate ninety-day daily-cadence continuation of the v5 shortage checkpoint used the v6 workforce policy: 196 accepted commands, zero rejections. One country recovered positive energy income and three recovered positive mineral income. Other deficits persisted, including a food/energy tradeoff with reserves. This verifies actual recovery commands at finer cadence, not long-term equilibrium.

AI war declarations were enabled, but the final campaign started 0 wars and recorded 0 combat reports. This run does not establish war balance; war permission, planning, and combat cache equivalence have separate regression tests.

Shared automatic job order, production rates, district limits and outpost prices were not changed to hide these findings. Clear startup/recipe bugs were fixed separately: initial crew, initial research labs, and impossible research stockpile costs. Forecasts use visible own-state rules and reserve margins; they are approximate where government/species effects differ. Further limits include prefunding upgrades under hard district caps, sophisticated fleet design/diplomacy, and ground-war planning.

## Open the results

- [Latest timelapse](http://127.0.0.1:8124/active-campaign-final-v7/timelapse.html)
- [Completed ten-year v2 baseline](http://127.0.0.1:8124/active-campaign-42-v2/timelapse.html)
- Raw comparison: `.cache/ai-lab/expansion-diagnosis/final-comparison.json`.
- Daily shortage reproduction: `.cache/ai-lab/workforce-reproduction/comparison.json`.
- Each campaign preserves actions, events, monthly histories, initial/yearly/final checkpoints and source identity.

Partial v3/v4 experiments are explicitly marked superseded and are not counted as completed campaigns.

The final-code thirty-day daily-cadence smoke test also completed with 18 accepted commands and zero rejections.

Validation: 348 server tests passed; server typecheck passed; client production build passed. Viewer scripts and all chart selections were executed with a DOM/canvas stub, and local HTTP links were checked. This is not visual browser inspection.

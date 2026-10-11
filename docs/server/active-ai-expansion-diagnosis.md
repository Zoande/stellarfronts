# V2 expansion diagnosis

Evidence: `year-8.checkpoint.json` (year 8), recorded commands through day 3000, and monthly timeline from the completed ten-year v2 campaign. Policy gates are reconstructed from the checkpoint using unchanged passive candidate/reserve rules; these are diagnostic explanations, not decision reasons recorded at the time.

Eight of ten active countries fail the six-month economic health gate. All eight still have an idle construction fleet, so absence of a builder is not the cause. Most have tiny mineral stocks and negative mineral income; some also have energy or goods deficits. Their repeated small market purchases never accumulate the 2,000 minerals for an outpost plus the 550-mineral policy reserve.

A separate healthy active country, Color 6 (internal ID 5), repeatedly buys corvettes. Shipbuilding is checked before outposts, so positive income alone does not guarantee expansion savings. It has two colonies in its one home system and thus has grown in a way the system count alone does not show.

| Country | AI | Systems | Colonies | Energy/month | Minerals/month | Minerals saved | Economic gate | Outposts ordered | Market trades |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| Color 1 (ID 0) | active | 5 | 2 | 94.3 | 148.5 | 1493 | Pass | 5 | 0 |
| Color 2 (ID 1) | active | 1 | 1 | -22.5 | -36.7 | 21 | Blocked | 0 | 36 |
| Color 3 (ID 2) | active | 1 | 1 | -56.1 | -30.9 | 8 | Blocked | 0 | 33 |
| Color 4 (ID 3) | active | 1 | 1 | 8.1 | -43.4 | 87 | Blocked | 0 | 17 |
| Color 5 (ID 4) | active | 1 | 1 | 5.7 | -87.4 | 2 | Blocked | 0 | 74 |
| Color 6 (ID 5) | active | 1 | 2 | 109.9 | 43.8 | 884 | Pass | 0 | 0 |
| Color 7 (ID 6) | active | 1 | 1 | 4.2 | -65.9 | 4 | Blocked | 0 | 77 |
| Color 8 (ID 7) | active | 1 | 1 | -58.9 | 1.4 | 303 | Blocked | 0 | 16 |
| Color 9 (ID 8) | active | 1 | 1 | 8.1 | -43.4 | 87 | Blocked | 0 | 17 |
| Color 10 (ID 9) | active | 1 | 1 | 43.6 | -95.8 | 23 | Blocked | 0 | 87 |
| Color 11 (ID 10) | passive | 3 | 2 | 96.8 | 71.6 | 2106 | Pass | 2 | 0 |
| Color 12 (ID 11) | passive | 1 | 1 | -96.7 | -30.0 | 0 | Blocked | 0 | 85 |
| Color 13 (ID 12) | passive | 1 | 1 | -96.8 | 16.1 | 547 | Blocked | 0 | 56 |
| Color 14 (ID 13) | passive | 1 | 1 | 43.2 | -61.0 | 23 | Blocked | 0 | 86 |
| Color 15 (ID 14) | passive | 1 | 1 | -47.9 | 152.1 | 6994 | Blocked | 0 | 10 |

## Examples

- Color 5 (ID 4): 2 minerals, -87.4 minerals/month, idle builder, 74 market trades. No expansion orders.
- Color 7 (ID 6): 4 minerals, -65.9 minerals/month, idle builder, 77 market trades. No expansion orders.
- Color 8 (ID 7): four generator districts but only about 972 million technicians, while other jobs occupy the available workforce. Energy income is -58.9/month. Adding districts alone does not ensure staffed production.
- Color 15 (ID 14, passive): nearly 7,000 minerals and reachable expansion candidates, but energy income is -47.9/month and the energy reserve is below six months of deficit. Its homeworld has reached its two-generator limit. This is a different shortage from low minerals.
- Color 6 (ID 5): +43.8 minerals and +109.9 energy/month, but only 884 minerals saved and repeated corvette orders. The fixed ship-before-outpost priority prevents savings.
- Color 1 (ID 0): +148.5 minerals and +94.3 energy/month, an active outpost build, two colonies, and regular expansion.

## Response

The approved recovery policy can pause optional demand or fund productive construction while protecting wartime alloy output. A three-day daily-cadence continuation improved the mineral/energy incomes of IDs 4 and 6, with all 19 commands accepted. That verifies immediate recovery effects, not long-term sustainability.

The user also approved peace-time expansion savings with limited military purchases. The controller now permits one military order between outposts while saving; wars and stronger visible border threats override that limit. It delays unneeded crew infrastructure, prioritizes crowded housing, and forecasts staffing and input effects before resource development. No production rates, job priorities, district limits, prices, or outpost costs were changed.

## Workforce findings

The year-eight v2 checkpoint shows a further feedback loop: many stalled homeworlds have roughly 12 billion residents and housing for 10 billion, happiness around 41–48, and low stability. Successful homeworlds have more housing and staffed technician jobs. Building additional generators alone does not solve low staffing because the shared job order fills industry, farming, and mining before technicians.

The same-map three-year v5 follow-up confirms that housing and expansion priority improve territorial growth, but do not solve the workforce distribution. All ten active countries expanded to 2–4 systems, versus only one expanding active country at the matching v2 date. Nevertheless seven active countries ended with negative energy income. Some had capacity for 2.5 billion technicians but no technicians working; trade kept stocks above zero. The saved workforce details are in `.cache/ai-lab/expansion-diagnosis/v5-workforce.json`.

The user approved managing workers through existing player controls. Those controls lock current allocations rather than assigning workers to empty jobs. The implementation therefore frees workers with safe temporary building pauses and protects the newly staffed essential jobs before restarting production. Existing player locks are preserved. Shared job ordering remains unchanged.

The daily-cadence continuation of the v5 final checkpoint ran ninety days with 196 accepted commands and no rejections. Color 4 (ID 3) improved from -74.4 to +36.5 energy/month. IDs 3, 6, and 8 changed from negative to positive mineral income. Other deficits persisted, and one pause traded food production for energy while retaining food reserves. This is a recovery mechanism with tradeoffs, not evidence of a fully balanced economy. Details and all commands are in `.cache/ai-lab/workforce-reproduction/comparison.json`; that continuation uses the v6 implementation, before the final safeguards below.

The investigation also found that new projects could consume essential workers despite a large cash reserve, and that development could build another factory while the earlier copy was deliberately paused. The final controller protects essential staffing before construction as well as restart, and blocks duplicate production that bypasses a pause. This is covered by regression tests and a separate same-world campaign. See [active-ai-first-results.md](active-ai-first-results.md) for the final measured comparison.

The full `v2.json` retains stocks, income, jobs, districts/capacity, queues, builder orders, known-system counts, candidate counts, reconstructed decisions, and recent action traces. Small outpost candidate counts can simply mean the candidate generator filtered unaffordable orders; they do not alone establish that no unclaimed systems exist.

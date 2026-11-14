# November 2026 balance audit

The production campaign was inspected read-only on 14 November, before changing
its code. No population, inventories, ownership, memberships or war settings
were reset. Private snapshots and account information are not part of this report.

## What actually happened

At game year 2406.12, about 306 game years after creation on 14 October:

- All 15 countries had active AI controllers. The takeover mechanism had worked.
- Six countries had player memberships; none had an active connection during the audit.
- There were 411 systems, 166 starbases, 27 inhabited planets and only 15 ships.
- Every country had exhausted food and consumer goods. Research income was zero
  everywhere. All inhabited planets had zero stability and maximum crime.
- Population had grown to about 1.26 trillion, far beyond built housing and supply.
- AI war declarations were not enabled. No wars is consistent with that setting,
  rather than evidence that the controllers never started. The audit preserves it.
- The completed, isolated October grand simulation was a separate job. Its old
  PM2 entry was restarting successfully completed work continuously (over 2.6
  million restarts). It was stopped and PM2's saved state updated; its results
  were retained. The repository's current grand-simulation config already has
  `stop_exit_codes: [0]` and should be used for future runs.

Main already contained development-branch's game code. The only other branch
with an unmerged commit was generated Cloudflare configuration, not newer game logic.

## Changes

Natural births now taper with empire food-shortage progress and stop at the
famine threshold (34). Previously births could offset famine deaths indefinitely,
maintaining an overcrowded, starving equilibrium. The factor recovers as food
supply recovers. Local food deficits do not penalize well-supplied specialist
planets. The population panel explains the factor, with a fallback for older
protocol-12 snapshots. Healthy growth rates, species traits and famine death
rates are unchanged.

Economic recovery no longer requires an already bankrupt country to become
solvent in a single action. Empty industrial subdistricts can be rezoned without
removing buildings or paid queues. In peace, optional downstream factories can
be paused when doing so makes a substantial improvement to missing mineral or
energy inputs. The emergency path cannot worsen food or either upstream input;
market prices must support at least twice the value of any lost goods output.
Administrative complexes can also be paused when their forecast improves basic
supply. Player job locks, food supply, wartime alloy output and restart safeguards
remain protected. These are ordinary commands using visible country information,
not resource grants or direct state repairs.

Resting orbiting fleets no longer trigger a second full intelligence refresh on
every simulation tick. Actual travel and phase transitions retain that refresh.
A traveling fleet still needs both refreshes; this is not a claim that all of the
campaign's measured tick cost has been eliminated.

## Isolated continuation

Two copies of the same saved campaign were advanced for 30 game days: main
`bdd6216` and the updated code. Existing AI episodes and all six memberships were
retained; real account activity time was frozen. Both used the production game
core, authoritative commands and restricted AI observations, with **one-day
steps**, not production's 100 ms cadence. These are short counterfactual economy
experiments, not proof of long-term balance or combat equivalence.

| Result at day 30 | Old code | Updated code |
| --- | ---: | ---: |
| Accepted commands | 17 | 75 |
| Rejected commands | 0 | 0 |
| Combined mineral income / month | -2,555.1 | -41.0 |
| Combined energy income / month | -1,674.7 | -1,126.0 |
| Combined food income / month | -21,709.6 | -21,697.8 |
| Combined goods income / month | -2,083.1 | -2,060.1 |
| Combined research income / month | 0 | 0 |

The new policy performed nine residential rezonings, 53 optional building pauses
and 13 market trades. The mineral deficit fell by about 98%; energy improved by
about 33%. Food demand remains vastly above production, and research has not
restarted. This severely overgrown campaign is **not fully recovered**. A longer
observation period is needed before tuning growth, capital capacity, construction
funding, expansion upkeep or research costs further. Do not infer a healthy
multi-week campaign from a short startup simulation.

Regression coverage includes partial recovery from simultaneous empty stocks,
food protection, existing structures and queues, wartime output, worker locks,
famine births, resupply and specialist planets fed through imports. Release
checks include server and client typechecking, the full test suite and coverage
floors, production build/bundle budget, public observer authentication, and a
read-only WebSocket snapshot through the deployed gateway. Schema 30 and
protocol 12 remain compatible; deployment uses the orchestrator's verified
backup/update flow.

## Save latency follow-up

After deployment, the newest on-disk save's game clock was roughly three minutes
behind the running campaign even though writes were completing. Node's
`FileHandle.writeFile` splits this roughly 60 MB snapshot into 512 KiB writes.
With a busy synchronous tick, every callback can wait behind another tick.

Snapshot writes now serialize one coherent instant before the first asynchronous
operation, submit the complete remaining buffer, and retry legitimate short
writes. A zero-progress write fails. Temporary-file replacement, file and
directory fsync, single-flight saves and flushing of subsequent mutations are
unchanged. A deterministic test checks that an old clock cannot be combined with
later mutable arrays in the first snapshot.

An isolated busy-loop benchmark of the same 59,382,795-byte file took 6.37 seconds
with `writeFile` versus 0.27 seconds with the full-buffer writer. Both results
matched the original SHA-256. This is an I/O scheduling experiment, not a claim
that the live Pi has the same absolute timings or that simulation tick cost has
been eliminated.

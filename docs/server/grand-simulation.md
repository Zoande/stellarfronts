# Overnight grand simulation

After pulling these changes on the Raspberry Pi, install the locked dependencies with `npm ci`, then run:

```bash
npm run grandsimulation
```

This defaults to **15 wall hours, 15 active AIs, zero passive AIs, the full default map, forensic recording, and an 80 GB soft storage budget**. For 12 hours:

```bash
npm run grandsimulation -- --hours 12
```

No `.env`, auth server, game server, orchestrator, browser, database, or network listener is needed. The runner uses the existing in-memory headless production runtime. It creates a separate game and writes only its own result directory. AI war declarations are enabled in that game; real games retain their normal default. If run on a machine that also hosts live games, it still competes for that machine's CPU, memory and disk bandwidth.

The default output directory is `.cache/grandsimulation/run-<UTC timestamp>/`. The console prints its absolute path. The default seed is 42. Map generation uses the ordinary default configuration requesting 500 systems; its spacing rules currently place 422 for seed 42. This is the full default map, without laboratory size reductions.

## Accuracy and speed

The runner executes **every production tick at 100 ms virtual intervals**, using the same constant as the live server. Every economy, population, research, movement, combat, intelligence and AI update goes through the normal production pipeline. AI controllers retain their normal daily decision schedule. No days, combat frames or update calls are skipped. There are no real-time pacing waits, adaptive daily steps, parallel faction decisions, or AI resource bonuses. Disk backpressure and recording reduce throughput instead of dropping updates.

This is a deterministic laboratory clock, not a reproduction of live network latency or irregular server timer delays. Tests compare recorded versus unrecorded state digests, reconstruct the recorded state, and compare resumed versus uninterrupted runs.

At the default clock, one game day requires 240 ticks. A rate of 1 tick/second produces 15 game days per wall hour; 10 ticks/second produces 150. **Twelve to fifteen wall hours do not guarantee decades of game time.** The initial full-map benchmark on the development machine, alongside other simulations, averaged approximately 0.5–0.6 ticks/second. The Pi has not been benchmarked. Watch the printed `game days/hour` rate to judge progress. Useful speed improvements must preserve the production calculations and can be evaluated separately with this data.

Logs are streamed into fast gzip level 1, rotated at 64 MiB of raw JSON per channel, with backpressure. They are not accumulated in memory for the whole run. The current world, delta comparison state, a limited number of pending records and lightweight map frames still use memory and grow with the game. Host memory/CPU samples help detect this. Compression runs through Node's worker pool; authoritative updates remain sequential to preserve command order and RNG outcomes.

## Data volume and recording levels

The longer initial forensic benchmark produced about 38 MB of compressed logs over 100 ticks. Extrapolating that early throughput gives roughly **9–12 GB over 12–15 hours on the development machine**. Budgeting **5–25 GB** is a rough planning range for forensic data, not a Pi measurement or guarantee. Later growth/combat, intelligence size, thermal throttling, storage speed and processing throughput can change it materially. The console and `progress.json` update a measured forecast throughout the run; very early samples are noisy and may not cover a full AI day. Forecasts describe ingestion before future retention savings.

| Level | Recorded detail | Rough planning allowance for 12–15 hours |
| --- | --- | --- |
| `forensic` (default) | Full authoritative state changes after every tick and exact restricted AI inputs before every turn, plus all channels below | 5–25 GB; default soft budget 80 GB |
| `detailed` | All dynamic gameplay state changes after every tick, excluding static geometry, uninhabited idle planets and intelligence ledgers; full checkpoints keep those fields | 0.5–5 GB |
| `compact` | Every decision/command/event, daily economy/planet/map samples, performance and full checkpoints; no per-tick state delta channel | 0.2–2 GB |

All three use identical game integration accuracy. Only recording detail and processing overhead differ. Override explicitly if desired:

```bash
npm run grandsimulation -- --logging detailed --max-data-gb 20
```

All levels record controller diagnostics and rejected commands, realized market transactions, development/research/ship/army transitions, war/border/combat events, per-tick performance, daily economies and workers, daily map frames, host performance, source identity and full checkpoints including RNG and AI episode state.

Near 80 GB (at 90%, or **72 GB**), the runner seals open chunks and starts maintaining the oldest data. It first tries lossless gzip level 9 recompression, aiming for 80% (**64 GB**). Only if stronger compression is insufficient does it remove old `intelligenceByFaction` state history and old observation snapshot intelligence/static geometry. Core gameplay state, all decisions/actions/trade/development/combat/border history, and full checkpoints remain intact. `retention.json` records each rewrite, its byte savings and removed fields; reduced records have an explicit `projection` label. New data continues to arrive at the selected recording level.

The soft budget includes compressed logs and checkpoints. Final recovery output, small reports, buffered writes and compaction temporary files can exceed it slightly. If protected data alone exhausts the budget, the runner saves and stops with `data-limit-core-retained`. It also saves and stops if free disk falls below 2 GB. It never deletes core history or checkpoints to hide budget exhaustion.

## Results, stopping and recovery

Open `timelapse.html` from the result directory in a browser. It is self-contained and has daily border frames, economy/military/research charts and links to the reports. Copy the result directory back from the Pi for analysis; preserve `logs/`, checkpoints and `retention.json` together.

| Output | Contents |
| --- | --- |
| `run.json`, `summary.json`, `progress.json` | Configuration, host/source identity, status, throughput, storage forecast and counters |
| `timelapse.html`, `timeline.jsonl`, `galaxy.json` | Daily border/development visualization, raw frames and map geometry |
| `analysis.md`, `analysis.json` | Automatically generated pacing, development, trade and decision analysis after clean stop |
| `logs/<channel>-NNNNN.jsonl.gz` | Independently compressed JSON Lines chunks; channel record order follows the numeric suffix |
| `initial`, `periodic-*`, `final` or `failure.checkpoint.json.gz` | Full isolated game checkpoints; periodic saves every 10 wall minutes or game year, whichever comes first |
| `latest-checkpoint.json` | Latest completed checkpoint filename, tick and digest |
| `recording.md`, `retention.json` | Recording/reconstruction instructions and any deliberate old-detail reductions |
| `source.patch`, `untracked-source.json` | Working-tree source additions/changes relative to the recorded Git revision, when Git is available |

Use **Ctrl+C once** to stop after the current update and save. Wait for the stopped message. The wall limit stops after a completed update; initialization, final checkpointing and analysis can add time. Forced termination or power loss can leave the open gzip chunk incomplete; completed checkpoints/chunks remain the recovery points. The script does not keep the operating system awake or survive a disconnected terminal by itself; on a Linux Pi, use your usual persistent terminal such as an existing `tmux` session for unattended execution.

Resume into a new output directory:

```bash
npm run grandsimulation -- --checkpoint .cache/grandsimulation/run-EXAMPLE/periodic-00001.checkpoint.json.gz
```

Resume preserves the checkpoint's world/RNG/controller state, pins all 15 countries active and enables laboratory wars again. The old output directory remains intact. Checkpoints with human accounts or paused clocks are rejected. Keep the same code revision for deterministic continuation; a changed AI implementation can legitimately make different decisions. `--out` can choose a directory, but an existing run is never overwritten.

Rebuild the analysis from completed compressed logs without decompressing gigabytes onto disk:

```bash
npm run grandsimulation -- --analyze .cache/grandsimulation/run-EXAMPLE
```

State records use `{tick,day,delta:{set:[[path,value]],remove:[path]}}`. Paths are arrays, preserving IDs containing punctuation. The first record establishes the state view. Apply sets, then removes, using `applyStateDelta`. For gameplay reconstruction across mixed retention tiers, apply `reduceOldGrandRecord("state", row)` to **all** state records first, so intelligence is consistently omitted. Complete intelligence reconstruction requires an unmodified checkpoint and subsequent unreduced chunks. Reduced observations are no longer the original exact AI input. Diagnostic command logs alone are not an independent executable replay script.

## How to extend / rules

Keep the runner independent of database/server startup and environment files. Preserve production tick cadence, shared game rules, restricted AI observations, command ordering and deterministic RNG. Recording callbacks must never feed authoritative observer knowledge into controller decisions. Declare any reduced history in the retention manifest and preserve recoverable full checkpoints. When optimizing, compare state digests and replay/resume behavior against the unchanged production pipeline.

## Key files

- [CLI](../../server/grand-simulation-cli.ts) and [runner](../../server/game/grand-simulation.ts).
- [Gzip/state recording](../../server/game/grand-recording.ts) and [retention](../../server/game/grand-retention.ts).
- [Headless production runtime](../../server/game/headless-game.ts), [telemetry](../../server/game/campaign-telemetry.ts), [analysis](../../server/game/campaign-analysis.ts) and [viewer](../../server/game/campaign-viewer.ts).
- [Verification](../../server/tests/grand-simulation.test.ts).

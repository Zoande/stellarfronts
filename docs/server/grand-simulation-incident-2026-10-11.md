# Interrupted Pi grand simulation: 2026-10-11 UTC

## Finding

The archive `run-2026-10-11T23-24-36-621Z.zip` contains roughly 23 minutes of execution, ending around 23:47 UTC, not an overnight simulation. The recording reached about six game days. Its metadata still says `running`; there is no final summary, failure checkpoint or clean-shutdown record. Open gzip channels have incomplete endings. This establishes abrupt termination, but does not establish its cause.

The supplied Pi journal shows the same boot and the same background worker PID logging continuously across the cutoff. That argues against a whole-machine reboot or power failure in that interval. A subsequent search found no matching OOM, killed-process, Node, terminal, desktop-session or crash entries. `coredumpctl` is not installed. There is insufficient evidence to identify a simulation exception, terminal failure, OS kill or other cause conclusively.

## Recovered evidence

- Configuration: 15 active countries, no passive countries, full default map (422 generated systems), forensic recording, every 100 ms production tick, 15-hour wall allowance, 80 GB storage allowance.
- Last progress: tick 1430, 5.9583 game days, 1352.3 wall seconds. Timeline reaches day 6; final state history ends during the following record.
- 86 accepted commands, zero rejected: 15 research selections, 15 districts, 15 fleet moves, 26 worker locks, 15 starbase orders. There are 90 daily AI decisions/observations.
- No wars, combat reports, border changes or completed research in this short window. This is useful startup and recording evidence, but cannot support long-term balance or war-pace conclusions.
- Recorded RSS peaked around 1.10 GB on a 16 GB Pi. Free storage remained around 159.6 GB. Neither recorded sample indicates exhaustion; unsampled transient failure remains possible.
- The three saved checkpoints decompress successfully. Latest: `periodic-00002.checkpoint.json.gz`, tick 1268, day 5.2833. Loading it with the current headless runtime preserves its recorded state digest: `ac2cc6f3ffffb7ca167c310b185881ed47d1b95f8250f87854f2ad79dcea6989`. This validates the recovery state, not identical future behavior across differing source revisions.

The original ZIP is untouched. Local recovery artifacts are under `.cache/ai-lab/pi-overnight-investigation/`: `audit.json`, `recording-benchmark.json` and `recovered-analysis/`. Complete JSON lines were salvaged from truncated diagnostic gzip channels; the incomplete final line was discarded and the recovery is labeled. State history was not expanded into multi-gigabyte plain files. The recovered directory contains rebuilt `analysis.md`, `analysis.json` and the original timelapse.

## Performance and changes

Measured throughput was about 1.06 ticks/second, or 15.9 game days per wall hour. At that early pace, 15 wall hours would produce around 238 game days, rather than years. The existing performance channel measured game calculations only: 744 seconds over 1430 updates, versus 1352 wall seconds overall. Recording and other work therefore represent a substantial additional cost.

Repeated intelligence `observedAtYear` paths dominated raw deltas. A six-update check from the recovered checkpoint compared the old recording with a lossless grouped timestamp encoding, reconstructed every authoritative field exactly, and reduced raw deltas from approximately 8.2–8.5 MB to 2.27–2.57 MB per update (about 72%). This is a development-machine measurement, not a guarantee of Pi throughput or compressed storage savings. Production update cadence, rules, AI decisions and RNG are unchanged.

The next run has independent process diagnostics, native fatal reports, persistent PM2 console logs, phase-specific tick timings, and automatic checkpoint continuation into separate segments. PM2 saves every five wall minutes, retains the original run deadline, and does not restart successful completion. See [launch and recovery instructions](grand-simulation.md).

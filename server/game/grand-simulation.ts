import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statfsSync, writeFileSync } from "node:fs";
import { cpus, totalmem, platform, arch } from "node:os";
import path from "node:path";
import { gzip, gunzipSync } from "node:zlib";
import { promisify } from "node:util";
import { setImmediate } from "node:timers/promises";
import { GALAXY_MAP } from "../../src/data/GalaxyMap";
import { RESOURCE_KINDS } from "../../src/data/Economy";
import { createHeadlessGame, type GameCheckpoint } from "./headless-game";
import { campaignSample, sourceArchive, type CampaignSample } from "./active-lab";
import { campaignViewer } from "./campaign-viewer";
import { createCampaignTelemetry } from "./campaign-telemetry";
import { createGrandLog, createStateDelta, grandStateView, type GrandLogLevel } from "./grand-recording";
import { analyzeCampaign } from "./campaign-analysis";
import { SERVER_TICK_INTERVAL_MS } from "./constants";
import { createGrandRetention } from "./grand-retention";

export const GRAND_STEP_MS = SERVER_TICK_INTERVAL_MS;
const GB = 1e9;
const compress = promisify(gzip);
export interface GrandOptions {
  output: string; seed: number; hours: number; logging: GrandLogLevel;
  maxDataGB: number; checkpointMinutes: number; maxTicks?: number; checkpoint?: string;
  /** Test fixtures only; the CLI always uses the full default map and 15 AIs. */
  initialWorld?: { starCount: number; factionCount: number };
  shouldStop?: () => string | undefined;
  minFreeGB?: number;
  onCheckpoint?: (filename: string) => void;
  onStatus?: (status: { phase: string; tick: number; day: number }) => void;
}
export function readGrandCheckpoint(filename: string): GameCheckpoint {
  const bytes = readFileSync(filename);
  return JSON.parse((filename.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8"));
}
function atomicJson(filename: string, value: unknown) {
  writeFileSync(filename + ".tmp", JSON.stringify(value, null, 2)); renameSync(filename + ".tmp", filename);
}

/** All game and AI updates run through the production pipeline, in fixed
 * 100 ms virtual increments. Wall time limits execution, never game cadence.
 * No auth store, sockets, orchestrator, server saves or environment file. */
export async function runGrandSimulation(options: GrandOptions) {
  if (!Number.isFinite(options.hours) || options.hours <= 0 || !Number.isFinite(options.maxDataGB) || options.maxDataGB <= 0
    || !Number.isFinite(options.checkpointMinutes) || options.checkpointMinutes <= 0
    || !["compact", "detailed", "forensic"].includes(options.logging)
    || !Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff
    || options.maxTicks !== undefined && (!Number.isSafeInteger(options.maxTicks) || options.maxTicks <= 0)) throw new Error("Invalid grand simulation options.");
  mkdirSync(options.output, { recursive: true });
  const safeOptions = { ...options, shouldStop: undefined };
  writeFileSync(path.join(options.output, "run.json"), JSON.stringify({ status: "initializing", options: safeOptions }), { flag: "wx" });
  try { return await executeGrandSimulation(options); }
  catch (error) {
    try {
      const filename = path.join(options.output, "run.json"), run = JSON.parse(readFileSync(filename, "utf8"));
      atomicJson(filename, { ...run, status: "failed", failure: String(error) });
    } catch { /* Preserve the original error even if the storage device failed. */ }
    throw error;
  }
}

async function executeGrandSimulation(options: GrandOptions) {
  const safeOptions = { ...options, shouldStop: undefined };
  const revision = sourceArchive(options.output);
  const initial = options.checkpoint ? readGrandCheckpoint(options.checkpoint) : createHeadlessGame({ worldSeed: options.seed,
    simulationSeed: (options.seed ^ 0x5f3759df) >>> 0, initialWorld: options.initialWorld ?? { starCount: GALAXY_MAP.starCount, factionCount: 15 } }).exportCheckpoint();
  if (Object.keys(initial.accounts.owners).length) throw new Error("Grand simulations accept only isolated checkpoints with no human accounts.");
  if (!options.initialWorld && initial.state.factions.length !== 15) throw new Error("The grand simulation requires exactly 15 countries.");
  if (initial.state.clock.paused) throw new Error("Cannot run a paused checkpoint; resume an unpaused isolated checkpoint.");
  initial.state.aiSettings = { allowWarDeclarations: true };
  const activeIds = initial.state.factions.map((faction) => faction.id);
  const log = createGrandLog(path.join(options.output, "logs"));
  try {
    const retention = createGrandRetention(options.output, log);
    const telemetry = createCampaignTelemetry(options.output, initial.state, (name, value) => log.write(name, { tick, ...value as object }));
    const stateDelta = createStateDelta({ groupIntelTimestamps: true });
    let tick = 0, day = 0, accepted = 0, rejected = 0, checkpointBytes = 0, checkpoints = 0, maximumTickMs = 0, ownershipChanges = 0;
    let stopReason = "wall-time", failure: unknown;
    const game = createHeadlessGame({ checkpoint: initial, stepMs: GRAND_STEP_MS,
      enablePassiveAi: false, enableActiveAi: true, activeFactionIds: activeIds,
      onAiObservation: options.logging === "forensic" ? (observation) => log.write("observations", { tick, day, observation }) : undefined,
      onAiDecision: (record) => telemetry.decision(day, record),
      onAiAction: (record) => { record.outcome.ok ? accepted++ : rejected++; log.write("actions", { tick, day, ...record }); } });
    const start = game.now(), msPerDay = 1000 * initial.state.clock.tickSpeedSeconds / initial.state.clock.tickSizeDays;
    const frames: CampaignSample[] = [];
    const stars = initial.state.stars.map(({ id, x, z, name }) => ({ id, x, z, name }));
    const factions = initial.state.factions.map(({ id, name, color }) => ({ id, name, color, mode: "active" }));
    atomicJson(path.join(options.output, "galaxy.json"), { stars, hyperlanes: initial.state.hyperlanes, factions });
    writeFileSync(path.join(options.output, "timeline.jsonl"), "", { flag: "wx" });
    const metadata = { formatVersion: 2, options: { ...safeOptions, stars: options.initialWorld?.starCount ?? GALAXY_MAP.starCount,
      countries: activeIds.length, active: activeIds.length, stepMs: GRAND_STEP_MS, allowWars: true, adaptive: false }, revision, stepMs: GRAND_STEP_MS,
      startedAtUTC: new Date().toISOString(),
      host: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), platform: platform(), arch: arch(), node: process.version, pid: process.pid },
      schedule: "every-production-tick", actualStars: stars.length, actualCountries: factions.length, activeIds, mapSampleDays: 1,
      initialYear: initial.state.clock.year, resumedFrom: options.checkpoint ?? null, logs: "gzip JSONL chunks; see recording.md" };
    atomicJson(path.join(options.output, "run.json"), { ...metadata, status: "running" });
    writeFileSync(path.join(options.output, "recording.md"), `# Grand simulation recording\n\nEvery game update is ${GRAND_STEP_MS} virtual milliseconds. There are no adaptive or skipped-day updates. All ${activeIds.length} countries are pinned active, and AI wars are enabled only in this isolated game.\n\nLogs are gzip JSONL in logs/, rotated after 64 MiB of raw JSON. Completed chunks are independently decompressible. The open chunk is finalized on clean shutdown. No live records are intentionally dropped; storage retention can reduce old observer fields as declared below. Backpressure can reduce wall throughput, without changing virtual tick size.\n\nAll levels: every controller decision/attempted command, every observed market/development transition, per-tick performance, daily economies/inhabited planets, daily map frames, full initial/periodic/final checkpoints, RNG state and source archives. Detailed adds gameplay state deltas after every tick, excluding static geometry, empty planets and intelligence ledgers (preserved in checkpoints). Forensic adds the complete authoritative state delta, including all intelligence fields, and exact detached AI observations before each controller turn. Observer data never enters AI decisions.\n\nstate-*.jsonl.gz contains {tick,day,delta:{set:[[path,value]],remove:[path]}}. Paths are arrays of keys or indices. Apply set operations, then optional intelTimestamps, then removes. intelTimestamps groups exact observedAtYear changes by year; fields is a nested path tree relative to intelligenceByFaction, with true leaves identifying objects whose observedAtYear becomes that year. No timestamps are inferred or omitted. applyStateDelta supports both this format and older logs. The first record initializes the selected state view. Reconstruct forensic records against full checkpoint state; detailed records reconstruct their documented projection. Command/event logs are diagnostic history, not an independent executable replay script.\n\nFull checkpoint *.json.gz files contain the normal headless GameCheckpoint format. Resume using --checkpoint path; it creates a new output directory and keeps the previous run intact. Forced termination/power loss may truncate an open log chunk; use a completed checkpoint.\n`);
    appendFileSync(path.join(options.output, "recording.md"), `\n## Storage retention\n\nThe selected storage budget is ${options.maxDataGB} decimal GB. At 90% of the budget, maintenance seals open chunks and first recompresses the oldest completed chunks at gzip level 9, aiming for 80% of the budget. If stronger compression is insufficient, older state chunks omit intelligenceByFaction, and older AI observations omit snapshot intelligence/static map fields. All other gameplay state, decisions, commands, trade, development, war/border/combat events, and full checkpoints remain intact. The simulation still executes every production tick. retention.json records every rewrite and removed field; reduced JSONL records carry a projection label.\n\nFor gameplay reconstruction across mixed tiers, call reduceOldGrandRecord(\"state\", row) on ALL state records before applyStateDelta. Full intelligence reconstruction requires an unreduced checkpoint and subsequent unreduced chunks. A reduced observation is no longer the exact original AI input.\n\nIf irreducible protected data reaches the budget, the runner saves and stops rather than silently deleting it. A 2 GB free-disk reserve also causes a clean stop. Final checkpoint, metadata, stream buffers and maintenance temporary files can briefly exceed the soft budget. Checkpoints are never pruned.\n`);
    async function checkpoint(name: string) {
      options.onStatus?.({ phase: "checkpoint", tick, day });
      const filename = path.join(options.output, name + ".checkpoint.json.gz");
      const bytes = await compress(JSON.stringify(game.exportCheckpoint()), { level: 1 });
      const temporary = filename + ".tmp", fd = openSync(temporary, "w");
      try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, filename);
      options.onCheckpoint?.(path.resolve(filename));
      checkpointBytes += bytes.length; checkpoints++;
      const digest = game.digest();
      atomicJson(path.join(options.output, "latest-checkpoint.json"), { filename: path.basename(filename), tick, day, digest });
      log.write("checkpoints", { tick, day, filename: path.basename(filename), bytes: bytes.length, digest });
    }
    function sample() {
      const frame = campaignSample(game.diagnosticState(), activeIds, day); frames.push(frame);
      const filename = path.join(options.output, "timeline.jsonl");
      // Timeline remains plain JSONL for the existing viewer/analyzers.
      appendTimeline(filename, frame);
    }
    let ownerHistory = JSON.stringify(initial.state.starOwnership), warHistory = JSON.stringify(initial.state.diplomacy), reports = new Set(initial.state.combatReports.map((report) => report.id));
    let nextDay = 1, nextYear = 360;
    await checkpoint("initial"); sample(); telemetry.sample(game.diagnosticState(), day);
    if (options.logging !== "compact") log.write("state", { tick, day, delta: stateDelta(grandStateView(game.diagnosticState(), options.logging)) });
    console.log(`Isolated grand simulation: ${activeIds.length} active AIs, ${stars.length} actual systems, ${options.logging}, ${options.hours} wall hours. Output: ${path.resolve(options.output)}`);
    const created = performance.now();
    let lastProgress = created, lastCheckpoint = created, baseStats = log.stats(), measuredAt = created;
    let lastDailySample = 0;
    function summary(status: string) {
      const elapsedSeconds = (performance.now() - created) / 1000;
      const stats = log.stats(), measuredSeconds = Math.max(1, (performance.now() - measuredAt) / 1000);
      const logBytesPerSecond = Math.max(0, stats.compressedBytes + retention.summary().savedBytes - baseStats.compressedBytes) / measuredSeconds;
      const meanCheckpointBytes = checkpointBytes / Math.max(1, checkpoints);
      const checkpointRate = meanCheckpointBytes * Math.max(1 / (options.checkpointMinutes * 60), (day / Math.max(1, elapsedSeconds)) / 360);
      return { ...metadata, status, stopReason, tick, simulatedDays: day, year: game.diagnosticState().clock.year, elapsedSeconds,
        accepted, rejected, maximumTickMs, ownershipChanges, ticksPerSecond: tick / Math.max(1, elapsedSeconds),
        warsStarted: game.diagnosticState().diplomacy.wars.length,
        warsEnded: game.diagnosticState().diplomacy.wars.filter((war) => war.endedAtYear).length, combatReports: reports.size,
        gameYearsPerWallHour: day / 360 / Math.max(1, elapsedSeconds) * 3600,
        gameDaysPerWallHour: day / Math.max(1, elapsedSeconds) * 3600,
        ...stats, checkpointBytes, checkpoints, totalRecordedBytes: stats.compressedBytes + checkpointBytes, retention: retention.summary(),
        storageEstimate: { measuredSeconds, logBytesPerSecond, periodicCheckpointBytesPerSecond: checkpointRate,
          earlySample: day < 1 || elapsedSeconds < 60,
          twelveHoursGB: (logBytesPerSecond + checkpointRate) * 12 * 3600 / GB,
          fifteenHoursGB: (logBytesPerSecond + checkpointRate) * 15 * 3600 / GB,
          note: "Extrapolated from observed ingestion/throughput, excluding the initial checkpoint and baseline logs, before future retention savings. Early samples may not cover a full AI day. Later growth/combat/observations can materially change the rate. This is not a guarantee or limit." },
        ...telemetry.summary() };
    }
    async function progress() {
      const disk = statfsSync(options.output);
      log.write("host", { tick, day, elapsedSeconds: (performance.now() - created) / 1000,
        memory: process.memoryUsage(), cpu: process.cpuUsage(), resources: process.resourceUsage(),
        systemFreeBytes: disk.bavail * disk.bsize });
      await log.flush();
      const report = summary("running");
      atomicJson(path.join(options.output, "progress.json"), report);
      writeFileSync(path.join(options.output, "timelapse.html"), campaignViewer({ stars, hyperlanes: initial.state.hyperlanes, factions, frames, compressedLogs: true,
        summary: { ...report, runtimeMs: report.elapsedSeconds * 1000, warsStarted: game.diagnosticState().diplomacy.wars.length } }));
      const estimate = tick === 0 ? "storage estimate warming up" : `~${report.storageEstimate.fifteenHoursGB.toFixed(2)} GB/15h${report.storageEstimate.earlySample ? " (early sample)" : ""}`;
      console.log(`Year ${report.year.toFixed(3)} | ${day.toFixed(2)} days | ${tick} ticks | ${report.ticksPerSecond.toFixed(2)} ticks/s | ${report.gameDaysPerWallHour.toFixed(1)} game days/hour | ${(report.totalRecordedBytes / GB).toFixed(3)} GB | ${estimate} | ${accepted}/${rejected} accepted/rejected`);
      return report;
    }
    await progress();
    baseStats = log.stats(); measuredAt = performance.now();
    try {
      while (performance.now() - created < options.hours * 3600_000) {
        const requested = options.shouldStop?.();
        if (requested) { stopReason = requested; break; }
        if (options.maxTicks !== undefined && tick >= options.maxTicks) { stopReason = "tick-limit"; break; }
        if (tick % 8 === 0 && log.stats().compressedBytes + checkpointBytes >= options.maxDataGB * GB * 0.9) {
          console.log("Storage maintenance: recompressing oldest completed logs, then reducing old observer detail if needed.");
          let maintenanceStop: string | undefined;
          const maintenance = await retention.maintain(options.maxDataGB * GB, checkpointBytes, tick,
            () => { maintenanceStop = options.shouldStop?.(); return !!maintenanceStop || performance.now() - created >= options.hours * 3600_000; });
          if (maintenanceStop) { stopReason = maintenanceStop; break; }
          if (log.stats().compressedBytes + checkpointBytes >= options.maxDataGB * GB) {
            if (maintenance.exhausted) { stopReason = "data-limit-core-retained"; break; }
            await progress(); continue;
          }
        }
        tick++; day = ((game.now() - start) + GRAND_STEP_MS) / msPerDay;
        options.onStatus?.({ phase: "game-update", tick, day });
        const before = performance.now(); game.step(GRAND_STEP_MS); const runtimeMs = performance.now() - before;
        maximumTickMs = Math.max(maximumTickMs, runtimeMs);
        const state = game.diagnosticState();
        telemetry.step(state, day, GRAND_STEP_MS / msPerDay, runtimeMs, "production-100ms");
        options.onStatus?.({ phase: "state-recording", tick, day });
        const deltaStart = performance.now();
        const delta = options.logging !== "compact" ? stateDelta(grandStateView(state, options.logging)) : undefined;
        const deltaMs = performance.now() - deltaStart;
        const writeStart = performance.now();
        if (delta) log.write("state", { tick, day, delta });
        const stateWriteMs = performance.now() - writeStart;
        for (const economy of state.factionEconomies) for (const resource of RESOURCE_KINDS) {
          if (!Number.isFinite(economy.stockpiles[resource]) || !Number.isFinite(economy.monthlyDelta[resource])) throw new Error(`Nonfinite ${resource} for country ${economy.factionId}, tick ${tick}.`);
        }
        const owners = JSON.stringify(state.starOwnership), wars = JSON.stringify(state.diplomacy);
        if (owners !== ownerHistory) {
          const previous: number[] = JSON.parse(ownerHistory);
          state.starOwnership.forEach((owner, starId) => { if (owner !== previous[starId]) {
            ownershipChanges++; log.write("events", { tick, day, type: "ownership", starId, from: previous[starId], to: owner });
          } });
          ownerHistory = owners;
        }
        if (wars !== warHistory) { log.write("events", { tick, day, type: "diplomacy", diplomacy: state.diplomacy }); warHistory = wars; }
        for (const report of state.combatReports) if (!reports.has(report.id)) { reports.add(report.id); log.write("events", { tick, day, type: "combat", report }); }
        if (day + 1e-9 >= nextDay) { telemetry.sample(state, day); lastDailySample = day; sample(); nextDay++; }
        options.onStatus?.({ phase: "compression-drain", tick, day });
        const drainStart = performance.now();
        await log.drain();
        log.write("tick-profile", { tick, day, gameMs: runtimeMs, deltaMs, stateWriteMs,
          drainMs: performance.now() - drainStart, tickMs: performance.now() - before });
        const now = performance.now();
        if (now - lastProgress >= 15_000) {
          const report = await progress(); lastProgress = performance.now();
          const disk = statfsSync(options.output);
          if (disk.bavail * disk.bsize < (options.minFreeGB ?? 2) * GB) { stopReason = "disk-reserve"; break; }
        }
        if (now - lastCheckpoint >= options.checkpointMinutes * 60_000 || day + 1e-9 >= nextYear) {
          await checkpoint(`periodic-${String(checkpoints).padStart(5, "0")}`); lastCheckpoint = performance.now();
          if (day + 1e-9 >= nextYear) nextYear += 360;
        }
        if (tick % 8 === 0) await setImmediate();
      }
    } catch (error) { failure = error; stopReason = "failure"; }
    // A recorder failure must not prevent an independent recovery checkpoint.
    try { await checkpoint(failure ? "failure" : "final"); }
    catch (error) { failure ??= error; stopReason = "failure"; }
    try {
      if (frames.at(-1)?.day !== day) sample();
      if (lastDailySample !== day) telemetry.sample(game.diagnosticState(), day);
      await log.close();
    } catch (error) { failure ??= error; stopReason = "failure"; log.abort(); }
    const result = { ...summary(failure ? "failed" : "complete"), finalDigest: game.digest(), failure: failure ? String(failure) : undefined };
    result.totalRecordedBytes = result.compressedBytes + checkpointBytes;
    atomicJson(path.join(options.output, "summary.json"), result);
    atomicJson(path.join(options.output, "progress.json"), result);
    atomicJson(path.join(options.output, "run.json"), result);
    writeFileSync(path.join(options.output, "timelapse.html"), campaignViewer({ stars, hyperlanes: initial.state.hyperlanes, factions, frames, compressedLogs: true,
      summary: { ...result, runtimeMs: result.elapsedSeconds * 1000, warsStarted: game.diagnosticState().diplomacy.wars.length } }));
    if (failure) throw failure;
    await analyzeCampaign(options.output);
    console.log(`Stopped: ${stopReason}. Saved ${day.toFixed(2)} game days; open ${path.join(options.output, "timelapse.html")}`);
    return result;
  } catch (error) { log.abort(); throw error; }
}

// Kept outside the hot update loop; only called on map samples.
function appendTimeline(filename: string, frame: CampaignSample) { appendFileSync(filename, JSON.stringify(frame) + "\n"); }

export function parseGrandOptions(argv: string[]): GrandOptions {
  const supported = new Set(["hours", "logging", "max-data-gb", "checkpoint-minutes", "seed", "out", "max-ticks", "checkpoint"]);
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].replace(/^--/, ""), value = argv[i + 1];
    if (!argv[i].startsWith("--") || !supported.has(name) || !value || value.startsWith("--") || values.has(name)) throw new Error(`Invalid or duplicate option: ${argv[i]}`);
    values.set(name, value);
  }
  return { output: path.resolve(values.get("out") ?? `.cache/grandsimulation/run-${new Date().toISOString().replace(/[:.]/g, "-")}`),
    seed: Number(values.get("seed") ?? 42), hours: Number(values.get("hours") ?? 15), logging: (values.get("logging") ?? "forensic") as GrandLogLevel,
    maxDataGB: Number(values.get("max-data-gb") ?? 80), checkpointMinutes: Number(values.get("checkpoint-minutes") ?? 10),
    maxTicks: values.has("max-ticks") ? Number(values.get("max-ticks")) : undefined, checkpoint: values.get("checkpoint") };
}

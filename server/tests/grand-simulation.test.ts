import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { gunzipSync } from "node:zlib";
import { applyStateDelta, createGrandLog, createStateDelta } from "../game/grand-recording";
import { GRAND_STEP_MS, parseGrandOptions, readGrandCheckpoint, runGrandSimulation, type GrandOptions } from "../game/grand-simulation";
import { createHeadlessGame } from "../game/headless-game";
import { createGrandRetention, reduceOldGrandRecord } from "../game/grand-retention";

function temporary(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "stellarfronts-grand-"));
  t.after(() => {
    // Only remove this test's verified, unique temporary directory.
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith("stellarfronts-grand-"));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
function rows(directory: string, name: string) {
  return readdirSync(path.join(directory, "logs")).filter((file) => file.startsWith(name + "-")).sort()
    .flatMap((file) => gunzipSync(readFileSync(path.join(directory, "logs", file))).toString().trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)));
}
function options(output: string, extra: Partial<GrandOptions> = {}): GrandOptions {
  return { output, seed: 42, hours: 1, logging: "forensic", maxDataGB: 1, checkpointMinutes: 10,
    maxTicks: 4, initialWorld: { starCount: 8, factionCount: 2 }, minFreeGB: 0, ...extra };
}

test("grand command fixes production cadence and validates option names", async (t) => {
  const defaults = parseGrandOptions([]);
  assert.equal(GRAND_STEP_MS, 100);
  assert.equal(defaults.hours, 15);
  assert.equal(defaults.initialWorld, undefined);
  assert.equal(defaults.logging, "forensic"); assert.equal(defaults.maxDataGB, 80);
  assert.throws(() => parseGrandOptions(["--step-ms", "24000"]), /Invalid/);
  assert.throws(() => parseGrandOptions(["--hours", "12", "--hours", "15"]), /duplicate/);
  assert.throws(() => parseGrandOptions(["--out"]), /Invalid/);
  const directory = temporary(t);
  for (const extra of [{ hours: NaN }, { logging: "invalid" }, { maxTicks: 0 }, { maxDataGB: -1 }]) {
    await assert.rejects(runGrandSimulation(options(directory, extra as Partial<GrandOptions>)), /Invalid grand/);
  }
  assert.equal(readdirSync(directory).length, 0);
});

test("state recording survives in-place edits, deletion, array resizing and arbitrary IDs", () => {
  const next = createStateDelta();
  const state: any = { "faction:1.some/id": { hp: 10, old: true }, list: [{ x: 1 }, { x: 2 }], value: 3 };
  let restored: any;
  function check() {
    const delta = JSON.parse(JSON.stringify(next(state)));
    restored = applyStateDelta(restored, delta);
    assert.deepEqual(restored, JSON.parse(JSON.stringify(state)));
    return delta;
  }
  check();
  state["faction:1.some/id"].hp = 9; delete state["faction:1.some/id"].old;
  state.list[0].x = 4; state.value = { nested: true }; check();
  state.list.push({ x: 7 }); state.added = { arr: [null, "value"] }; check();
  state.list.length = 1; state.added = undefined; check();
  assert.deepEqual(check(), { set: [], remove: [] });
});

test("gzip rotation and backpressure preserve every record and exact byte totals", async (t) => {
  const directory = temporary(t);
  const log = createGrandLog(path.join(directory, "logs"), 10_000);
  for (let i = 0; i < 24; i++) {
    log.write("state", { i, payload: "payload-".repeat(800) });
    log.write("events", { i });
    await log.drain();
  }
  await log.flush(); await log.close(); await log.close();
  assert.deepEqual(rows(directory, "state").map((row) => row.i), Array.from({ length: 24 }, (_, i) => i));
  assert.equal(rows(directory, "events").length, 24);
  assert.ok(log.stats().channels.state.parts > 1);
  assert.equal(log.stats().compressedBytes, readdirSync(path.join(directory, "logs"))
    .reduce((sum, file) => sum + statSync(path.join(directory, "logs", file)).size, 0));
  assert.throws(() => log.write("state", {}), /closed/);
});

test("exact tick history reconstructs final state; logging and checkpoint resume preserve outcomes", async (t) => {
  const directory = temporary(t), first = path.join(directory, "first");
  const result = await runGrandSimulation(options(first));
  assert.equal(result.stopReason, "tick-limit"); assert.equal(result.tick, 4);
  const initial = readGrandCheckpoint(path.join(first, "initial.checkpoint.json.gz"));
  const final = readGrandCheckpoint(path.join(first, "final.checkpoint.json.gz"));
  assert.equal(final.nowMs - initial.nowMs, 4 * GRAND_STEP_MS);
  assert.equal(final.enableActiveAi, true); assert.equal(final.enablePassiveAi, false);
  assert.deepEqual(final.activeFactionIds, [0, 1]);
  assert.equal(final.state.aiSettings?.allowWarDeclarations, true);
  assert.deepEqual(Object.keys(final.state.passiveEpisodes ?? {}), []);
  let restored: any;
  const history = rows(first, "state");
  assert.deepEqual(history.map((row) => row.tick), [0, 1, 2, 3, 4]);
  for (const row of history) restored = applyStateDelta(restored, row.delta);
  assert.deepEqual(restored, JSON.parse(JSON.stringify(final.state)));
  assert.equal(rows(first, "observations").length, 2);
  assert.equal(rows(first, "performance").length, 4);
  assert.ok(rows(first, "actions").every((row) => row.mode === "active"));
  assert.ok(rows(first, "decisions").every((row) => row.warTag));
  const plain = createHeadlessGame({ checkpoint: initial, stepMs: GRAND_STEP_MS });
  plain.step(4 * GRAND_STEP_MS);
  assert.equal(result.finalDigest, plain.digest());
  assert.equal(JSON.parse(readFileSync(path.join(first, "analysis.json"), "utf8")).performance["production-100ms"].ticks, 4);
  assert.ok(readFileSync(path.join(first, "timelapse.html"), "utf8").includes("AI campaign"));
  const resumed = await runGrandSimulation(options(path.join(directory, "resumed"), {
    checkpoint: path.join(first, "final.checkpoint.json.gz"), maxTicks: 2,
  }));
  plain.step(2 * GRAND_STEP_MS);
  assert.equal(resumed.finalDigest, plain.digest());
  await assert.rejects(runGrandSimulation(options(first)), /EEXIST/);
});

test("clean interruption, data limits, and simulation failure retain recoverable checkpoints", async (t) => {
  const directory = temporary(t);
  let polls = 0;
  const interrupted = path.join(directory, "interrupted");
  const result = await runGrandSimulation(options(interrupted, { shouldStop: () => ++polls === 3 ? "interrupted" : undefined }));
  assert.equal(result.stopReason, "interrupted"); assert.equal(result.tick, 2);
  assert.ok(readGrandCheckpoint(path.join(interrupted, "final.checkpoint.json.gz")));
  const capped = path.join(directory, "capped");
  const limited = await runGrandSimulation(options(capped, { maxDataGB: 0.000001 }));
  assert.equal(limited.stopReason, "data-limit-core-retained"); assert.equal(limited.tick, 0);
  assert.ok(readGrandCheckpoint(path.join(capped, "final.checkpoint.json.gz")));
  const failed = path.join(directory, "failed");
  await assert.rejects(runGrandSimulation(options(failed, { shouldStop: () => { throw new Error("injected failure"); } })), /injected failure/);
  assert.equal(JSON.parse(readFileSync(path.join(failed, "run.json"), "utf8")).status, "failed");
  assert.ok(readGrandCheckpoint(path.join(failed, "failure.checkpoint.json.gz")));
});

test("grand simulation rejects checkpoints belonging to human accounts", async (t) => {
  const directory = temporary(t);
  const checkpoint = createHeadlessGame({ initialWorld: { starCount: 8, factionCount: 2 }, accounts: { owners: { 0: 12 }, balances: {} } }).exportCheckpoint();
  const filename = path.join(directory, "human.json"); writeFileSync(filename, JSON.stringify(checkpoint));
  await assert.rejects(runGrandSimulation(options(path.join(directory, "out"), { checkpoint: filename })), /no human accounts/);
  assert.equal(JSON.parse(readFileSync(path.join(directory, "out", "run.json"), "utf8")).status, "failed");
});

test("a whole game day retains all 240 production updates and the next daily AI turn", async (t) => {
  const directory = temporary(t), output = path.join(directory, "day");
  const result = await runGrandSimulation(options(output, { maxTicks: 241 }));
  assert.equal(result.tick, 241);
  assert.equal(result.simulatedDays, 241 / 240);
  assert.equal(rows(output, "performance").length, 241);
  assert.equal(rows(output, "state").length, 242);
  assert.equal(rows(output, "decisions").length, 4);
  assert.equal(rows(output, "observations").length, 4);
  const daily = rows(output, "economies");
  assert.deepEqual(daily.map((row) => row.day), [0, 1, 241 / 240]);
  const frames = readFileSync(path.join(output, "timeline.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(frames.map((row) => row.day), [0, 1, 241 / 240]);
});

test("oldest log retention recompresses first, then removes only declared observer fields", async (t) => {
  const directory = temporary(t), log = createGrandLog(path.join(directory, "logs"), 4_000);
  const retention = createGrandRetention(directory, log), next = createStateDelta();
  const state = { clock: { year: 2100 }, economy: { food: 10 }, intelligenceByFaction: {
    entities: Array.from({ length: 1200 }, (_, i) => ({ id: "intel." + i, observed: 0, value: "Observation #" + i })),
  } };
  for (let tick = 0; tick < 6; tick++) {
    state.clock.year += 0.01; state.economy.food++;
    for (const entity of state.intelligenceByFaction.entities) entity.observed = tick;
    log.write("state", { tick, day: tick, delta: next(state) });
    log.write("actions", { tick, action: { type: "marketTrade", amount: tick + 1 }, outcome: { ok: true } });
    log.write("events", { tick, type: "ownership", from: 0, to: 1 });
    log.write("observations", { tick, observation: { factionId: 0,
      snapshot: { intelligence: state.intelligenceByFaction, stars: state.intelligenceByFaction.entities,
        clock: { ...state.clock }, text: "🛰é".repeat(24000) }, planets: { food: state.economy.food } } });
    await log.drain();
  }
  await log.seal();
  const before = log.stats().compressedBytes;
  const retained = await retention.maintain(100, 0, 6, () => false, 60_000);
  assert.equal(retained.exhausted, true);
  assert.ok(log.stats().compressedBytes < before);
  assert.ok(retention.summary().recompressedChunks > 0);
  assert.ok(retention.summary().reducedChunks > 0);
  // Fresh full-detail deltas can follow reduced old chunks without breaking
  // the declared gameplay projection across the combined history.
  state.economy.food++;
  for (const entity of state.intelligenceByFaction.entities) entity.observed++;
  log.write("state", { tick: 7, day: 7, delta: next(state) });
  await log.close();
  assert.deepEqual(rows(directory, "actions").map((row) => row.action.amount), [1, 2, 3, 4, 5, 6]);
  assert.equal(rows(directory, "events").length, 6);
  let restored: any;
  for (const row of rows(directory, "state")) restored = applyStateDelta(restored, reduceOldGrandRecord("state", row).delta);
  assert.deepEqual(restored, { clock: state.clock, economy: state.economy });
  for (const row of rows(directory, "observations")) {
    assert.equal(row.observation.snapshot.text, "🛰é".repeat(24000));
    assert.equal(row.observation.planets.food, row.tick + 11);
    assert.equal(row.observation.snapshot.intelligence, undefined);
    assert.equal(row.observation.snapshot.stars, undefined);
  }
  const manifest = JSON.parse(readFileSync(path.join(directory, "retention.json"), "utf8"));
  const firstReduced = manifest.history.findIndex((item: any) => item.tier === "reduced");
  assert.ok(firstReduced > 0);
  assert.ok(manifest.history.slice(firstReduced).every((item: any) => item.tier === "reduced"));
  assert.ok(manifest.history.filter((item: any) => item.tier === "strong").every((item: any, index: number, list: any[]) => !index || item.firstTick >= list[index - 1].firstTick));
});

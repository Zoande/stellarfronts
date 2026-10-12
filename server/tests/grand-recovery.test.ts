import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { applyStateDelta, createStateDelta } from "../game/grand-recording";
import { reduceOldGrandRecord } from "../game/grand-retention";
import { openGrandSession } from "../game/grand-session";
import { monitorGrandProcess } from "../game/grand-process";
import { runGrandSimulation, readGrandCheckpoint, type GrandOptions } from "../game/grand-simulation";

function temporary(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "stellarfronts-grand-recovery-"));
  t.after(() => { assert.equal(path.dirname(directory), os.tmpdir()); assert.ok(path.basename(directory).startsWith("stellarfronts-grand-recovery-")); rmSync(directory, { recursive: true, force: true }); });
  return directory;
}
function options(output: string): GrandOptions { return { output, seed: 42, hours: 1, logging: "forensic", maxDataGB: 1,
  checkpointMinutes: 10, maxTicks: 2, minFreeGB: 0, initialWorld: { starCount: 8, factionCount: 2 } }; }

test("grouped intelligence timestamps reconstruct exact state, retain stale fields and reduce safely", () => {
  const next = createStateDelta({ groupIntelTimestamps: true }), ordinary = createStateDelta();
  const fields: any = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`planet:${i}.name`, { value: i, observedAtYear: 0 }]));
  const state: any = { intelligenceByFaction: { 0: { entities: { "system:/1": { fields } } } }, count: 1 };
  let restored: any;
  const check = () => { const delta = JSON.parse(JSON.stringify(next(state))); restored = applyStateDelta(restored, delta); assert.deepEqual(restored, state); return delta; };
  check(); ordinary(state);
  for (let i = 0; i < 90; i++) fields[`planet:${i}.name`].observedAtYear = i < 45 ? 1 : 2;
  fields["planet:2.name"].value = 200; delete fields["planet:3.name"];
  fields["new"] = { value: "new", observedAtYear: 3 }; state.count = 2;
  const delta = check(), original = ordinary(state);
  assert.ok(JSON.stringify(delta).length < JSON.stringify(original).length / 2);
  assert.equal(delta.intelTimestamps.length, 2);
  const reduced = reduceOldGrandRecord("state", { delta: structuredClone(delta) });
  assert.equal(reduced.delta.intelTimestamps, undefined);
  assert.deepEqual(applyStateDelta({ count: 1 }, reduced.delta), { count: 2 });
  delete state.intelligenceByFaction[0]; check();
  state.intelligenceByFaction = { 2: { observedAtYear: 5 } }; check();
});

test("session crash resume preserves checkpoints, original deadline, previous logs and one writer", async t => {
  const directory = temporary(t), start = Date.now();
  const first = openGrandSession(directory, options(directory), start)!;
  assert.throws(() => openGrandSession(directory, options(directory)), /already running/);
  const result = await runGrandSimulation(first.options);
  const checkpoint = path.join(first.options.output, "final.checkpoint.json.gz");
  first.release(); // Simulate a process exit before session completion.
  const second = openGrandSession(directory, { ...options(directory), seed: 99, hours: 100 }, start + 1800_000)!;
  assert.equal(second.options.seed, 42); assert.equal(second.options.hours, 0.5);
  assert.equal(second.options.checkpoint, checkpoint); assert.notEqual(second.options.output, first.options.output);
  const resumed = await runGrandSimulation(second.options);
  assert.equal(readGrandCheckpoint(path.join(second.options.output, "initial.checkpoint.json.gz")).nowMs,
    readGrandCheckpoint(checkpoint).nowMs);
  assert.equal(resumed.tick, result.tick);
  second.finish("wall-time"); second.release();
  assert.equal(openGrandSession(directory, options(directory)), undefined);
  assert.equal(JSON.parse(readFileSync(path.join(first.options.output, "summary.json"), "utf8")).finalDigest, result.finalDigest);
});

test("sessions recover stale locks and enforce wall and cumulative storage budgets", t => {
  const directory = temporary(t);
  // A child PID which has definitely exited avoids guessing an unused process ID.
  const exitedPid = Number(spawnSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" }).stdout.trim());
  assert.ok(exitedPid > 0);
  writeFileSync(path.join(directory, "session.lock"), JSON.stringify({ pid: exitedPid, host: os.hostname(), token: "old" }));
  const first = openGrandSession(directory, options(directory), 1000)!; first.release();
  const expired = openGrandSession(directory, options(directory), 3601001);
  assert.equal(expired, undefined);
  const cappedDir = path.join(directory, "capped"); mkdirSync(cappedDir);
  const capped = openGrandSession(cappedDir, { ...options(cappedDir), maxDataGB: 0.011 })!; capped.release();
  writeFileSync(path.join(cappedDir, "prior-data"), Buffer.alloc(2_000_000));
  assert.equal(openGrandSession(cappedDir, options(cappedDir)), undefined);
});

test("process diagnostics record phase, errors and shutdown independently of game recorder", t => {
  const directory = temporary(t), monitor = monitorGrandProcess(directory, () => {});
  try {
    monitor.status({ phase: "compression-drain", tick: 42, day: 1 });
    monitor.record("test-event"); monitor.finish(new Error("recorder failure"));
    const rows = readFileSync(path.join(directory, "process.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(rows[0].event, "start"); assert.equal(rows[1].tick, 42); assert.equal(rows[1].phase, "compression-drain");
    assert.match(rows.at(-1).error, /recorder failure/); assert.ok(rows[0].systemFreeMemoryBytes > 0);
  } finally { monitor.dispose(); }
});

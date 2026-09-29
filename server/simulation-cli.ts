import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import { runScenario, replay, type ReplayRecord, type SimulationResult } from "./game/simulation-lab";
import { SCENARIO_NAMES, type ScenarioName } from "./game/simulation-scenarios";

const argv = process.argv.slice(2);
const mode = argv.shift() ?? "batch";
function option(name: string, fallback: string): string {
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`Missing --${name} value.`);
  return argv[index + 1];
}
function positive(name: string, fallback: number): number {
  const value = Number(option(name, String(fallback)));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid --${name} value.`);
  return value;
}

if (mode === "replay") {
  const filename = argv[0];
  if (!filename) throw new Error("Usage: npm run ai:simulate -- replay path/to/replay.jsonl");
  const records = readFileSync(filename, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line) as ReplayRecord);
  const result = replay(records);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} else {
  if (mode !== "batch" && mode !== "scenario" && mode !== "long-economy") throw new Error("Use batch, scenario, long-economy, or replay.");
  const scenario = option("scenario", "idle-economy") as ScenarioName;
  if (!SCENARIO_NAMES.includes(scenario)) throw new Error("Unknown scenario.");
  const seeds = option("seeds", "19,42,71").split(",").map(Number);
  if (!seeds.length || !seeds.every((seed) => Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff)) throw new Error("Seeds must be uint32 values.");
  const days = positive("days", mode === "long-economy" ? 360 : 30);
  const stepMs = positive("step-ms", 100);
  // Compact worlds make routine experiments practical. The in-memory API defaults to the production galaxy.
  const starCount = positive("stars", 12); const factionCount = positive("countries", 2);
  const output = path.resolve(option("out", ".cache/ai-lab")); mkdirSync(output, { recursive: true });
  let revision = "unknown";
  try { revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) {
      const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "server", "src", "package.json", "package-lock.json"], { encoding: "utf8" }).trim().split(/\r?\n/).sort();
      const hash = createHash("sha256");
      for (const filename of files) { hash.update(filename); hash.update(readFileSync(filename)); }
      revision += `+dirty:${hash.digest("hex")}`;
      // Keep the uncommitted implementation reviewable and reconstructable at
      // the recorded base revision, including newly introduced source files.
      writeFileSync(path.join(output, "source.patch"), execFileSync("git", ["diff", "--binary", "HEAD", "--", "server", "src", "package.json", "package-lock.json"]));
      const added = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", "server", "src"], { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
      writeFileSync(path.join(output, "untracked-source.json"), JSON.stringify(added.map((filename) => ({ filename, base64: readFileSync(filename).toString("base64") })), null, 2));
    }
  } catch { /* Source archives may have no git metadata. */ }
  const scenarios = mode === "batch" ? option("scenarios", SCENARIO_NAMES.join(",")).split(",") as ScenarioName[] : [mode === "long-economy" ? "idle-economy" as const : scenario];
  if (!scenarios.length || !scenarios.every((name) => SCENARIO_NAMES.includes(name))) throw new Error("Unknown --scenarios value.");
  const results: SimulationResult[] = [];
  for (const current of scenarios) for (const seed of seeds) {
    const filename = path.join(output, `${current}-${seed}.jsonl`); writeFileSync(filename, "");
    console.log(`Running ${current}, seed ${seed}, ${days} game days (${starCount} stars, ${factionCount} countries).`);
    const result = await runScenario(current, { worldSeed: seed, simulationSeed: seed ^ 0x5f3759df, days, stepMs, revision, initialWorld: { starCount, factionCount } },
      (entry) => appendFileSync(filename, `${JSON.stringify(entry)}\n`),
      (day) => { if (day % 5 === 0) console.log(`  ${current}/${seed}: day ${day}`); });
    results.push(result); writeFileSync(path.join(output, `${current}-${seed}.json`), `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(path.join(output, "metrics.json"), `${JSON.stringify(results, null, 2)}\n`);
    const report = ["# AI simulation laboratory", "", `Revision: ${revision}`, "", "Compact seeded scenarios exercise production rules and the production pipeline. These are diagnostics, not evidence of production-scale balance. Population loss includes possible migration and combat; famine exposure is reported separately.", "", "| Scenario | Seed | Days | Accepted/rejected | Tick max (ms) | Food shortage (days, faction 0) |", "| --- | --- | --- | --- | --- | --- |",
      ...results.map((r) => `| ${r.scenario} | ${r.worldSeed} | ${r.simulatedDays} | ${r.actionsAccepted}/${r.actionsRejected} | ${r.maximumTickMs.toFixed(1)} | ${r.factions[0].shortageDays.food.toFixed(2)} |`), "", "## Findings", "",
      ...results.flatMap((r) => r.findings.map((finding) => `- ${r.scenario}, seed ${r.worldSeed}: ${finding}`)), "", "Balance changes require a separate decision; no balance constants were changed.", ""];
    writeFileSync(path.join(output, "findings.md"), report.join("\n"));
    console.log(`Finished ${current}/${seed}: ${result.ticks} ticks, ${result.runtimeMs.toFixed(0)} ms, ${result.actionsAccepted} accepted / ${result.actionsRejected} rejected.`);
  }
  console.log(`Reports: ${output}`);
}

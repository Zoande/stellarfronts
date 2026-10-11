import { analyzeCampaign } from "./campaign-analysis";
import { calculateFactionResourceFlow } from "./economy-market";
import { createCampaignTelemetry } from "./campaign-telemetry";
import { campaignStep } from "./campaign-schedule";
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { RESOURCE_KINDS } from "../../src/data/Economy";
import { GAME_DAYS_PER_YEAR } from "../../src/game/GameTime";
import { createHeadlessGame, type GameCheckpoint, type HeadlessGameOptions } from "./headless-game";
import type { GameState } from "./types";
import { campaignViewer } from "./campaign-viewer";

export interface CampaignOptions {
  seed: number;
  stars: number;
  countries: number;
  active: number;
  days: number;
  stepMs: number;
  allowWars: boolean;
  output: string;
  adaptive?: boolean;
  checkpoint?: string;
}

function sourceArchive(output: string) {
  try {
    const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "server", "src", "package.json", "package-lock.json"], { encoding: "utf8" }).trim().split(/\r?\n/).sort();
    const hash = createHash("sha256");
    for (const file of files) { hash.update(file); hash.update(readFileSync(file)); }
    writeFileSync(path.join(output, "source.patch"), execFileSync("git", ["diff", "--binary", "HEAD", "--", "server", "src", "package.json", "package-lock.json"]));
    const added = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", "server", "src"], { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
    writeFileSync(path.join(output, "untracked-source.json"), JSON.stringify(added.map((filename) => ({ filename, base64: readFileSync(filename).toString("base64") }))));
    return `${revision}+source:${hash.digest("hex")}`;
  } catch { return "unavailable"; }
}

export function campaignSample(state: Readonly<GameState>, activeIds: readonly number[], day: number) {
  return {
    day, year: state.clock.year, owners: [...state.starOwnership],
    wars: state.diplomacy.wars.filter((war) => !war.endedAtYear).map((war) => [war.attackerFactionId, war.defenderFactionId]),
    factions: state.factions.map((faction) => {
      const economy = state.factionEconomies.find((entry) => entry.factionId === faction.id)!;
      const planets = state.planetStates.filter((planet) => planet.ownerId === faction.id && planet.isHabited);
      return { id: faction.id, mode: activeIds.includes(faction.id) ? "active" : "passive", systems: state.starOwnership.filter((id) => id === faction.id).length,
        colonies: planets.length, population: planets.reduce((sum, planet) => sum + planet.population, 0),
        ships: state.ships.filter((ship) => ship.ownerId === faction.id).length,
        technologies: state.factionTechnologies.find((entry) => entry.factionId === faction.id)?.completedTechIds.length ?? 0,
        stockpiles: { ...economy.stockpiles }, income: { ...economy.monthlyDelta },
        crew: economy.crewStockpile,
        militaryPower: state.ships.filter((ship) => ship.ownerId === faction.id && ["corvette", "destroyer", "cruiser", "battleship"].includes(ship.shipKind))
          .reduce((sum, ship) => sum + ship.hull + ship.armor + ship.shield, 0),
        unemployed: planets.reduce((sum, planet) => sum + planet.economy.unemployedPopulation, 0),
        housing: planets.reduce((sum, planet) => sum + planet.economy.housing, 0),
        researchIncome: economy.monthlyDelta.research,
        imports: state.market.playerStats.find((entry) => entry.playerId === faction.id)?.totalImportsEnergy ?? 0,
        exports: state.market.playerStats.find((entry) => entry.playerId === faction.id)?.totalExportsEnergy ?? 0,
        production: calculateFactionResourceFlow(state as GameState, faction.id).production,
        consumption: calculateFactionResourceFlow(state as GameState, faction.id).consumption,
        famine: planets.some((planet) => planet.economy.populationDecline.active && planet.economy.populationDecline.cause === "famine"),
        queues: planets.reduce((sum, planet) => sum + planet.constructionQueue.length + planet.defense.shipQueue.length, 0)
          + state.starbases.filter((base) => base.ownerId === faction.id).reduce((sum, base) => sum + base.constructionQueue.length + base.shipQueue.length, 0) };
    }),
  };
}
export type CampaignSample = ReturnType<typeof campaignSample>;

/** An isolated game: no sockets, accounts, database, production saves, or wall-clock sleeps. */
export async function runCampaign(options: CampaignOptions) {
  if (!Number.isInteger(options.active) || options.active < 1 || options.active > options.countries
    || !Number.isFinite(options.days) || options.days <= 0 || !Number.isSafeInteger(options.stepMs) || options.stepMs <= 0) throw new Error("Invalid campaign options.");
  mkdirSync(options.output, { recursive: true });
  // Exclusive metadata creation prevents accidentally overwriting an earlier experiment.
  writeFileSync(path.join(options.output, "run.json"), JSON.stringify({ formatVersion: 1, options, status: "initializing" }, null, 2), { flag: "wx" });
  const revision = sourceArchive(options.output);
  writeFileSync(path.join(options.output, "run.json"), JSON.stringify({ formatVersion: 1, options, revision, status: "running" }, null, 2));
  const created = performance.now();
  const initial: GameCheckpoint = options.checkpoint ? JSON.parse(readFileSync(options.checkpoint, "utf8")) : createHeadlessGame({ worldSeed: options.seed, simulationSeed: (options.seed ^ 0x5f3759df) >>> 0,
    initialWorld: { starCount: options.stars, factionCount: options.countries } }).exportCheckpoint();
  initial.state.aiSettings = { allowWarDeclarations: options.allowWars };
  const activeIds = initial.state.factions.slice(0, options.active).map((faction) => faction.id);
  if (activeIds.length !== options.active) throw new Error("World generation did not create the requested active countries.");
  const commandsFile = path.join(options.output, "actions.jsonl");
  const eventsFile = path.join(options.output, "events.jsonl");
  const timelineFile = path.join(options.output, "timeline.jsonl");
  const ticksFile = path.join(options.output, "ticks.jsonl");
  for (const file of [commandsFile, eventsFile, timelineFile, ticksFile]) writeFileSync(file, "");
  let tick = 0; let day = 0; let accepted = 0; let rejected = 0;
  const actionsByType: Record<string, number> = {};
  const rejections: Record<string, number> = {};
  const actionCounts = new Map<number, { accepted: number; rejected: number }>();
  const telemetry = createCampaignTelemetry(options.output, initial.state);
  const headlessOptions: HeadlessGameOptions = { checkpoint: initial, stepMs: options.stepMs, enablePassiveAi: true, enableActiveAi: true, activeFactionIds: activeIds,
    onAiDecision: (record) => telemetry.decision(day, record),
    onAiAction: (record) => {
      appendFileSync(commandsFile, `${JSON.stringify({ tick, day, ...record })}\n`);
      const counts = actionCounts.get(record.factionId) ?? { accepted: 0, rejected: 0 };
      actionCounts.set(record.factionId, counts);
      if (record.outcome.ok) { accepted++; counts.accepted++; actionsByType[record.action.type] = (actionsByType[record.action.type] ?? 0) + 1; }
      else { rejected++; counts.rejected++; const key = `${record.action.type}: ${record.outcome.message}`; rejections[key] = (rejections[key] ?? 0) + 1; }
    } };
  const game = createHeadlessGame(headlessOptions);
  const start = game.exportCheckpoint();
  writeFileSync(path.join(options.output, "initial.checkpoint.json"), JSON.stringify(start));
  const msPerDay = 1000 * start.state.clock.tickSpeedSeconds / start.state.clock.tickSizeDays;
  const duration = Math.round(options.days * msPerDay);
  if (!Number.isSafeInteger(duration)) throw new Error("Campaign horizon too large.");
  const frames: CampaignSample[] = [];
  const shortages = new Map<number, Record<string, number>>();
  const famineDays = new Map<number, number>();
  const lostShips = new Map<string, number>();
  const combatReportIds = new Set<string>();
  let ownershipChanges = 0; let maxTickMs = 0; let nextSample = 0; let nextCheckpoint = 360;
  let previousOwners = [...start.state.starOwnership];
  let previousWars = JSON.stringify(start.state.diplomacy.wars);
  const stars = start.state.stars.map((star) => ({ id: star.id, x: star.x, z: star.z, name: star.name }));
  const factions = start.state.factions.map((faction) => ({ id: faction.id, name: faction.name, color: faction.color, mode: activeIds.includes(faction.id) ? "active" : "passive" }));
  writeFileSync(path.join(options.output, "galaxy.json"), JSON.stringify({ stars, hyperlanes: start.state.hyperlanes, factions }));
  function sample() {
    const frame = campaignSample(game.diagnosticState(), activeIds, day); frames.push(frame);
    telemetry.sample(game.diagnosticState(), day);
    appendFileSync(timelineFile, `${JSON.stringify(frame)}\n`);
    appendFileSync(ticksFile, `${JSON.stringify({ tick, day, digest: game.digest() })}\n`);
    writeFileSync(path.join(options.output, "progress.json"), JSON.stringify({ tick, day, accepted, rejected, elapsedSeconds: (performance.now() - created) / 1000 }));
    writeFileSync(path.join(options.output, "timelapse.html"), campaignViewer({ stars, hyperlanes: start.state.hyperlanes, factions, frames,
      summary: { status: "running", options, actualStars: stars.length, actualCountries: factions.length, simulatedDays: day,
        runtimeMs: performance.now() - created, accepted, rejected, ownershipChanges, warsStarted: game.diagnosticState().diplomacy.wars.length } }));
  }
  sample(); nextSample = 30;
  try {
    game.advanceRealTime(0);
    while (game.now() - start.nowMs < duration) {
      const schedule = options.adaptive === false ? { ms: options.stepMs, reason: "fixed" } : campaignStep(game.diagnosticState(), options.stepMs, msPerDay);
      const elapsedMs = Math.min(schedule.ms, duration - (game.now() - start.nowMs));
      tick++; day = (game.now() + elapsedMs - start.nowMs) / msPerDay;
      const before = performance.now(); game.step(elapsedMs); const runtimeMs = performance.now() - before; maxTickMs = Math.max(maxTickMs, runtimeMs);
      telemetry.step(game.diagnosticState(), day, elapsedMs / msPerDay, runtimeMs, schedule.reason);
      const state = game.diagnosticState(); const deltaDays = elapsedMs / msPerDay;
      for (const economy of state.factionEconomies) {
        const missing = shortages.get(economy.factionId) ?? {};
        shortages.set(economy.factionId, missing);
        for (const resource of RESOURCE_KINDS) {
          if (!Number.isFinite(economy.stockpiles[resource]) || !Number.isFinite(economy.monthlyDelta[resource])) throw new Error(`Nonfinite ${resource} at day ${day}, faction ${economy.factionId}.`);
          if (economy.stockpiles[resource] <= 0 && economy.monthlyDelta[resource] < 0) missing[resource] = (missing[resource] ?? 0) + deltaDays;
        }
        if (state.planetStates.some((planet) => planet.ownerId === economy.factionId && planet.isHabited && planet.economy.populationDecline.active
          && planet.economy.populationDecline.cause === "famine")) famineDays.set(economy.factionId, (famineDays.get(economy.factionId) ?? 0) + deltaDays);
      }
      for (let starId = 0; starId < state.starOwnership.length; starId++) if (previousOwners[starId] !== state.starOwnership[starId]) {
        ownershipChanges++; appendFileSync(eventsFile, `${JSON.stringify({ type: "ownership", day, starId, from: previousOwners[starId], to: state.starOwnership[starId] })}\n`);
      }
      previousOwners = [...state.starOwnership];
      const wars = JSON.stringify(state.diplomacy.wars);
      if (wars !== previousWars) { appendFileSync(eventsFile, `${JSON.stringify({ type: "wars", day, wars: state.diplomacy.wars })}\n`); previousWars = wars; }
      for (const report of state.combatReports) if (!combatReportIds.has(report.id)) {
        combatReportIds.add(report.id); appendFileSync(eventsFile, `${JSON.stringify({ type: "combat", day, report })}\n`);
        for (const id of report.shipsLost) lostShips.set(id, report.ownerId);
      }
      if (day + 1e-6 >= nextSample || game.now() - start.nowMs >= duration) {
        sample(); nextSample += 30;
        console.log(`Campaign day ${day.toFixed(0)}/${options.days}: ${accepted} actions, ${rejected} rejected; ${((performance.now() - created) / 1000).toFixed(1)}s elapsed.`);
      }
      if (day + 1e-6 >= nextCheckpoint) {
        writeFileSync(path.join(options.output, `year-${Math.round(nextCheckpoint / GAME_DAYS_PER_YEAR)}.checkpoint.json`), JSON.stringify(game.exportCheckpoint()));
        nextCheckpoint += GAME_DAYS_PER_YEAR;
      }
      if (tick % 10 === 0) await setImmediate();
    }
  } catch (error) {
    writeFileSync(path.join(options.output, "failure.checkpoint.json"), JSON.stringify(game.exportCheckpoint()));
    writeFileSync(path.join(options.output, "failure.json"), JSON.stringify({ tick, day, message: String(error), stack: error instanceof Error ? error.stack : undefined }));
    writeFileSync(path.join(options.output, "run.json"), JSON.stringify({ formatVersion: 1, options, revision, status: "failed", tick, day }, null, 2));
    throw error;
  }
  const final = game.exportCheckpoint();
  writeFileSync(path.join(options.output, "final.checkpoint.json"), JSON.stringify(final));
  const summary = { formatVersion: 1, options, revision, actualStars: final.state.stars.length, actualCountries: final.state.factions.length, activeIds,
    ...telemetry.summary(), ticks: tick, simulatedDays: day, runtimeMs: performance.now() - created, maximumTickMs: maxTickMs, accepted, rejected, actionsByType, rejections,
    ownershipChanges, warsStarted: final.state.diplomacy.wars.length, warsEnded: final.state.diplomacy.wars.filter((war) => war.endedAtYear).length,
    combatReports: combatReportIds.size, shipsLost: lostShips.size, finalDigest: game.digest(),
    factions: frames.at(-1)!.factions.map((faction) => ({ ...faction, ...actionCounts.get(faction.id), stockoutDays: shortages.get(faction.id) ?? {}, famineDays: famineDays.get(faction.id) ?? 0 })) };
  writeFileSync(path.join(options.output, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(path.join(options.output, "timelapse.html"), campaignViewer({ stars, hyperlanes: start.state.hyperlanes, factions, frames, summary }));
  const report = ["# Active AI campaign", "", `Seed ${options.seed}; ${summary.actualStars} systems; ${options.active} active and ${summary.actualCountries - options.active} passive countries; AI wars ${options.allowWars ? "enabled" : "disabled"}.`,
    `${day.toFixed(0)} game days in ${(summary.runtimeMs / 1000).toFixed(1)} seconds; ${tick} ticks; virtual step ${options.stepMs} ms (${(options.stepMs / msPerDay).toFixed(3)} game days). No wall-clock waits.`, "",
    `Schedule: ${options.adaptive === false ? "fixed" : "adaptive, daily peace maximum with transition boundaries and production combat cadence"}. This uses normal production rules. Tick size can affect combat, movement, and economic outcomes; compare balance only against the same schedule. Sampled stockout/famine durations are approximate. ${options.active} active countries are fixed for this laboratory run; remaining countries stay passive regardless of virtual real time.`, "",
    `Accepted/rejected actions: ${accepted}/${rejected}. Ownership changes: ${ownershipChanges}. Wars started/ended: ${summary.warsStarted}/${summary.warsEnded}. Unique combat reports: ${summary.combatReports}; recorded ship losses: ${summary.shipsLost}.`, "",
    "| Country | AI | Systems | Colonies | Ships | Techs | Food/month | Famine days | Accepted/rejected |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...summary.factions.map((faction) => `| ${faction.id} | ${faction.mode} | ${faction.systems} | ${faction.colonies} | ${faction.ships} | ${faction.technologies} | ${faction.income.food.toFixed(1)} | ${faction.famineDays.toFixed(1)} | ${faction.accepted ?? 0}/${faction.rejected ?? 0} |`), "", "## Rejected commands", "",
    ...Object.entries(rejections).map(([reason, count]) => `- ${count}: ${reason}`), "", "## Files", "", "Open timelapse.html in a browser for the animated border map and economy history. timeline.jsonl contains monthly snapshots; events.jsonl records ownership, war, and combat events at tick resolution; actions.jsonl contains every attempted command and its outcome. decisions.jsonl records every controller turn including idle turns, visible opportunity assessments, resource runway and stressed trade budgets. development.jsonl tracks queue changes, technologies, ship creation/removal and colonies; removal is not automatically a combat loss. market.jsonl records actual transactions, fees and energy flows. economies.jsonl and planets.jsonl preserve monthly production, consumption, crew, research, jobs, housing and construction. performance.jsonl records every integration interval, reason and measured runtime. Initial, yearly, and final checkpoints preserve the complete isolated game. run.json and source archives identify the implementation. ticks.jsonl contains sampled state digests. These files are diagnostic history, not the scripted-scenario replay format.", ""];
  writeFileSync(path.join(options.output, "findings.md"), report.join("\n"));
  writeFileSync(path.join(options.output, "run.json"), JSON.stringify({ formatVersion: 1, options, revision, status: "complete", finalDigest: summary.finalDigest }, null, 2));
  await analyzeCampaign(options.output);
  return summary;
}

export async function runCampaignCli(argv: string[]) {
  const option = (name: string, fallback: string) => { const i = argv.indexOf(`--${name}`); if (i < 0) return fallback;
    const value = argv[i + 1]; if (!value || value.startsWith("--")) throw new Error(`Missing --${name} value.`); return value; };
  const allow = option("allow-wars", "false");
  if (allow !== "true" && allow !== "false") throw new Error("--allow-wars must be true or false.");
  const output = path.resolve(option("out", `.cache/ai-lab/campaign-${Date.now()}`));
  const result = await runCampaign({ seed: Number(option("seed", "42")), stars: Number(option("stars", "500")), countries: Number(option("countries", "15")),
    active: Number(option("active", "10")), days: Number(option("days", "3600")), stepMs: Number(option("step-ms", "24000")), allowWars: allow === "true", adaptive: option("adaptive", "true") !== "false", checkpoint: argv.includes("--checkpoint") ? option("checkpoint", "") : undefined, output });
  console.log(`Finished ${result.simulatedDays} game days in ${(result.runtimeMs / 1000).toFixed(1)} seconds. Reports: ${output}`);
}

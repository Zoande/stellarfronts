import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import { createHeadlessGame, type GameCheckpoint, type HeadlessGameOptions } from "./headless-game";
import type { GameActor, GameAction } from "./actions";
import type { CommandOutcome } from "./mutation-coordinator";
import { prepareScenario, scriptedActions, type ScenarioName } from "./simulation-scenarios";
import { RESOURCE_KINDS } from "../../src/data/Economy";
import type { ResourceCounts } from "../../src/data/Economy";
import type { AiObservation } from "./ai-observation";

export type ReplayRecord =
  | { type: "header"; formatVersion: 1; revision: string; scenario: ScenarioName; options: { days: number; stepMs: number }; checkpoint: GameCheckpoint; digest: string }
  | { type: "action"; tick: number; actor: GameActor; action: GameAction; outcome: CommandOutcome; digest: string }
  | { type: "tick"; tick: number; elapsedMs: number; digest: string }
  | { type: "failure"; tick: number; phase: "action"; actor: GameActor; action: GameAction; message: string; digest: string }
  | { type: "failure"; tick: number; phase: "tick"; elapsedMs: number; message: string; digest: string }
  | { type: "end"; tick: number; digest: string };

export interface FactionMetrics {
  factionId: number;
  stockpiles: ResourceCounts;
  income: ResourceCounts;
  minimumStockpiles: ResourceCounts;
  shortageDays: ResourceCounts;
  population: number;
  populationLost: number;
  famineAffectedDays: number;
  constructionCompleted: number;
  technologiesCompleted: number;
  systems: number;
  colonies: number;
  shipsLost: number;
}
export interface SimulationResult {
  scenario: ScenarioName;
  revision: string;
  worldSeed: number;
  ticks: number;
  simulatedDays: number;
  stars: number;
  countries: number;
  actionsAccepted: number;
  actionsRejected: number;
  combatReports: number;
  runtimeMs: number;
  maximumTickMs: number;
  finalDigest: string;
  factions: FactionMetrics[];
  findings: string[];
}

export async function runScenario(
  scenario: ScenarioName,
  options: HeadlessGameOptions & { days?: number; revision?: string } = {},
  record: (record: ReplayRecord) => void = () => undefined,
  progress: (day: number) => void = () => undefined,
  decide: (day: number, observation: AiObservation) => readonly GameAction[] = (day, observation) => scriptedActions(scenario, day, observation),
): Promise<SimulationResult> {
  const days = options.days ?? 30;
  const stepMs = options.stepMs ?? 100;
  if (!Number.isFinite(days) || days <= 0) throw new Error("Simulation days must be positive and finite.");
  const checkpoint = prepareScenario(scenario, options);
  const game = createHeadlessGame({ checkpoint, stepMs });
  const start = game.exportCheckpoint();
  if (start.state.clock.paused) throw new Error("Scenario checkpoints must have a running game clock.");
  const msPerGameDay = 1000 * start.state.clock.tickSpeedSeconds / start.state.clock.tickSizeDays;
  const actor = game.createAiActor(0);
  const revision = options.revision ?? "unknown";
  record({ type: "header", formatVersion: 1, revision, scenario, options: { days, stepMs }, checkpoint: start, digest: game.digest() });
  const metrics = new Map<number, FactionMetrics>();
  const initialTech = new Map(start.state.factionTechnologies.map((t) => [t.factionId, t.completedTechIds.length]));
  const shipOwners = new Map(start.state.ships.map((s) => [s.id, s.ownerId]));
  const lostShips = new Set<string>();
  const empty = (): ResourceCounts => ({ energy: 0, minerals: 0, food: 0, goods: 0, alloys: 0, research: 0 });
  for (const economy of start.state.factionEconomies) {
    metrics.set(economy.factionId, { factionId: economy.factionId, stockpiles: { ...economy.stockpiles }, income: { ...economy.monthlyDelta }, minimumStockpiles: { ...economy.stockpiles }, shortageDays: empty(),
      population: start.state.planetStates.filter((p) => p.ownerId === economy.factionId).reduce((sum, p) => sum + p.population, 0), populationLost: 0, famineAffectedDays: 0, constructionCompleted: 0, technologiesCompleted: 0, systems: 0, colonies: 0, shipsLost: 0 });
  }
  let accepted = 0; let rejected = 0; let maxTickMs = 0; let tick = 0; let lastDay = -1;
  const started = performance.now();
  const durationMs = Math.round(days * msPerGameDay);
  if (!Number.isSafeInteger(durationMs) || durationMs < 1) throw new Error("Simulation horizon is outside the supported millisecond range.");
  function constructionQueues(state: GameCheckpoint["state"]) {
    return new Map([...state.planetStates, ...state.starbases].flatMap((p) => p.constructionQueue.map((q) => [q.id, p.ownerId] as const)));
  }
  let previousQueues = constructionQueues(start.state);
  let lastSampleMs = start.nowMs;
  const findings: string[] = [];
  while (game.now() - start.nowMs < durationMs) {
    const day = Math.floor((game.now() - start.nowMs) / msPerGameDay);
    if (day !== lastDay) {
      for (const action of decide(day, game.observe(0))) {
        let outcome: CommandOutcome;
        try { outcome = game.act(actor, action); }
        catch (error) {
          record({ type: "failure", tick, phase: "action", actor, action, message: error instanceof Error ? error.message : String(error), digest: game.digest() });
          throw error;
        }
        if (outcome.ok) accepted++; else { rejected++; findings.push(`Day ${day}: ${action.type} rejected: ${outcome.message}`); }
        record({ type: "action", tick, actor, action, outcome, digest: game.digest() });
      }
      progress(day); lastDay = day;
    }
    const elapsedMs = Math.min(stepMs, durationMs - (game.now() - start.nowMs));
    const before = performance.now();
    try { game.step(elapsedMs); }
    catch (error) {
      record({ type: "failure", tick: tick + 1, phase: "tick", elapsedMs, message: error instanceof Error ? error.message : String(error), digest: game.digest() });
      throw error;
    }
    maxTickMs = Math.max(maxTickMs, performance.now() - before); tick++;
    record({ type: "tick", tick, elapsedMs, digest: game.digest() });
    // Diagnostics sample hourly; controllers never receive this checkpoint.
    if (tick % Math.max(1, Math.round(1000 / stepMs)) === 0 || game.now() - start.nowMs >= durationMs) {
      const state = game.diagnosticState();
      const sampledDays = (game.now() - lastSampleMs) / msPerGameDay;
      lastSampleMs = game.now();
      const currentQueues = constructionQueues(state);
      for (const ship of state.ships) shipOwners.set(ship.id, ship.ownerId);
      for (const report of state.combatReports) for (const id of report.shipsLost) lostShips.add(id);
      for (const economy of state.factionEconomies) {
        const m = metrics.get(economy.factionId)!;
        for (const resource of RESOURCE_KINDS) {
          if (!Number.isFinite(economy.stockpiles[resource]) || !Number.isFinite(economy.monthlyDelta[resource])) throw new Error(`Nonfinite ${resource} for faction ${economy.factionId} at tick ${tick}.`);
          m.minimumStockpiles[resource] = Math.min(m.minimumStockpiles[resource], economy.stockpiles[resource]);
          if ((economy.stockpiles[resource] <= 0 && economy.monthlyDelta[resource] < 0) || state.situations.some((s) => s.factionId === economy.factionId && s.subject === resource && s.progress > 0)) m.shortageDays[resource] += sampledDays;
        }
        m.stockpiles = { ...economy.stockpiles }; m.income = { ...economy.monthlyDelta };
        const planets = state.planetStates.filter((p) => p.ownerId === economy.factionId && p.isHabited);
        const population = planets.reduce((sum, p) => sum + p.population, 0);
        m.populationLost += Math.max(0, m.population - population); m.population = population;
        if (planets.some((p) => p.economy.populationDecline.active && p.economy.populationDecline.cause === "famine")) m.famineAffectedDays += sampledDays;
        m.systems = state.starOwnership.filter((owner) => owner === economy.factionId).length; m.colonies = planets.length;
        m.technologiesCompleted = state.factionTechnologies.find((t) => t.factionId === economy.factionId)!.completedTechIds.length - initialTech.get(economy.factionId)!;
        m.shipsLost = Array.from(lostShips).filter((id) => shipOwners.get(id) === economy.factionId).length;
        for (const [id, ownerId] of previousQueues) if (ownerId === economy.factionId && !currentQueues.has(id)) m.constructionCompleted++;
      }
      previousQueues = currentQueues;
    }
    if (tick % 100 === 0) await setImmediate();
  }
  const final = game.exportCheckpoint(); const finalDigest = game.digest();
  record({ type: "end", tick, digest: finalDigest });
  for (const m of metrics.values()) {
    if (m.shortageDays.food > 0) findings.push(`Faction ${m.factionId}: food shortage for ${m.shortageDays.food.toFixed(2)} game days; examine economy balance.`);
    if (m.populationLost > 0) findings.push(`Faction ${m.factionId}: observed population loss ${m.populationLost}; compare famine, migration, and combat before attributing causes.`);
  }
  return { scenario, revision, worldSeed: checkpoint.game.seed, ticks: tick, simulatedDays: days, stars: final.state.stars.length, countries: final.state.factions.length,
    actionsAccepted: accepted, actionsRejected: rejected, combatReports: final.state.combatReports.length, runtimeMs: performance.now() - started, maximumTickMs: maxTickMs,
    finalDigest, factions: Array.from(metrics.values()), findings };
}

export function replay(records: readonly ReplayRecord[]) {
  const header = records[0];
  if (!header || header.type !== "header" || header.formatVersion !== 1) throw new Error("Replay header is missing or unsupported.");
  const game = createHeadlessGame({ checkpoint: header.checkpoint, stepMs: header.options.stepMs });
  if (game.digest() !== header.digest) return { ok: false, tick: 0, record: 0, reason: "Initial checkpoint differs." };
  function actorFor(actor: GameActor) {
    return actor.kind === "ai" ? game.createAiActor(actor.factionId, actor.controllerId)
      : actor.kind === "human" ? game.createHumanActor(actor.accountId, actor.factionId) : game.createObserverActor();
  }
  let expectedTick = 0;
  for (let index = 1; index < records.length; index++) {
    const entry = records[index];
    if (entry.type === "header") throw new Error("Unexpected replay header.");
    if (!["action", "tick", "end", "failure"].includes(entry.type)) throw new Error("Unknown replay record.");
    if (entry.type === "failure") {
      if (index !== records.length - 1 || entry.tick !== expectedTick + (entry.phase === "tick" ? 1 : 0)) throw new Error("Invalid failure record order.");
      let message: string | undefined;
      try {
        if (entry.phase === "tick") game.step(entry.elapsedMs);
        else game.act(actorFor(entry.actor), entry.action);
      } catch (error) { message = error instanceof Error ? error.message : String(error); }
      if (message !== entry.message || game.digest() !== entry.digest) return { ok: false, tick: entry.tick, record: index, reason: "Recorded failure differs." };
      return { ok: true, tick: entry.tick, digest: entry.digest, reproducedFailure: message };
    }
    if (entry.type === "tick") {
      if (entry.tick !== ++expectedTick) throw new Error("Invalid replay tick order.");
      game.step(entry.elapsedMs);
    } else if (entry.tick !== expectedTick) throw new Error("Invalid replay action/end order.");
    if (entry.type === "end" && index !== records.length - 1) throw new Error("Unexpected replay end.");
    if (entry.type === "action") {
      const outcome = game.act(actorFor(entry.actor), entry.action);
      if (JSON.stringify(outcome) !== JSON.stringify(entry.outcome)) return { ok: false, tick: entry.tick, record: index, reason: "Action outcome differs." };
    }
    if (game.digest() !== entry.digest) return { ok: false, tick: entry.tick, record: index, reason: entry.type === "action" ? "State differs after action." : "State differs after tick." };
  }
  if (records.at(-1)?.type !== "end") throw new Error("Replay is incomplete.");
  return { ok: true, tick: records.at(-1)!.type === "end" ? (records.at(-1) as Extract<ReplayRecord, { type: "end" }>).tick : 0, digest: game.digest() };
}

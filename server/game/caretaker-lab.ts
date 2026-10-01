import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import { RESOURCE_KINDS } from "../../src/data/Economy";
import type { ResourceCounts } from "../../src/data/Economy";
import { createHeadlessGame } from "./headless-game";
import { CARETAKER_AFK_MS } from "./caretaker";
import { prepareScenario, type ScenarioName } from "./simulation-scenarios";
import { createGameCore } from "../game-runtime";
import { createMemoryAuth } from "./headless-game";
import type { ReplayRecord } from "./simulation-lab";
import type { GameAction } from "./actions";
import type { CommandOutcome } from "./mutation-coordinator";

interface EconomyMeasures {
  stockpiles: ResourceCounts;
  income: ResourceCounts;
  minimumStockpiles: ResourceCounts;
  shortageDays: ResourceCounts;
  /** Actual stockout, separate from lingering shortage-situation progress. */
  foodStockoutDays: number;
  foodDeficitDays: number;
  population: number;
  populationLost: number;
  famineAffectedDays: number;
  systems: number;
  colonies: number;
  ships: number;
  shipsLost: number;
  constructionCompleted: number;
  technologiesCompleted: number;
}

export interface FoodRecoverySample {
  day: number;
  food: number;
  foodIncome: number;
  shortageProgress: number;
  population: number;
  agricultureDistricts: number;
  farmerCapacity: number;
  farmersEmployed: number;
  foodProduced: number;
  foodConsumed: number;
  famine: boolean;
  queues: Array<{ planetId: string; label: string; remainingDays: number }>;
}

export function foodRecoverySample(state: ReturnType<ReturnType<typeof createHeadlessGame>["diagnosticState"]>, factionId: number, day: number): FoodRecoverySample {
  const economy = state.factionEconomies.find((entry) => entry.factionId === factionId)!;
  const planets = state.planetStates.filter((planet) => planet.ownerId === factionId && planet.isHabited);
  return {
    day, food: economy.stockpiles.food, foodIncome: economy.monthlyDelta.food,
    shortageProgress: Math.max(0, ...state.situations.filter((situation) => situation.factionId === factionId && situation.subject === "food").map((situation) => situation.progress)),
    population: planets.reduce((sum, planet) => sum + planet.population, 0),
    agricultureDistricts: planets.reduce((sum, planet) => sum + planet.builtDistricts.agriculture, 0),
    farmerCapacity: planets.reduce((sum, planet) => sum + planet.economy.jobCapacity.farmer, 0),
    farmersEmployed: planets.reduce((sum, planet) => sum + planet.economy.popGroups.filter((group) => group.job === "farmer").reduce((total, group) => total + group.population, 0), 0),
    foodProduced: planets.reduce((sum, planet) => sum + planet.economy.production.food, 0),
    foodConsumed: planets.reduce((sum, planet) => sum + planet.economy.upkeep.food, 0),
    famine: planets.some((planet) => planet.economy.populationDecline.active && planet.economy.populationDecline.cause === "famine"),
    queues: planets.flatMap((planet) => planet.constructionQueue.map((item) => ({ planetId: planet.id, label: item.label, remainingDays: item.remainingDays }))),
  };
}

export interface CaretakerSimulationResult {
  controller: "caretaker" | "passive";
  revision: string;
  scenario: ScenarioName;
  seed: number;
  stars: number;
  countries: number;
  days: number;
  ticks: number;
  runtimeMs: number;
  actionsAccepted: number;
  actionsRejected: number;
  actionsByType: Record<string, number>;
  caretaker: EconomyMeasures;
  idleComparison: EconomyMeasures;
  finalDigest: string;
  replayVerified: boolean;
  findings: string[];
}

export interface CaretakerActionTrace {
  tick: number;
  factionId: number;
  action: GameAction;
  outcome: CommandOutcome;
}

function emptyResources(): ResourceCounts {
  return { energy: 0, minerals: 0, food: 0, goods: 0, alloys: 0, research: 0 };
}

function measures(state: ReturnType<ReturnType<typeof createHeadlessGame>["diagnosticState"]>, factionId: number): EconomyMeasures {
  const economy = state.factionEconomies.find((entry) => entry.factionId === factionId)!;
  return {
    stockpiles: { ...economy.stockpiles }, income: { ...economy.monthlyDelta }, minimumStockpiles: { ...economy.stockpiles }, shortageDays: emptyResources(),
    population: state.planetStates.filter((planet) => planet.ownerId === factionId && planet.isHabited).reduce((sum, planet) => sum + planet.population, 0),
    foodStockoutDays: 0, foodDeficitDays: 0, populationLost: 0, famineAffectedDays: 0, systems: state.starOwnership.filter((owner) => owner === factionId).length,
    colonies: state.planetStates.filter((planet) => planet.ownerId === factionId && planet.isHabited).length,
    ships: state.ships.filter((ship) => ship.ownerId === factionId).length, shipsLost: 0, constructionCompleted: 0, technologiesCompleted: 0,
  };
}

function queueIds(state: ReturnType<ReturnType<typeof createHeadlessGame>["diagnosticState"]>, factionId: number): Set<string> {
  return new Set([
    ...state.planetStates.filter((planet) => planet.ownerId === factionId).flatMap((planet) => [...planet.constructionQueue, ...planet.defense.shipQueue].map((item) => item.id)),
    ...state.starbases.filter((base) => base.ownerId === factionId).flatMap((base) => [...base.constructionQueue, ...base.shipQueue].map((item) => item.id)),
  ]);
}

function sample(target: EconomyMeasures, state: ReturnType<ReturnType<typeof createHeadlessGame>["diagnosticState"]>, factionId: number,
  elapsedDays: number, initialTechCount: number, previousQueues: Set<string>, seenLosses: Set<string>): Set<string> {
  const economy = state.factionEconomies.find((entry) => entry.factionId === factionId)!;
  if (economy.stockpiles.food <= 0 && economy.monthlyDelta.food < 0) target.foodStockoutDays += elapsedDays;
  if (economy.monthlyDelta.food < 0) target.foodDeficitDays += elapsedDays;
  for (const resource of RESOURCE_KINDS) {
    if (!Number.isFinite(economy.stockpiles[resource]) || !Number.isFinite(economy.monthlyDelta[resource])) throw new Error(`Nonfinite ${resource} in caretaker experiment.`);
    target.minimumStockpiles[resource] = Math.min(target.minimumStockpiles[resource], economy.stockpiles[resource]);
    if ((economy.stockpiles[resource] <= 0 && economy.monthlyDelta[resource] < 0)
      || state.situations.some((situation) => situation.factionId === factionId && situation.subject === resource && situation.progress > 0)) {
      target.shortageDays[resource] += elapsedDays;
    }
  }
  const population = state.planetStates.filter((planet) => planet.ownerId === factionId && planet.isHabited).reduce((sum, planet) => sum + planet.population, 0);
  target.populationLost += Math.max(0, target.population - population);
  target.population = population;
  if (state.planetStates.some((planet) => planet.ownerId === factionId && planet.isHabited
    && planet.economy.populationDecline.active && planet.economy.populationDecline.cause === "famine")) target.famineAffectedDays += elapsedDays;
  target.stockpiles = { ...economy.stockpiles };
  target.income = { ...economy.monthlyDelta };
  target.systems = state.starOwnership.filter((owner) => owner === factionId).length;
  target.colonies = state.planetStates.filter((planet) => planet.ownerId === factionId && planet.isHabited).length;
  target.ships = state.ships.filter((ship) => ship.ownerId === factionId).length;
  target.technologiesCompleted = (state.factionTechnologies.find((tech) => tech.factionId === factionId)?.completedTechIds.length ?? 0) - initialTechCount;
  for (const report of state.combatReports.filter((entry) => entry.ownerId === factionId)) for (const shipId of report.shipsLost) seenLosses.add(shipId);
  target.shipsLost = seenLosses.size;
  const currentQueues = queueIds(state, factionId);
  for (const id of previousQueues) if (!currentQueues.has(id)) target.constructionCompleted++;
  return currentQueues;
}

/** Same virtual production pipeline as the normal lab, with an actual AFK handoff. */
export async function runCaretakerExperiment(
  scenario: ScenarioName,
  seed: number,
  days = 30,
  stepMs = 24_000,
  record: (entry: ReplayRecord) => void = () => undefined,
  recordAction: (entry: CaretakerActionTrace) => void = () => undefined,
  settings: { revision?: string; starCount?: number; factionCount?: number; controller?: "caretaker" | "passive";
    onSample?: (entry: { caretaker: FoodRecoverySample; idle: FoodRecoverySample }) => void } = {},
): Promise<CaretakerSimulationResult> {
  if (!Number.isFinite(days) || days <= 0 || !Number.isSafeInteger(stepMs) || stepMs <= 0) throw new Error("Invalid experiment duration.");
  const prepared = prepareScenario(scenario, { worldSeed: seed, simulationSeed: (seed ^ 0x5f3759df) >>> 0,
    initialWorld: { starCount: settings.starCount ?? 12, factionCount: settings.factionCount ?? 2 } });
  if (scenario === "combat-repair") {
    const home = prepared.state.factions.find((faction) => faction.id === 0)!.homeStarId;
    for (const fleet of prepared.state.fleets) {
      if (fleet.ownerId !== 0 && fleet.ownerId !== 1) continue;
      if (!fleet.shipIds.some((id) => prepared.state.ships.some((ship) => ship.id === id && (ship.shipKind === "corvette" || ship.shipKind === "constructionShip")))) continue;
      fleet.currentStarId = home;
      fleet.targetStarId = null;
      fleet.orderType = null;
      fleet.phase = "idle";
      fleet.route = [];
      fleet.movementPlan = null;
    }
    const damaged = prepared.state.ships.find((ship) => ship.ownerId === 0 && ship.shipKind === "corvette");
    if (damaged) {
      damaged.hull = Math.max(1, damaged.maxHull * 0.75);
      damaged.armor = damaged.maxArmor * 0.5;
      damaged.hp = damaged.hull;
    }
    const core = createGameCore(prepared.game, createMemoryAuth(prepared.accounts), { initialState: prepared.state, now: () => prepared.nowMs });
    core.context.refreshDiscovery();
  }
  const controller = settings.controller ?? "caretaker";
  prepared.enablePassiveAi = controller === "passive";
  prepared.accounts.owners = controller === "caretaker" ? { 0: 17 } : {};
  prepared.accounts.activities = { 0: prepared.realNowMs ?? prepared.nowMs };
  const idleCheckpoint = structuredClone(prepared);
  idleCheckpoint.enablePassiveAi = false;
  idleCheckpoint.accounts.owners = {};
  idleCheckpoint.accounts.activities = {};
  const actions: CaretakerActionTrace[] = [];
  let tick = -1;
  const game = createHeadlessGame({ checkpoint: prepared, stepMs, onAiAction: (action) => {
    const entry = { tick, ...action };
    actions.push(entry);
    recordAction(entry);
  } });
  const idle = createHeadlessGame({ checkpoint: idleCheckpoint, stepMs });
  const started = performance.now();
  game.advanceRealTime(CARETAKER_AFK_MS);
  const start = game.exportCheckpoint();
  const millisecondsPerGameDay = 1_000 * start.state.clock.tickSpeedSeconds / start.state.clock.tickSizeDays;
  const durationMs = Math.round(days * millisecondsPerGameDay);
  if (!Number.isSafeInteger(durationMs)) throw new Error("Experiment horizon too long.");
  const caretaker = measures(game.diagnosticState(), 0);
  const idleComparison = measures(idle.diagnosticState(), 0);
  const initialTechCount = game.diagnosticState().factionTechnologies.find((tech) => tech.factionId === 0)?.completedTechIds.length ?? 0;
  let caretakerQueues = queueIds(game.diagnosticState(), 0);
  let idleQueues = queueIds(idle.diagnosticState(), 0);
  const caretakerLosses = new Set<string>();
  const idleLosses = new Set<string>();
  record({ type: "header", formatVersion: 1, revision: settings.revision ?? "unknown", scenario, options: { days, stepMs }, checkpoint: start, digest: game.digest() });
  let elapsed = 0;
  let lastSampleElapsed = 0;
  settings.onSample?.({ caretaker: foodRecoverySample(game.diagnosticState(), 0, 0), idle: foodRecoverySample(idle.diagnosticState(), 0, 0) });
  while (elapsed < durationMs) {
    const delta = Math.min(stepMs, durationMs - elapsed);
    tick++;
    game.step(delta);
    idle.step(delta);
    elapsed += delta;
    record({ type: "tick", tick: tick + 1, elapsedMs: delta, digest: game.digest() });
    if ((tick + 1) % Math.max(1, Math.round(millisecondsPerGameDay / stepMs)) === 0 || elapsed === durationMs) {
      const span = (elapsed - lastSampleElapsed) / millisecondsPerGameDay;
      caretakerQueues = sample(caretaker, game.diagnosticState(), 0, span, initialTechCount, caretakerQueues, caretakerLosses);
      idleQueues = sample(idleComparison, idle.diagnosticState(), 0, span, initialTechCount, idleQueues, idleLosses);
      lastSampleElapsed = elapsed;
      settings.onSample?.({ caretaker: foodRecoverySample(game.diagnosticState(), 0, elapsed / millisecondsPerGameDay), idle: foodRecoverySample(idle.diagnosticState(), 0, elapsed / millisecondsPerGameDay) });
    }
    if ((tick + 1) % 100 === 0) await setImmediate();
  }
  record({ type: "end", tick: tick + 1, digest: game.digest() });
  const actionsByType: Record<string, number> = {};
  for (const entry of actions) actionsByType[entry.action.type] = (actionsByType[entry.action.type] ?? 0) + 1;
  const findings: string[] = [];
  const rejected = actions.filter((entry) => !entry.outcome.ok);
  if (rejected.length) findings.push(`${rejected.length} caretaker commands rejected; first: ${rejected[0].action.type}: ${rejected[0].outcome.message}`);
  if (caretaker.shortageDays.food > idleComparison.shortageDays.food) findings.push("Caretaker food shortage lasted longer than idle control.");
  if (caretaker.populationLost > idleComparison.populationLost) findings.push("Caretaker population loss exceeded idle control.");
  if (caretaker.shortageDays.food > 0) findings.push(`Caretaker food shortage: ${caretaker.shortageDays.food.toFixed(1)} game days.`);
  const replayed = createHeadlessGame({ checkpoint: start, stepMs });
  for (let i = 0; i <= tick; i++) replayed.step(Math.min(stepMs, durationMs - i * stepMs));
  const replayVerified = replayed.digest() === game.digest();
  if (!replayVerified) findings.push("Checkpoint replay diverged.");
  return {
    controller, revision: settings.revision ?? "unknown", scenario, seed, stars: start.state.stars.length, countries: start.state.factions.length,
    days, ticks: tick + 1, runtimeMs: performance.now() - started,
    actionsAccepted: actions.filter((entry) => entry.outcome.ok).length, actionsRejected: rejected.length,
    actionsByType, caretaker, idleComparison, finalDigest: game.digest(), replayVerified, findings,
  };
}

import type { AiObservation } from "./ai-observation";
import { getAiCandidates } from "./ai-candidates";
import type { GameAction } from "./actions";
import type { GameCheckpoint, HeadlessGameOptions } from "./headless-game";
import { createHeadlessGame } from "./headless-game";
import { createFleet, createShipFromDesign } from "./fleet-factory";
import { resolveShipDesign } from "./ship-designs";
import { createGameCore } from "../game-runtime";
import { createMemoryAuth } from "./headless-game";
import { hasCommandLink } from "./intelligence";
import { getPlanetConfig } from "./state-queries";
import { SHORTAGE_SITUATION_ID, situationInstanceId } from "../../src/data/Situations";

export const SCENARIO_NAMES = ["idle-economy", "shortage-recovery", "famine-recovery", "construction-research", "expansion", "combat-repair"] as const;
export type ScenarioName = typeof SCENARIO_NAMES[number];

/** Only fixture preparation has full truth. Scripted decisions receive faction observations. */
export function prepareScenario(name: ScenarioName, options: HeadlessGameOptions): GameCheckpoint {
  const checkpoint = createHeadlessGame(options).exportCheckpoint();
  const state = checkpoint.state;
  const core = createGameCore(checkpoint.game, createMemoryAuth(), { initialState: state, now: () => checkpoint.nowMs });
  const planet = state.planetStates.find((p) => p.ownerId === 0 && p.isHabited)!;
  if (name === "shortage-recovery" || name === "famine-recovery") {
    state.factionEconomies.find((e) => e.factionId === 0)!.stockpiles.food = 0;
    planet.builtDistricts.agriculture = 0;
    planet.buildings.agriculture.fill(null);
    if (name === "famine-recovery") state.situations.push({ id: situationInstanceId(SHORTAGE_SITUATION_ID, 0, "food"), defId: SHORTAGE_SITUATION_ID,
      factionId: 0, subject: "food", progress: 60, startedAtYear: state.clock.year, lastThreshold: 0 });
  }
  if (name === "combat-repair") {
    const friendly = state.fleets.find((f) => f.ownerId === 0 && f.shipIds.some((id) => state.ships.find((s) => s.id === id)?.shipKind === "corvette"))!;
    const hostile = state.fleets.find((f) => f.ownerId === 1 && f.shipIds.some((id) => state.ships.find((s) => s.id === id)?.shipKind === "corvette"))!;
    // Prefer a linked neutral system. Isolated starting systems use their home
    // authority, where normal starbase defense also participates in the battle.
    const neutral = state.starOwnership.findIndex((owner, id) => owner < 0 && hasCommandLink(state, 0, id));
    const location = neutral >= 0 ? neutral : state.factions[0].homeStarId;
    for (const fleet of [friendly, hostile]) {
      fleet.currentStarId = location;
      fleet.systemPosition = { x: fleet.ownerId === 0 ? -1 : 1, y: 0, z: 0 };
      fleet.combatSettings.engagementRule = "engageSystem";
    }
    const construction = state.fleets.find((f) => f.ownerId === 0 && f.shipIds.some((id) => state.ships.find((s) => s.id === id)?.shipKind === "constructionShip"))!;
    construction.currentStarId = location;
    construction.systemPosition = { x: -3, y: 0, z: 0 };
    state.diplomacy.wars.push({ id: "scenario-war", attackerFactionId: 0, defenderFactionId: 1, startedAtYear: state.clock.year, endedAtYear: null, preWarOwnership: state.starOwnership.map((owner, id) => [id, owner]) });
  }
  if (name === "expansion") {
    // Include an ordinary unlocked colony ship as explicit scenario setup, without bot resource bonuses.
    // A normal habitable target in the home system makes colonization testable
    // even when this generated seed has only restricted uninhabited worlds.
    const target = state.planetStates.find((p) => p.starId === planet.starId && !p.isHabited);
    const homeConfig = getPlanetConfig(core.context, planet);
    const targetConfig = target && getPlanetConfig(core.context, target);
    if (target && homeConfig && targetConfig) {
      targetConfig.type = homeConfig.type;
      targetConfig.objectDetails = structuredClone(homeConfig.objectDetails);
      target.habitability = planet.habitability;
    }
    const design = resolveShipDesign(state.shipDesigns, 0, "colonizationShip");
    const fleetId = core.context.createRuntimeId("scenario-colony-fleet");
    const ship = createShipFromDesign(core.context, 0, fleetId, design);
    state.ships.push(ship);
    state.fleets.push(createFleet(core.context, 0, state.factions[0].homeStarId, [ship.id], fleetId));
  }
  // Fixture edits represent an explicit starting checkpoint. Refresh its
  // permitted intelligence before decisions, rather than keeping pre-edit intel.
  core.context.recalculatePlanetEconomies();
  core.context.refreshFactionEconomyDeltas();
  core.context.refreshDiscovery();
  return checkpoint;
}

export function scriptedActions(name: ScenarioName, day: number, observation: AiObservation): GameAction[] {
  const candidates = getAiCandidates(observation);
  if (name === "idle-economy") return [];
  if (name === "shortage-recovery" || name === "famine-recovery") {
    // Food is itself part of the agriculture construction cost. Buy it first,
    // then use the next observation to queue the district through normal rules.
    if (day !== 3 && day !== 4 && day !== 10 && day !== 20) return [];
    const build = candidates.economy.find((a) => a.type === "buildDistrict" && a.districtKind === "agriculture");
    const quote = observation.market.resources.find((r) => r.resourceId === "food");
    const economy = observation.snapshot.factionEconomies.find((e) => e.factionId === observation.factionId);
    const amount = quote && economy ? Math.min(100, Math.floor(economy.stockpiles.energy / Math.max(1, quote.buyPrice * 1.2))) : 0;
    return [...build && day === 4 ? [build] : [], ...amount > 0 && day !== 4 ? [{ type: "marketTrade" as const, resourceId: "food" as const, tradeType: "buy" as const, amount }] : []];
  }
  if (name === "construction-research") {
    if (day === 0) {
      const build = candidates.economy.find((a) => a.type === "buildDistrict" && a.districtKind === "mining") ?? candidates.economy.find((a) => a.type === "buildDistrict");
      const activeTechId = observation.snapshot.technologies.find((t) => t.factionId === observation.factionId)?.activeTechId;
      const research = candidates.research[0] ?? (activeTechId ? { type: "setActiveTechnology" as const, techId: activeTechId } : undefined);
      return [...research ? [research] : [], ...build ? [build] : []];
    }
    if (day === 15) return candidates.economy.filter((a) => a.type === "upgradePlanetBuilding").slice(0, 1);
  }
  if (name === "expansion") {
    if (day === 0) return [...candidates.expansion.slice(0, 1), ...candidates.colonization.slice(0, 1)];
    if (day === 15) return candidates.colonization.slice(0, 1);
  }
  if (name === "combat-repair") {
    if (day === 0) {
      const ours = observation.fleets.fleets.find((f) => f.ownerId === observation.factionId && f.shipIds.some((id) => observation.fleets.ships.find((s) => s.id === id)?.shipKind === "corvette"));
      const enemy = observation.fleets.fleets.find((f) => f.ownerId !== observation.factionId && f.currentStarId === ours?.currentStarId);
      return ours && enemy ? [{ type: "attackTarget", fleetId: ours.id, targetId: enemy.id, targetKind: "fleet" }] : [];
    }
    if (day >= 1 && day <= 5) return candidates.repairs.slice(0, 1);
  }
  return [];
}

import { getPlanetBuildingKind, PEOPLE_PER_MONTHLY_UNIT } from "../../src/data/Economy";
import { computeFleetPower } from "../../src/game/combatPower";
import {
  BASELINE_RESEARCH_PER_HOUR,
  createEmptyTechProgress,
  evaluateTechnologyResearch,
  getFirstRequiredTechName,
  getMissingPrerequisites,
  getPassiveProgressCap,
  getRequiredTechIdsForShipHull,
  getRequiredTechIdsForShipModule,
  getRequiredTechIdsForShipSection,
  isTechnologyAvailable,
  isTechnologyCompleted,
  isUnlockedByAnyRequiredTech,
  normalizeFactionTechState,
  TECHNOLOGY_DEFINITIONS,
  TECHNOLOGY_BY_ID,
} from "../../src/data/Technology";
import type {
  FactionTechState,
  FactionTechnologyView,
  ResearchContext,
  TechId,
} from "../../src/data/Technology";
import type { ShipDesign } from "../../src/data/ShipDesigns";
import type { GalaxyPerspective } from "../../src/data/Factions";
import { GAME_HOURS_PER_MONTH } from "../../src/game/GameTime";
import {
  getGovernmentResearchAllocation,
  getGovernmentResearchSpeedMultiplier,
  getFactionTechnology,
  getFactionEconomy,
} from "./state-queries";
import type { RuntimeContext } from "./types";

function countOwnedPlanetBuildings(ctx: RuntimeContext, factionId: number, buildingKind: string): number {
  let count = 0;
  for (const planetState of ctx.state.planetStates) {
    if (planetState.ownerId !== factionId) continue;
    for (const building of Object.values(planetState.buildings).flat()) {
      if (getPlanetBuildingKind(building) === buildingKind) count += 1;
    }
    for (const subDistrict of planetState.urbanSubDistricts) {
      for (const building of subDistrict.buildings) {
        if (getPlanetBuildingKind(building) === buildingKind) count += 1;
      }
    }
  }
  return count;
}

function buildResearchContext(ctx: RuntimeContext, factionId: number): ResearchContext {
  const economy = getFactionEconomy(ctx.state, factionId);
  const jobs: Record<string, number> = {
    farmer: 0,
    miner: 0,
    researcher: 0,
    artisan: 0,
    metallurgist: 0,
    technician: 0,
  };
  for (const planetState of ctx.state.planetStates) {
    if (planetState.ownerId !== factionId) continue;
    for (const group of planetState.economy.popGroups) {
      if (Object.prototype.hasOwnProperty.call(jobs, group.job)) {
        jobs[group.job] += group.population / PEOPLE_PER_MONTHLY_UNIT;
      }
    }
  }
  const factionFleets = ctx.state.fleets.filter((fleet) => fleet.ownerId === factionId);
  const factionShips = ctx.state.ships.filter((ship) => ship.ownerId === factionId);
  const shipsByFleetId = new Map<string, typeof factionShips>();
  for (const ship of factionShips) {
    const list = shipsByFleetId.get(ship.fleetId) ?? [];
    list.push(ship);
    shipsByFleetId.set(ship.fleetId, list);
  }
  const fleetPower = factionFleets.reduce((sum, fleet) => (
    sum + computeFleetPower(shipsByFleetId.get(fleet.id) ?? [], fleet.shipIds.length, undefined, ctx.state.shipDesigns)
  ), 0);
  const recentCombatCutoff = ctx.state.clock.year - 1;
  const atWar = ctx.state.recentCombatContacts.some((contact) => (
    contact.year >= recentCombatCutoff
    && (contact.sourceOwnerId === factionId || contact.targetOwnerId === factionId)
  ));
  const foodStockpile = economy?.stockpiles.food ?? 0;
  const foodIncome = economy?.monthlyDelta.food ?? 0;
  return {
    farmerJobs: jobs.farmer,
    minerJobs: jobs.miner,
    researcherJobs: jobs.researcher,
    artisanJobs: jobs.artisan,
    metallurgistJobs: jobs.metallurgist,
    technicianJobs: jobs.technician,
    fleetPower,
    shipCount: factionShips.length,
    atWar,
    famine: foodStockpile < 0 || (foodStockpile < 250 && foodIncome < 0),
    lowFoodStockpile: foodStockpile < 1000 || foodIncome < 0,
    foodIncome,
    mineralsIncome: economy?.monthlyDelta.minerals ?? 0,
    alloyIncome: economy?.monthlyDelta.alloys ?? 0,
    energyIncome: economy?.monthlyDelta.energy ?? 0,
    goodsIncome: economy?.monthlyDelta.goods ?? 0,
    researchIncome: economy?.monthlyDelta.research ?? 0,
    researchLabs: countOwnedPlanetBuildings(ctx, factionId, "researchLabs"),
    starbaseResearchAnnexes: ctx.state.starbases
      .filter((starbase) => starbase.ownerId === factionId)
      .reduce((count, starbase) => count + starbase.buildingSlots.filter((building) => building === "researchAnnex").length, 0),
  };
}

function selectNextActiveTechnology(techState: FactionTechState): TechId | undefined {
  return TECHNOLOGY_DEFINITIONS
    .filter((tech) => isTechnologyAvailable(tech, techState))
    .sort((a, b) => a.tier - b.tier || a.positionInTree.y - b.positionInTree.y || a.name.localeCompare(b.name))[0]?.id;
}

export function ensureActiveTechnology(techState: FactionTechState): boolean {
  if (
    techState.activeTechId
    && TECHNOLOGY_BY_ID[techState.activeTechId]
    && !isTechnologyCompleted(techState, techState.activeTechId)
    && isTechnologyAvailable(TECHNOLOGY_BY_ID[techState.activeTechId], techState)
  ) {
    return false;
  }
  const nextActive = selectNextActiveTechnology(techState);
  if (techState.activeTechId === nextActive) return false;
  techState.activeTechId = nextActive;
  return true;
}

export function completeTechnology(techState: FactionTechState, techId: TechId): boolean {
  const tech = TECHNOLOGY_BY_ID[techId];
  if (!tech || isTechnologyCompleted(techState, techId)) return false;
  const progress = techState.progressByTechId[techId] ?? createEmptyTechProgress();
  techState.progressByTechId[techId] = {
    ...progress,
    totalProgress: tech.cost,
    completed: true,
  };
  techState.completedTechIds = Array.from(new Set([...techState.completedTechIds, techId]));
  if (techState.activeTechId === techId) techState.activeTechId = undefined;
  return true;
}

function applyActiveResearchPool(
  techState: FactionTechState,
  context: ResearchContext,
  activeResearchPool: number,
): boolean {
  let pool = Math.max(0, activeResearchPool);
  let changed = false;
  let guard = 0;
  while (pool > 0.000001 && guard < TECHNOLOGY_DEFINITIONS.length) {
    guard += 1;
    changed = ensureActiveTechnology(techState) || changed;
    const techId = techState.activeTechId;
    if (!techId) break;
    const tech = TECHNOLOGY_BY_ID[techId];
    if (!tech || tech.cost <= 0 || isTechnologyCompleted(techState, techId)) {
      techState.activeTechId = undefined;
      continue;
    }
    const progress = techState.progressByTechId[techId] ?? createEmptyTechProgress();
    const evaluation = evaluateTechnologyResearch(tech, context);
    const remainingProgress = Math.max(0, tech.cost - progress.totalProgress);
    const poolToComplete = remainingProgress / Math.max(0.000001, evaluation.multiplier);
    const consumedPool = Math.min(pool, poolToComplete);
    const gainedProgress = consumedPool * evaluation.multiplier;
    if (gainedProgress <= 0) break;
    progress.activeProgress += gainedProgress;
    progress.totalProgress = Math.min(tech.cost, progress.totalProgress + gainedProgress);
    techState.progressByTechId[techId] = progress;
    pool -= consumedPool;
    changed = true;
    if (progress.totalProgress >= tech.cost - 0.000001) {
      completeTechnology(techState, techId);
      changed = true;
      continue;
    }
    break;
  }
  return changed;
}

function applyPassiveResearchPool(
  techState: FactionTechState,
  context: ResearchContext,
  passiveResearchPool: number,
): boolean {
  let pool = Math.max(0, passiveResearchPool);
  if (pool <= 0) return false;
  const candidates = TECHNOLOGY_DEFINITIONS
    .filter((tech) => isTechnologyAvailable(tech, techState))
    .map((tech) => {
      const progress = techState.progressByTechId[tech.id] ?? createEmptyTechProgress();
      const capRemaining = Math.max(0, getPassiveProgressCap(tech) - progress.passiveProgress);
      const totalRemaining = Math.max(0, tech.cost - progress.totalProgress);
      const remaining = Math.min(capRemaining, totalRemaining);
      const evaluation = evaluateTechnologyResearch(tech, context);
      return { tech, progress, evaluation, remaining };
    })
    .filter((entry) => entry.remaining > 0 && entry.evaluation.passiveScore > 0);
  const totalScore = candidates.reduce((sum, entry) => sum + entry.evaluation.passiveScore, 0);
  if (totalScore <= 0) return false;

  let changed = false;
  for (const entry of candidates) {
    const share = pool * (entry.evaluation.passiveScore / totalScore);
    const gain = Math.min(share, entry.remaining);
    if (gain <= 0) continue;
    entry.progress.passiveProgress += gain;
    entry.progress.totalProgress = Math.min(entry.tech.cost, entry.progress.totalProgress + gain);
    entry.progress.completed = false;
    techState.progressByTechId[entry.tech.id] = entry.progress;
    changed = true;
  }
  return changed;
}

export function getFactionResearchPerHour(ctx: RuntimeContext, factionId: number): number {
  const economy = getFactionEconomy(ctx.state, factionId);
  const base = BASELINE_RESEARCH_PER_HOUR + Math.max(0, (economy?.monthlyDelta.research ?? 0) / GAME_HOURS_PER_MONTH);
  return base * getGovernmentResearchSpeedMultiplier(ctx.state, factionId);
}

export function applyTechnologyResearchForFaction(ctx: RuntimeContext, factionId: number, elapsedHours: number, researchPerHour: number): boolean {
  const techState = getFactionTechnology(ctx.state, factionId);
  if (!techState || elapsedHours <= 0) return false;
  const context = buildResearchContext(ctx, factionId);
  let changed = ensureActiveTechnology(techState);
  const researchPool = Math.max(0, researchPerHour) * elapsedHours;
  const allocation = getGovernmentResearchAllocation(ctx.state, factionId);
  changed = applyActiveResearchPool(techState, context, researchPool * allocation.activeFraction) || changed;
  changed = applyPassiveResearchPool(techState, context, researchPool * allocation.passiveFraction) || changed;
  changed = ensureActiveTechnology(techState) || changed;
  if (changed) {
    ctx.hasDirtyState = true;
  }
  return changed;
}

export function createFactionTechnologyView(ctx: RuntimeContext, factionId: number): FactionTechnologyView {
  const techState = getFactionTechnology(ctx.state, factionId) ?? normalizeFactionTechState(factionId, undefined);
  const context = buildResearchContext(ctx, factionId);
  const researchPerHour = getFactionResearchPerHour(ctx, factionId);
  const allocation = getGovernmentResearchAllocation(ctx.state, factionId);
  return {
    factionId,
    activeTechId: techState.activeTechId,
    completedTechIds: [...techState.completedTechIds],
    researchPerHour,
    activeResearchPerHour: researchPerHour * allocation.activeFraction,
    passiveResearchPerHour: researchPerHour * allocation.passiveFraction,
    technologies: TECHNOLOGY_DEFINITIONS.map((tech) => {
      const progress = techState.progressByTechId[tech.id] ?? createEmptyTechProgress(isTechnologyCompleted(techState, tech.id));
      const missingPrerequisites = getMissingPrerequisites(tech, techState);
      const completed = isTechnologyCompleted(techState, tech.id);
      const available = !completed && missingPrerequisites.length === 0;
      return {
        id: tech.id,
        completed,
        available,
        locked: !completed && !available,
        active: techState.activeTechId === tech.id,
        progress,
        passiveCap: getPassiveProgressCap(tech),
        evaluation: evaluateTechnologyResearch(tech, context),
        missingPrerequisites,
      };
    }),
  };
}

export function getVisibleTechnologyViews(ctx: RuntimeContext, perspective: GalaxyPerspective): FactionTechnologyView[] {
  if (perspective.mode === "faction") return [createFactionTechnologyView(ctx, perspective.factionId)];
  return ctx.state.factions.map((faction) => createFactionTechnologyView(ctx, faction.id));
}

export function isShipDesignUnlockedForFaction(ctx: RuntimeContext, factionId: number, design: ShipDesign): boolean {
  const techState = getFactionTechnology(ctx.state, factionId);
  if (!isUnlockedByAnyRequiredTech(techState, getRequiredTechIdsForShipHull(design.shipKind))) return false;
  for (const sectionModuleId of [...design.weaponSectionModuleIds, ...design.defenseSectionModuleIds]) {
    if (!isUnlockedByAnyRequiredTech(techState, getRequiredTechIdsForShipSection(sectionModuleId))) return false;
  }
  for (const moduleId of [...design.weaponModuleIds, ...design.defenseModuleIds, ...design.utilityModuleIds]) {
    if (!isUnlockedByAnyRequiredTech(techState, getRequiredTechIdsForShipModule(moduleId))) return false;
  }
  return true;
}

export function getShipDesignMissingTechnologyName(ctx: RuntimeContext, factionId: number, design: ShipDesign): string | null {
  const techState = getFactionTechnology(ctx.state, factionId);
  const hullTechs = getRequiredTechIdsForShipHull(design.shipKind);
  if (!isUnlockedByAnyRequiredTech(techState, hullTechs)) return getFirstRequiredTechName(hullTechs);
  for (const sectionModuleId of [...design.weaponSectionModuleIds, ...design.defenseSectionModuleIds]) {
    const required = getRequiredTechIdsForShipSection(sectionModuleId);
    if (!isUnlockedByAnyRequiredTech(techState, required)) return getFirstRequiredTechName(required);
  }
  for (const moduleId of [...design.weaponModuleIds, ...design.defenseModuleIds, ...design.utilityModuleIds]) {
    const required = getRequiredTechIdsForShipModule(moduleId);
    if (!isUnlockedByAnyRequiredTech(techState, required)) return getFirstRequiredTechName(required);
  }
  return null;
}

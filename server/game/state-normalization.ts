// =============================================================================
// State rehydration / normalization — extracted from server/index.ts
//
// Helpers that coerce loosely-typed persisted (or admin-provided) data into the
// canonical runtime shapes — ships, fleets, starbases, faction economies, ship
// designs — plus the membership/ownership sync passes that keep derived state
// consistent. createInitialState / loadState stay in index.ts and call these.
// =============================================================================

import {
  createEmptyResourceCounts,
  addResourceCounts,
  cloneResourceCounts,
  createInitialFactionEconomyState,
  getPlanetBuildingKind,
  getPlanetBuildingLevel,
  sumSpeciesPopulation,
} from "../../src/data/Economy";
import type { BuildingKind, FactionEconomyState, ResourceCounts } from "../../src/data/Economy";
import {
  STARBASE_LEVEL_DEFINITIONS,
  STARBASE_SHIP_KINDS,
  isStarbaseBuildingKind,
  isStarbaseShipKind,
  createEmptyStarbaseSlots,
  calculateStarbaseEconomy,
} from "../../src/data/Starbase";
import type { StarbaseBuildingKind, StarbaseLevel } from "../../src/data/Starbase";
import {
  calculateShipDesignStats,
  createDefaultShipDesign,
  normalizeShipDesign,
} from "../../src/data/ShipDesigns";
import type { ShipDesign } from "../../src/data/ShipDesigns";
import {
  HUMAN_SPECIES_ID,
  normalizeSpeciesState,
  createDefaultSpeciesForFaction,
  createDefaultSpeciesRightsState,
  normalizeSpeciesRightsForLaws,
} from "../../src/data/Species";
import type { FactionSpeciesRightsState, SpeciesId, SpeciesRights, SpeciesState } from "../../src/data/Species";
import {
  getRequiredTechIdsForBuilding,
  getRequiredTechIdsForBuildingLevel,
  getRequiredTechIdsForStarbaseBuilding,
  getRequiredTechIdsForShipHull,
  getRequiredTechIdsForShipSection,
  getRequiredTechIdsForShipModule,
  normalizeFactionTechState,
} from "../../src/data/Technology";
import type { FactionTechState, TechId } from "../../src/data/Technology";
import { normalizeSystemStarbasePosition, getSystemStarbasePosition } from "../../src/data/SystemCoordinates";
import { GAME_START_YEAR, gameYearToMonthIndex, gameYearToHourIndex } from "../../src/game/GameTime";
import type { FactionInfo } from "../../src/data/Factions";
import { getSpeciesLawSelections } from "./state-queries";
import type {
  FleetOrderType,
  ServerFleet,
  ServerShip,
  ServerStarbase,
  ShipTransitPhase,
} from "../../src/game/GameProtocol";
import { getFleetTacticalRadius } from "../../src/game/tacticalFormation";
import { isFleetFormation, normalizeCombatStance } from "./validators";
import { systemCenterPosition, scaleResourceCounts } from "./pure-helpers";
import {
  getShipDefinition,
  resolveShipDesign,
  findShipDesignById,
  getNewestActiveShipDesign,
} from "./ship-designs";
import {
  createFleet,
  createDefaultFleetCombatSettings,
  normalizeFleetRetreatState,
  normalizeFleetTacticalOrder,
  applyShipDesignToShip,
} from "./fleet-factory";
import { phaseDuration, phaseDurationDays } from "./fleet-combat";
import { DEFAULT_SHIP_SPEED } from "./constants";
import type { GameFleet, GameShip, GameState, RuntimeContext } from "./types";

export function normalizeResourceCounts(counts?: Partial<ResourceCounts>): ResourceCounts {
  return {
    ...createEmptyResourceCounts(),
    ...counts,
  };
}

export function normalizeStarbase(starbase: Partial<ServerStarbase> & Pick<ServerStarbase, "id" | "ownerId" | "starId">): ServerStarbase {
  const level = (starbase.level ?? "outpost") as StarbaseLevel;
  const combat = STARBASE_LEVEL_DEFINITIONS[level]?.combat ?? STARBASE_LEVEL_DEFINITIONS.outpost.combat;
  const maxShieldValue = Number(starbase.maxShield);
  const maxArmorValue = Number(starbase.maxArmor);
  const maxHullValue = Number(starbase.maxHull);
  const maxShield = Math.max(0, Number.isFinite(maxShieldValue) ? maxShieldValue : combat.maxShield);
  const maxArmor = Math.max(0, Number.isFinite(maxArmorValue) ? maxArmorValue : combat.maxArmor);
  const maxHull = Math.max(1, Number.isFinite(maxHullValue) ? maxHullValue : combat.maxHull);
  const shieldValue = Number(starbase.shield);
  const armorValue = Number(starbase.armor);
  const hullValue = Number(starbase.hull);
  const buildingSlots = Array.isArray(starbase.buildingSlots)
    ? createEmptyStarbaseSlots().map((_, index) => {
      const building = starbase.buildingSlots?.[index] ?? null;
      return building && isStarbaseBuildingKind(building) ? building : null;
    })
    : createEmptyStarbaseSlots();
  return {
    id: starbase.id,
    ownerId: starbase.ownerId,
    starId: starbase.starId,
    systemPosition: normalizeSystemStarbasePosition(starbase.systemPosition ?? getSystemStarbasePosition()),
    status: starbase.status ?? "online",
    buildProgress: starbase.buildProgress ?? 1,
    shield: Math.max(0, Math.min(maxShield, Number.isFinite(shieldValue) ? shieldValue : maxShield)),
    maxShield,
    armor: Math.max(0, Math.min(maxArmor, Number.isFinite(armorValue) ? armorValue : maxArmor)),
    maxArmor,
    hull: Math.max(0, Math.min(maxHull, Number.isFinite(hullValue) ? hullValue : maxHull)),
    maxHull,
    weaponCooldowns: typeof starbase.weaponCooldowns === "object" && starbase.weaponCooldowns
      ? Object.fromEntries(Object.entries(starbase.weaponCooldowns).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]))
      : {},
    lastShieldDamageAtYear: starbase.lastShieldDamageAtYear ?? null,
    level,
    economy: calculateStarbaseEconomy(level, buildingSlots),
    buildingSlots,
    constructionQueue: Array.isArray(starbase.constructionQueue)
      ? starbase.constructionQueue.map((item) => ({
        ...item,
        cost: normalizeResourceCounts(item.cost),
      }))
      : [],
    shipQueue: Array.isArray(starbase.shipQueue)
      ? starbase.shipQueue
        .filter((item) => item.shipKind && isStarbaseShipKind(item.shipKind))
        .map((item) => {
          const totalDays = Math.max(1, Number(item.totalDays) || 1);
          const cost = normalizeResourceCounts(item.cost);
          const fallbackUpfrontCost = scaleResourceCounts(cost, 0.05);
          const upfrontCost = normalizeResourceCounts(item.upfrontCost ?? fallbackUpfrontCost);
          const fallbackDaily = scaleResourceCounts(addResourceCounts(cost, scaleResourceCounts(upfrontCost, -1)), 1 / totalDays);
          const resourceUpkeepPerDay = normalizeResourceCounts(item.resourceUpkeepPerDay ?? fallbackDaily);
          return {
            ...item,
            kind: item.kind === "upgrade" ? "upgrade" : "build",
            designId: typeof item.designId === "string" ? item.designId : null,
            targetDesignId: typeof item.targetDesignId === "string" ? item.targetDesignId : null,
            shipId: typeof item.shipId === "string" ? item.shipId : null,
            cost,
            upfrontCost,
            resourceUpkeepPerDay,
            remainingDays: Math.max(0, Number(item.remainingDays) || 0),
            totalDays,
            alloyUpkeepPerDay: Math.max(0, Number(item.alloyUpkeepPerDay) || resourceUpkeepPerDay.alloys),
            crewDemand: Math.max(0, Number(item.crewDemand) || 0),
          };
        })
      : [],
  };
}

export function normalizeShip(
  ship: Partial<ServerShip> & { id: string; ownerId: number },
  fallbackFleetId: string,
  shipDesigns: ShipDesign[],
): GameShip {
  const definition = getShipDefinition(ship.shipKind);
  const shipKind = definition.kind;
  const ownerId = Number.isInteger(ship.ownerId) ? ship.ownerId : 0;
  const design = resolveShipDesign(shipDesigns, ownerId, shipKind, ship.designId);
  const explicitTarget = typeof ship.targetDesignId === "string"
    ? findShipDesignById(shipDesigns, ownerId, shipKind, ship.targetDesignId, false)
    : null;
  const fallbackTarget = design.status === "decommissioned"
    ? getNewestActiveShipDesign(shipDesigns, ownerId, shipKind)
    : null;
  const targetDesign = explicitTarget ?? fallbackTarget;
  const stats = calculateShipDesignStats(design);
  const combat = stats.combat;
  const maxHull = Math.max(1, Number(ship.maxHull ?? ship.maxHp) || combat.maxHull);
  const maxShield = Math.max(0, Number(ship.maxShield) || combat.maxShield);
  const maxArmor = Math.max(0, Number(ship.maxArmor) || combat.maxArmor);
  const hull = Math.max(0, Math.min(maxHull, Number(ship.hull ?? ship.hp) || maxHull));
  const shield = Math.max(0, Math.min(maxShield, Number(ship.shield) || maxShield));
  const armor = Math.max(0, Math.min(maxArmor, Number(ship.armor) || maxArmor));
  return {
    id: ship.id,
    ownerId,
    fleetId: ship.fleetId || fallbackFleetId,
    shipKind,
    designId: design.id,
    targetDesignId: targetDesign && targetDesign.id !== design.id ? targetDesign.id : null,
    speed: Math.max(0.05, Number(ship.speed) || stats.speed),
    hp: hull,
    maxHp: maxHull,
    shield,
    maxShield,
    armor,
    maxArmor,
    hull,
    maxHull,
    weaponCooldowns: typeof ship.weaponCooldowns === "object" && ship.weaponCooldowns
      ? Object.fromEntries(Object.entries(ship.weaponCooldowns).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]))
      : {},
  };
}

export function normalizeFleet(
  ctx: RuntimeContext,
  fleet: Partial<ServerFleet> & {
    id: string;
    ownerId: number;
    currentStarId: number;
    phaseElapsedMs?: number;
  },
): GameFleet {
  const currentStarId = Number.isInteger(fleet.currentStarId) ? fleet.currentStarId : 0;
  const phase = (fleet.phase ?? "idle") as ShipTransitPhase;
  const targetStarId = Number.isInteger(fleet.targetStarId) ? Number(fleet.targetStarId) : null;
  const formation = isFleetFormation(fleet.formation) ? fleet.formation : "line";
  const orderType: FleetOrderType = fleet.orderType === "move" || fleet.orderType === "build" || fleet.orderType === "attack" || fleet.orderType === "orbit" || fleet.orderType === "merge" || fleet.orderType === "retreat"
    ? fleet.orderType
    : null;
  const shipIds = Array.isArray(fleet.shipIds) ? fleet.shipIds.filter((id) => typeof id === "string") : [];
  const combatSettings = createDefaultFleetCombatSettings(fleet.combatSettings);
  const systemPosition = fleet.systemPosition ?? systemCenterPosition();
  return {
    id: fleet.id,
    ownerId: Number.isInteger(fleet.ownerId) ? fleet.ownerId : 0,
    shipIds,
    formation,
    currentStarId,
    targetStarId,
    phase,
    phaseStartedAtYear: fleet.phaseStartedAtYear ?? GAME_START_YEAR,
    phaseDurationDays: fleet.phaseDurationDays ?? phaseDurationDays(ctx, phase),
    route: Array.isArray(fleet.route) && fleet.route.length > 0 ? fleet.route : [currentStarId],
    routeIndex: Math.max(0, Number(fleet.routeIndex) || 0),
    phaseProgress: Math.max(0, Math.min(1, Number(fleet.phaseProgress) || 0)),
    phaseElapsedMs: fleet.phaseElapsedMs ?? Math.round((fleet.phaseProgress ?? 0) * phaseDuration(ctx, phase)),
    orderType,
    speed: Math.max(0.05, Number(fleet.speed) || DEFAULT_SHIP_SPEED),
    combatStance: normalizeCombatStance(fleet.combatStance),
    retreatState: normalizeFleetRetreatState(fleet.retreatState),
    systemPosition,
    hyperlanePosition: fleet.hyperlanePosition ?? null,
    movementPlan: fleet.movementPlan ?? null,
    orbitTargetPlanetId: typeof fleet.orbitTargetPlanetId === "string" ? fleet.orbitTargetPlanetId : null,
    orbitOffset: fleet.orbitOffset ?? null,
    orbitTarget: fleet.orbitTarget ?? null,
    mergeTargetFleetId: typeof fleet.mergeTargetFleetId === "string" ? fleet.mergeTargetFleetId : null,
    combatSettings,
    currentTacticalOrder: normalizeFleetTacticalOrder(fleet.currentTacticalOrder),
    tacticalRadius: getFleetTacticalRadius(shipIds.length),
    maxWeaponRange: Math.max(0, Number(fleet.maxWeaponRange) || 0),
    minWeaponRange: Math.max(0, Number(fleet.minWeaponRange) || 0),
    currentTargetId: typeof fleet.currentTargetId === "string" ? fleet.currentTargetId : null,
    currentTargetKind: fleet.currentTargetKind === "fleet" || fleet.currentTargetKind === "starbase" ? fleet.currentTargetKind : null,
    combatStatus: fleet.combatStatus === "maneuvering"
      || fleet.combatStatus === "engaging"
      || fleet.combatStatus === "firing"
      || fleet.combatStatus === "evading"
      || fleet.combatStatus === "retreating"
      || fleet.combatStatus === "destroyed"
      ? fleet.combatStatus
      : "idle",
    lastCombatAtYear: Number.isFinite(fleet.lastCombatAtYear) ? Number(fleet.lastCombatAtYear) : null,
  };
}

export function createLegacyFleetFromShip(ctx: RuntimeContext, ship: Partial<ServerShip> & {
  id: string;
  ownerId: number;
  currentStarId?: number;
  targetStarId?: number | null;
  phase?: ShipTransitPhase;
  phaseStartedAtYear?: number;
  phaseDurationDays?: number;
  route?: number[];
  routeIndex?: number;
  phaseProgress?: number;
  phaseElapsedMs?: number;
  orderType?: FleetOrderType;
  systemPosition?: ReturnType<typeof systemCenterPosition>;
  hyperlanePosition?: ServerFleet["hyperlanePosition"];
}): GameFleet {
  const currentStarId = Number.isInteger(ship.currentStarId) ? ship.currentStarId! : 0;
  return normalizeFleet(ctx, {
    id: ship.fleetId || ship.id.replace(/^ship/, "fleet"),
    ownerId: Number.isInteger(ship.ownerId) ? ship.ownerId : 0,
    shipIds: [ship.id],
    formation: "line",
    currentStarId,
    targetStarId: Number.isInteger(ship.targetStarId) ? ship.targetStarId! : null,
    phase: ship.phase ?? "idle",
    phaseStartedAtYear: ship.phaseStartedAtYear ?? GAME_START_YEAR,
    phaseDurationDays: ship.phaseDurationDays ?? phaseDurationDays(ctx, ship.phase ?? "idle"),
    route: ship.route ?? [currentStarId],
    routeIndex: ship.routeIndex ?? 0,
    phaseProgress: ship.phaseProgress ?? 0,
    phaseElapsedMs: ship.phaseElapsedMs,
    orderType: ship.orderType ?? null,
    systemPosition: ship.systemPosition ?? systemCenterPosition(),
    hyperlanePosition: ship.hyperlanePosition ?? null,
  });
}

export function syncFleetMembership(ctx: RuntimeContext, nextState: GameState): boolean {
  let changed = false;
  const fleetsById = new Map(nextState.fleets.map((fleet) => [fleet.id, fleet]));
  const shipsByFleet = new Map<string, GameShip[]>();

  for (const ship of nextState.ships) {
    let fleet = fleetsById.get(ship.fleetId);
    if (!fleet) {
      const ownerHomeStarId = nextState.factions.find((faction) => faction.id === ship.ownerId)?.homeStarId ?? 0;
      fleet = createFleet(ctx, ship.ownerId, ownerHomeStarId, [], ship.fleetId);
      nextState.fleets.push(fleet);
      fleetsById.set(fleet.id, fleet);
      changed = true;
    }
    if (fleet.ownerId !== ship.ownerId) {
      ship.ownerId = fleet.ownerId;
      changed = true;
    }
    const ships = shipsByFleet.get(ship.fleetId) ?? [];
    ships.push(ship);
    shipsByFleet.set(ship.fleetId, ships);
  }

  nextState.fleets = nextState.fleets.filter((fleet) => {
    const ships = shipsByFleet.get(fleet.id) ?? [];
    if (ships.length === 0) {
      changed = true;
      return false;
    }
    const shipIds = ships.map((ship) => ship.id);
    if (
      shipIds.length !== fleet.shipIds.length
      || shipIds.some((id, index) => id !== fleet.shipIds[index])
    ) {
      fleet.shipIds = shipIds;
      changed = true;
    }
    const nextSpeed = Math.min(...ships.map((ship) => Math.max(0.05, ship.speed)));
    if (Math.abs(fleet.speed - nextSpeed) > 0.0001) {
      fleet.speed = nextSpeed;
      changed = true;
    }
    return true;
  });

  return changed;
}

export function syncSystemOwnershipFromStarbases(nextState: GameState): boolean {
  const ownerByStar = new Array(nextState.stars.length).fill(-1);
  for (const starbase of nextState.starbases) {
    if (!Number.isInteger(starbase.starId) || starbase.starId < 0 || starbase.starId >= ownerByStar.length) continue;
    ownerByStar[starbase.starId] = starbase.ownerId;
  }

  let changed = nextState.starOwnership.length !== ownerByStar.length;
  for (let starId = 0; starId < ownerByStar.length; starId += 1) {
    if ((nextState.starOwnership[starId] ?? -1) !== ownerByStar[starId]) {
      changed = true;
      break;
    }
  }
  if (changed) {
    nextState.starOwnership = ownerByStar;
  }
  return changed;
}

export function fleetHasConstructionShip(ctx: RuntimeContext, fleet: Pick<GameFleet, "shipIds">): boolean {
  const shipIds = new Set(fleet.shipIds);
  return ctx.state.ships.some((ship) => shipIds.has(ship.id) && ship.shipKind === "constructionShip" && ship.hull > 0);
}

export function getFleetColonizationShip(ctx: RuntimeContext, fleet: Pick<GameFleet, "shipIds">): GameShip | null {
  const shipIds = new Set(fleet.shipIds);
  return ctx.state.ships.find((ship) => shipIds.has(ship.id) && ship.shipKind === "colonizationShip" && ship.hull > 0) ?? null;
}

export function syncShipsForDesign(ctx: RuntimeContext, nextState: GameState, design: ShipDesign): boolean {
  let changed = false;
  for (const ship of nextState.ships) {
    if (ship.designId !== design.id) continue;
    applyShipDesignToShip(ship, design);
    changed = true;
  }
  if (changed) syncFleetMembership(ctx, nextState);
  return changed;
}

export function normalizeFactionEconomies(
  nextState: Omit<GameState, "factionEconomies"> & { factionEconomies?: FactionEconomyState[] },
): FactionEconomyState[] {
  const byFaction = new Map((nextState.factionEconomies ?? []).map((economy) => [economy.factionId, economy]));
  const month = gameYearToMonthIndex(nextState.clock.year);
  return nextState.factions.map((faction) => {
    const existing = byFaction.get(faction.id);
    const economy = existing ?? createInitialFactionEconomyState(faction.id, month);
    return {
      factionId: faction.id,
      stockpiles: existing?.stockpiles ? cloneResourceCounts(normalizeResourceCounts(existing.stockpiles)) : economy.stockpiles,
      monthlyDelta: existing?.monthlyDelta ? cloneResourceCounts(normalizeResourceCounts(existing.monthlyDelta)) : economy.monthlyDelta,
      lastProcessedMonth: existing?.lastProcessedMonth ?? month,
      lastProcessedHour: existing?.lastProcessedHour ?? gameYearToHourIndex(nextState.clock.year),
    };
  });
}

export function uniqueShipDesignId(baseId: string, usedIds: Set<string>): string {
  if (!usedIds.has(baseId)) return baseId;
  let index = 2;
  while (usedIds.has(`${baseId}-${index}`)) index += 1;
  return `${baseId}-${index}`;
}

export function normalizeShipDesignsForFactions(
  factions: FactionInfo[],
  rawDesigns: unknown,
  year = GAME_START_YEAR,
): ShipDesign[] {
  const factionIds = new Set(factions.map((faction) => faction.id));
  const usedIds = new Set<string>();
  const designs: ShipDesign[] = [];
  if (Array.isArray(rawDesigns)) {
    for (const raw of rawDesigns) {
      const partial = raw as Partial<ShipDesign>;
      const ownerId = Number.isInteger(partial.ownerId) ? Number(partial.ownerId) : NaN;
      if (!factionIds.has(ownerId)) continue;
      const normalized = normalizeShipDesign(partial, ownerId, year);
      normalized.id = uniqueShipDesignId(normalized.id, usedIds);
      usedIds.add(normalized.id);
      designs.push(normalized);
    }
  }

  for (const faction of factions) {
    for (const shipKind of STARBASE_SHIP_KINDS) {
      const hasActive = designs.some((design) => (
        design.ownerId === faction.id
        && design.shipKind === shipKind
        && design.status === "active"
      ));
      if (hasActive) continue;
      const fallback = createDefaultShipDesign(faction.id, shipKind, year);
      fallback.id = uniqueShipDesignId(fallback.id, usedIds);
      usedIds.add(fallback.id);
      designs.push(fallback);
    }
  }
  return designs;
}

// ---------------------------------------------------------------------------
// Species founding + faction technology inference (load / init setup)
// ---------------------------------------------------------------------------

export function getFactionFoundingSpeciesId(factionId: number): SpeciesId {
  return `species-faction-${factionId}`;
}

export function getFallbackHumanSpecies(): SpeciesState {
  return {
    id: HUMAN_SPECIES_ID,
    name: "Human",
    archetypeId: "humanoid",
    traitIds: [],
    originFactionId: null,
  };
}

export function ensureFactionFoundingSpeciesIds(factions: FactionInfo[]): boolean {
  let changed = false;
  for (const faction of factions) {
    const expected = getFactionFoundingSpeciesId(faction.id);
    if (faction.foundingSpeciesId === expected) continue;
    faction.foundingSpeciesId = expected;
    changed = true;
  }
  return changed;
}

export function normalizeSpeciesForFactions(factions: FactionInfo[], rawSpecies: unknown): SpeciesState[] {
  ensureFactionFoundingSpeciesIds(factions);
  const rawById = new Map<string, Partial<SpeciesState>>();
  if (Array.isArray(rawSpecies)) {
    for (const raw of rawSpecies) {
      const candidate = raw as Partial<SpeciesState>;
      if (typeof candidate?.id !== "string" || !candidate.id.trim()) continue;
      rawById.set(candidate.id.trim(), candidate);
    }
  }

  const usedIds = new Set<SpeciesId>();
  const species: SpeciesState[] = [];
  const human = normalizeSpeciesState(rawById.get(HUMAN_SPECIES_ID), getFallbackHumanSpecies());
  species.push(human);
  usedIds.add(human.id);

  for (const faction of factions) {
    const fallback = createDefaultSpeciesForFaction(faction.id, faction.name);
    const normalized = normalizeSpeciesState(rawById.get(fallback.id), fallback);
    normalized.id = fallback.id;
    normalized.originFactionId = faction.id;
    faction.foundingSpeciesId = normalized.id;
    if (usedIds.has(normalized.id)) continue;
    usedIds.add(normalized.id);
    species.push(normalized);
  }

  for (const [speciesId, raw] of rawById) {
    if (usedIds.has(speciesId)) continue;
    const fallback: SpeciesState = {
      id: speciesId,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name : speciesId,
      archetypeId: "humanoid",
      traitIds: [],
      originFactionId: Number.isInteger(raw.originFactionId) ? Number(raw.originFactionId) : null,
    };
    const normalized = normalizeSpeciesState(raw, fallback);
    usedIds.add(normalized.id);
    species.push(normalized);
  }

  return species;
}

export function normalizeSpeciesRightsForFactions(nextState: GameState, rawRights: unknown = nextState.speciesRights): FactionSpeciesRightsState[] {
  const rawByFaction = new Map<number, FactionSpeciesRightsState>();
  if (Array.isArray(rawRights)) {
    for (const raw of rawRights) {
      const candidate = raw as Partial<FactionSpeciesRightsState>;
      if (!Number.isInteger(candidate?.factionId)) continue;
      rawByFaction.set(Number(candidate.factionId), {
        factionId: Number(candidate.factionId),
        rightsBySpeciesId: candidate.rightsBySpeciesId ?? {},
      });
    }
  }
  const speciesIds = nextState.species.map((species) => species.id);
  return nextState.factions.map((faction) => {
    const existing = rawByFaction.get(faction.id) ?? createDefaultSpeciesRightsState(faction.id, speciesIds);
    const laws = getSpeciesLawSelections(nextState, faction.id);
    const rightsBySpeciesId: Record<SpeciesId, SpeciesRights> = {};
    for (const speciesId of speciesIds) {
      rightsBySpeciesId[speciesId] = normalizeSpeciesRightsForLaws(existing.rightsBySpeciesId?.[speciesId], laws);
    }
    return { factionId: faction.id, rightsBySpeciesId };
  });
}

export function assignFoundingSpeciesToOwnedPops(nextState: GameState): boolean {
  let changed = false;
  const factionById = new Map(nextState.factions.map((faction) => [faction.id, faction]));
  nextState.planetStates = nextState.planetStates.map((planetState) => {
    if (!planetState.isHabited) return planetState;
    const ownerId = planetState.ownerId ?? -1;
    const faction = factionById.get(ownerId);
    const foundingSpeciesId = faction?.foundingSpeciesId ?? (faction ? getFactionFoundingSpeciesId(faction.id) : null);
    if (!foundingSpeciesId) return planetState;

    const source = planetState.speciesPopulations?.length
      ? planetState.speciesPopulations
      : planetState.population > 0
        ? [{ speciesId: foundingSpeciesId, population: planetState.population }]
        : [];
    const bySpecies = new Map<SpeciesId, number>();
    for (const entry of source) {
      const nextSpeciesId = entry.speciesId === HUMAN_SPECIES_ID ? foundingSpeciesId : entry.speciesId;
      if (nextSpeciesId !== entry.speciesId) changed = true;
      bySpecies.set(nextSpeciesId, (bySpecies.get(nextSpeciesId) ?? 0) + Math.max(0, Math.floor(entry.population)));
    }
    const speciesPopulations = Array.from(bySpecies.entries())
      .filter(([, population]) => population > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([speciesId, population]) => ({ speciesId, population }));
    const population = sumSpeciesPopulation(speciesPopulations);
    if (population !== planetState.population || JSON.stringify(speciesPopulations) !== JSON.stringify(planetState.speciesPopulations ?? [])) {
      changed = true;
      return { ...planetState, population, speciesPopulations };
    }
    return planetState;
  });
  return changed;
}

function addInferredTechIdsFromBuilding(techIds: Set<TechId>, buildingKind: BuildingKind, level = 1): void {
  for (const techId of getRequiredTechIdsForBuilding(buildingKind)) techIds.add(techId);
  for (let buildingLevel = 2; buildingLevel <= level; buildingLevel += 1) {
    for (const techId of getRequiredTechIdsForBuildingLevel(buildingKind, buildingLevel)) techIds.add(techId);
  }
}

function addInferredTechIdsFromStarbaseBuilding(techIds: Set<TechId>, buildingKind: StarbaseBuildingKind): void {
  for (const techId of getRequiredTechIdsForStarbaseBuilding(buildingKind)) techIds.add(techId);
}

function addInferredTechIdsFromShipDesign(techIds: Set<TechId>, design: ShipDesign): void {
  for (const techId of getRequiredTechIdsForShipHull(design.shipKind)) techIds.add(techId);
  for (const moduleId of design.weaponSectionModuleIds) {
    for (const techId of getRequiredTechIdsForShipSection(moduleId)) techIds.add(techId);
  }
  for (const moduleId of design.defenseSectionModuleIds) {
    for (const techId of getRequiredTechIdsForShipSection(moduleId)) techIds.add(techId);
  }
  for (const moduleId of [...design.weaponModuleIds, ...design.defenseModuleIds, ...design.utilityModuleIds]) {
    for (const techId of getRequiredTechIdsForShipModule(moduleId)) techIds.add(techId);
  }
}

export function inferCompletedTechIdsFromExistingAssets(nextState: GameState, factionId: number): TechId[] {
  const techIds = new Set<TechId>();
  for (const planetState of nextState.planetStates) {
    if (planetState.ownerId !== factionId) continue;
    for (const building of Object.values(planetState.buildings).flat()) {
      const buildingKind = getPlanetBuildingKind(building);
      if (buildingKind) addInferredTechIdsFromBuilding(techIds, buildingKind, getPlanetBuildingLevel(building));
    }
    for (const subDistrict of planetState.urbanSubDistricts) {
      for (const building of subDistrict.buildings) {
        const buildingKind = getPlanetBuildingKind(building);
        if (buildingKind) addInferredTechIdsFromBuilding(techIds, buildingKind, getPlanetBuildingLevel(building));
      }
    }
    for (const queued of planetState.constructionQueue) {
      if (queued.buildingKind) addInferredTechIdsFromBuilding(techIds, queued.buildingKind);
    }
  }
  for (const starbase of nextState.starbases) {
    if (starbase.ownerId !== factionId) continue;
    for (const buildingKind of starbase.buildingSlots) {
      if (buildingKind) addInferredTechIdsFromStarbaseBuilding(techIds, buildingKind);
    }
    for (const queued of starbase.constructionQueue) {
      if (queued.buildingKind) addInferredTechIdsFromStarbaseBuilding(techIds, queued.buildingKind);
    }
  }
  for (const design of nextState.shipDesigns) {
    if (design.ownerId === factionId) addInferredTechIdsFromShipDesign(techIds, design);
  }
  return Array.from(techIds);
}

export function normalizeFactionTechnologies(nextState: Omit<GameState, "factionTechnologies"> & { factionTechnologies?: FactionTechState[] }): FactionTechState[] {
  const byFaction = new Map((nextState.factionTechnologies ?? []).map((techState) => [techState.factionId, techState]));
  return nextState.factions.map((faction) => {
    const raw = byFaction.get(faction.id);
    const inferred = inferCompletedTechIdsFromExistingAssets(nextState as GameState, faction.id);
    return normalizeFactionTechState(faction.id, raw, inferred);
  });
}

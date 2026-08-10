import {
  ARMY_MANPOWER,
  ARMY_TYPE_DEFINITIONS,
  GARRISONS_PER_FORTRESS,
  GROUND_WITHDRAWAL_DAYS,
  MOBILE_ARMY_TYPE_IDS,
  SOLDIERS_PER_GARRISON,
  calculateGroundDailyLoss,
  createArmyUnit,
  getArmyCurrentPower,
  getArmyHabitabilityMultiplier,
  getArmyMaxHp,
  getPlanetCombatWidth,
  selectStrongestArmyIds,
} from "../../src/data/Armies";
import type { ArmyTypeId, ArmyUnit, GroundBattleState, LandedArmyTransport } from "../../src/data/Armies";
import {
  getEffectiveSpeciesHabitability,
  getPlanetBuildingKind,
  isPlanetBuildingEnabled,
  recalculatePlanetStateEconomy,
} from "../../src/data/Economy";
import type { PlanetState } from "../../src/data/Economy";
import type { StarbaseShipQueueItem } from "../../src/data/Starbase";
import { areFactionsAtWar, getBorderPolicy } from "../../src/data/Diplomacy";
import { GAME_DAYS_PER_YEAR } from "../../src/game/GameTime";
import type { ServerFleet, ServerShip, ShipSystemPosition } from "../../src/game/GameProtocol";
import { createFleet, createShip } from "./fleet-factory";
import { startOrbitOrder } from "./fleet-combat";
import {
  getFactionEconomy,
  getGroundLeaderEffects,
  getPlanetDistrictLimitsFromState,
  getPlanetSpeciesContext,
  getPlanetTechnologyModifiers,
} from "./state-queries";
import type { GameFleet, GameShip, GameState, RuntimeContext } from "./types";

const EPSILON = 0.000001;

export function isArmyFleet(state: GameState, fleet: Pick<ServerFleet, "shipIds">): boolean {
  if (fleet.shipIds.length === 0) return false;
  const ids = new Set(fleet.shipIds);
  const ships = state.ships.filter((ship) => ids.has(ship.id));
  return ships.length === fleet.shipIds.length && ships.every((ship) => ship.shipKind === "armyShip" && typeof ship.armyUnitId === "string");
}

export function getArmySpeciesPopulation(state: GameState, factionId: number, speciesId: string): number {
  return state.planetStates
    .filter((planet) => planet.isHabited && planet.ownerId === factionId)
    .flatMap((planet) => planet.speciesPopulations)
    .filter((entry) => entry.speciesId === speciesId)
    .reduce((total, entry) => total + entry.population, 0);
}

export function getArmyRecruitmentCap(state: GameState, factionId: number, speciesId: string): { used: number; cap: number } {
  const existing = state.armies.filter((army) => army.ownerId === factionId && army.speciesId === speciesId && army.mobility === "mobile").length;
  const queued = [
    ...state.starbases.filter((yard) => yard.ownerId === factionId).flatMap((yard) => yard.shipQueue),
    ...state.planetStates.filter((yard) => yard.ownerId === factionId).flatMap((yard) => yard.defense.shipQueue),
  ].filter((item) => item.kind === "armyBuild" && item.speciesId === speciesId).length;
  return {
    used: existing + queued,
    cap: Math.floor(getArmySpeciesPopulation(state, factionId, speciesId) / 100_000_000),
  };
}

export function getArmyPowerAtPlanet(state: GameState, planet: PlanetState, ownerId?: number): number {
  return state.armies
    .filter((army) => army.location.kind === "planet" && army.location.planetId === planet.id && (ownerId === undefined || army.ownerId === ownerId))
    .reduce((total, army) => total + getEffectiveArmyPower(state, planet, army, false).nominal, 0);
}

export function getEffectiveArmyPower(
  state: GameState,
  planet: PlanetState,
  army: ArmyUnit,
  attacking: boolean,
  battle?: GroundBattleState | null,
) {
  const species = state.species.find((candidate) => candidate.id === army.speciesId);
  const habitability = getEffectiveSpeciesHabitability(planet, army.speciesId, getPlanetSpeciesContext(state, planet));
  const leader = attacking && battle
    ? getGroundLeaderEffects(state, "groundBattle", battle.id, false)
    : getGroundLeaderEffects(state, "planetMilitary", planet.id, true);
  return getArmyCurrentPower(army, {
    habitabilityMultiplier: getArmyHabitabilityMultiplier(habitability),
    attackMultiplier: leader.attackMultiplier,
    defenseMultiplier: leader.defenseMultiplier,
  });
}

function transportFromShip(ship: GameShip): LandedArmyTransport {
  return {
    id: ship.id,
    designId: ship.designId,
    speed: ship.speed,
    hp: ship.hp,
    maxHp: ship.maxHp,
    shield: ship.shield,
    maxShield: ship.maxShield,
    armor: ship.armor,
    maxArmor: ship.maxArmor,
    hull: ship.hull,
    maxHull: ship.maxHull,
    weaponCooldowns: { ...(ship.weaponCooldowns ?? {}) },
    weaponReadyAtYears: { ...(ship.weaponReadyAtYears ?? {}) },
    lastShieldDamageAtYear: ship.lastShieldDamageAtYear,
    disabled: ship.disabled,
    crew: ship.crew,
    crewCapacity: ship.crewCapacity,
    subsystemState: ship.subsystemState ? {
      disabledWeaponKeys: [...ship.subsystemState.disabledWeaponKeys],
      engineDisabled: ship.subsystemState.engineDisabled,
      emergencyMobility: ship.subsystemState.emergencyMobility,
    } : undefined,
  };
}

function shipFromTransport(ctx: RuntimeContext, ownerId: number, fleetId: string, army: ArmyUnit): GameShip {
  const stored = army.landedTransport;
  const ship = createShip(ctx, ownerId, fleetId, "armyShip", stored?.id ?? army.transportShipId ?? ctx.createRuntimeId("army-ship", [ownerId, army.id]), stored?.designId);
  if (stored) {
    Object.assign(ship, {
      id: stored.id,
      speed: stored.speed,
      hp: stored.hp,
      maxHp: stored.maxHp,
      shield: stored.shield,
      maxShield: stored.maxShield,
      armor: stored.armor,
      maxArmor: stored.maxArmor,
      hull: stored.hull,
      maxHull: stored.maxHull,
      weaponCooldowns: { ...(stored.weaponCooldowns ?? {}) },
      weaponReadyAtYears: { ...(stored.weaponReadyAtYears ?? {}) },
      lastShieldDamageAtYear: stored.lastShieldDamageAtYear ?? null,
      disabled: stored.disabled === true,
      crew: stored.crew,
      crewCapacity: stored.crewCapacity,
      subsystemState: stored.subsystemState ? {
        disabledWeaponKeys: [...stored.subsystemState.disabledWeaponKeys],
        engineDisabled: stored.subsystemState.engineDisabled,
        emergencyMobility: stored.subsystemState.emergencyMobility,
      } : ship.subsystemState,
    });
  }
  ship.fleetId = fleetId;
  ship.ownerId = ownerId;
  ship.armyUnitId = army.id;
  return ship;
}

export function spawnCompletedArmy(
  ctx: RuntimeContext,
  ownerId: number,
  starId: number,
  item: Pick<StarbaseShipQueueItem, "armyTypeId" | "speciesId">,
  orbitPlanetId?: string,
  systemPosition?: ShipSystemPosition,
): ArmyUnit | null {
  if (!item.armyTypeId || !MOBILE_ARMY_TYPE_IDS.includes(item.armyTypeId) || !item.speciesId) return null;
  const fleetId = ctx.createRuntimeId("army-fleet", [ownerId, starId]);
  const shipId = ctx.createRuntimeId("army-ship", [ownerId, item.armyTypeId, item.speciesId]);
  const armyId = ctx.createRuntimeId("army", [ownerId, item.armyTypeId, item.speciesId]);
  const traits = ctx.state.species.find((species) => species.id === item.speciesId)?.traitIds ?? [];
  const army = createArmyUnit({
    id: armyId,
    ownerId,
    speciesId: item.speciesId,
    typeId: item.armyTypeId,
    location: { kind: "fleet", fleetId },
    speciesTraitIds: traits,
    transportShipId: shipId,
  });
  const ship = createShip(ctx, ownerId, fleetId, "armyShip", shipId);
  ship.armyUnitId = army.id;
  const fleet = createFleet(ctx, ownerId, starId, [ship.id], fleetId);
  fleet.combatSettings.engagementRule = "avoid";
  fleet.speed = ship.speed;
  fleet.phaseStartedAtYear = ctx.state.clock.year;
  if (systemPosition) fleet.systemPosition = { ...systemPosition };
  ctx.state.armies.push(army);
  ctx.state.ships.push(ship);
  ctx.state.fleets.push(fleet);
  if (orbitPlanetId) startOrbitOrder(ctx, fleet, orbitPlanetId);
  return army;
}

function transferFleetCommander(state: GameState, fleetId: string, targetKind: "planetMilitary" | "groundBattle", targetId: string, preserveExisting: boolean): void {
  const commander = state.leaders.find((leader) => leader.status !== "dead" && leader.assignment?.kind === "fleet" && leader.assignment.targetId === fleetId);
  if (!commander) return;
  if (preserveExisting && state.leaders.some((leader) => leader.status !== "dead" && leader.assignment?.kind === targetKind && leader.assignment.targetId === targetId)) {
    commander.assignment = null;
    return;
  }
  commander.assignment = { kind: targetKind, targetId };
}

export function landArmyFleet(ctx: RuntimeContext, fleet: GameFleet, planet: PlanetState, targetBattle?: GroundBattleState): ArmyUnit[] {
  if (!isArmyFleet(ctx.state, fleet)) throw new Error("Only a pure Army Fleet can land.");
  const shipIds = new Set(fleet.shipIds);
  const ships = ctx.state.ships.filter((ship) => shipIds.has(ship.id));
  const landed: ArmyUnit[] = [];
  for (const ship of ships) {
    const army = ctx.state.armies.find((candidate) => candidate.id === ship.armyUnitId && candidate.location.kind === "fleet" && candidate.location.fleetId === fleet.id);
    if (!army) throw new Error("Army transport is missing its persistent unit.");
    army.location = { kind: "planet", planetId: planet.id };
    army.landedTransport = transportFromShip(ship);
    army.transportShipId = ship.id;
    landed.push(army);
  }
  if (targetBattle) {
    transferFleetCommander(ctx.state, fleet.id, "groundBattle", targetBattle.id, true);
  } else {
    transferFleetCommander(ctx.state, fleet.id, "planetMilitary", planet.id, true);
  }
  ctx.state.ships = ctx.state.ships.filter((ship) => !shipIds.has(ship.id));
  ctx.state.fleets = ctx.state.fleets.filter((candidate) => candidate.id !== fleet.id);
  return landed;
}

export function embarkPlanetArmies(
  ctx: RuntimeContext,
  planet: PlanetState,
  armyIds: readonly string[],
  ownerId: number,
  embarkCommander: boolean,
): GameFleet {
  const selected = [...new Set(armyIds)].map((id) => ctx.state.armies.find((army) => army.id === id)).filter((army): army is ArmyUnit => Boolean(army));
  if (selected.length === 0) throw new Error("Select at least one mobile army.");
  if (selected.some((army) => army.ownerId !== ownerId || army.mobility !== "mobile" || army.location.kind !== "planet" || army.location.planetId !== planet.id)) {
    throw new Error("One or more selected armies cannot embark.");
  }
  if (ctx.state.groundBattles.some((battle) => battle.planetId === planet.id)) throw new Error("Armies cannot embark during a ground battle.");
  const fleetId = ctx.createRuntimeId("army-fleet", [ownerId, planet.starId]);
  const ships = selected.map((army) => shipFromTransport(ctx, ownerId, fleetId, army));
  const fleet = createFleet(ctx, ownerId, planet.starId, ships.map((ship) => ship.id), fleetId);
  fleet.combatSettings.engagementRule = "avoid";
  fleet.speed = Math.min(...ships.map((ship) => ship.speed));
  fleet.phaseStartedAtYear = ctx.state.clock.year;
  for (const army of selected) {
    army.location = { kind: "fleet", fleetId };
    army.landedTransport = null;
  }
  ctx.state.ships.push(...ships);
  ctx.state.fleets.push(fleet);
  startOrbitOrder(ctx, fleet, planet.id);
  if (embarkCommander) {
    const commander = ctx.state.leaders.find((leader) => leader.status !== "dead" && leader.assignment?.kind === "planetMilitary" && leader.assignment.targetId === planet.id);
    if (commander) commander.assignment = { kind: "fleet", targetId: fleet.id };
  }
  return fleet;
}

function isArmedNavalFleet(state: GameState, fleet: GameFleet): boolean {
  if (isArmyFleet(state, fleet)) return false;
  return fleet.shipIds.some((id) => {
    const ship = state.ships.find((candidate) => candidate.id === id);
    return ship && ship.shipKind !== "scienceShip" && ship.shipKind !== "constructionShip" && ship.shipKind !== "colonizationShip" && ship.shipKind !== "armyShip" && ship.hull > 0;
  });
}

export function getInvasionBlocker(state: GameState, fleet: GameFleet, planet: PlanetState): string | null {
  const hostile = state.fleets.find((candidate) => candidate.ownerId !== fleet.ownerId
    && areFactionsAtWar(state.diplomacy, fleet.ownerId, candidate.ownerId)
    && candidate.currentStarId === planet.starId
    && (candidate.stationaryPlanetId === planet.id || candidate.orbitTarget?.kind === "planet" && candidate.orbitTarget.planetId === planet.id)
    && isArmedNavalFleet(state, candidate));
  return hostile ? "Hostile naval forces or planetary platforms control this planet's orbit." : null;
}

export function beginPlanetInvasion(ctx: RuntimeContext, fleet: GameFleet, planet: PlanetState): GroundBattleState {
  if (planet.ownerId === null || !planet.isHabited) throw new Error("Only an inhabited enemy planet can be invaded.");
  if (!areFactionsAtWar(ctx.state.diplomacy, fleet.ownerId, planet.ownerId)) throw new Error("You must be at war with the planet owner.");
  if (fleet.orbitTarget?.kind !== "planet" || fleet.orbitTarget.planetId !== planet.id || fleet.phase !== "orbitingPlanet") throw new Error("Army Fleet must be orbiting the target planet.");
  const blocker = getInvasionBlocker(ctx.state, fleet, planet);
  if (blocker) throw new Error(blocker);
  let battle = ctx.state.groundBattles.find((candidate) => candidate.planetId === planet.id);
  if (battle && battle.attackerFactionId !== fleet.ownerId) throw new Error("Another faction is already invading this planet.");
  if (!battle) {
    battle = {
      id: ctx.createRuntimeId("ground-battle", [planet.id, fleet.ownerId]),
      planetId: planet.id,
      attackerFactionId: fleet.ownerId,
      defenderFactionId: planet.ownerId,
      attackerArmyIds: [],
      defenderArmyIds: ctx.state.armies.filter((army) => army.ownerId === planet.ownerId && army.location.kind === "planet" && army.location.planetId === planet.id && army.hp > 0 && army.manpower > 0 && army.supported !== false).map((army) => army.id),
      startedAtYear: ctx.state.clock.year,
      lastProcessedDay: Math.floor(ctx.state.clock.year * GAME_DAYS_PER_YEAR),
      withdrawalRequestedAtYear: null,
      withdrawalDueYear: null,
    };
    ctx.state.groundBattles.push(battle);
  }
  const landed = landArmyFleet(ctx, fleet, planet, battle);
  battle.attackerArmyIds.push(...landed.map((army) => army.id));
  return battle;
}

export function reinforceOwnedPlanet(ctx: RuntimeContext, fleet: GameFleet, planet: PlanetState): ArmyUnit[] {
  if (planet.ownerId !== fleet.ownerId) throw new Error("Friendly landing is limited to owned planets.");
  const battle = ctx.state.groundBattles.find((candidate) => candidate.planetId === planet.id);
  const landed = landArmyFleet(ctx, fleet, planet);
  if (battle) battle.defenderArmyIds.push(...landed.map((army) => army.id));
  return landed;
}

export function requestGroundWithdrawal(state: GameState, battle: GroundBattleState): void {
  if (battle.withdrawalRequestedAtYear !== null && battle.withdrawalRequestedAtYear !== undefined) return;
  battle.withdrawalRequestedAtYear = state.clock.year;
  battle.withdrawalDueYear = state.clock.year + GROUND_WITHDRAWAL_DAYS / GAME_DAYS_PER_YEAR;
}

function fortressKeys(planet: PlanetState): string[] {
  const keys: string[] = [];
  for (const [area, buildings] of Object.entries(planet.buildings)) {
    buildings.forEach((building, index) => {
      if (getPlanetBuildingKind(building) === "fortress" && isPlanetBuildingEnabled(building)) keys.push(`${area}:${index}`);
    });
  }
  planet.urbanSubDistricts.forEach((district, districtIndex) => district.buildings.forEach((building, buildingIndex) => {
    if (getPlanetBuildingKind(building) === "fortress" && isPlanetBuildingEnabled(building)) keys.push(`urban:${districtIndex}:${buildingIndex}`);
  }));
  return keys.sort();
}

function supportedGarrisonSpecies(planet: PlanetState, count: number): string[] {
  const soldiers = planet.economy.popGroups.filter((group) => group.job === "soldier" && group.population > 0).sort((a, b) => a.speciesId.localeCompare(b.speciesId));
  const total = soldiers.reduce((sum, group) => sum + group.population, 0);
  if (total <= 0 || count <= 0) return [];
  const exact = soldiers.map((group) => ({ speciesId: group.speciesId, exact: count * group.population / total }));
  const allocation = exact.map((entry) => ({ ...entry, value: Math.floor(entry.exact) }));
  let remaining = count - allocation.reduce((sum, entry) => sum + entry.value, 0);
  allocation.sort((a, b) => (b.exact - b.value) - (a.exact - a.value) || a.speciesId.localeCompare(b.speciesId));
  for (let i = 0; i < allocation.length && remaining > 0; i += 1, remaining -= 1) allocation[i].value += 1;
  return allocation.sort((a, b) => a.speciesId.localeCompare(b.speciesId)).flatMap((entry) => Array.from({ length: entry.value }, () => entry.speciesId));
}

export function syncPlanetGarrisons(ctx: RuntimeContext): boolean {
  let changed = false;
  for (const planet of ctx.state.planetStates) {
    if (!planet.isHabited || planet.ownerId === null) continue;
    const fortresses = fortressKeys(planet);
    const validSources = new Set(fortresses.flatMap((key) => Array.from({ length: GARRISONS_PER_FORTRESS }, (_, slot) => `${key}:${slot}`)));
    const soldierTotal = planet.economy.popGroups.filter((group) => group.job === "soldier").reduce((sum, group) => sum + group.population, 0);
    const supportedCount = Math.min(validSources.size, Math.floor(soldierTotal / SOLDIERS_PER_GARRISON));
    const species = supportedGarrisonSpecies(planet, supportedCount);
    const sources = [...validSources].sort();
    const existing = ctx.state.armies.filter((army) => army.typeId === "garrison" && army.location.kind === "planet" && army.location.planetId === planet.id);
    for (const army of existing) {
      if (army.sourceFortressKey && validSources.has(army.sourceFortressKey)) continue;
      ctx.state.armies = ctx.state.armies.filter((candidate) => candidate.id !== army.id);
      changed = true;
    }
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      let army = ctx.state.armies.find((candidate) => candidate.typeId === "garrison" && candidate.location.kind === "planet" && candidate.location.planetId === planet.id && candidate.sourceFortressKey === source);
      const supported = index < supportedCount;
      if (!army && supported) {
        const speciesId = species[index] ?? planet.speciesPopulations.slice().sort((a, b) => b.population - a.population || a.speciesId.localeCompare(b.speciesId))[0]?.speciesId;
        if (!speciesId) continue;
        army = createArmyUnit({
          id: `garrison:${planet.id}:${source}`,
          ownerId: planet.ownerId,
          speciesId,
          typeId: "garrison",
          location: { kind: "planet", planetId: planet.id },
          speciesTraitIds: ctx.state.species.find((entry) => entry.id === speciesId)?.traitIds,
          sourceFortressKey: source,
        });
        ctx.state.armies.push(army);
        const battle = ctx.state.groundBattles.find((candidate) => candidate.planetId === planet.id);
        if (battle) battle.defenderArmyIds.push(army.id);
        changed = true;
      }
      const targetSpeciesId = supported ? species[index] : undefined;
      if (army && targetSpeciesId && army.speciesId !== targetSpeciesId) {
        const hpRatio = army.maxHp > 0 ? army.hp / army.maxHp : 0;
        army.speciesId = targetSpeciesId;
        army.maxHp = getArmyMaxHp(ctx.state.species.find((entry) => entry.id === targetSpeciesId)?.traitIds ?? []);
        army.hp = Math.max(0, Math.min(army.maxHp, army.maxHp * hpRatio));
        changed = true;
      }
      if (army && army.supported !== supported) {
        army.supported = supported;
        changed = true;
      }
    }
  }
  return changed;
}

function reducePopulationForGarrisonLoss(ctx: RuntimeContext, planet: PlanetState, speciesId: string): void {
  let remaining = ARMY_MANPOWER;
  planet.speciesPopulations = planet.speciesPopulations.map((entry) => {
    if (entry.speciesId !== speciesId || remaining <= 0) return entry;
    const removed = Math.min(entry.population, remaining);
    remaining -= removed;
    return { ...entry, population: entry.population - removed };
  }).filter((entry) => entry.population > 0);
  planet.population = Math.max(0, planet.population - (ARMY_MANPOWER - remaining));
  Object.assign(planet, recalculatePlanetStateEconomy(planet, getPlanetDistrictLimitsFromState(ctx.state, planet), getPlanetTechnologyModifiers(ctx.state, planet), getPlanetSpeciesContext(ctx.state, planet)));
}

function destroyArmy(ctx: RuntimeContext, army: ArmyUnit, planet: PlanetState): void {
  if (army.typeId === "garrison") {
    if (!army.depleted) reducePopulationForGarrisonLoss(ctx, planet, army.speciesId);
    army.hp = 0;
    army.manpower = 0;
    army.depleted = true;
    return;
  }
  if (army.location.kind === "fleet") {
    const shipIds = new Set(ctx.state.ships.filter((ship) => ship.armyUnitId === army.id).map((ship) => ship.id));
    ctx.state.ships = ctx.state.ships.filter((ship) => !shipIds.has(ship.id));
  }
  ctx.state.armies = ctx.state.armies.filter((candidate) => candidate.id !== army.id);
}

function activeBattleArmies(ctx: RuntimeContext, ids: string[]): ArmyUnit[] {
  const idSet = new Set(ids);
  return ctx.state.armies.filter((army) => idSet.has(army.id) && army.hp > EPSILON && army.manpower > EPSILON && army.supported !== false);
}

function removeBattle(ctx: RuntimeContext, battle: GroundBattleState): void {
  ctx.state.groundBattles = ctx.state.groundBattles.filter((candidate) => candidate.id !== battle.id);
}

function immediateEmbarkAttackers(ctx: RuntimeContext, battle: GroundBattleState, planet: PlanetState): void {
  const survivors = activeBattleArmies(ctx, battle.attackerArmyIds).filter((army) => army.mobility === "mobile");
  const commander = ctx.state.leaders.find((leader) => leader.assignment?.kind === "groundBattle" && leader.assignment.targetId === battle.id);
  // Normal player-driven embarkation is forbidden during combat. End the
  // battle first so ceasefires and completed withdrawals can use that same
  // reconstruction path without weakening the command-side guard.
  removeBattle(ctx, battle);
  if (survivors.length > 0) {
    const fleet = embarkPlanetArmies(ctx, planet, survivors.map((army) => army.id), battle.attackerFactionId, false);
    if (commander) commander.assignment = { kind: "fleet", targetId: fleet.id };
  } else if (commander) commander.assignment = null;
}

function resolveAttackerVictory(ctx: RuntimeContext, battle: GroundBattleState, planet: PlanetState): void {
  const oldOwner = planet.ownerId;
  planet.ownerId = battle.attackerFactionId;
  for (const item of planet.defense.shipQueue) {
    void item;
  }
  for (const leader of ctx.state.leaders) {
    if (leader.assignment?.kind === "planet" && leader.assignment.targetId === planet.id) leader.assignment = null;
    if (leader.assignment?.kind === "planetMilitary" && leader.assignment.targetId === planet.id) leader.assignment = null;
  }
  const attackerCommander = ctx.state.leaders.find((leader) => leader.assignment?.kind === "groundBattle" && leader.assignment.targetId === battle.id);
  if (attackerCommander) attackerCommander.assignment = { kind: "planetMilitary", targetId: planet.id };
  for (const army of activeBattleArmies(ctx, battle.attackerArmyIds)) army.ownerId = battle.attackerFactionId;
  for (const army of ctx.state.armies.filter((candidate) => candidate.location.kind === "planet" && candidate.location.planetId === planet.id && candidate.typeId === "garrison")) {
    army.ownerId = battle.attackerFactionId;
    army.hp = 0;
    army.manpower = 0;
    army.depleted = true;
  }
  if (oldOwner !== null) {
    for (const queued of planet.defense.shipQueue) void queued;
  }
  removeBattle(ctx, battle);
}

function processBattleDay(ctx: RuntimeContext, battle: GroundBattleState): void {
  const planet = ctx.state.planetStates.find((candidate) => candidate.id === battle.planetId);
  if (!planet) return removeBattle(ctx, battle);
  if (!areFactionsAtWar(ctx.state.diplomacy, battle.attackerFactionId, battle.defenderFactionId)) return immediateEmbarkAttackers(ctx, battle, planet);
  if (battle.withdrawalDueYear && ctx.state.clock.year + EPSILON >= battle.withdrawalDueYear) return immediateEmbarkAttackers(ctx, battle, planet);
  const attackers = activeBattleArmies(ctx, battle.attackerArmyIds);
  const defenders = activeBattleArmies(ctx, battle.defenderArmyIds);
  if (attackers.length === 0) return removeBattle(ctx, battle);
  if (defenders.length === 0) return resolveAttackerVictory(ctx, battle, planet);
  const planetType = ctx.state.stars[planet.starId]?.system.planets[planet.planetIndex]?.type;
  const width = getPlanetCombatWidth(planetType ?? "Barren", planet.features);
  const attackPower = new Map(attackers.map((army) => [army.id, getEffectiveArmyPower(ctx.state, planet, army, true, battle)]));
  const defensePower = new Map(defenders.map((army) => [army.id, getEffectiveArmyPower(ctx.state, planet, army, false, battle)]));
  const engagedAttackerIds = new Set(selectStrongestArmyIds(attackers.map((army) => ({ id: army.id, power: attackPower.get(army.id)?.attack ?? 0 })), width));
  const engagedDefenderIds = new Set(selectStrongestArmyIds(defenders.map((army) => ({ id: army.id, power: defensePower.get(army.id)?.defense ?? 0 })), width));
  const engagedAttackers = attackers.filter((army) => engagedAttackerIds.has(army.id));
  const engagedDefenders = defenders.filter((army) => engagedDefenderIds.has(army.id));
  const attackerTotal = engagedAttackers.reduce((sum, army) => sum + (attackPower.get(army.id)?.attack ?? 0), 0);
  const attackerDefense = engagedAttackers.reduce((sum, army) => sum + (attackPower.get(army.id)?.defense ?? 0), 0);
  const defenderTotal = engagedDefenders.reduce((sum, army) => sum + (defensePower.get(army.id)?.attack ?? 0), 0);
  const defenderDefense = engagedDefenders.reduce((sum, army) => sum + (defensePower.get(army.id)?.defense ?? 0), 0);
  const damageToAttacker = calculateGroundDailyLoss(defenderTotal, attackerDefense);
  const damageToDefender = calculateGroundDailyLoss(attackerTotal, defenderDefense);
  const pending = [
    ...engagedAttackers.map((army) => ({ army, loss: damageToAttacker })),
    ...engagedDefenders.map((army) => ({ army, loss: damageToDefender })),
  ];
  for (const { army, loss } of pending) {
    army.hp = Math.max(0, army.hp - loss.hp);
    army.manpower = Math.max(0, army.manpower - loss.manpower);
  }
  for (const { army } of pending) if (army.hp <= EPSILON || army.manpower <= EPSILON) destroyArmy(ctx, army, planet);
  const remainingAttackers = activeBattleArmies(ctx, battle.attackerArmyIds);
  const remainingDefenders = activeBattleArmies(ctx, battle.defenderArmyIds);
  if (remainingAttackers.length === 0) removeBattle(ctx, battle);
  else if (remainingDefenders.length === 0) resolveAttackerVictory(ctx, battle, planet);
}

export function processGroundBattles(ctx: RuntimeContext): boolean {
  let changed = syncPlanetGarrisons(ctx);
  const currentDay = Math.floor(ctx.state.clock.year * GAME_DAYS_PER_YEAR);
  for (const battle of [...ctx.state.groundBattles]) {
    const days = Math.max(0, currentDay - battle.lastProcessedDay);
    for (let day = 0; day < days && ctx.state.groundBattles.includes(battle); day += 1) processBattleDay(ctx, battle);
    if (days > 0) {
      battle.lastProcessedDay = currentDay;
      changed = true;
    }
  }
  return changed;
}

function replenishmentSystemOwnerAllows(state: GameState, factionId: number, starId: number): boolean {
  const infrastructureOwners = new Set<number>();
  for (const planet of state.planetStates) if (planet.starId === starId && planet.isHabited && planet.ownerId !== null) infrastructureOwners.add(planet.ownerId);
  for (const starbase of state.starbases) if (starbase.starId === starId && starbase.status === "online") infrastructureOwners.add(starbase.ownerId);
  for (const ownerId of infrastructureOwners) {
    if (ownerId === factionId) return true;
    if (!areFactionsAtWar(state.diplomacy, ownerId, factionId) && getBorderPolicy(state.diplomacy, ownerId, factionId) === "open") return true;
  }
  return false;
}

function armyCanReplenish(state: GameState, army: ArmyUnit): boolean {
  if (state.groundBattles.some((battle) => battle.attackerArmyIds.includes(army.id) || battle.defenderArmyIds.includes(army.id))) return false;
  if (army.location.kind === "planet") {
    const planetId = army.location.planetId;
    const planet = state.planetStates.find((candidate) => candidate.id === planetId);
    return Boolean(planet && planet.ownerId === army.ownerId);
  }
  const fleetId = army.location.fleetId;
  const fleet = state.fleets.find((candidate) => candidate.id === fleetId);
  return Boolean(fleet && !fleet.hyperlanePosition && fleet.combatStatus === "idle" && replenishmentSystemOwnerAllows(state, army.ownerId, fleet.currentStarId));
}

export function processArmyAndCrewReplenishment(ctx: RuntimeContext, elapsedDays: number): boolean {
  if (elapsedDays <= 0) return false;
  let changed = false;
  for (const army of ctx.state.armies) {
    const inBattle = ctx.state.groundBattles.some((battle) => battle.attackerArmyIds.includes(army.id) || battle.defenderArmyIds.includes(army.id));
    if (inBattle || army.supported === false) continue;
    const definition = ARMY_TYPE_DEFINITIONS[army.typeId];
    const battle = ctx.state.groundBattles.find((candidate) => candidate.planetId === (army.location.kind === "planet" ? army.location.planetId : ""));
    const defending = army.location.kind === "planet";
    const targetId = battle && battle.attackerFactionId === army.ownerId ? battle.id : army.location.kind === "planet" ? army.location.planetId : "";
    const leaderEffects = battle && battle.attackerFactionId === army.ownerId
      ? getGroundLeaderEffects(ctx.state, "groundBattle", targetId, false)
      : army.location.kind === "planet"
        ? getGroundLeaderEffects(ctx.state, "planetMilitary", targetId, defending)
        : { recoveryMultiplier: 1 };
    const hpGain = army.maxHp * elapsedDays / definition.hpRecoveryDays * leaderEffects.recoveryMultiplier;
    if (army.hp < army.maxHp) {
      army.hp = Math.min(army.maxHp, army.hp + hpGain);
      changed = true;
    }
    if (!armyCanReplenish(ctx.state, army)) continue;
    const wanted = Math.min(army.maxManpower - army.manpower, army.maxManpower * elapsedDays / definition.manpowerRecoveryDays * leaderEffects.recoveryMultiplier);
    const economy = getFactionEconomy(ctx.state, army.ownerId);
    const supplied = Math.min(wanted, economy?.crewStockpile ?? 0);
    if (supplied > 0 && economy) {
      army.manpower += supplied;
      economy.crewStockpile -= supplied;
      if (army.manpower > EPSILON) army.depleted = false;
      changed = true;
    }
    if (army.mobility === "mobile" && army.location.kind === "planet" && army.landedTransport && economy) {
      const transport = army.landedTransport;
      const crewWanted = Math.min(
        transport.crewCapacity - transport.crew,
        transport.crewCapacity * elapsedDays / 180,
      );
      const crewSupplied = Math.min(Math.max(0, crewWanted), economy.crewStockpile);
      if (crewSupplied > 0) {
        transport.crew += crewSupplied;
        economy.crewStockpile -= crewSupplied;
        changed = true;
      }
    }
  }
  for (const ship of ctx.state.ships) {
    if (ship.crew >= ship.crewCapacity) continue;
    const fleet = ctx.state.fleets.find((candidate) => candidate.id === ship.fleetId);
    if (!fleet || fleet.hyperlanePosition || fleet.combatStatus !== "idle" || !replenishmentSystemOwnerAllows(ctx.state, ship.ownerId, fleet.currentStarId)) continue;
    const economy = getFactionEconomy(ctx.state, ship.ownerId);
    const wanted = Math.min(ship.crewCapacity - ship.crew, ship.crewCapacity * elapsedDays / 180);
    const supplied = Math.min(wanted, economy?.crewStockpile ?? 0);
    if (supplied > 0 && economy) {
      ship.crew += supplied;
      economy.crewStockpile -= supplied;
      changed = true;
    }
  }
  return changed;
}

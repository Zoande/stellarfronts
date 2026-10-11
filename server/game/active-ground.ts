import { ARMY_POPULATION_PER_CAP, ARMY_TOTAL_CREW_DEMAND, ARMY_TYPE_DEFINITIONS, GARRISONS_PER_FORTRESS,
  MOBILE_ARMY_TYPE_IDS, getArmyCurrentPower, getArmyHabitabilityMultiplier, getPlanetCombatWidth, type ArmyUnit } from "../../src/data/Armies";
import { countPlanetShipyards, getPlanetBuildingKind, isPlanetBuildingEnabled, RESOURCE_KINDS, type PlanetState } from "../../src/data/Economy";
import { PlanetType } from "../../src/data/StarMap";
import type { IntelEntityView } from "../../src/data/Intelligence";
import type { AiObservation } from "./ai-observation";
import type { ActiveEpisode } from "./types";
import type { GameAction } from "./actions";
import { isAiFleetReady, isAiOwnedStarbase, type AiCandidates } from "./ai-candidates";
import { affordableWithReserve } from "./passive";
import { hasTradeLiquidity } from "./active-trade";
import { localWarOpportunities } from "./active-strategy";

const ARMED = new Set(["corvette", "destroyer", "cruiser", "battleship", "defensePlatform"]);
function value<T>(entity: IntelEntityView, key: string, fallback: T): T {
  const field = entity.fields[key];
  return field && field.status !== "unknown" ? field.value as T : fallback;
}

/** These are estimates from player intelligence, never authoritative enemy armies.
 * A missing building observation is uncertainty, not proof of zero garrisons. */
export function groundAssessment(observation: AiObservation, prepareConquests = false) {
  const { snapshot, factionId, fleets } = observation;
  const enemies = new Set(observation.diplomacy.countries.filter((country) => country.atWar).map((country) => country.faction.id));
  const navy = fleets.ships.filter((ship) => ship.ownerId === factionId && ARMED.has(ship.shipKind) && ship.shipKind !== "defensePlatform")
    .reduce((sum, ship) => sum + ship.hull + ship.armor + ship.shield, 0);
  // Prepare one achievable border expedition, rather than armies against every
  // peaceful neighbor. Treaty and unknown-defense targets are never candidates.
  const peacefulSystems = new Set(!enemies.size && prepareConquests ? localWarOpportunities(observation)
    .filter((target) => target.reason === "requires-invasion" && navy >= target.requiredPower).map((target) => target.starId) : []);
  const owners = new Map(snapshot.starOwnership);
  const targets = snapshot.intelligence.entities.filter((entity) => entity.kind === "planet"
    && value(entity, "isHabited", false) && (enemies.has(value(entity, "ownerId", -1))
      || peacefulSystems.has(value(entity, "starId", -1)))).map((entity) => {
    const width = getPlanetCombatWidth(value(entity, "type", PlanetType.Grassland), value(entity, "features", []));
    const buildings = value<PlanetState["buildings"] | null>(entity, "buildings", null);
    const urban = value<PlanetState["urbanSubDistricts"]>(entity, "urbanSubDistricts", []);
    const fortresses = [...Object.values(buildings ?? {}).flat(), ...urban.flatMap((district) => district.buildings)]
      .filter((slot) => getPlanetBuildingKind(slot) === "fortress" && isPlanetBuildingEnabled(slot)).length;
    const current = entity.fields.buildings?.status === "current" && entity.fields.urbanSubDistricts?.status === "current";
    const estimatedGarrisons = Math.max(fortresses * GARRISONS_PER_FORTRESS, buildings ? width : width * 2);
    const defense = estimatedGarrisons * ARMY_TYPE_DEFINITIONS.garrison.defensePower * (current ? 1.1 : 1.3);
    return { planetId: entity.id, starId: value(entity, "starId", -1), ownerId: value(entity, "ownerId", -1), width,
      habitability: value(entity, "habitability", 40), observedFortresses: fortresses, current, estimatedDefense: defense,
      requiredAttack: defense * 1.5 + width * ARMY_TYPE_DEFINITIONS.lightInfantry.attackPower };
  }).sort((a, b) => Number(owners.get(b.starId) === factionId) - Number(owners.get(a.starId) === factionId)
    || a.requiredAttack - b.requiredAttack || a.planetId.localeCompare(b.planetId));
  const own = snapshot.armies.filter((army) => army.ownerId === factionId && army.mobility === "mobile");
  const pending = [...fleets.starbases.filter((base) => isAiOwnedStarbase(observation, base)).flatMap((base) => base.shipQueue),
    ...observation.planets.planets.filter(({ planetState }) => planetState.ownerId === factionId).flatMap(({ planetState }) => planetState.defense.shipQueue)]
    .filter((item) => item.kind === "armyBuild");
  const requiredAttack = targets[0]?.requiredAttack ?? (enemies.size ? 128_000 : 0);
  return { targets, own, pending, requiredAttack, mobileAttack: own.reduce((sum, army) => sum + getArmyCurrentPower(army).attack, 0),
    pendingAttack: pending.reduce((sum, item) => sum + ARMY_TYPE_DEFINITIONS[item.armyTypeId ?? "lightInfantry"].attackPower, 0) };
}

/** All orders still pass the normal player command validators. */
export function activeGroundOrders(observation: AiObservation, candidates: AiCandidates, occupied: Set<string>, prepareConquests = false, blockedRoutes: Record<string, number> = {}): GameAction[] {
  const { snapshot, factionId, fleets } = observation;
  const assessment = groundAssessment(observation, prepareConquests), owners = new Map(snapshot.starOwnership);
  const enemies = new Set(observation.diplomacy.countries.filter((country) => country.atWar).map((country) => country.faction.id));
  const current = new Set(snapshot.intelligence.entities.filter((entity) => entity.kind === "fleet" && entity.fields.existence?.status === "current"
    && entity.fields.existence.value === true && entity.fields.currentStarId?.status === "current").map((entity) => entity.id));
  // Support ships and stale sightings do not blockade a planet. Be more cautious
  // than the invasion validator: avoid any currently observed armed enemy in-system.
  const safe = (starId: number) => owners.get(starId) === factionId && !fleets.fleets.some((fleet) => current.has(fleet.id)
    && fleet.currentStarId === starId && enemies.has(fleet.ownerId) && fleet.shipIds.some((id) => {
      const ship = fleets.ships.find((ship) => ship.id === id);
      return !ship || ARMED.has(ship.shipKind) && ship.hull > 0;
    }));
  const actions: GameAction[] = [];
  const power = (units: ArmyUnit[], attack: boolean, width?: number) => units.filter((army) => army.supported !== false)
    .map((army) => getArmyCurrentPower(army)[attack ? "attack" : "defense"]).sort((a, b) => b - a)
    .slice(0, width ?? units.length).reduce((sum, value) => sum + value, 0);
  for (const battle of snapshot.groundBattles.filter((battle) => battle.attackerFactionId === factionId && !battle.withdrawalDueYear)) {
    const ours = snapshot.armies.filter((army) => battle.attackerArmyIds.includes(army.id));
    const theirs = snapshot.armies.filter((army) => battle.defenderArmyIds.includes(army.id));
    const width = assessment.targets.find((target) => target.planetId === battle.planetId)?.width ?? 4;
    // Compare both engaged forces and reserves; sheer army count cannot defeat
    // an overwhelming quality difference within the planet's combat width.
    if (power(ours, true) < power(theirs, false) * 0.65
      || power(ours, true, width) < power(theirs, false, width) * 0.4) actions.push({ type: "withdrawGroundBattle", battleId: battle.id });
  }
  const ready = (army: ArmyUnit) => army.hp >= army.maxHp * 0.9 && army.manpower >= army.maxManpower * 0.9;
  for (const { planetState: planet } of observation.planets.planets.filter(({ planetState }) => planetState.ownerId === factionId)) {
    if (!safe(planet.starId) || snapshot.groundBattles.some((battle) => battle.planetId === planet.id)) continue;
    const landed = assessment.own.filter((army) => army.location.kind === "planet" && army.location.planetId === planet.id);
    if (landed.length && landed.every(ready) && assessment.targets.length) actions.push({ type: "embarkPlanetArmies", planetId: planet.id,
      armyIds: landed.map((army) => army.id), embarkCommander: true });
  }
  const transports = fleets.fleets.filter((fleet) => fleet.ownerId === factionId && !occupied.has(fleet.id) && isAiFleetReady(fleet)
    && fleet.shipIds.length
    && fleet.shipIds.every((id) => fleets.ships.some((ship) => ship.id === id && ship.shipKind === "armyShip")));
  // Merge locally even when another transport is isolated behind closed borders.
  for (const starId of new Set(transports.filter((fleet) => safe(fleet.currentStarId)).map((fleet) => fleet.currentStarId))) {
    const group = transports.filter((fleet) => fleet.currentStarId === starId);
    if (group.length < 2) continue;
    // A slow transport should rendezvous with a fixed anchor, rather than chase
    // a carrier around its planet's orbit indefinitely.
    if (group[0].orbitTargetPlanetId || group[0].orbitTarget?.kind === "planet") actions.push({ type: "issueFleetTacticalOrder", fleetId: group[0].id, order: { type: "hold" } });
    actions.push({ type: "mergeFleets", targetFleetId: group[0].id, sourceFleetIds: group.slice(1).map((fleet) => fleet.id) });
    for (const fleet of group) occupied.add(fleet.id);
  }
  const available = transports.filter((fleet) => !occupied.has(fleet.id)).sort((a, b) => b.shipIds.length - a.shipIds.length || a.id.localeCompare(b.id));
  const rally = available.find((fleet) => safe(fleet.currentStarId));
  const reachable = (fleetId: string, from: number, to: number) => from === to || candidates.movement.some((action) => action.type === "moveFleet" && action.fleetId === fleetId && action.targetStarId === to);
  for (const fleet of available) {
    const units = assessment.own.filter((army) => army.location.kind === "fleet" && army.location.fleetId === fleet.id);
    if (!safe(fleet.currentStarId)) {
      const home = candidates.movement.find((action) => action.type === "moveFleet" && action.fleetId === fleet.id && safe(action.targetStarId)
        && (blockedRoutes[`retreat:${fleet.id}:${action.targetStarId}`] ?? 0) <= snapshot.clock.year);
      if (home?.type === "moveFleet") {
        actions.push({ type: "retreatFleetTo", fleetId: fleet.id, targetStarId: home.targetStarId }); occupied.add(fleet.id);
      }
      continue;
    }
    const defense = observation.planets.planets.find(({ planetState: planet }) => planet.ownerId === factionId && safe(planet.starId)
      && snapshot.groundBattles.some((battle) => battle.planetId === planet.id && battle.defenderFactionId === factionId)
      && reachable(fleet.id, fleet.currentStarId, planet.starId));
    const recovery = units.some((army) => !ready(army)) && observation.planets.planets.find(({ planetState: planet }) => planet.ownerId === factionId && safe(planet.starId)
      && !snapshot.groundBattles.some((battle) => battle.planetId === planet.id) && reachable(fleet.id, fleet.currentStarId, planet.starId));
    const target = assessment.targets.find((target) => enemies.has(target.ownerId) && safe(target.starId) && reachable(fleet.id, fleet.currentStarId, target.starId)
      && !snapshot.groundBattles.some((battle) => battle.planetId === target.planetId && (battle.attackerFactionId !== factionId || !!battle.withdrawalDueYear))
      && (snapshot.groundBattles.some((battle) => battle.planetId === target.planetId && battle.attackerFactionId === factionId)
        || power(units, true) * getArmyHabitabilityMultiplier(target.habitability) >= target.requiredAttack));
    const planetId = defense?.planetState.id ?? (recovery ? recovery.planetState.id : target?.planetId);
    if (planetId) {
      const orbiting = fleet.phase === "orbitingPlanet" && fleet.orbitTarget?.kind === "planet" && fleet.orbitTarget.planetId === planetId;
      actions.push(orbiting ? { type: defense || recovery ? "landArmyFleet" : "beginPlanetInvasion", fleetId: fleet.id, planetId }
        : { type: "orbitPlanet", fleetId: fleet.id, planetId });
      occupied.add(fleet.id);
    } else {
      // A fixed tie-break prevents equal groups from swapping systems forever.
      const main = rally?.id !== fleet.id && rally && reachable(fleet.id, fleet.currentStarId, rally.currentStarId) ? rally : undefined;
      if (main && main.currentStarId !== fleet.currentStarId) {
        actions.push({ type: "moveFleet", fleetId: fleet.id, targetStarId: main.currentStarId }); occupied.add(fleet.id);
      }
    }
  }
  return actions;
}

export function activeArmyRecruitment(observation: AiObservation, episode: ActiveEpisode, prepareConquests = false): GameAction | undefined {
  const { snapshot, factionId, fleets } = observation;
  const assessment = groundAssessment(observation, prepareConquests);
  if (!assessment.requiredAttack || snapshot.clock.year < (episode.nextArmyYear ?? -Infinity)) return;
  const targetMultiplier = getArmyHabitabilityMultiplier(assessment.targets[0]?.habitability ?? 40);
  if ((assessment.mobileAttack + assessment.pendingAttack) * targetMultiplier >= assessment.requiredAttack) return;
  const economy = snapshot.factionEconomies.find((entry) => entry.factionId === factionId);
  if (!economy || economy.crewStockpile < ARMY_TOTAL_CREW_DEMAND + 50_000) return;
  const planets = observation.planets.planets.filter(({ planetState }) => planetState.ownerId === factionId && planetState.isHabited);
  const yards = [
    ...fleets.starbases.filter((base) => isAiOwnedStarbase(observation, base) && base.status === "online" && base.buildingSlots.includes("shipyard"))
      .map((base) => ({ kind: "starbase" as const, id: base.id, queue: base.shipQueue })),
    ...planets.filter(({ planetState }) => countPlanetShipyards(planetState) > 0)
      .map(({ planetState }) => ({ kind: "planet" as const, id: planetState.id, queue: planetState.defense.shipQueue })),
  ].filter((yard) => yard.queue.length < 2).sort((a, b) => a.queue.length - b.queue.length || a.id.localeCompare(b.id));
  if (!yards.length) return;
  const populations = new Map<string, number>();
  for (const { planetState } of planets) for (const species of planetState.speciesPopulations) populations.set(species.speciesId, (populations.get(species.speciesId) ?? 0) + species.population);
  const species = [...populations].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).find(([id, population]) =>
    assessment.own.filter((army) => army.speciesId === id).length + assessment.pending.filter((item) => item.speciesId === id).length < Math.floor(population / ARMY_POPULATION_PER_CAP));
  if (!species) return;
  const completed = snapshot.technologies.find((entry) => entry.factionId === factionId)?.completedTechIds ?? [];
  for (const typeId of [...MOBILE_ARMY_TYPE_IDS].sort((a, b) => ARMY_TYPE_DEFINITIONS[b].attackPower - ARMY_TYPE_DEFINITIONS[a].attackPower)) {
    const type = ARMY_TYPE_DEFINITIONS[typeId];
    if (type.requiredTechnologyId && !completed.includes(type.requiredTechnologyId)) continue;
    const action: GameAction = { type: "queueArmyRecruitment", yardKind: yards[0].kind, yardId: yards[0].id, armyTypeId: typeId, speciesId: species[0] };
    const upkeep = Object.fromEntries(RESOURCE_KINDS.map((resource) => [resource, type.upkeep[resource]
      + assessment.pending.reduce((sum, item) => sum + ARMY_TYPE_DEFINITIONS[item.armyTypeId ?? "lightInfantry"].upkeep[resource], 0)]));
    if (affordableWithReserve(observation, action, true) && (hasTradeLiquidity(observation, upkeep, type.cost)
      || RESOURCE_KINDS.every((resource) => resource === "research" || economy.stockpiles[resource] - type.cost[resource]
        >= Math.max(100, -(economy.monthlyDelta[resource] - upkeep[resource]) * 12)))) return action;
  }
}

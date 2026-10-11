import type { AiObservation } from "./ai-observation";
import type { ActiveEpisode } from "./types";
import { countPlanetShipyards } from "../../src/data/Economy";
import { countStarbaseShipyards, type StarbaseShipQueueItem } from "../../src/data/Starbase";
import { ARMY_TYPE_DEFINITIONS, getArmyCurrentPower, getArmyHabitabilityMultiplier } from "../../src/data/Armies";
import { groundAssessment } from "./active-ground";
import { hasVisibleMilitaryThreat } from "./active-strategy";

/** Include queue competition, not just the remaining time of an army buried
 * behind other work. Ninety days is one ordinary infantry training phase. */
function soonArmyPower(queue: StarbaseShipQueueItem[], slots: number): number {
  if (slots <= 0) return 0;
  const available = Array.from({ length: slots }, () => 0);
  let power = 0;
  for (const item of queue) {
    const slot = available.indexOf(Math.min(...available));
    available[slot] += Math.max(0, item.remainingDays);
    if (item.kind === "armyBuild" && available[slot] <= 90) power += ARMY_TYPE_DEFINITIONS[item.armyTypeId ?? "lightInfantry"].attackPower;
  }
  return power;
}

function promisingInvasion(observation: AiObservation, rival: number): boolean {
  const ground = groundAssessment(observation), owners = new Map(observation.snapshot.starOwnership);
  const targets = ground.targets.filter((target) => target.ownerId === rival && owners.get(target.starId) === observation.factionId);
  if (!targets.length) return false;
  const readyByStar = new Map<number, number>();
  for (const fleet of observation.fleets.fleets.filter((fleet) => fleet.ownerId === observation.factionId
    && owners.get(fleet.currentStarId) === observation.factionId && !fleet.retreatState && !fleet.hyperlanePosition && fleet.combatStatus === "idle")) {
    const power = ground.own.filter((army) => army.location.kind === "fleet" && army.location.fleetId === fleet.id)
      .reduce((sum, army) => sum + getArmyCurrentPower(army).attack, 0);
    readyByStar.set(fleet.currentStarId, (readyByStar.get(fleet.currentStarId) ?? 0) + power);
  }
  for (const base of observation.fleets.starbases.filter((base) => base.ownerId === observation.factionId && base.status === "online")) {
    readyByStar.set(base.starId, (readyByStar.get(base.starId) ?? 0) + soonArmyPower(base.shipQueue, countStarbaseShipyards(base)));
  }
  for (const { planetState: planet } of observation.planets.planets.filter(({ planetState }) => planetState.ownerId === observation.factionId)) {
    readyByStar.set(planet.starId, (readyByStar.get(planet.starId) ?? 0) + soonArmyPower(planet.defense.shipQueue, countPlanetShipyards(planet)));
  }
  return targets.some((target) => [...readyByStar.values()].some((power) => power * getArmyHabitabilityMultiplier(target.habitability) >= target.requiredAttack)
    || observation.snapshot.groundBattles.some((battle) => battle.planetId === target.planetId && battle.attackerFactionId === observation.factionId
      && !battle.withdrawalDueYear && observation.snapshot.armies.filter((army) => battle.attackerArmyIds.includes(army.id)).reduce((sum, army) => sum + getArmyCurrentPower(army).attack, 0)
        >= observation.snapshot.armies.filter((army) => battle.defenderArmyIds.includes(army.id)).reduce((sum, army) => sum + getArmyCurrentPower(army).defense, 0) * 1.1));
}

/** Remember only our own borders, never the private global pre-war map. */
export function rememberWarBorders(observation: AiObservation, episode: ActiveEpisode) {
  const own = observation.snapshot.starOwnership.filter(([, owner]) => owner === observation.factionId).map(([starId]) => starId);
  const baselines = episode.warBaselineSystems ??= {};
  for (const war of observation.diplomacy.wars.filter((entry) => !entry.endedAtYear && [entry.attackerFactionId, entry.defenderFactionId].includes(observation.factionId))) {
    const rival = war.attackerFactionId === observation.factionId ? war.defenderFactionId : war.attackerFactionId;
    baselines[war.id] ??= baselines[`pending:${rival}`] ?? own;
    delete baselines[`pending:${rival}`];
  }
}

export function peaceAssessment(observation: AiObservation, episode: ActiveEpisode, rival: number, solvent: boolean, hasNavy: boolean) {
  const war = observation.diplomacy.wars.find((entry) => !entry.endedAtYear && [entry.attackerFactionId, entry.defenderFactionId].includes(rival)
    && [entry.attackerFactionId, entry.defenderFactionId].includes(observation.factionId));
  const owners = new Map(observation.snapshot.starOwnership);
  const baseline = war ? episode.warBaselineSystems?.[war.id] ?? [] : [];
  const gains = observation.snapshot.starOwnership.filter(([id, owner]) => owner === observation.factionId && !baseline.includes(id)).length;
  const losses = baseline.filter((id) => owners.get(id) !== observation.factionId).length;
  const strandedColony = observation.planets.planets.some(({ planetState }) => planetState.ownerId === observation.factionId
    && planetState.isHabited && owners.get(planetState.starId) !== observation.factionId);
  const power = (owner: number) => observation.fleets.ships.filter((ship) => ship.ownerId === owner && ["corvette", "destroyer", "cruiser", "battleship", "defensePlatform"].includes(ship.shipKind))
    .reduce((sum, ship) => sum + ship.hull + ship.armor + ship.shield, 0);
  const exhausted = !solvent || !hasNavy || power(rival) > power(observation.factionId) * 1.25;
  const prolonged = !!war && observation.snapshot.clock.year - war.startedAtYear >= 3;
  const deferForInvasion = !!war && !exhausted && losses === 0 && !strandedColony && !hasVisibleMilitaryThreat(observation) && promisingInvasion(observation, rival);
  return { gains, losses, exhausted, prolonged, deferForInvasion,
    acceptStatusQuo: !!war && !deferForInvasion && !strandedColony && (gains >= losses || exhausted),
    acceptWhitePeace: !!war && !deferForInvasion && (gains <= losses || exhausted),
    proposeStatusQuo: !!war && !deferForInvasion && !strandedColony && (gains > 0 && gains >= losses || exhausted) };
}

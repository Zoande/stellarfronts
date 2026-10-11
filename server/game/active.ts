import { rememberWarBorders, peaceAssessment } from "./active-diplomacy";
import { GAME_DAYS_PER_YEAR } from "../../src/game/GameTime";
import type { ServerFleet } from "../../src/game/GameProtocol";
import { getPlanetBuildingKind, getUnlockedPlanetDefenseSlots } from "../../src/data/Economy";
import { getRequiredTechIdsForPlanetDefenseBuilding } from "../../src/data/Technology";
import { ARMY_TOTAL_CREW_DEMAND } from "../../src/data/Armies";
import type { AiObservation } from "./ai-observation";
import { getAiCandidates, isAiFleetAvailable } from "./ai-candidates";
import type { GameAction } from "./actions";
import type { CaretakerDecision } from "./caretaker";
import { affordableWithReserve, createPassiveEpisode, decidePassive, recordPassiveAcceptance } from "./passive";
import type { ActiveEpisode } from "./types";
import { localWarOpportunities } from "./active-strategy";
import { hasTradeLiquidity } from "./active-trade";
import { activeRecoveryAction, protectDevelopmentWorkforce } from "./active-economy";
import { activeAllocationAction, activeInvestmentProject, fundActiveProject, projectPlanningView } from "./active-investment";

export const ACTIVE_AFK_MS = 7 * 24 * 60 * 60 * 1000;
export const ACTIVE_UNCLAIMED_MS = 72 * 60 * 60 * 1000;
const MILITARY = new Set(["corvette", "destroyer", "cruiser", "battleship", "defensePlatform"]);

export function createActiveEpisode(observation: AiObservation, accountId: number | null, lastActivityAt: number, realNow: number): ActiveEpisode {
  return { ...createPassiveEpisode(observation, accountId, lastActivityAt, realNow),
    nextWarYear: observation.snapshot.clock.year, nextDiplomacyYear: observation.snapshot.clock.year, exploredStarIds: [] };
}

/** A deliberately rough estimate from remembered hulls, never hidden rival designs or queues. */
function strength(observation: AiObservation, fleet: ServerFleet): number {
  return observation.fleets.ships.filter((ship) => fleet.shipIds.includes(ship.id) && MILITARY.has(ship.shipKind))
    .reduce((sum, ship) => sum + Math.max(0, ship.hull) + Math.max(0, ship.armor) + Math.max(0, ship.shield), 0);
}

export function decideActive(observation: AiObservation, episode: ActiveEpisode, allowWarDeclarations = false): CaretakerDecision[] {
  const { factionId, snapshot, fleets, diplomacy } = observation;
  const year = snapshot.clock.year;
  const owners = new Map(snapshot.starOwnership);
  const candidates = getAiCandidates(observation);
  const opportunities = localWarOpportunities(observation);
  let decisions = decidePassive(observation, episode, true, candidates);
  let recovery = activeRecoveryAction(observation, episode, candidates);
  const development = recovery ?? decisions.find(({ action }) => ["buildDistrict", "buildPlanetBuilding", "upgradePlanetBuilding"].includes(action.type))?.action;
  if (development) recovery = protectDevelopmentWorkforce(observation, development) ?? recovery;
  if (recovery) decisions = [...decisions.filter(({ action }) => !["marketTrade", "buildDistrict", "buildPlanetBuilding", "upgradePlanetBuilding", "buildPlanetDefenseBuilding", "buildStarbase", "buildStarbaseBuilding", "buildStarbaseShip", "buildPlanetShip", "colonizePlanet"].includes(action.type)), { action: recovery }];
  const economy = snapshot.factionEconomies.find((entry) => entry.factionId === factionId);
  const solvent = !!economy && (["energy", "minerals", "food", "goods", "alloys"] as const).every((resource) =>
    economy.stockpiles[resource] > Math.max(100, -economy.monthlyDelta[resource] * 6) || hasTradeLiquidity(observation));
  const ownedPlanets = observation.planets.planets.filter((entry) => entry.planetState.ownerId === factionId && entry.planetState.isHabited);
  const hasBuilding = (kind: string) => ownedPlanets.some(({ planetState: planet }) =>
    [...Object.values(planet.buildings).flat(), ...planet.urbanSubDistricts.flatMap((sub) => sub.buildings)].some((slot) => getPlanetBuildingKind(slot) === kind)
    || planet.constructionQueue.some((item) => item.buildingKind === kind));
  const hasTraining = ownedPlanets.some(({ planetState: planet }) => planet.defense.defenseSlots.some((slot) => slot?.kind === "barracks" && slot.enabled !== false)
    || planet.constructionQueue.some((item) => item.defenseBuildingKind === "barracks"));
  const needsCrewTraining = !!economy && economy.crewStockpile < 50_000;
  // Bootstrap the inputs that new empires lack. Without labs and trained crew,
  // selecting research and constructing a shipyard never leads to progress.
  if (!recovery && solvent && year >= episode.nextDevelopmentYear && !decisions.some(({ action }) => action.type === "marketTrade")) {
    let prerequisite: GameAction | undefined;
    const desired = !hasBuilding("researchLabs") ? "researchLabs" : needsCrewTraining && !hasTraining && !hasBuilding("fortress") ? "fortress" : null;
    if (desired) prerequisite = getAiCandidates(projectPlanningView(observation)).economy.find((action) => action.type === "buildPlanetBuilding" && action.buildingKind === desired
      && ownedPlanets.find((entry) => entry.planetState.id === action.planetId)!.planetState.constructionQueue.length < 2);
    if (!desired && needsCrewTraining && !hasTraining) {
      const completed = snapshot.technologies.find((entry) => entry.factionId === factionId)?.completedTechIds ?? [];
      if (getRequiredTechIdsForPlanetDefenseBuilding("barracks").some((id) => completed.includes(id))) {
        for (const { planetState: planet } of ownedPlanets) {
          const slotIndex = planet.defense.defenseSlots.findIndex((slot, index) => !slot && index < getUnlockedPlanetDefenseSlots(planet)
            && !planet.constructionQueue.some((item) => item.defenseSection === "defense" && item.slotIndex === index));
          const action: GameAction = { type: "buildPlanetDefenseBuilding", planetId: planet.id, section: "defense", slotIndex, buildingKind: "barracks" };
          if (slotIndex >= 0 && planet.constructionQueue.length < 2) { prerequisite = action; break; }
        }
      }
    }
    if (prerequisite) {
      const action = affordableWithReserve(observation, prerequisite, true) ? prerequisite : fundActiveProject(observation, prerequisite);
      if (action) decisions = [...decisions.filter(({ action }) => !["buildDistrict", "buildPlanetBuilding", "upgradePlanetBuilding", "buildStarbase", "colonizePlanet", "buildStarbaseBuilding", "buildStarbaseShip", "buildPlanetShip"].includes(action.type)), { action }];
    }
  }
  const expense = decisions.find(({ action }) => ["marketTrade", "buildDistrict", "buildPlanetBuilding", "upgradePlanetBuilding", "buildPlanetDefenseBuilding", "buildStarbase", "buildStarbaseBuilding", "buildStarbaseShip", "buildPlanetShip", "colonizePlanet"].includes(action.type))?.action;
  const militaryExpense = expense && (expense.type === "buildStarbaseShip" || expense.type === "buildPlanetShip") && MILITARY.has(expense.shipKind);
  if (!recovery && solvent && (!expense || militaryExpense) && year >= episode.nextDevelopmentYear) {
    const project = activeInvestmentProject(observation, episode);
    if (project && JSON.stringify(project) !== JSON.stringify(expense)) {
      // Existing ship decisions carry fleet-assignment receipts. Keep them
      // intact, and let the ordinary planner issue newly funded ship orders.
      const ship = project.type === "buildStarbaseShip" || project.type === "buildPlanetShip";
      const action = !ship && affordableWithReserve(observation, project, true) ? protectDevelopmentWorkforce(observation, project) ?? project : fundActiveProject(observation, project);
      if (action) decisions = [...decisions.filter(({ action }) => action !== expense), { action }];
    }
  }
  if (!recovery && solvent && !decisions.some(({ action }) => action.type === "setPlanetJobLock")) {
    const allocation = activeAllocationAction(observation, episode);
    // Re-evaluate building forecasts after any workforce change.
    if (allocation) decisions = [...decisions.filter(({ action }) => !["buildDistrict", "buildPlanetBuilding", "upgradePlanetBuilding"].includes(action.type)), { action: allocation }];
  }
  const occupied = new Set(decisions.flatMap(({ action }) =>
    "fleetId" in action && typeof action.fleetId === "string" ? [action.fleetId]
    : action.type === "mergeFleets" ? [action.targetFleetId, ...action.sourceFleetIds]
    : action.type === "repairFleet" ? [action.constructionFleetId, action.targetFleetId] : []));
  const idle = fleets.fleets.filter((fleet) => fleet.ownerId === factionId && isAiFleetAvailable(fleet) && !fleet.orderType
    && !fleet.retreatState && !fleet.stationaryStarbaseId && !fleet.stationaryPlanetId && !fleet.repairOrder && !occupied.has(fleet.id));
  const military = idle.filter((fleet) => strength(observation, fleet) > 0).sort((a, b) => strength(observation, b) - strength(observation, a) || a.id.localeCompare(b.id));
  const hasNavy = fleets.fleets.some((fleet) => fleet.ownerId === factionId && !fleet.stationaryStarbaseId
    && !fleet.stationaryPlanetId && strength(observation, fleet) > 0);
  const wars = diplomacy.countries.filter((country) => country.atWar);
  rememberWarBorders(observation, episode);

  // Diplomacy always remains available with the war tag disabled. Never accept a
  // peace that gives away our assets or a treaty replacement without evaluating it.
  const incoming = diplomacy.proposals.find((proposal) => proposal.toFactionId === factionId && proposal.status === "pending");
  if (incoming) {
    const assessment = peaceAssessment(observation, episode, incoming.fromFactionId, solvent, hasNavy);
    const accept = incoming.kind === "peace" ? !!incoming.peaceTerms
      && (incoming.peaceTerms.mode === "statusQuo" ? assessment.acceptStatusQuo : assessment.acceptWhitePeace)
      && !incoming.peaceTerms.transfers.length && !incoming.peaceTerms.enforcedArticleIds.length
      : !wars.some((country) => country.faction.id === incoming.fromFactionId) && !incoming.replacesTreatyId;
    decisions.push({ action: { type: "respondDiplomacyProposal", proposalId: incoming.id, response: accept ? "accept" : "decline" } });
  } else if (year >= episode.nextDiplomacyYear) {
    const longWar = diplomacy.wars.find((war) => !war.endedAtYear && (war.attackerFactionId === factionId || war.defenderFactionId === factionId)
      && (year - war.startedAtYear >= 3 || !solvent || !hasNavy));
    if (longWar) {
      const targetFactionId = longWar.attackerFactionId === factionId ? longWar.defenderFactionId : longWar.attackerFactionId;
      const assessment = peaceAssessment(observation, episode, targetFactionId, solvent, hasNavy);
      if (!diplomacy.proposals.some((proposal) => proposal.status === "pending" && proposal.kind === "peace"
        && [proposal.fromFactionId, proposal.toFactionId].includes(targetFactionId)
        && [proposal.fromFactionId, proposal.toFactionId].includes(factionId))) decisions.push({ action: { type: "proposePeace", targetFactionId,
        terms: { mode: assessment.proposeStatusQuo ? "statusQuo" : "whitePeace", transfers: [], enforcedArticleIds: [], enforcedDurationYears: 1 } } });
    }
  }

  // Assemble co-located fleets before risking an offensive. Existing orders and
  // caretaker defense/repair decisions take priority.
  const main = military[0];
  const source = main && military.find((fleet) => fleet.id !== main.id && fleet.currentStarId === main.currentStarId);
  if (main && source) {
    decisions.push({ action: { type: "mergeFleets", targetFleetId: main.id, sourceFleetIds: [source.id] } });
    occupied.add(main.id); occupied.add(source.id);
  }
  // A navy used for early scouting must not strand later reinforcements at its
  // shipyard. Regroup through observed legal routes; emergency defense and
  // repairs above retain priority. A lone early corvette can still explore.
  if (main && !source && (military.length > 1 || wars.length
    || fleets.ships.some((ship) => ship.ownerId === factionId && ship.shipKind === "scienceShip"))) {
    const rally = owners.get(main.currentStarId) === factionId ? main.currentStarId
      : fleets.starbases.find((base) => base.ownerId === factionId && base.status === "online"
        && candidates.movement.some((action) => action.type === "moveFleet" && action.fleetId === main.id && action.targetStarId === base.starId))?.starId;
    if (rally !== undefined) for (const fleet of military.filter((fleet) => !occupied.has(fleet.id) && fleet.currentStarId !== rally)) {
      const move = candidates.movement.find((action) => action.type === "moveFleet" && action.fleetId === fleet.id && action.targetStarId === rally);
      if (move) { decisions.push({ action: move }); occupied.add(fleet.id); }
    }
  }
  const currentEntities = new Set(snapshot.intelligence.entities.filter((entity) => entity.fields.existence?.status === "current"
    && entity.fields.existence.value === true && entity.fields.currentStarId?.status === "current").map((entity) => entity.id));
  for (const fleet of military.filter((entry) => !occupied.has(entry.id))) {
    const enemiesHere = fleets.fleets.filter((enemy) => enemy.currentStarId === fleet.currentStarId && currentEntities.has(enemy.id)
      && wars.some((country) => country.faction.id === enemy.ownerId));
    const enemyPower = enemiesHere.reduce((sum, enemy) => sum + strength(observation, enemy), 0);
    if (enemyPower > strength(observation, fleet) * 1.5) {
      const home = candidates.movement.find((action) => action.type === "moveFleet" && action.fleetId === fleet.id && owners.get(action.targetStarId) === factionId);
      if (home?.type === "moveFleet") {
        decisions.push({ action: { type: "retreatFleetTo", fleetId: fleet.id, targetStarId: home.targetStarId } });
        occupied.add(fleet.id);
      }
      continue;
    }
    const target = candidates.movement.find((action) => action.type === "moveFleet" && action.fleetId === fleet.id
      && wars.some((country) => country.faction.id === owners.get(action.targetStarId))
      && opportunities.some((opportunity) => opportunity.starId === action.targetStarId
        && opportunity.reason !== "unknown-defenses" && opportunity.requiredPower <= strength(observation, fleet)));
    if (target?.type === "moveFleet" && solvent) {
      decisions.push({ action: { type: "attackSystem", fleetId: fleet.id, targetStarId: target.targetStarId } });
      occupied.add(fleet.id);
    }
  }

  // Small expeditionary forces follow the navy into systems we already control.
  // Normal orbit, recruitment cap, crew, and invasion validation still apply.
  const armyFleets = fleets.fleets.filter((fleet) => fleet.ownerId === factionId && !fleet.retreatState && fleet.combatStatus === "idle"
    && fleet.shipIds.length > 0 && fleet.shipIds.every((id) => fleets.ships.some((ship) => ship.id === id && ship.shipKind === "armyShip")));
  for (const transport of armyFleets) {
    const target = observation.planets.planets.map((entry) => entry.planetState).find((planet) => planet.isHabited && planet.ownerId !== null && owners.get(planet.starId) === factionId
      && wars.some((country) => country.faction.id === planet.ownerId)
      && !fleets.fleets.some((enemy) => enemy.currentStarId === planet.starId && currentEntities.has(enemy.id) && wars.some((country) => country.faction.id === enemy.ownerId)));
    if (!target) continue;
    if (transport.phase === "orbitingPlanet" && transport.orbitTarget?.kind === "planet" && transport.orbitTarget.planetId === target.id) {
      decisions.push({ action: { type: "beginPlanetInvasion", fleetId: transport.id, planetId: target.id } });
    } else if (isAiFleetAvailable(transport) && (transport.currentStarId === target.starId
      || candidates.movement.some((action) => action.type === "moveFleet" && action.fleetId === transport.id && action.targetStarId === target.starId))) {
      decisions.push({ action: { type: "orbitPlanet", fleetId: transport.id, planetId: target.id } });
    }
  }
  const pendingArmies = [...fleets.starbases.filter((base) => base.ownerId === factionId).flatMap((base) => base.shipQueue),
    ...ownedPlanets.flatMap((entry) => entry.planetState.defense.shipQueue)].filter((item) => item.kind === "armyBuild");
  const ownArmies = snapshot.armies.filter((army) => army.ownerId === factionId && army.mobility === "mobile");
  const spending = new Set(["marketTrade", "buildDistrict", "buildPlanetBuilding", "upgradePlanetBuilding", "buildPlanetDefenseBuilding", "buildStarbase", "buildStarbaseBuilding", "buildStarbaseShip", "buildPlanetShip"]);
  if (!recovery && wars.length && solvent && economy && economy.crewStockpile >= ARMY_TOTAL_CREW_DEMAND && ownArmies.length + pendingArmies.length < 2
    && year >= episode.nextShipYear && !decisions.some(({ action }) => spending.has(action.type))) {
    const yard = fleets.starbases.find((base) => base.ownerId === factionId && base.status === "online" && base.buildingSlots.includes("shipyard") && base.shipQueue.length < 2);
    const species = ownedPlanets.flatMap((entry) => entry.planetState.speciesPopulations).find((entry) => entry.population >= 300_000_000);
    if (yard && species) {
      const action: GameAction = { type: "queueArmyRecruitment", yardKind: "starbase", yardId: yard.id, armyTypeId: "lightInfantry", speciesId: species.speciesId };
      if (affordableWithReserve(observation, action, true) && economy.monthlyDelta.energy > 1 && economy.monthlyDelta.goods > 1) decisions.push({ action });
    }
  }

  if (!recovery && allowWarDeclarations && !wars.length && solvent && main && !occupied.has(main.id) && year >= episode.nextWarYear) {
    const target = opportunities.find((opportunity) => opportunity.reason === "border-outpost"
      && strength(observation, main) >= opportunity.requiredPower
      && snapshot.hyperlanes.some(([a, b]) => {
        const staging = a === opportunity.starId ? b : b === opportunity.starId ? a : -1;
        return owners.get(staging) === factionId && (main.currentStarId === staging
          || candidates.movement.some((action) => action.type === "moveFleet" && action.fleetId === main.id && action.targetStarId === staging));
      }));
    if (target) {
      (episode.warBaselineSystems ??= {})[`pending:${target.targetFactionId}`] = snapshot.starOwnership.filter(([, owner]) => owner === factionId).map(([id]) => id);
      decisions.push({ action: { type: "declareWar", targetFactionId: target.targetFactionId } });
      occupied.add(main.id);
    }
  }

  const known = new Set(snapshot.knownStarIds ?? []);
  for (const [key, until] of Object.entries(episode.blockedScoutTargets ?? {})) if (until <= year) delete episode.blockedScoutTargets![key];
  const scienceExists = fleets.ships.some((ship) => ship.ownerId === factionId && ship.shipKind === "scienceShip");
  for (const scout of idle.filter((fleet) => !occupied.has(fleet.id) && (fleet.shipIds.some((id) => fleets.ships.some((ship) => ship.id === id && ship.shipKind === "scienceShip"))
    || !scienceExists && !wars.length && fleet.id === main?.id))) {
    if (!episode.exploredStarIds.includes(scout.currentStarId)) episode.exploredStarIds.push(scout.currentStarId);
    const destinations = candidates.movement.filter((action) => action.type === "moveFleet" && action.fleetId === scout.id
      && (episode.blockedScoutTargets?.[`${scout.id}:${action.targetStarId}`] ?? 0) <= year
      && !episode.exploredStarIds.includes(action.targetStarId)
      && !fleets.fleets.some((fleet) => fleet.ownerId !== factionId && fleet.currentStarId === action.targetStarId && wars.some((country) => country.faction.id === fleet.ownerId)));
    const score = (starId: number) => snapshot.hyperlanes.filter(([a, b]) => a === starId && !known.has(b) || b === starId && !known.has(a)).length * 10
      + (owners.get(starId) === factionId ? 0 : 1);
    destinations.sort((a, b) => a.type === "moveFleet" && b.type === "moveFleet" ? score(b.targetStarId) - score(a.targetStarId) || a.targetStarId - b.targetStarId : 0);
    if (destinations[0]) decisions.push({ action: destinations[0] });
  }
  return decisions;
}

export function recordActiveAcceptance(episode: ActiveEpisode, action: GameAction, year: number): void {
  recordPassiveAcceptance(episode, action, year);
  if ((action.type === "buildStarbaseShip" || action.type === "buildPlanetShip") && MILITARY.has(action.shipKind)) episode.militaryOrdersSinceOutpost = (episode.militaryOrdersSinceOutpost ?? 0) + 1;
  if (action.type === "buildStarbase") episode.militaryOrdersSinceOutpost = 0;
  if (action.type === "buildStarbase") episode.nextOutpostYear = year + 7 / GAME_DAYS_PER_YEAR;
  if (action.type === "colonizePlanet") episode.nextColonyYear = year + 30 / GAME_DAYS_PER_YEAR;
  if (["buildDistrict", "buildPlanetBuilding", "upgradePlanetBuilding", "buildPlanetDefenseBuilding", "buildStarbaseBuilding"].includes(action.type)) episode.nextDevelopmentYear = year + 7 / GAME_DAYS_PER_YEAR;
  if (["buildDistrict", "buildPlanetBuilding", "upgradePlanetBuilding"].includes(action.type)) episode.nextInvestmentYear = year + 90 / GAME_DAYS_PER_YEAR;
  if (["buildStarbaseShip", "buildPlanetShip", "queueArmyRecruitment"].includes(action.type)) episode.nextShipYear = year + 7 / GAME_DAYS_PER_YEAR;
  if (action.type === "declareWar" || action.type === "proposePeace" || action.type === "respondDiplomacyProposal") episode.nextWarYear = year + 5;
  if (action.type === "proposePeace" || action.type === "respondDiplomacyProposal") episode.nextDiplomacyYear = year + 0.25;
}

/** A failed route is ordinary player-visible feedback, not a reveal of hidden
 * borders. Try other scouting destinations before revisiting the same failure. */
export function recordActiveRejection(episode: ActiveEpisode, action: GameAction, year: number, message: string): void {
  if (action.type === "declareWar") delete episode.warBaselineSystems?.[`pending:${action.targetFactionId}`];
  if (action.type === "moveFleet" && message.includes("route")) (episode.blockedScoutTargets ??= {})[`${action.fleetId}:${action.targetStarId}`] = year + 90 / GAME_DAYS_PER_YEAR;
}

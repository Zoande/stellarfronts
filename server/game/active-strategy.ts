import { STARBASE_SHIP_DEFINITIONS } from "../../src/data/Starbase";
import type { AiObservation } from "./ai-observation";

const MILITARY = new Set(["corvette", "destroyer", "cruiser", "battleship", "defensePlatform"]);
/** Potential threat uses currently visible forces near our borders, never stale
 * sightings as proof of an immediate danger or private opponent designs. */
export function hasVisibleMilitaryThreat(observation: AiObservation): boolean {
  const owners = new Map(observation.snapshot.starOwnership);
  const borders = new Set(observation.snapshot.hyperlanes.flatMap(([a, b]) => owners.get(a) === observation.factionId ? [a, b]
    : owners.get(b) === observation.factionId ? [a, b] : []));
  const current = new Set(observation.snapshot.intelligence.entities.filter((entry) => entry.kind === "fleet"
    && entry.fields.existence?.status === "current" && entry.fields.existence.value === true
    && entry.fields.currentStarId?.status === "current").map((entry) => entry.id));
  const power = (ownerId: number, shipIds?: string[]) => observation.fleets.ships.filter((ship) => ship.ownerId === ownerId
    && MILITARY.has(ship.shipKind) && (!shipIds || shipIds.includes(ship.id))).reduce((sum, ship) => sum + ship.hull + ship.armor + ship.shield, 0);
  const ownPower = power(observation.factionId);
  return observation.fleets.fleets.some((fleet) => fleet.ownerId !== observation.factionId && current.has(fleet.id) && borders.has(fleet.currentStarId)
    && !observation.diplomacy.countries.find((country) => country.faction.id === fleet.ownerId)?.activeTreatyCount
    && power(fleet.ownerId, fleet.shipIds) > Math.max(100, ownPower * 1.25));
}

export function hasPeaceExpansionGoal(observation: AiObservation): boolean {
  if (observation.diplomacy.countries.some((country) => country.atWar) || hasVisibleMilitaryThreat(observation)) return false;
  if (!observation.fleets.ships.some((ship) => ship.ownerId === observation.factionId && ship.shipKind === "constructionShip" && ship.hull > 0)) return false;
  const owners = new Map(observation.snapshot.starOwnership), known = new Set(observation.snapshot.knownStarIds);
  const goals = new Set(observation.snapshot.hyperlanes.flatMap(([a, b]) => owners.get(a) === observation.factionId && known.has(b) && (owners.get(b) ?? -1) < 0 ? [b]
    : owners.get(b) === observation.factionId && known.has(a) && (owners.get(a) ?? -1) < 0 ? [a] : []));
  if (!goals.size) return false;
  const adjacency = new Map<number, number[]>();
  for (const [a, b] of observation.snapshot.hyperlanes) { adjacency.set(a, [...adjacency.get(a) ?? [], b]); adjacency.set(b, [...adjacency.get(b) ?? [], a]); }
  const queue = observation.fleets.fleets.filter((fleet) => fleet.ownerId === observation.factionId && fleet.phase !== "missingInAction" && !fleet.retreatState
    && fleet.shipIds.some((id) => observation.fleets.ships.some((ship) => ship.id === id && ship.shipKind === "constructionShip"))).map((fleet) => fleet.currentStarId);
  const reached = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    if (goals.has(queue[i])) return true;
    for (const next of adjacency.get(queue[i]) ?? []) {
      const owner = owners.get(next) ?? -1;
      if (!known.has(next) || reached.has(next) || owner >= 0 && owner !== observation.factionId
        && observation.diplomacy.countries.find((country) => country.faction.id === owner)?.theirBorderPolicy !== "open") continue;
      reached.add(next); queue.push(next);
    }
  }
  return false;
}

/** Local objectives use remembered public defenses, with a reserve for unseen
 * reinforcements. Missing observations never imply an undefended system. */
export function localWarOpportunities(observation: AiObservation) {
  const { factionId, snapshot, fleets, diplomacy } = observation;
  const owners = new Map(snapshot.starOwnership);
  const targets = new Set(snapshot.hyperlanes.flatMap(([a, b]) => owners.get(a) === factionId && (owners.get(b) ?? -1) >= 0 && owners.get(b) !== factionId ? [b]
    : owners.get(b) === factionId && (owners.get(a) ?? -1) >= 0 && owners.get(a) !== factionId ? [a] : []));
  const entityById = new Map(snapshot.intelligence.entities.map((entity) => [entity.id, entity]));
  return [...targets].sort((a, b) => a - b).map((starId) => {
    const targetFactionId = owners.get(starId)!;
    const country = diplomacy.countries.find((entry) => entry.faction.id === targetFactionId);
    const bases = fleets.starbases.filter((base) => base.starId === starId && base.ownerId === targetFactionId);
    const localFleets = fleets.fleets.filter((fleet) => fleet.currentStarId === starId && fleet.ownerId === targetFactionId);
    const localShips = fleets.ships.filter((ship) => localFleets.some((fleet) => fleet.shipIds.includes(ship.id)));
    const unknownShips = localFleets.reduce((sum, fleet) => sum + fleet.shipIds.filter((id) => !localShips.some((ship) => ship.id === id)).length, 0);
    const unknownPower = unknownShips * 2 * (STARBASE_SHIP_DEFINITIONS.corvette.combat.maxHull + STARBASE_SHIP_DEFINITIONS.corvette.combat.maxArmor + STARBASE_SHIP_DEFINITIONS.corvette.combat.maxShield);
    const defense = bases.reduce((sum, base) => sum + Math.max(0, base.hull) + Math.max(0, base.armor) + Math.max(0, base.shield), 0)
      + localShips.reduce((sum, ship) => {
        const fallback = STARBASE_SHIP_DEFINITIONS[ship.shipKind].combat;
        return sum + (ship.maxHull > 0 ? Math.max(0, ship.hull) + Math.max(0, ship.armor) + Math.max(0, ship.shield)
          : (fallback.maxHull + fallback.maxArmor + fallback.maxShield) * 1.25);
      }, 0) + unknownPower;
    const stale = localFleets.some((fleet) => entityById.get(fleet.id)?.fields.currentStarId?.status !== "current");
    const inhabited = snapshot.habitedPlanetSystemIds.includes(starId);
    return { starId, targetFactionId, defense, requiredPower: defense * (stale ? 1.8 : 1.5) + 354,
      reason: !country ? "unknown-country" : country.activeTreatyCount ? "treaty" : !bases.length || bases.some((base) => base.maxHull <= 0) ? "unknown-defenses"
        : inhabited ? "requires-invasion" : bases.some((base) => base.level !== "outpost") ? "fortified-system" : "border-outpost" };
  });
}

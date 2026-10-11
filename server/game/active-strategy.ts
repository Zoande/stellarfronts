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

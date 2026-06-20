import type { GalaxyPerspective } from "../../src/data/Factions";
import type { FactionState } from "../../src/game/GameProtocol";
import type {
  ServerCombatContact,
  ServerFleet,
  ServerShip,
  ServerStar,
  ServerStarbase,
  ServerStarbaseSummary,
  SystemDetailPayload,
  SystemHyperlaneExitPoint,
} from "../../src/game/GameProtocol";
import type { PlanetState } from "../../src/data/Economy";
import type { ShipDesign } from "../../src/data/ShipDesigns";
import type { FactionTechnologyView } from "../../src/data/Technology";
import type { StarData } from "../../src/data/StarMap";
import {
  getHyperlaneDirection,
  getHyperlaneExitSystemPosition,
} from "../../src/data/SystemCoordinates";

export interface BuildSystemDetailPayloadInput {
  perspective: GalaxyPerspective;
  starId: number;
  stars: StarData[];
  visibleStars: StarData[];
  knownStarIds: Set<number> | null;
  hyperlanes: Array<[number, number]>;
  planetStates: PlanetState[];
  fleets: ServerFleet[];
  ships: ServerShip[];
  starbases: ServerStarbase[];
  recentCombatContacts: ServerCombatContact[];
  factions: FactionState[];
  shipDesigns: ShipDesign[];
  technologies: FactionTechnologyView[];
  starOwnership: number[];
}

export type BuildSystemDetailPayloadResult =
  | { ok: true; payload: SystemDetailPayload }
  | { ok: false; error: string };

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function createSystemDetailRevision(payload: SystemDetailPayload): string {
  const input = stableStringify(payload);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function summarizeSystemStarbase(starbase: ServerStarbase): ServerStarbaseSummary {
  const {
    economy: _economy,
    buildingSlots: _buildingSlots,
    constructionQueue: _constructionQueue,
    shipQueue: _shipQueue,
    ...summary
  } = starbase;
  return summary;
}

export function buildSystemHyperlaneExits(
  starId: number,
  stars: StarData[],
  visibleStars: StarData[],
  hyperlanes: Array<[number, number]>,
): SystemHyperlaneExitPoint[] {
  const star = stars[starId];
  if (!star) return [];

  return hyperlanes
    .map(([a, b]) => {
      if (a !== starId && b !== starId) return null;
      const targetStarId = a === starId ? b : a;
      const targetStar = stars[targetStarId];
      if (!targetStar) return null;
      const visibleTarget = visibleStars[targetStarId] ?? targetStar;
      const direction = getHyperlaneDirection(star, targetStar);
      return {
        starId: targetStarId,
        name: visibleTarget.name,
        dx: direction.dx,
        dz: direction.dz,
        systemPosition: getHyperlaneExitSystemPosition(direction),
      };
    })
    .filter((exit): exit is SystemHyperlaneExitPoint => exit !== null);
}

export function buildSystemDetailPayload(
  input: BuildSystemDetailPayloadInput,
): BuildSystemDetailPayloadResult {
  const star = input.stars[input.starId];
  if (!Number.isInteger(input.starId) || !star) {
    return { ok: false, error: "System is not available." };
  }
  if (input.perspective.mode !== "observer" && !input.knownStarIds?.has(input.starId)) {
    return { ok: false, error: "System is not available." };
  }

  const fleets = input.fleets.filter((fleet) => (
    fleet.currentStarId === input.starId && fleet.phase !== "jumpingHyperlane"
  ));
  const fleetIds = new Set(fleets.map((fleet) => fleet.id));
  const ships = input.ships.filter((ship) => fleetIds.has(ship.fleetId));
  const starbases = input.starbases
    .filter((starbase) => starbase.starId === input.starId)
    .map(summarizeSystemStarbase);
  const entityStarIds = new Map<string, number>();
  for (const fleet of fleets) entityStarIds.set(fleet.id, fleet.currentStarId);
  for (const starbase of starbases) entityStarIds.set(starbase.id, starbase.starId);
  const recentCombatContacts = input.recentCombatContacts.filter((contact) => (
    entityStarIds.get(contact.sourceId) === input.starId
    || entityStarIds.get(contact.targetId) === input.starId
  ));
  const perspectiveFactionId = input.perspective.mode === "faction" ? input.perspective.factionId : null;
  const technology = perspectiveFactionId !== null
    ? input.technologies.find((view) => view.factionId === perspectiveFactionId) ?? null
    : null;
  const owner = input.starOwnership[input.starId];

  return {
    ok: true,
    payload: {
      star: star as ServerStar,
      planetStates: input.planetStates.filter((planetState) => planetState.starId === input.starId),
      fleets,
      ships,
      starbases,
      recentCombatContacts,
      hyperlaneExits: buildSystemHyperlaneExits(
        input.starId,
        input.stars,
        input.visibleStars,
        input.hyperlanes,
      ),
      factions: input.factions,
      shipDesigns: input.shipDesigns,
      technology,
      starOwnerId: Number.isInteger(owner) && owner >= 0 ? owner : null,
    },
  };
}

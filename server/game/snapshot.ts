// =============================================================================
// Snapshot & update payload builders — extracted from server/index.ts
//
// These assemble the per-perspective GameSnapshot / GameUpdate payloads that the
// WebSocket layer broadcasts. They read RuntimeContext and apply fog-of-war
// redaction via the visibility helpers; the actual socket send stays in index.ts.
// =============================================================================

import { StarType } from "../../src/data/StarMap";
import type { StarData } from "../../src/data/StarMap";
import type { PlanetState } from "../../src/data/Economy";
import type { GalaxyPerspective } from "../../src/data/Factions";
import { getBorderPolicy, areFactionsAtWar } from "../../src/data/Diplomacy";
import type {
  DiplomacyMovementPayload,
  FactionState,
  GameSnapshot,
  GameUpdate,
  ServerStarbase,
  ServerStarbaseSummary,
  ServerUpdateField,
} from "../../src/game/GameProtocol";
import { getVisibleTechnologyViews } from "./research";
import { getVisibleSet, getKnownSet, isFleetVisible } from "./visibility";
import type { RuntimeContext } from "./types";

// ---------------------------------------------------------------------------
// Pure payload helpers
// ---------------------------------------------------------------------------

export function createRedactedStar(star: StarData): StarData {
  return {
    id: star.id,
    name: "Unknown Signal",
    type: StarType.G,
    x: star.x,
    z: star.z,
    luminosity: 0.6,
    color: [0.42, 0.62, 0.58],
    galaxyPulseAmplitude: 0.01,
    galaxyPulseFrequency: 0.4,
    objectDetails: undefined as unknown as StarData["objectDetails"],
    system: { planets: [] },
  };
}

export function createMapStar(star: StarData): StarData {
  return {
    ...star,
    objectDetails: undefined as unknown as StarData["objectDetails"],
    system: { planets: [] },
  };
}

export function toOwnershipEntries(ownership: number[]): Array<[number, number]> {
  const entries: Array<[number, number]> = [];
  ownership.forEach((ownerId, starId) => {
    if (ownerId >= 0) entries.push([starId, ownerId]);
  });
  return entries;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function createRevision(payload: unknown): string {
  const input = stableStringify(payload);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function summarizeStarbase(starbase: ServerStarbase): ServerStarbaseSummary {
  const {
    economy: _economy,
    buildingSlots: _buildingSlots,
    constructionQueue: _constructionQueue,
    shipQueue: _shipQueue,
    ...summary
  } = starbase;
  return summary;
}

// ---------------------------------------------------------------------------
// ctx-scoped visible-state assembly
// ---------------------------------------------------------------------------

export function createVisibleStars(ctx: RuntimeContext, perspective: GalaxyPerspective, knownSet: Set<number> | null): StarData[] {
  if (perspective.mode === "observer" || knownSet === null) {
    return ctx.state.stars.map((star) => createMapStar(star));
  }
  return ctx.state.stars.map((star) => (knownSet.has(star.id) ? createMapStar(star) : createRedactedStar(star)));
}

export function createVisiblePlanetStates(ctx: RuntimeContext, knownSet: Set<number> | null, includeDetails: boolean): PlanetState[] {
  if (!includeDetails) return [];
  if (knownSet === null) return ctx.state.planetStates;
  return ctx.state.planetStates.filter((planetState) => knownSet.has(planetState.starId));
}

export function createHabitedPlanetSystemIds(ctx: RuntimeContext, knownSet: Set<number> | null): number[] {
  const systemIds = new Set<number>();
  for (const planetState of ctx.state.planetStates) {
    if (!planetState.isHabited) continue;
    if (knownSet !== null && !knownSet.has(planetState.starId)) continue;
    systemIds.add(planetState.starId);
  }
  return Array.from(systemIds).sort((a, b) => a - b);
}

export function createDiplomacyMovementPayload(ctx: RuntimeContext, perspective: GalaxyPerspective): DiplomacyMovementPayload {
  if (perspective.mode !== "faction") {
    return {
      playerFactionId: null,
      openBorderFactionIds: [],
      warFactionIds: [],
    };
  }
  const playerFactionId = perspective.factionId;
  const openBorderFactionIds: number[] = [];
  const warFactionIds: number[] = [];
  for (const faction of ctx.state.factions) {
    if (faction.id === playerFactionId) continue;
    if (getBorderPolicy(ctx.state.diplomacy, faction.id, playerFactionId) === "open") {
      openBorderFactionIds.push(faction.id);
    }
    if (areFactionsAtWar(ctx.state.diplomacy, playerFactionId, faction.id)) {
      warFactionIds.push(faction.id);
    }
  }
  return {
    playerFactionId,
    openBorderFactionIds: openBorderFactionIds.sort((a, b) => a - b),
    warFactionIds: warFactionIds.sort((a, b) => a - b),
  };
}

export function createVisibleState(ctx: RuntimeContext, perspective: GalaxyPerspective): Omit<GameSnapshot, "type" | "perspective" | "stars"> {
  const visibleSet = getVisibleSet(ctx, perspective);
  const knownSet = getKnownSet(ctx, perspective);
  const visibleStarIds = visibleSet ? Array.from(visibleSet).sort((a, b) => a - b) : null;
  const knownStarIds = knownSet ? Array.from(knownSet).sort((a, b) => a - b) : null;
  const factions: FactionState[] = ctx.state.factions.map((faction) => {
    const isOwnFaction = perspective.mode === "faction" && perspective.factionId === faction.id;
    return {
      ...faction,
      homeStarId: visibleSet === null || isOwnFaction ? faction.homeStarId : -1,
      discoveredStarIds: visibleSet === null || isOwnFaction
        ? ctx.state.discoveredByFaction[String(faction.id)] ?? []
        : [],
    };
  });
  const visibleStarbases = visibleSet
    ? ctx.state.starbases.filter((starbase) => visibleSet.has(starbase.starId))
    : ctx.state.starbases;
  const fleets = ctx.state.fleets.filter((fleet) => isFleetVisible(fleet, visibleSet, perspective));
  const visibleFleetIds = new Set(fleets.map((fleet) => fleet.id));
  const ships = ctx.state.ships.filter((ship) => visibleFleetIds.has(ship.fleetId));
  const shipDesigns = perspective.mode === "faction"
    ? ctx.state.shipDesigns.filter((design) => design.ownerId === perspective.factionId)
    : ctx.state.shipDesigns;
  const hyperlanes = visibleSet
    ? ctx.state.hyperlanes.filter(([a, b]) => knownSet?.has(a) || knownSet?.has(b))
    : ctx.state.hyperlanes;
  const starOwnership = perspective.mode === "faction"
    ? (ctx.state.lastKnownOwnershipByFaction[String(perspective.factionId)] ?? [])
      .slice(0, ctx.state.stars.length)
    : ctx.state.starOwnership;
  while (starOwnership.length < ctx.state.stars.length) starOwnership.push(-1);
  const factionEconomies = perspective.mode === "faction"
    ? ctx.state.factionEconomies.filter((economy) => economy.factionId === perspective.factionId)
    : [];
  const governments = perspective.mode === "faction"
    ? ctx.state.governments.filter((government) => government.factionId === perspective.factionId)
    : ctx.state.governments;
  const leaders = perspective.mode === "faction"
    ? ctx.state.leaders.filter((leader) => leader.factionId === perspective.factionId && leader.status !== "dead")
    : ctx.state.leaders.filter((leader) => leader.status !== "dead");
  const species = ctx.state.species;
  // Events, situations, and trade alerts are private to the owning faction.
  const situations = perspective.mode === "faction"
    ? ctx.state.situations.filter((situation) => situation.factionId === perspective.factionId)
    : [];
  const events = perspective.mode === "faction"
    ? ctx.state.events.filter((event) => event.factionId === perspective.factionId)
    : [];
  const tradeAlerts = perspective.mode === "faction"
    ? (ctx.state.market.tradeAlerts ?? []).filter((alert) => alert.playerId === perspective.factionId)
    : [];
  const recentCombatContacts = visibleSet
    ? ctx.state.recentCombatContacts.filter((contact) => {
      const sourceStarId = contact.sourceKind === "fleet"
        ? ctx.state.fleets.find((fleet) => fleet.id === contact.sourceId)?.currentStarId
        : ctx.state.starbases.find((starbase) => starbase.id === contact.sourceId)?.starId;
      const targetStarId = contact.targetKind === "fleet"
        ? ctx.state.fleets.find((fleet) => fleet.id === contact.targetId)?.currentStarId
        : ctx.state.starbases.find((starbase) => starbase.id === contact.targetId)?.starId;
      return (sourceStarId !== undefined && visibleSet.has(sourceStarId)) || (targetStarId !== undefined && visibleSet.has(targetStarId));
    })
    : ctx.state.recentCombatContacts;

  return {
    clock: {
      year: ctx.state.clock.year,
      speedMultiplier: ctx.state.clock.speedMultiplier,
      tickSizeDays: ctx.state.clock.tickSizeDays,
      tickSpeedSeconds: ctx.state.clock.tickSpeedSeconds,
      paused: ctx.state.clock.paused,
      syncedAtMs: ctx.state.clock.syncedAtMs,
    },
    hyperlanes,
    factions,
    starOwnership: toOwnershipEntries(starOwnership),
    visibleStarIds,
    knownStarIds,
    ships,
    shipDesigns,
    fleets,
    starbases: visibleStarbases.map(summarizeStarbase),
    technologies: getVisibleTechnologyViews(ctx, perspective),
    leaders,
    governments,
    species,
    recentCombatContacts,
    diplomacy: createDiplomacyMovementPayload(ctx, perspective),
    planetStates: createVisiblePlanetStates(ctx, knownSet, perspective.mode === "observer"),
    factionEconomies,
    habitedPlanetSystemIds: createHabitedPlanetSystemIds(ctx, knownSet),
    situations,
    events,
    tradeAlerts,
  };
}

export function createSnapshot(ctx: RuntimeContext, perspective: GalaxyPerspective): GameSnapshot {
  const visibleState = createVisibleState(ctx, perspective);
  const knownSet = getKnownSet(ctx, perspective);

  return {
    type: "snapshot",
    protocolVersion: 2,
    perspective,
    ...visibleState,
    stars: createVisibleStars(ctx, perspective, knownSet),
  };
}

export function createUpdate(ctx: RuntimeContext, perspective: GalaxyPerspective, changed: ServerUpdateField[]): GameUpdate {
  const visibleState = createVisibleState(ctx, perspective);
  const knownSet = getKnownSet(ctx, perspective);
  const update: GameUpdate = {
    type: "update",
    protocolVersion: 2,
    perspective,
    changed,
  };

  if (changed.includes("clock")) {
    update.clock = visibleState.clock;
  }
  if (changed.includes("visibility")) {
    update.stars = createVisibleStars(ctx, perspective, knownSet);
    update.hyperlanes = visibleState.hyperlanes;
    update.factions = visibleState.factions;
    update.starOwnership = visibleState.starOwnership;
    update.visibleStarIds = visibleState.visibleStarIds;
    update.knownStarIds = visibleState.knownStarIds;
    update.habitedPlanetSystemIds = visibleState.habitedPlanetSystemIds;
  }
  if (changed.includes("planetStates")) {
    update.planetStates = visibleState.planetStates;
  }
  if (changed.includes("habitedPlanetSystems")) {
    update.habitedPlanetSystemIds = visibleState.habitedPlanetSystemIds;
  }
  if (changed.includes("factionEconomies")) {
    update.factionEconomies = visibleState.factionEconomies;
  }
  if (changed.includes("ships")) {
    update.ships = visibleState.ships;
  }
  if (changed.includes("shipDesigns")) {
    update.shipDesigns = visibleState.shipDesigns;
  }
  if (changed.includes("fleets")) {
    update.fleets = visibleState.fleets;
  }
  if (changed.includes("starbases")) {
    update.starbases = visibleState.starbases;
  }
  if (changed.includes("technologies")) {
    update.technologies = visibleState.technologies;
  }
  if (changed.includes("leaders")) {
    update.leaders = visibleState.leaders;
  }
  if (changed.includes("governments")) {
    update.governments = visibleState.governments;
  }
  if (changed.includes("species")) {
    update.species = visibleState.species;
  }
  if (changed.includes("diplomacy")) {
    update.diplomacy = visibleState.diplomacy;
  }
  if (changed.includes("combatContacts") || changed.includes("visibility")) {
    update.recentCombatContacts = visibleState.recentCombatContacts;
  }
  if (changed.includes("situations")) {
    update.situations = visibleState.situations;
  }
  if (changed.includes("events")) {
    update.events = visibleState.events;
  }
  if (changed.includes("tradeAlerts")) {
    update.tradeAlerts = visibleState.tradeAlerts;
  }
  return update;
}

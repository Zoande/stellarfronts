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
import type { IntelEntityView, IntelValue } from "../../src/data/Intelligence";
import type { GalaxyPerspective } from "../../src/data/Factions";
import { getBorderPolicy, areFactionsAtWar } from "../../src/data/Diplomacy";
import type {
  DiplomacyMovementPayload,
  FactionState,
  GameSnapshot,
  GameUpdate,
  ServerStarbase,
  ServerStarbaseSummary,
  ServerFleet,
  ServerShip,
  ServerCombatProjectile,
  ServerUpdateField,
} from "../../src/game/GameProtocol";
import { getVisibleTechnologyViews } from "./research";
import { getVisibleSet, getKnownSet } from "./visibility";
import {
  getGalaxyIntelligenceView,
  getIntelEntityView,
  getKnownLanePairs,
  getKnownStarIds,
  getKnownSystemOwner,
} from "./intelligence";
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

function readIntel<T>(view: IntelEntityView, fieldId: string, fallback: T): T {
  const field = view.fields[fieldId] as IntelValue<T> | undefined;
  return field && field.status !== "unknown" ? field.value : fallback;
}

function materializeIntelFleet(source: ServerFleet, view: IntelEntityView): ServerFleet {
  const telemetry = view.fields.telemetry as IntelValue<ServerFleet> | undefined;
  if (telemetry && telemetry.status !== "unknown") return telemetry.value;
  const shipCountField = view.fields.shipCount as IntelValue<number> | undefined;
  const placeholderShipCount = shipCountField && shipCountField.status !== "unknown" ? Math.max(0, Number(shipCountField.value) || 0) : 1;
  return {
    id: source.id, ownerId: readIntel(view, "ownerId", -1), stationaryStarbaseId: readIntel(view, "stationaryStarbaseId", null), shipIds: Array.from({ length: placeholderShipCount }, (_, index) => `unknown:${source.id}:${index}`), formation: readIntel(view, "formation", "line"),
    currentStarId: readIntel(view, "currentStarId", -1), targetStarId: null, phase: "idle", phaseStartedAtYear: 0,
    phaseDurationDays: 0, route: [], routeIndex: 0, phaseProgress: 0, orderType: null, speed: 0,
    combatStance: "passive", retreatState: null, systemPosition: { x: 0, y: 0, z: 0 },
    hyperlanePosition: readIntel(view, "hyperlanePosition", null), movementPlan: null, orbitTargetPlanetId: null,
    orbitOffset: null, orbitTarget: null, mergeTargetFleetId: null,
    combatSettings: { behavior: "line", chasePolicy: "none", retreatPolicy: "none" },
    currentTacticalOrder: null, tacticalRadius: 0, maxWeaponRange: 0, minWeaponRange: 0,
    currentTargetId: null, currentTargetKind: null, combatStatus: "idle", lastCombatAtYear: null,
  };
}

function materializeIntelShip(source: ServerShip, view: IntelEntityView): ServerShip {
  const telemetry = view.fields.telemetry as IntelValue<ServerShip> | undefined;
  if (telemetry && telemetry.status !== "unknown") return telemetry.value;
  return {
    id: source.id,
    ownerId: readIntel(view, "ownerId", -1),
    fleetId: readIntel(view, "fleetId", ""),
    shipKind: readIntel(view, "shipKind", "corvette"),
    speed: 0, hp: 0, maxHp: 0, shield: 0, maxShield: 0, armor: 0, maxArmor: 0, hull: 0, maxHull: 0,
  };
}

function materializeIntelStarbaseSummary(source: ServerStarbase, view: IntelEntityView): ServerStarbaseSummary {
  return {
    id: source.id,
    ownerId: readIntel(view, "ownerId", -1),
    starId: readIntel(view, "starId", -1),
    systemPosition: readIntel(view, "systemPosition", { x: 0, y: 0, z: 0 }),
    status: readIntel(view, "status", "building"),
    buildProgress: readIntel(view, "buildProgress", 0),
    shield: readIntel(view, "shield", 0), maxShield: readIntel(view, "maxShield", 0),
    armor: readIntel(view, "armor", 0), maxArmor: readIntel(view, "maxArmor", 0),
    hull: readIntel(view, "hull", 0), maxHull: readIntel(view, "maxHull", 0),
    weaponCooldowns: readIntel(view, "weaponCooldowns", {}),
    lastShieldDamageAtYear: null,
    level: readIntel(view, "level", "outpost"),
  };
}

// ---------------------------------------------------------------------------
// ctx-scoped visible-state assembly
// ---------------------------------------------------------------------------

export function createVisibleStars(ctx: RuntimeContext, perspective: GalaxyPerspective, knownSet: Set<number> | null): StarData[] {
  if (perspective.mode === "observer" || knownSet === null) {
    return ctx.state.stars.map((star) => createMapStar(star));
  }
  return ctx.state.stars.map((star) => {
    const redacted = createRedactedStar(star);
    const view = getIntelEntityView(ctx.state, perspective.factionId, "star", star.id);
    if (!view) return redacted;
    const nebulaId = readIntel<number | undefined>(view, "nebulaId", undefined);
    const materialized: StarData = {
      ...redacted,
      name: readIntel(view, "name", redacted.name),
      type: readIntel(view, "type", redacted.type),
      // Coordinates are structural map positions already exposed by unknown
      // signals; every descriptive stellar property remains field-gated.
      x: star.x,
      z: star.z,
      luminosity: readIntel(view, "luminosity", redacted.luminosity),
      color: readIntel(view, "color", redacted.color),
      galaxyPulseAmplitude: readIntel(view, "galaxyPulseAmplitude", redacted.galaxyPulseAmplitude),
      galaxyPulseFrequency: readIntel(view, "galaxyPulseFrequency", redacted.galaxyPulseFrequency),
    };
    if (nebulaId !== undefined) materialized.nebulaId = nebulaId;
    return materialized;
  });
}

export function createVisiblePlanetStates(ctx: RuntimeContext, knownSet: Set<number> | null, includeDetails: boolean): PlanetState[] {
  if (!includeDetails) return [];
  if (knownSet === null) return ctx.state.planetStates;
  return ctx.state.planetStates.filter((planetState) => knownSet.has(planetState.starId));
}

export function createHabitedPlanetSystemIds(ctx: RuntimeContext, perspective: GalaxyPerspective): number[] {
  const systemIds = new Set<number>();
  for (const planetState of ctx.state.planetStates) {
    if (perspective.mode === "observer") {
      if (!planetState.isHabited) continue;
    } else {
      const habitation = getIntelEntityView(ctx.state, perspective.factionId, "planet", planetState.id)?.fields.isHabited;
      if (!habitation || habitation.status === "unknown" || habitation.value !== true) continue;
    }
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
        ? Array.from(getKnownStarIds(ctx.state, faction.id))
        : [],
    };
  });
  const visibleStarbases = perspective.mode === "faction"
    ? ctx.state.starbases.flatMap((starbase) => {
      const view = getIntelEntityView(ctx.state, perspective.factionId, "starbase", starbase.id);
      return view?.fields.existence ? [materializeIntelStarbaseSummary(starbase, view)] : [];
    })
    : ctx.state.starbases.map(summarizeStarbase);
  const fleets = perspective.mode === "faction"
    ? ctx.state.fleets.flatMap((fleet) => {
      const view = getIntelEntityView(ctx.state, perspective.factionId, "fleet", fleet.id);
      return view?.fields.existence ? [materializeIntelFleet(fleet, view)] : [];
    })
    : ctx.state.fleets;
  const visibleFleetIds = new Set(fleets.map((fleet) => fleet.id));
  const ships = perspective.mode === "faction"
    ? ctx.state.ships.flatMap((ship) => {
      const view = getIntelEntityView(ctx.state, perspective.factionId, "ship", ship.id);
      return view?.fields.existence && visibleFleetIds.has(readIntel(view, "fleetId", ship.fleetId))
        ? [materializeIntelShip(ship, view)]
        : [];
    })
    : ctx.state.ships;
  const shipDesigns = perspective.mode === "faction"
    ? ctx.state.shipDesigns.filter((design) => design.ownerId === perspective.factionId)
    : ctx.state.shipDesigns;
  const hyperlanes = perspective.mode === "faction"
    ? getKnownLanePairs(ctx.state, perspective.factionId)
    : ctx.state.hyperlanes;
  const starOwnership = perspective.mode === "faction"
    ? ctx.state.stars.map((star) => getKnownSystemOwner(ctx.state, perspective.factionId, star.id))
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
  const species = perspective.mode === "faction"
    ? ctx.state.species.filter((entry) => (
      entry.originFactionId === perspective.factionId
      || ctx.state.planetStates.some((planet) => (
        planet.ownerId === perspective.factionId
        && planet.speciesPopulations.some((population) => population.speciesId === entry.id)
      ))
    ))
    : ctx.state.species;
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
  const redactProjectile = (projectile: ServerCombatProjectile): ServerCombatProjectile => {
    const hiddenResult = { lockedHit: false, accuracyMiss: false, dodged: false };
    if (perspective.mode === "observer") return { ...projectile, ...hiddenResult };
    if (projectile.ownerId === perspective.factionId) return { ...projectile, ...hiddenResult };
    const sourceView = getIntelEntityView(ctx.state, perspective.factionId, projectile.sourceActorKind, projectile.sourceActorId);
    const sourceKnown = sourceView?.fields.existence?.status !== undefined && sourceView.fields.existence.status !== "unknown";
    const knownOwner = sourceView?.fields.ownerId;
    const ownerId = knownOwner && knownOwner.status !== "unknown" ? Number(knownOwner.value) : -1;
    return {
      ...projectile,
      ...hiddenResult,
      ownerId: Number.isInteger(ownerId) ? ownerId : -1,
      sourceActorId: sourceKnown ? projectile.sourceActorId : `track:${projectile.id}`,
      sourceShipId: null,
      sourceMountKey: projectile.attackClass,
      damage: 0,
      shieldPenetration: 0,
      armorPenetration: 0,
      shieldDamageMultiplier: 1,
      armorDamageMultiplier: 1,
      hullDamageMultiplier: 1,
    };
  };
  const combatProjectiles = ctx.state.combatProjectiles
    .filter((projectile) => perspective.mode === "observer" || projectile.ownerId === perspective.factionId || visibleSet?.has(projectile.starId))
    .map(redactProjectile);
  const combatReports = perspective.mode === "observer"
    ? ctx.state.combatReports
    : ctx.state.combatReports.filter((report) => report.ownerId === perspective.factionId);

  return {
    intelligence: getGalaxyIntelligenceView(ctx.state, perspective),
    clock: {
      year: ctx.state.clock.year,
      speedMultiplier: ctx.state.clock.speedMultiplier,
      tickSizeDays: ctx.state.clock.tickSizeDays,
      tickSpeedSeconds: ctx.state.clock.tickSpeedSeconds,
      paused: ctx.state.clock.paused,
      syncedAtMs: ctx.state.clock.syncedAtMs,
    },
    nebulae: ctx.state.nebulae ?? [],
    hyperlanes,
    factions,
    starOwnership: toOwnershipEntries(starOwnership),
    visibleStarIds,
    knownStarIds,
    ships,
    shipDesigns,
    fleets,
    starbases: visibleStarbases,
    technologies: getVisibleTechnologyViews(ctx, perspective),
    leaders,
    governments,
    species,
    recentCombatContacts,
    combatProjectiles,
    combatReports,
    diplomacy: createDiplomacyMovementPayload(ctx, perspective),
    planetStates: createVisiblePlanetStates(ctx, knownSet, perspective.mode === "observer"),
    factionEconomies,
    habitedPlanetSystemIds: createHabitedPlanetSystemIds(ctx, perspective),
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
    protocolVersion: 4,
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
    protocolVersion: 4,
    perspective,
    changed,
    intelligence: getGalaxyIntelligenceView(ctx.state, perspective),
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
  if (changed.includes("combatProjectiles") || changed.includes("visibility")) {
    update.combatProjectiles = visibleState.combatProjectiles;
  }
  if (changed.includes("combatReports") || changed.includes("visibility")) {
    update.combatReports = visibleState.combatReports;
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

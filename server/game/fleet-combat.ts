// =============================================================================
// Fleet routing, movement, and combat engine — extracted from server/index.ts
// =============================================================================

import {
  getPlanetSystemPosition,
  getSystemHyperlaneEntryPosition,
  getSystemHyperlaneExitPosition,
  getSystemStarOrbitPosition,
  getSystemStarbasePosition,
  getSystemStarbaseOrbitPosition,
  interpolateSystemPosition,
  DEFAULT_ORBIT_EPOCH_MS,
  SYSTEM_FLEET_Y,
} from "../../src/data/SystemCoordinates";
import { getSystemOrbitLayout } from "../../src/data/SystemCoordinates";
import type { PlanetConfig, StarData } from "../../src/data/StarMap";
import { calculateShipDesignStats } from "../../src/data/ShipDesigns";
import {
  calculateStarbaseEconomy,
  createEmptyStarbaseSlots,
  STARBASE_LEVEL_DEFINITIONS,
  STARBASE_SHIP_DEFINITIONS,
} from "../../src/data/Starbase";
import type {
  StarbaseLevel,
  WeaponMountDefinition,
} from "../../src/data/Starbase";
import { areFactionsAtWar, getBorderPolicy } from "../../src/data/Diplomacy";
import { nebulaTravelSpeedMultiplier } from "../../src/data/Nebula";
import type { GalaxyPerspective } from "../../src/data/Factions";
import {
  GAME_DAYS_PER_YEAR,
  GAME_HOURS_PER_YEAR,
  GAME_START_YEAR,
  REAL_MS_PER_GAME_DAY,
} from "../../src/game/GameTime";
import { DARK_MATTER_FLEET_SPEED_MULTIPLIER } from "../../src/game/DarkMatter";
import { getFleetTacticalRadius, hashTacticalId } from "../../src/game/tacticalFormation";
import type {
  FleetFormation,
  FleetMovementPlan,
  FleetMovementSegment,
  FleetOrbitTarget,
  FleetOrderType,
  ServerCombatContact,
  ServerFleet,
  ServerShip,
  ServerStarbase,
  ServerCombatProjectile,
  ShipTransitPhase,
} from "../../src/game/GameProtocol";
import type { CombatTrackQuality, FleetRetreatPolicy } from "../../src/game/CombatTypes";
import {
  applyWeaponDamage,
  getWeaponId,
  getWeaponName,
  getWeaponCooldownRounds,
  getWeaponCooldownHours,
  getWeaponAttackClass,
  getWeaponTravelSpeed,
  getWeaponInterceptableBy,
  getWeaponCounterClass,
  getWeaponOptimalRangeBand,
  getWeaponMaxSystemRange,
  getWeaponMinSystemRange,
  getPreferredRangeBand,
  RANGE_BAND_SYSTEM_DISTANCE,
  rollWeaponShot,
  weaponCanFireAtDistance,
} from "./combat";
import type { CombatLayerState } from "./combat";
import type { GameFleet, GameShip, GameState, RuntimeContext } from "./types";
import {
  getFleetSpeedMultiplier,
  getFleetAttackMultiplier,
  getFleetShieldMultiplier,
  getFleetLeaderEffects,
  getGovernmentFleetEffects,
} from "./state-queries";
import { clamp, gameDaysToYears, getMountRangeSummary, getMaxWeaponSystemRange } from "./pure-helpers";
import { getShipDesignForShip } from "./ship-designs";
import { getKnownOwnership } from "./visibility";
import {
  getKnownLanePairs,
  getKnownStarIds,
  getOperationalCommandSourceStarIds,
  hasCommandLink,
  getIntelEntityView,
} from "./intelligence";
import {
  DEPART_DURATION_MS,
  JUMP_DURATION_MS,
  ARRIVE_DURATION_MS,
  BUILD_DURATION_MS,
  DEFAULT_SHIP_SPEED,
  SYSTEM_FLEET_SPEED_UNITS_PER_DAY,
  SYSTEM_PLANET_ORBIT_DISTANCE,
  STARBASE_TACTICAL_RADIUS,
  RECENT_COMBAT_CONTACT_HISTORY,
  FLEET_GUARD_RADIUS,
  FLEET_EVADE_DISTANCE,
  FLEET_SOFT_SEPARATION_FACTOR,
  FLEET_RETREAT_THRESHOLDS,
  FORMATION_EVASION_BONUS,
} from "./constants";
import { queueFactionEvent } from "./leaders-events";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

export type ContinuousCombatActor =
  | {
      kind: "fleet";
      id: string;
      ownerId: number;
      starId: number;
      position: ReturnType<typeof systemCenterPosition>;
      radius: number;
      minWeaponRange: number;
      maxWeaponRange: number;
      fleet: GameFleet;
    }
  | {
      kind: "starbase";
      id: string;
      ownerId: number;
      starId: number;
      position: ReturnType<typeof systemCenterPosition>;
      radius: number;
      minWeaponRange: number;
      maxWeaponRange: number;
      starbase: ServerStarbase;
    };

// ---------------------------------------------------------------------------
// Pure positional helpers
// ---------------------------------------------------------------------------

export function systemCenterPosition(): { x: number; y: number; z: number } {
  return { x: 0, y: SYSTEM_FLEET_Y, z: 0 };
}

export function distance3(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

export function isSameSystemPosition(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): boolean {
  return distance3(a, b) <= 0.05;
}

export function cloneSystemPosition(
  position: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  return { x: position.x, y: position.y, z: position.z };
}

export function movePointToward(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  maxDistance: number,
): { x: number; y: number; z: number } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= 0.0001 || distance <= maxDistance) return cloneSystemPosition(to);
  const scale = maxDistance / distance;
  return { x: from.x + dx * scale, y: SYSTEM_FLEET_Y, z: from.z + dz * scale };
}

// ---------------------------------------------------------------------------
// Phase duration helpers (need ctx for speed multiplier)
// ---------------------------------------------------------------------------

export function phaseDuration(
  ctx: RuntimeContext,
  phase: ShipTransitPhase,
  fleet?: Pick<ServerFleet, "id" | "ownerId" | "speed" | "darkMatterBoostActive">,
): number {
  const fleetSpeed = fleet ? getFleetSpeedMultiplier(ctx.state, fleet) : 1;
  const darkMatterSpeed = fleet?.darkMatterBoostActive ? DARK_MATTER_FLEET_SPEED_MULTIPLIER : 1;
  const speed = Math.max(0.05, (fleet?.speed ?? DEFAULT_SHIP_SPEED) * fleetSpeed * darkMatterSpeed);
  const travelScale = 1 / speed;
  switch (phase) {
    case "departingSystem":
      return DEPART_DURATION_MS * travelScale;
    case "jumpingHyperlane":
      return JUMP_DURATION_MS * travelScale;
    case "arrivingSystem":
      return ARRIVE_DURATION_MS * travelScale;
    case "buildingStarbase":
      return BUILD_DURATION_MS;
    case "movingSystem":
    case "orbitingPlanet":
    case "orbiting":
      return 1;
    default:
      return 1;
  }
}

export function phaseDurationDays(
  ctx: RuntimeContext,
  phase: ShipTransitPhase,
  fleet?: Pick<ServerFleet, "id" | "ownerId" | "speed" | "darkMatterBoostActive">,
): number {
  if (phase === "idle") return 0;
  return phaseDuration(ctx, phase, fleet) / REAL_MS_PER_GAME_DAY;
}

export function phaseDurationYears(
  ctx: RuntimeContext,
  phase: ShipTransitPhase,
  fleet?: Pick<ServerFleet, "id" | "ownerId" | "speed" | "darkMatterBoostActive">,
): number {
  return phaseDurationDays(ctx, phase, fleet) / GAME_DAYS_PER_YEAR;
}

// ---------------------------------------------------------------------------
// System position helpers
// ---------------------------------------------------------------------------

export function systemExitPosition(
  ctx: RuntimeContext,
  fleet: Pick<GameFleet, "currentStarId" | "route" | "routeIndex">,
): { x: number; y: number; z: number } {
  const fromStarId = fleet.currentStarId;
  const toStarId = fleet.route[fleet.routeIndex + 1];
  const fromStar = ctx.state.stars[fromStarId];
  const toStar = toStarId !== undefined ? ctx.state.stars[toStarId] : null;
  if (!fromStar || !toStar) return systemCenterPosition();
  return getSystemHyperlaneExitPosition(fromStar, toStar);
}

export function systemEntryPosition(
  ctx: RuntimeContext,
  fleet: Pick<GameFleet, "currentStarId" | "route" | "routeIndex">,
): { x: number; y: number; z: number } {
  const toStarId = fleet.currentStarId;
  const fromStarId = fleet.route[fleet.routeIndex - 1];
  const fromStar = fromStarId !== undefined ? ctx.state.stars[fromStarId] : null;
  const toStar = ctx.state.stars[toStarId];
  if (!fromStar || !toStar) return systemCenterPosition();
  return getSystemHyperlaneEntryPosition(fromStar, toStar);
}

// ---------------------------------------------------------------------------
// Travel helpers (ctx-dependent)
// ---------------------------------------------------------------------------

export function systemTravelDays(
  ctx: RuntimeContext,
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  fleet: Pick<ServerFleet, "id" | "ownerId" | "speed" | "darkMatterBoostActive">,
): number {
  const darkMatterSpeed = fleet.darkMatterBoostActive ? DARK_MATTER_FLEET_SPEED_MULTIPLIER : 1;
  const speedScale = Math.max(0.05, fleet.speed * getFleetSpeedMultiplier(ctx.state, fleet) * darkMatterSpeed);
  return Math.max(0.1, distance3(from, to) / (SYSTEM_FLEET_SPEED_UNITS_PER_DAY * speedScale));
}

export function hyperlaneTravelDays(
  ctx: RuntimeContext,
  fromStarId: number,
  toStarId: number,
  fleet: Pick<ServerFleet, "id" | "ownerId" | "speed" | "darkMatterBoostActive">,
): number {
  const from = ctx.state.stars[fromStarId];
  const to = ctx.state.stars[toStarId];
  if (!from || !to) return phaseDurationDays(ctx, "jumpingHyperlane", fleet);
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  // Ion storms and similar nebulas mire fleets crossing into/out of them.
  const nebulaSpeedMultiplier = nebulaTravelSpeedMultiplier(ctx.state.nebulae, fromStarId, toStarId);
  const darkMatterSpeed = fleet.darkMatterBoostActive ? DARK_MATTER_FLEET_SPEED_MULTIPLIER : 1;
  const speed = Math.max(0.05, fleet.speed * getFleetSpeedMultiplier(ctx.state, fleet) * darkMatterSpeed * 2 * nebulaSpeedMultiplier);
  return Math.max(0.1, distance / speed);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function addMovementSegment(
  ctx: RuntimeContext,
  segments: FleetMovementSegment[],
  kind: FleetMovementSegment["kind"],
  fromStarId: number,
  toStarId: number,
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  startYear: number,
  days: number,
  targetPlanetId: string | null = null,
): number {
  const endYear = startYear + gameDaysToYears(days);
  segments.push({
    kind,
    fromStarId,
    toStarId,
    from,
    to,
    startYear,
    endYear,
    targetPlanetId,
  });
  return endYear;
}

function getPlanetConfigById(
  ctx: RuntimeContext,
  planetId: string,
): { star: StarData; planet: PlanetConfig; planetIndex: number } | null {
  for (const star of ctx.state.stars) {
    const planetIndex = star.system.planets.findIndex((planet) => planet.id === planetId);
    if (planetIndex < 0) continue;
    return { star, planet: star.system.planets[planetIndex], planetIndex };
  }
  return null;
}

function getPlanetSystemPositionAt(
  star: StarData,
  planet: PlanetConfig,
  planetIndex: number,
  year: number,
): { x: number; y: number; z: number } {
  const nowMs = DEFAULT_ORBIT_EPOCH_MS + ((year - GAME_START_YEAR) * GAME_DAYS_PER_YEAR * REAL_MS_PER_GAME_DAY);
  return getPlanetSystemPosition(planet, planetIndex, nowMs, getSystemOrbitLayout(star.type));
}

// ---------------------------------------------------------------------------
// Fleet position
// ---------------------------------------------------------------------------

export function getFleetAuthoritativeSystemPosition(
  ctx: RuntimeContext,
  fleet: GameFleet,
  year = ctx.state.clock.year,
): { x: number; y: number; z: number } {
  if (fleet.movementPlan) {
    const segment = fleet.movementPlan.segments.find((candidate) => (
      year >= candidate.startYear && year < candidate.endYear
    ));
    if (segment) {
      const progress = Math.max(
        0,
        Math.min(1, (year - segment.startYear) / Math.max(0.000001, segment.endYear - segment.startYear)),
      );
      return interpolateSystemPosition(segment.from, segment.to, progress);
    }
    const finalSegment = fleet.movementPlan.segments[fleet.movementPlan.segments.length - 1];
    if (finalSegment) return cloneSystemPosition(finalSegment.to);
  }
  if (fleet.orbitTargetPlanetId) {
    const star = ctx.state.stars[fleet.currentStarId];
    const planetIndex = star?.system.planets.findIndex((planet) => planet.id === fleet.orbitTargetPlanetId) ?? -1;
    const planet = planetIndex >= 0 ? star.system.planets[planetIndex] : null;
    if (star && planet) {
      const planetPosition = getPlanetSystemPositionAt(star, planet, planetIndex, year);
      const offset = fleet.orbitOffset ?? { x: SYSTEM_PLANET_ORBIT_DISTANCE, y: SYSTEM_FLEET_Y, z: 0 };
      return {
        x: planetPosition.x + offset.x,
        y: offset.y,
        z: planetPosition.z + offset.z,
      };
    }
  }
  return cloneSystemPosition(fleet.systemPosition ?? systemCenterPosition());
}

/**
 * Re-times only the untravelled portion of a fleet's active route. A scale of
 * 0.1 activates the 10x boost; 10 restores normal speed without teleporting.
 */
export function rescaleFleetMovementPlan(
  ctx: RuntimeContext,
  fleet: GameFleet,
  scale: number,
  atYear = ctx.state.clock.year,
): void {
  const plan = fleet.movementPlan;
  if (!plan || plan.segments.length === 0 || atYear >= plan.endsAtYear) return;

  const position = getFleetAuthoritativeSystemPosition(ctx, fleet, atYear);
  const remaining = plan.segments.filter((segment) => segment.endYear > atYear);
  if (remaining.length === 0) return;

  let cursorYear = atYear;
  let cursorPosition = position;
  const segments = remaining.map((segment) => {
    const remainingYears = Math.max(0.000001, segment.endYear - Math.max(atYear, segment.startYear));
    const durationYears = Math.max(0.000001, remainingYears * scale);
    const next: FleetMovementSegment = {
      ...segment,
      from: cloneSystemPosition(cursorPosition),
      startYear: cursorYear,
      endYear: cursorYear + durationYears,
    };
    cursorYear = next.endYear;
    cursorPosition = next.to;
    return next;
  });

  fleet.systemPosition = position;
  fleet.movementPlan = {
    ...plan,
    startedAtYear: atYear,
    endsAtYear: cursorYear,
    totalDays: Math.max(0, (cursorYear - atYear) * GAME_DAYS_PER_YEAR),
    segments,
  };
  const first = segments[0];
  fleet.phaseStartedAtYear = first.startYear;
  fleet.phaseDurationDays = Math.max(0.1, (first.endYear - first.startYear) * GAME_DAYS_PER_YEAR);
  fleet.phaseProgress = 0;
}

// ---------------------------------------------------------------------------
// Orbit / target helpers
// ---------------------------------------------------------------------------

export function getStarbaseInSystem(ctx: RuntimeContext, starId: number): ServerStarbase | null {
  return ctx.state.starbases.find((starbase) => starbase.starId === starId) ?? null;
}

export function createStarOrbitTarget(
  starId: number,
  position = getSystemStarOrbitPosition(),
): FleetOrbitTarget {
  return { kind: "star", starId, position: cloneSystemPosition(position) };
}

export function createStarbaseOrbitTarget(
  starbase: ServerStarbase,
  position?: { x: number; y: number; z: number },
): FleetOrbitTarget {
  const starbasePosition = starbase.systemPosition ?? getSystemStarbasePosition();
  const orbitPosition = position ?? getSystemStarbaseOrbitPosition(starbasePosition);
  return {
    kind: "starbase",
    starId: starbase.starId,
    starbaseId: starbase.id,
    position: cloneSystemPosition(orbitPosition),
  };
}

export function getDefaultMoveDestination(
  ctx: RuntimeContext,
  starId: number,
): { position: { x: number; y: number; z: number }; orbitTarget: FleetOrbitTarget } {
  const starbase = getStarbaseInSystem(ctx, starId);
  if (starbase) {
    const position = getSystemStarbaseOrbitPosition(starbase.systemPosition);
    return { position, orbitTarget: createStarbaseOrbitTarget(starbase, position) };
  }
  const position = getSystemStarOrbitPosition();
  return { position, orbitTarget: createStarOrbitTarget(starId, position) };
}

export function applyFleetOrbitTarget(fleet: GameFleet, orbitTarget: FleetOrbitTarget | null): void {
  fleet.orbitTarget = orbitTarget;
  fleet.orbitTargetPlanetId = orbitTarget?.kind === "planet" && orbitTarget.planetId ? orbitTarget.planetId : null;
  fleet.orbitOffset = orbitTarget?.kind === "planet"
    ? { x: SYSTEM_PLANET_ORBIT_DISTANCE, y: SYSTEM_FLEET_Y, z: 0 }
    : null;
}

export function clearFleetOrbit(fleet: GameFleet): void {
  fleet.orbitTargetPlanetId = null;
  fleet.orbitOffset = null;
  fleet.orbitTarget = null;
  fleet.mergeTargetFleetId = null;
}

export function clearFleetCombatIntent(fleet: GameFleet): void {
  fleet.retreatState = null;
  fleet.currentTacticalOrder = null;
  fleet.currentTargetId = null;
  fleet.currentTargetKind = null;
  if (fleet.combatStatus !== "destroyed") fleet.combatStatus = "idle";
}

export function isFleetOrbitingStar(fleet: GameFleet, starId: number): boolean {
  return fleet.currentStarId === starId
    && (fleet.phase === "orbiting" || fleet.phase === "orbitingPlanet")
    && fleet.orbitTarget?.kind === "star"
    && fleet.orbitTarget.starId === starId;
}

export function isFleetAvailableForOrders(fleet: GameFleet): boolean {
  return fleet.phase === "idle" || fleet.phase === "orbitingPlanet" || fleet.phase === "orbiting";
}

export function canFleetAcceptReplacementOrder(fleet: GameFleet): boolean {
  return !fleet.stationaryStarbaseId
    && fleet.phase !== "missingInAction"
    && fleet.combatStatus !== "destroyed"
    && fleet.shipIds.length > 0;
}

export function isMergeSourceEligible(fleet: GameFleet): boolean {
  return fleet.phase !== "missingInAction" && fleet.phase !== "buildingStarbase" && fleet.retreatState === null;
}

// ---------------------------------------------------------------------------
// Route helpers
// ---------------------------------------------------------------------------

/** Inline of the old getStarOwnerId — just a lookup on starOwnership. */
function getStarOwnerId(ctx: RuntimeContext, starId: number): number {
  return ctx.state.starOwnership[starId] ?? -1;
}

export function canEnterSystem(ctx: RuntimeContext, fleetOwnerId: number, starId: number): boolean {
  const ownerId = getStarOwnerId(ctx, starId);
  if (ownerId < 0 || ownerId === fleetOwnerId) return true;
  if (areFactionsAtWar(ctx.state.diplomacy, fleetOwnerId, ownerId)) return true;
  return getBorderPolicy(ctx.state.diplomacy, ownerId, fleetOwnerId) === "open";
}

export function routeIsAllowed(ctx: RuntimeContext, route: number[], ownerId: number): boolean {
  // Every intermediate star (not start, not end) must be enterable
  for (let i = 1; i < route.length - 1; i++) {
    if (!canEnterSystem(ctx, ownerId, route[i])) return false;
  }
  return true;
}

export function findRoute(ctx: RuntimeContext, fleet: GameFleet, targetStarId: number): number[] | null {
  const legacyDiscovered = (ctx.state as GameState & { discoveredByFaction?: Record<string, number[]> }).discoveredByFaction;
  const discovered = ctx.state.intelligenceByFaction
    ? getKnownStarIds(ctx.state, fleet.ownerId)
    : new Set(legacyDiscovered?.[String(fleet.ownerId)] ?? []);
  const startStarId = fleet.currentStarId;
  // A nebula scatters sensors, so its systems stay "undiscovered" until a fleet
  // physically enters one. Such a system can still be a *destination* — a single
  // jump out of charted space — but never a stepping stone to anywhere beyond it.
  // We therefore let the search end on an undiscovered target while only ever
  // relaying through discovered systems, mirroring the client's getReachableStarIds
  // (GalaxyScene). The start star always counts as reachable (the fleet is there).
  const canRouteTo = (starId: number): boolean => starId === targetStarId || discovered.has(starId);
  const distances = new Map<number, number>([[startStarId, 0]]);
  const previous = new Map<number, number | null>([[startStarId, null]]);
  const unsettled = new Set<number>([startStarId]);

  while (unsettled.size > 0) {
    let current = -1;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const candidate of unsettled) {
      const distance = distances.get(candidate) ?? Number.POSITIVE_INFINITY;
      if (distance < currentDistance) {
        current = candidate;
        currentDistance = distance;
      }
    }
    if (current < 0) break;
    unsettled.delete(current);
    if (current === targetStarId) break;

    for (const neighbor of ctx.state.adjacency[current] ?? []) {
      // Only the destination itself may be an undiscovered (e.g. nebula) system;
      // every intermediate hop must be charted so we never path blindly.
      if (!canRouteTo(neighbor)) continue;
      if (neighbor !== startStarId && !canEnterSystem(ctx, fleet.ownerId, neighbor)) continue;
      const nextDistance = currentDistance + hyperlaneTravelDays(ctx, current, neighbor, fleet);
      if (nextDistance >= (distances.get(neighbor) ?? Number.POSITIVE_INFINITY)) continue;
      distances.set(neighbor, nextDistance);
      previous.set(neighbor, current);
      unsettled.add(neighbor);
    }
  }

  if (!previous.has(targetStarId)) return null;
  const route: number[] = [];
  let cursor: number | null = targetStarId;
  while (cursor !== null) {
    route.push(cursor);
    cursor = previous.get(cursor) ?? null;
  }
  route.reverse();
  return route.length > 1 && routeIsAllowed(ctx, route, fleet.ownerId) ? route : null;
}

// ---------------------------------------------------------------------------
// Movement plan
// ---------------------------------------------------------------------------

export function createFleetMovementPlan(
  ctx: RuntimeContext,
  fleet: GameFleet,
  route: number[],
  orderType: Exclude<FleetOrderType, null>,
  destinationPosition: { x: number; y: number; z: number },
  destinationOrbitTarget: FleetOrbitTarget | null = null,
  destinationPlanetId: string | null = null,
): FleetMovementPlan {
  const segments: FleetMovementSegment[] = [];
  let cursorYear = ctx.state.clock.year;
  let cursorPosition = getFleetAuthoritativeSystemPosition(ctx, fleet);

  for (let i = 0; i < route.length - 1; i++) {
    const fromStarId = route[i];
    const toStarId = route[i + 1];
    const fromStar = ctx.state.stars[fromStarId];
    const toStar = ctx.state.stars[toStarId];
    if (!fromStar || !toStar) continue;

    const exit = getSystemHyperlaneExitPosition(fromStar, toStar);
    cursorYear = addMovementSegment(
      ctx,
      segments,
      "system",
      fromStarId,
      fromStarId,
      cursorPosition,
      exit,
      cursorYear,
      systemTravelDays(ctx, cursorPosition, exit, fleet),
    );

    const entry = getSystemHyperlaneEntryPosition(fromStar, toStar);
    cursorYear = addMovementSegment(
      ctx,
      segments,
      "hyperlane",
      fromStarId,
      toStarId,
      exit,
      entry,
      cursorYear,
      hyperlaneTravelDays(ctx, fromStarId, toStarId, fleet),
    );

    cursorPosition = entry;
  }

  const destinationStarId = route[route.length - 1] ?? fleet.currentStarId;
  let finalDestinationPosition = destinationPosition;
  let finalOrbitTarget = destinationOrbitTarget;
  if (destinationOrbitTarget?.kind === "planet" && destinationOrbitTarget.planetId) {
    const target = getPlanetConfigById(ctx, destinationOrbitTarget.planetId);
    if (target) {
      const planetPosition = getPlanetSystemPositionAt(target.star, target.planet, target.planetIndex, cursorYear);
      finalDestinationPosition = {
        x: planetPosition.x + SYSTEM_PLANET_ORBIT_DISTANCE,
        y: SYSTEM_FLEET_Y,
        z: planetPosition.z,
      };
      finalOrbitTarget = { ...destinationOrbitTarget, position: finalDestinationPosition };
    }
  }

  if (!isSameSystemPosition(cursorPosition, finalDestinationPosition)) {
    cursorYear = addMovementSegment(
      ctx,
      segments,
      finalOrbitTarget?.kind === "planet" ? "orbit" : "system",
      destinationStarId,
      destinationStarId,
      cursorPosition,
      finalDestinationPosition,
      cursorYear,
      systemTravelDays(ctx, cursorPosition, finalDestinationPosition, fleet),
      destinationPlanetId,
    );
  }

  return {
    destinationStarId,
    destinationPlanetId,
    destinationPosition: finalDestinationPosition,
    destinationOrbitTarget: finalOrbitTarget,
    startedAtYear: ctx.state.clock.year,
    endsAtYear: cursorYear,
    totalDays: Math.max(0, (cursorYear - ctx.state.clock.year) * GAME_DAYS_PER_YEAR),
    segments,
  };
}

// ---------------------------------------------------------------------------
// Order helpers
// ---------------------------------------------------------------------------

export function prepareFleetForReplacementOrder(ctx: RuntimeContext, fleet: GameFleet): void {
  fleet.systemPosition = getFleetAuthoritativeSystemPosition(ctx, fleet);
  fleet.targetStarId = null;
  fleet.route = [fleet.currentStarId];
  fleet.routeIndex = 0;
  fleet.orderType = null;
  fleet.hyperlanePosition = null;
  fleet.movementPlan = null;
  fleet.mergeTargetFleetId = null;
  clearFleetOrbit(fleet);
  clearFleetCombatIntent(fleet);
  ctx.setFleetPhase(fleet, "idle");
  fleet.phaseProgress = 0;
  fleet.phaseElapsedMs = 0;
}

export function startPositionOrder(
  ctx: RuntimeContext,
  fleet: GameFleet,
  targetStarId: number,
  orderType: Exclude<FleetOrderType, null>,
  targetPosition: { x: number; y: number; z: number },
  orbitTarget: FleetOrbitTarget | null = null,
  routeOverride: number[] | null = null,
): void {
  const engineBlocked = fleet.shipIds.some((shipId) => {
    const ship = ctx.state.ships.find((candidate) => candidate.id === shipId);
    return ship?.subsystemState?.engineDisabled && !ship.subsystemState.emergencyMobility;
  });
  if (engineBlocked && targetStarId !== fleet.currentStarId) throw new Error("Fleet contains an engine-crippled ship that requires construction assistance.");
  const route = routeOverride ?? (targetStarId === fleet.currentStarId ? [fleet.currentStarId] : findRoute(ctx, fleet, targetStarId));
  if (!route || !routeIsAllowed(ctx, route, fleet.ownerId)) throw new Error("No discovered safe route to target.");
  fleet.targetStarId = targetStarId;
  fleet.orderType = orderType;
  fleet.route = route;
  fleet.routeIndex = 0;
  fleet.movementPlan = createFleetMovementPlan(ctx, fleet, route, orderType, targetPosition, orbitTarget, orbitTarget?.planetId ?? null);
  fleet.hyperlanePosition = null;
  applyFleetOrbitTarget(fleet, null);
  if (fleet.movementPlan.segments.length === 0) {
    fleet.currentStarId = targetStarId;
    fleet.systemPosition = cloneSystemPosition(targetPosition);
    if (orderType === "build") {
      applyFleetOrbitTarget(fleet, createStarOrbitTarget(targetStarId, targetPosition));
      ctx.setFleetPhase(fleet, "buildingStarbase");
    } else if (orbitTarget?.kind === "planet") {
      applyFleetOrbitTarget(fleet, orbitTarget);
      ctx.setFleetPhase(fleet, "orbitingPlanet");
    } else if (orbitTarget) {
      applyFleetOrbitTarget(fleet, orbitTarget);
      ctx.setFleetPhase(fleet, "orbiting");
    } else {
      ctx.setFleetPhase(fleet, "idle");
    }
    fleet.movementPlan = null;
    fleet.darkMatterBoostActive = false;
    fleet.darkMatterBoostPaidUntilYear = null;
    return;
  }

  const firstSegment = fleet.movementPlan.segments[0];
  ctx.setFleetPhase(fleet, firstSegment.kind === "hyperlane" ? "jumpingHyperlane" : "movingSystem");
  fleet.phaseStartedAtYear = firstSegment.startYear;
  fleet.phaseDurationDays = Math.max(0.1, (firstSegment.endYear - firstSegment.startYear) * GAME_DAYS_PER_YEAR);
}

export function startMoveOrder(
  ctx: RuntimeContext,
  fleet: GameFleet,
  targetStarId: number,
  targetPosition?: { x: number; y: number; z: number },
  orbitTarget?: FleetOrbitTarget | null,
): void {
  const destination = targetPosition
    ? {
        position: cloneSystemPosition(targetPosition),
        orbitTarget: orbitTarget
          ? { ...orbitTarget, starId: targetStarId, position: cloneSystemPosition(targetPosition) }
          : null,
      }
    : getDefaultMoveDestination(ctx, targetStarId);

  const routeOverride = destination.orbitTarget?.kind === "hyperlane"
    && fleet.currentStarId !== targetStarId
    && ctx.state.adjacency[fleet.currentStarId]?.includes(targetStarId)
    ? [fleet.currentStarId, targetStarId]
    : null;
  startPositionOrder(ctx, fleet, targetStarId, "move", destination.position, destination.orbitTarget, routeOverride);
}

export function processFleetCommandLinkLoss(ctx: RuntimeContext): boolean {
  let changed = false;
  for (const fleet of ctx.state.fleets) {
    if (fleet.combatStatus === "destroyed" || fleet.phase === "missingInAction") continue;
    if (fleet.hyperlanePosition) continue; // finish the active lane segment
    if (hasCommandLink(ctx.state, fleet.ownerId, fleet.currentStarId)) continue;

    const targets = getOperationalCommandSourceStarIds(ctx.state, fleet.ownerId);
    const laneAdjacency = new Map<number, number[]>();
    for (const [a, b] of getKnownLanePairs(ctx.state, fleet.ownerId)) {
      laneAdjacency.set(a, [...(laneAdjacency.get(a) ?? []), b]);
      laneAdjacency.set(b, [...(laneAdjacency.get(b) ?? []), a]);
    }
    const queue = [fleet.currentStarId];
    const previous = new Map<number, number | null>([[fleet.currentStarId, null]]);
    let destination: number | null = targets.has(fleet.currentStarId) ? fleet.currentStarId : null;
    for (let head = 0; head < queue.length && destination === null; head += 1) {
      const current = queue[head];
      for (const neighbor of laneAdjacency.get(current) ?? []) {
        if (previous.has(neighbor) || !canEnterSystem(ctx, fleet.ownerId, neighbor)) continue;
        previous.set(neighbor, current);
        queue.push(neighbor);
        if (targets.has(neighbor)) {
          destination = neighbor;
          break;
        }
      }
    }

    if (destination === null || destination === fleet.currentStarId) {
      if (fleet.movementPlan || fleet.targetStarId !== null || fleet.orderType !== null) {
        clearFleetMovementNow(ctx, fleet);
        changed = true;
      }
      continue;
    }
    if (fleet.targetStarId === destination && fleet.movementPlan) continue;
    const route: number[] = [];
    for (let cursor: number | null = destination; cursor !== null; cursor = previous.get(cursor) ?? null) route.push(cursor);
    route.reverse();
    const target = route[route.length - 1];
    if (target === undefined) continue;
    clearFleetMovementNow(ctx, fleet);
    const moveTarget = getDefaultMoveDestination(ctx, target);
    startPositionOrder(ctx, fleet, target, "move", moveTarget.position, moveTarget.orbitTarget, route);
    changed = true;
  }
  return changed;
}

export function startAttackSystemOrder(ctx: RuntimeContext, fleet: GameFleet, targetStarId: number): void {
  const hostileStarbase = ctx.state.starbases.find((starbase) => (
    starbase.starId === targetStarId
    && isHostileOwner(ctx, fleet.ownerId, starbase.ownerId)
  ));
  const hostileFleet = ctx.state.fleets.find((candidate) => (
    candidate.id !== fleet.id
    && candidate.currentStarId === targetStarId
    && isHostileOwner(ctx, fleet.ownerId, candidate.ownerId)
  ));
  const destination = hostileStarbase
    ? {
        position: cloneSystemPosition(hostileStarbase.systemPosition ?? getSystemStarbasePosition()),
        orbitTarget: createStarbaseOrbitTarget(hostileStarbase),
      }
    : hostileFleet
      ? {
          position: getFleetAuthoritativeSystemPosition(ctx, hostileFleet as GameFleet),
          orbitTarget: {
            kind: "fleet" as const,
            starId: hostileFleet.currentStarId,
            targetFleetId: hostileFleet.id,
            position: getFleetAuthoritativeSystemPosition(ctx, hostileFleet as GameFleet),
          },
        }
      : getDefaultMoveDestination(ctx, targetStarId);

  startPositionOrder(ctx, fleet, targetStarId, "attack", destination.position, destination.orbitTarget);
  fleet.currentTacticalOrder = { type: "attack", issuedAtYear: ctx.state.clock.year };
  if (fleet.combatStance === "passive" || fleet.combatStance === "evade") {
    fleet.combatStance = "aggressive";
  }
}

export function startBuildOrder(ctx: RuntimeContext, fleet: GameFleet, targetStarId: number): void {
  const starPosition = getSystemStarOrbitPosition();
  if (isFleetOrbitingStar(fleet, targetStarId)) {
    fleet.targetStarId = targetStarId;
    fleet.orderType = "build";
    fleet.route = [targetStarId];
    fleet.routeIndex = 0;
    fleet.movementPlan = null;
    fleet.hyperlanePosition = null;
    fleet.systemPosition = starPosition;
    applyFleetOrbitTarget(fleet, createStarOrbitTarget(targetStarId, starPosition));
    ctx.setFleetPhase(fleet, "buildingStarbase");
    return;
  }
  startPositionOrder(ctx, fleet, targetStarId, "build", starPosition, createStarOrbitTarget(targetStarId, starPosition));
}

export function startOrbitOrder(ctx: RuntimeContext, fleet: GameFleet, planetId: string): void {
  const target = getPlanetConfigById(ctx, planetId);
  if (!target) throw new Error("Planet not found.");
  const route = target.star.id === fleet.currentStarId ? [fleet.currentStarId] : findRoute(ctx, fleet, target.star.id);
  if (!route) throw new Error("No discovered safe route to planet.");
  const planetPosition = getPlanetSystemPositionAt(target.star, target.planet, target.planetIndex, ctx.state.clock.year);
  const orbitPosition = {
    x: planetPosition.x + SYSTEM_PLANET_ORBIT_DISTANCE,
    y: SYSTEM_FLEET_Y,
    z: planetPosition.z,
  };
  const orbitTarget: FleetOrbitTarget = {
    kind: "planet",
    starId: target.star.id,
    planetId,
    position: orbitPosition,
  };
  startPositionOrder(ctx, fleet, target.star.id, "orbit", orbitPosition, orbitTarget, route);
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

export function cancelMergeSourceOrder(ctx: RuntimeContext, sourceFleet: GameFleet): void {
  sourceFleet.targetStarId = null;
  sourceFleet.orderType = null;
  sourceFleet.route = [sourceFleet.currentStarId];
  sourceFleet.routeIndex = 0;
  sourceFleet.movementPlan = null;
  sourceFleet.mergeTargetFleetId = null;
  sourceFleet.hyperlanePosition = null;
  applyFleetOrbitTarget(sourceFleet, null);
  ctx.setFleetPhase(sourceFleet, "idle");
}

export function completeMergeSourceFleet(ctx: RuntimeContext, sourceFleet: GameFleet): boolean {
  const targetFleetId = sourceFleet.mergeTargetFleetId;
  if (!targetFleetId) return false;
  const targetFleet = ctx.state.fleets.find((fleet) => fleet.id === targetFleetId) as GameFleet | undefined;
  if (!targetFleet || targetFleet.id === sourceFleet.id) {
    cancelMergeSourceOrder(ctx, sourceFleet);
    return false;
  }
  if (targetFleet.currentStarId !== sourceFleet.currentStarId) return false;

  const sourcePosition = getFleetAuthoritativeSystemPosition(ctx, sourceFleet);
  const targetPosition = getFleetAuthoritativeSystemPosition(ctx, targetFleet);
  if (!isSameSystemPosition(sourcePosition, targetPosition)) {
    return false;
  }

  for (const shipId of sourceFleet.shipIds) {
    if (!targetFleet.shipIds.includes(shipId)) targetFleet.shipIds.push(shipId);
  }
  for (const fleet of ctx.state.fleets) {
    if (fleet.mergeTargetFleetId === sourceFleet.id) {
      fleet.mergeTargetFleetId = targetFleet.id;
    }
  }
  ctx.state.ships = ctx.state.ships.map((ship) => (
    ship.fleetId === sourceFleet.id ? { ...ship, fleetId: targetFleet.id } : ship
  ));
  ctx.state.fleets = ctx.state.fleets.filter((fleet) => fleet.id !== sourceFleet.id);
  ctx.syncFleetMembership();
  return true;
}

export function startMergeSourceOrder(ctx: RuntimeContext, sourceFleet: GameFleet, targetFleet: GameFleet): void {
  sourceFleet.mergeTargetFleetId = targetFleet.id;
  if (completeMergeSourceFleet(ctx, sourceFleet)) return;

  const targetPosition = getFleetAuthoritativeSystemPosition(ctx, targetFleet);
  const orbitTarget: FleetOrbitTarget = {
    kind: "fleet",
    starId: targetFleet.currentStarId,
    targetFleetId: targetFleet.id,
    position: targetPosition,
  };
  const routeOverride = sourceFleet.currentStarId === targetFleet.currentStarId ? [sourceFleet.currentStarId] : null;
  startPositionOrder(ctx, sourceFleet, targetFleet.currentStarId, "merge", targetPosition, orbitTarget, routeOverride);
  sourceFleet.mergeTargetFleetId = targetFleet.id;
}

export function advanceMergeSourceFleet(ctx: RuntimeContext, sourceFleet: GameFleet, scaledMs: number): boolean {
  if (sourceFleet.orderType !== "merge" || !sourceFleet.mergeTargetFleetId) return false;
  const targetFleet = ctx.state.fleets.find((fleet) => fleet.id === sourceFleet.mergeTargetFleetId) as GameFleet | undefined;
  if (!targetFleet || targetFleet.id === sourceFleet.id || targetFleet.ownerId !== sourceFleet.ownerId) {
    cancelMergeSourceOrder(ctx, sourceFleet);
    return true;
  }

  if (completeMergeSourceFleet(ctx, sourceFleet)) return true;

  const targetPosition = getFleetAuthoritativeSystemPosition(ctx, targetFleet);
  const sourcePosition = getFleetAuthoritativeSystemPosition(ctx, sourceFleet);
  if (sourceFleet.currentStarId === targetFleet.currentStarId && !sourceFleet.hyperlanePosition) {
    const elapsedDays = Math.max(0, scaledMs / REAL_MS_PER_GAME_DAY);
    const fleetSpeed = getFleetSpeedMultiplier(ctx.state, sourceFleet);
    const maxDistance = elapsedDays * SYSTEM_FLEET_SPEED_UNITS_PER_DAY * Math.max(0.15, sourceFleet.speed * fleetSpeed);
    const nextPosition = movePointToward(sourcePosition, targetPosition, maxDistance);
    sourceFleet.targetStarId = targetFleet.currentStarId;
    sourceFleet.route = [targetFleet.currentStarId];
    sourceFleet.routeIndex = 0;
    sourceFleet.movementPlan = null;
    sourceFleet.hyperlanePosition = null;
    sourceFleet.systemPosition = nextPosition;
    sourceFleet.orbitTarget = {
      kind: "fleet",
      starId: targetFleet.currentStarId,
      targetFleetId: targetFleet.id,
      position: cloneSystemPosition(targetPosition),
    };
    sourceFleet.orbitTargetPlanetId = null;
    sourceFleet.orbitOffset = null;
    sourceFleet.phase = "movingSystem";
    sourceFleet.phaseStartedAtYear = ctx.state.clock.year;
    sourceFleet.phaseDurationDays = Math.max(0.1, systemTravelDays(ctx, nextPosition, targetPosition, sourceFleet));
    sourceFleet.phaseProgress = isSameSystemPosition(nextPosition, targetPosition) ? 1 : 0;
    if (completeMergeSourceFleet(ctx, sourceFleet)) return true;
    return false;
  }

  const plan = sourceFleet.movementPlan;
  const finalDestination = plan?.destinationPosition ?? null;
  const destinationMoved = sourceFleet.currentStarId === targetFleet.currentStarId
    && finalDestination
    && !isSameSystemPosition(finalDestination, targetPosition);
  if (!plan || plan.destinationStarId !== targetFleet.currentStarId || destinationMoved) {
    startMergeSourceOrder(ctx, sourceFleet, targetFleet);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Fleet order completion & advancement
// ---------------------------------------------------------------------------

export function completeFleetOrder(ctx: RuntimeContext, fleet: GameFleet): void {
  let finalOrbitTarget: FleetOrbitTarget | null = fleet.orbitTarget;
  if (fleet.orderType === "build" && fleet.targetStarId !== null) {
    const starId = fleet.targetStarId;
    let starbase = ctx.state.starbases.find((candidate) => candidate.starId === starId) ?? null;
    if (!starbase) {
      const combat = STARBASE_LEVEL_DEFINITIONS.outpost.combat;
      starbase = {
        id: ctx.createRuntimeId("starbase", [fleet.ownerId, starId]),
        ownerId: fleet.ownerId,
        starId,
        systemPosition: getSystemStarbasePosition(),
        status: "online",
        buildProgress: 1,
        shield: combat.maxShield,
        maxShield: combat.maxShield,
        armor: combat.maxArmor,
        maxArmor: combat.maxArmor,
        hull: combat.maxHull,
        maxHull: combat.maxHull,
        lastShieldDamageAtYear: null,
        level: "outpost",
        economy: calculateStarbaseEconomy("outpost"),
        buildingSlots: createEmptyStarbaseSlots(),
        constructionQueue: [],
        shipQueue: [],
      };
      ctx.state.starbases.push(starbase);
      ctx.state.starOwnership[starId] = fleet.ownerId;
      ctx.syncSystemOwnershipFromStarbases();
      ctx.recalculatePlanetEconomies();
      ctx.refreshFactionEconomyDeltas();
    }
    finalOrbitTarget = createStarbaseOrbitTarget(starbase);
    fleet.systemPosition = finalOrbitTarget.position;
  }

  fleet.targetStarId = null;
  fleet.orderType = null;
  fleet.route = [fleet.currentStarId];
  fleet.routeIndex = 0;
  fleet.movementPlan = null;
  fleet.mergeTargetFleetId = null;
  fleet.hyperlanePosition = null;
  applyFleetOrbitTarget(fleet, finalOrbitTarget);
  ctx.setFleetPhase(fleet, finalOrbitTarget?.kind === "planet" ? "orbitingPlanet" : (finalOrbitTarget ? "orbiting" : "idle"));
}

export function advanceFleet(ctx: RuntimeContext, fleet: GameFleet, scaledMs: number): boolean {
  if (fleet.phase === "missingInAction") {
    return false;
  }
  if (fleet.orderType === "merge" && fleet.mergeTargetFleetId) {
    const mergeChanged = advanceMergeSourceFleet(ctx, fleet, scaledMs);
    if (mergeChanged || !ctx.state.fleets.includes(fleet)) return true;
    if (!fleet.movementPlan) return false;
  }
  if (fleet.movementPlan && fleet.phase !== "idle" && fleet.phase !== "buildingStarbase" && fleet.phase !== "orbitingPlanet" && fleet.phase !== "orbiting") {
    const plan = fleet.movementPlan;
    const nextYear = ctx.state.clock.year;
    const segment = plan.segments.find((candidate) => nextYear >= candidate.startYear && nextYear < candidate.endYear)
      ?? plan.segments[plan.segments.length - 1];

    if (segment && nextYear < plan.endsAtYear) {
      const progress = Math.max(0, Math.min(1, (nextYear - segment.startYear) / Math.max(0.000001, segment.endYear - segment.startYear)));
      fleet.currentStarId = segment.kind === "hyperlane" ? segment.fromStarId : segment.toStarId;
      fleet.routeIndex = Math.max(0, fleet.route.indexOf(segment.toStarId));
      fleet.phaseStartedAtYear = segment.startYear;
      fleet.phaseDurationDays = Math.max(0.1, (segment.endYear - segment.startYear) * GAME_DAYS_PER_YEAR);
      fleet.phaseProgress = progress;

      if (segment.kind === "hyperlane") {
        fleet.phase = "jumpingHyperlane";
        fleet.hyperlanePosition = { fromStarId: segment.fromStarId, toStarId: segment.toStarId, progress };
        fleet.systemPosition = interpolateSystemPosition(segment.from, segment.to, progress);
      } else {
        fleet.phase = "movingSystem";
        fleet.hyperlanePosition = null;
        fleet.systemPosition = interpolateSystemPosition(segment.from, segment.to, progress);
      }
      return false;
    }

    fleet.phaseProgress = 1;
    fleet.currentStarId = plan.destinationStarId;
    fleet.routeIndex = Math.max(0, fleet.route.length - 1);
    fleet.hyperlanePosition = null;
    fleet.systemPosition = plan.segments[plan.segments.length - 1]?.to ?? systemCenterPosition();
    fleet.movementPlan = null;
    fleet.darkMatterBoostActive = false;
    fleet.darkMatterBoostPaidUntilYear = null;

    if (fleet.orderType === "merge") {
      if (!completeMergeSourceFleet(ctx, fleet)) {
        const targetFleet = fleet.mergeTargetFleetId
          ? ctx.state.fleets.find((candidate) => candidate.id === fleet.mergeTargetFleetId) as GameFleet | undefined
          : null;
        if (targetFleet) {
          startMergeSourceOrder(ctx, fleet, targetFleet);
        } else {
          cancelMergeSourceOrder(ctx, fleet);
        }
      }
      return true;
    }

    if (fleet.orderType === "orbit" && plan.destinationOrbitTarget?.kind === "planet") {
      applyFleetOrbitTarget(fleet, plan.destinationOrbitTarget);
      fleet.orderType = "orbit";
      fleet.targetStarId = null;
      fleet.route = [fleet.currentStarId];
      fleet.routeIndex = 0;
      ctx.setFleetPhase(fleet, "orbitingPlanet");
      fleet.phaseDurationDays = 0;
      return true;
    }

    if (fleet.orderType === "build") {
      applyFleetOrbitTarget(fleet, createStarOrbitTarget(fleet.currentStarId, plan.destinationPosition ?? getSystemStarOrbitPosition()));
      ctx.setFleetPhase(fleet, "buildingStarbase");
      fleet.systemPosition = plan.destinationPosition ?? getSystemStarOrbitPosition();
      return true;
    }

    const finalOrbitTarget = plan.destinationOrbitTarget ?? null;
    if (fleet.orderType === "retreat") {
      fleet.retreatState = null;
      fleet.currentTacticalOrder = null;
      fleet.combatStatus = "idle";
    }
    fleet.targetStarId = null;
    fleet.orderType = null;
    fleet.route = [fleet.currentStarId];
    fleet.routeIndex = 0;
    fleet.mergeTargetFleetId = null;
    applyFleetOrbitTarget(fleet, finalOrbitTarget);
    ctx.setFleetPhase(fleet, finalOrbitTarget?.kind === "planet" ? "orbitingPlanet" : (finalOrbitTarget ? "orbiting" : "idle"));
    return true;
  }

  if (fleet.phase === "orbitingPlanet" || fleet.phase === "orbiting") {
    return false;
  }

  let arrivedSystem = false;
  let remaining = scaledMs;
  while (remaining > 0 && fleet.phase !== "idle") {
    const duration = phaseDuration(ctx, fleet.phase, fleet);
    const available = duration - fleet.phaseElapsedMs;
    const step = Math.min(remaining, available);
    fleet.phaseElapsedMs += step;
    fleet.phaseProgress = Math.max(0, Math.min(1, fleet.phaseElapsedMs / duration));
    remaining -= step;

    if (fleet.phase === "departingSystem") {
      fleet.systemPosition = interpolateSystemPosition(systemCenterPosition(), systemExitPosition(ctx, fleet), fleet.phaseProgress);
    } else if (fleet.phase === "jumpingHyperlane") {
      const fromStarId = fleet.route[fleet.routeIndex];
      const toStarId = fleet.route[fleet.routeIndex + 1];
      fleet.hyperlanePosition = { fromStarId, toStarId, progress: fleet.phaseProgress };
    } else if (fleet.phase === "arrivingSystem") {
      fleet.systemPosition = interpolateSystemPosition(systemEntryPosition(ctx, fleet), systemCenterPosition(), fleet.phaseProgress);
    }

    if (fleet.phaseElapsedMs < duration) break;

    fleet.phaseElapsedMs = 0;
    fleet.phaseProgress = 0;

    if (fleet.phase === "departingSystem") {
      ctx.setFleetPhase(fleet, "jumpingHyperlane");
      const fromStarId = fleet.route[fleet.routeIndex];
      const toStarId = fleet.route[fleet.routeIndex + 1];
      fleet.hyperlanePosition = { fromStarId, toStarId, progress: 0 };
    } else if (fleet.phase === "jumpingHyperlane") {
      fleet.currentStarId = fleet.route[fleet.routeIndex + 1];
      fleet.routeIndex += 1;
      fleet.hyperlanePosition = null;
      ctx.setFleetPhase(fleet, "arrivingSystem");
      fleet.systemPosition = systemEntryPosition(ctx, fleet);
    } else if (fleet.phase === "arrivingSystem") {
      arrivedSystem = true;
      if (fleet.routeIndex < fleet.route.length - 1) {
        ctx.setFleetPhase(fleet, "departingSystem");
        fleet.systemPosition = systemCenterPosition();
      } else if (fleet.orderType === "build") {
        ctx.setFleetPhase(fleet, "buildingStarbase");
        fleet.systemPosition = systemCenterPosition();
      } else {
        completeFleetOrder(ctx, fleet);
      }
    } else if (fleet.phase === "buildingStarbase") {
      completeFleetOrder(ctx, fleet);
    }
  }
  return arrivedSystem;
}

export function processMissingInActionFleets(ctx: RuntimeContext): boolean {
  let changed = false;
  for (const fleet of ctx.state.fleets as GameFleet[]) {
    if (fleet.phase !== "missingInAction" || fleet.retreatState?.status !== "mia") continue;
    const miaUntilYear = fleet.retreatState.miaUntilYear ?? ctx.state.clock.year;
    if (ctx.state.clock.year < miaUntilYear) continue;
    const targetStarId = fleet.retreatState.targetStarId;
    fleet.currentStarId = targetStarId;
    fleet.targetStarId = null;
    fleet.route = [targetStarId];
    fleet.routeIndex = 0;
    fleet.orderType = null;
    fleet.retreatState = null;
    fleet.hyperlanePosition = null;
    fleet.movementPlan = null;
    const destination = getDefaultMoveDestination(ctx, targetStarId);
    fleet.systemPosition = destination.position;
    applyFleetOrbitTarget(fleet, destination.orbitTarget);
    ctx.setFleetPhase(fleet, destination.orbitTarget?.kind === "planet" ? "orbitingPlanet" : "orbiting");
    changed = true;
  }
  if (changed) {
    ctx.refreshDiscovery();
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Combat helpers
// ---------------------------------------------------------------------------

export function isHostileOwner(ctx: RuntimeContext, ownerA: number, ownerB: number): boolean {
  return ownerA !== ownerB && areFactionsAtWar(ctx.state.diplomacy, ownerA, ownerB);
}

export function applyWeaponHit(
  mount: WeaponMountDefinition,
  target: CombatLayerState,
): { destroyed: boolean; shieldDamage: number; armorDamage: number; hullDamage: number } {
  return applyWeaponDamage(mount, target);
}

export function applyFleetAttackShortagePenalty(
  mount: WeaponMountDefinition,
  attackMultiplier: number,
): WeaponMountDefinition {
  if (Math.abs(attackMultiplier - 1) < 0.001) return mount;
  const accuracyScale = attackMultiplier < 1
    ? 0.78 + attackMultiplier * 0.22
    : 1 + (attackMultiplier - 1) * 0.18;
  return {
    ...mount,
    damage: mount.damage * attackMultiplier,
    accuracy: clamp(mount.accuracy * accuracyScale, 0.05, 1),
  };
}

export function getStarbaseWeaponMounts(starbase: ServerStarbase): WeaponMountDefinition[] {
  return STARBASE_LEVEL_DEFINITIONS[starbase.level]?.combat.weaponMounts ?? [];
}

export function getFleetWeaponMounts(
  ctx: RuntimeContext,
  fleet: GameFleet,
  shipsById: Map<string, GameShip>,
): WeaponMountDefinition[] {
  return fleet.shipIds
    .map((shipId) => shipsById.get(shipId))
    .filter((ship): ship is GameShip => !!ship)
    .flatMap((ship) => {
      const design = getShipDesignForShip(ctx, ship);
      return calculateShipDesignStats(design).combat.weaponMounts;
    });
}


export function getFleetLivingShips(fleet: GameFleet, shipsById: Map<string, GameShip>): GameShip[] {
  return fleet.shipIds
    .map((shipId) => shipsById.get(shipId))
    .filter((ship): ship is GameShip => !!ship && ship.hull > 0);
}

export function getFleetHealthRatio(fleet: GameFleet, shipsById: Map<string, GameShip>): number {
  const ships = getFleetLivingShips(fleet, shipsById);
  const current = ships.reduce((total, ship) => total + ship.shield + ship.armor + ship.hull, 0);
  const denominator = fleet.battleSnapshot?.initialDurability
    ?? fleet.shipIds.map((id) => shipsById.get(id)).filter((ship): ship is GameShip => !!ship)
      .reduce((total, ship) => total + ship.maxShield + ship.maxArmor + ship.maxHull, 0);
  return denominator > 0 ? current / denominator : 0;
}

export function ensureFleetBattleSnapshot(ctx: RuntimeContext, fleet: GameFleet, shipsById: Map<string, GameShip>): void {
  if (fleet.battleSnapshot) return;
  const ships = getFleetLivingShips(fleet, shipsById);
  fleet.battleSnapshot = {
    battleId: ctx.createRuntimeId("battle", [fleet.currentStarId, fleet.id]),
    startedAtYear: ctx.state.clock.year,
    initialDurability: Math.max(1, ships.reduce((total, ship) => total + ship.maxShield + ship.maxArmor + ship.maxHull, 0)),
    initialShipIds: ships.map((ship) => ship.id),
    projectilesIntercepted: 0,
    strayHits: 0,
    subsystemCriticals: 0,
    capturedStarbaseIds: [],
    retreated: false,
    repairSpending: {},
  };
}

export function getFleetCommandProfile(ctx: RuntimeContext, fleet: GameFleet, shipsById: Map<string, GameShip>): {
  used: number; capacity: number; accuracyMultiplier: number; cooldownMultiplier: number; coordinationMultiplier: number;
} {
  const commandCost = (kind: GameShip["shipKind"]): number => kind === "defensePlatform" ? 0 : kind === "battleship" ? 8 : kind === "cruiser" ? 4 : kind === "destroyer" ? 2 : 1;
  const used = getFleetLivingShips(fleet, shipsById).reduce((sum, ship) => sum + commandCost(ship.shipKind), 0);
  const commander = ctx.state.leaders.find((leader) => leader.assignment?.kind === "fleet" && leader.assignment.targetId === fleet.id && leader.status === "recruited");
  const capacity = 20 + 2 * Math.max(0, commander?.level ?? 0);
  return { used, capacity, ...getCommanderOverageMultipliers(used, capacity) };
}

export function getCommanderOverageMultipliers(used: number, capacity: number): {
  accuracyMultiplier: number; cooldownMultiplier: number; coordinationMultiplier: number;
} {
  const overage = Math.max(0, used / Math.max(1, capacity) - 1);
  return {
    accuracyMultiplier: Math.max(0.6, 1 - 0.2 * overage),
    cooldownMultiplier: Math.min(1.5, 1 + 0.25 * overage),
    coordinationMultiplier: Math.max(0.5, 1 - 0.25 * overage),
  };
}

export function computeFleetScreeningChance(screenStrength: number, protectedWeight: number, coordinationMultiplier = 1): number {
  return Math.min(0.3, 0.3 * Math.max(0, screenStrength) / Math.max(0.001, Math.max(0, screenStrength) + 2 * Math.max(0, protectedWeight)))
    * clamp(coordinationMultiplier, 0, 1);
}

export function computeStrayHitProbability(densityWeight: number): number {
  return Math.min(0.95, 1 - Math.exp(-Math.max(0, densityWeight) / 50));
}

export function computeStarbaseScreeningChance(platformStrength: number, levelCap: number): number {
  return Math.min(clamp(levelCap, 0, 0.9), Math.max(0, platformStrength) * 0.1);
}

export function getCombatTrackQuality(ctx: RuntimeContext, observerId: number, target: ContinuousCombatActor): CombatTrackQuality {
  if (observerId === target.ownerId) return "precise";
  const view = getIntelEntityView(ctx.state, observerId, target.kind, target.id);
  const existence = view?.fields.existence;
  if (!existence || existence.status === "unknown") {
    const hasLocalStarbase = ctx.state.starbases.some((starbase) => starbase.ownerId === observerId && starbase.starId === target.starId && starbase.status === "online");
    if (hasLocalStarbase) return "precise";
    const hasLocalFleet = ctx.state.fleets.some((fleet) => fleet.ownerId === observerId && fleet.currentStarId === target.starId);
    return hasLocalFleet ? "rough" : "none";
  }
  if (existence.status === "stale") return "rough";
  const telemetry = view?.fields.systemPosition ?? view?.fields.combatStatus ?? view?.fields.shipIds;
  if (telemetry?.status === "current") return "precise";
  const classification = view?.fields.ownerId ?? view?.fields.formation;
  return classification?.status === "current" ? "identified" : "rough";
}

export function getCombatTrackAccuracyMultiplier(quality: CombatTrackQuality): number {
  return quality === "precise" ? 1 : quality === "identified" ? 0.85 : quality === "rough" ? 0.7 : 0;
}

export function updateFleetTacticalProfile(
  ctx: RuntimeContext,
  fleet: GameFleet,
  shipsById: Map<string, GameShip>,
): boolean {
  const ships = getFleetLivingShips(fleet, shipsById);
  const mounts = ships.flatMap((ship) => calculateShipDesignStats(getShipDesignForShip(ctx, ship)).combat.weaponMounts);
  const range = getMountRangeSummary(mounts);
  const weightedWeaponRange = mounts.length > 0 ? RANGE_BAND_SYSTEM_DISTANCE[getPreferredRangeBand(mounts)] : 0;
  const nextRadius = getFleetTacticalRadius(Math.max(1, ships.length));
  const nextStatus = ships.length === 0 ? "destroyed" : fleet.combatStatus;
  const command = getFleetCommandProfile(ctx, fleet, shipsById);
  const changed = fleet.tacticalRadius !== nextRadius
    || fleet.minWeaponRange !== range.min
    || fleet.maxWeaponRange !== range.max
    || fleet.weightedWeaponRange !== weightedWeaponRange
    || fleet.combatStatus !== nextStatus
    || fleet.commandUsed !== command.used
    || fleet.commandCapacity !== command.capacity
    || fleet.commandAccuracyMultiplier !== command.accuracyMultiplier
    || fleet.commandCooldownMultiplier !== command.cooldownMultiplier
    || fleet.commandCoordinationMultiplier !== command.coordinationMultiplier;
  fleet.tacticalRadius = nextRadius;
  fleet.minWeaponRange = range.min;
  fleet.maxWeaponRange = range.max;
  fleet.weightedWeaponRange = weightedWeaponRange;
  fleet.combatStatus = nextStatus;
  fleet.commandUsed = command.used;
  fleet.commandCapacity = command.capacity;
  fleet.commandAccuracyMultiplier = command.accuracyMultiplier;
  fleet.commandCooldownMultiplier = command.cooldownMultiplier;
  fleet.commandCoordinationMultiplier = command.coordinationMultiplier;
  if (ships.length === 0) {
    fleet.currentTargetId = null;
    fleet.currentTargetKind = null;
  }
  return changed;
}

export function effectiveActorDistance(a: ContinuousCombatActor, b: ContinuousCombatActor): number {
  const centerDistance = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
  return Math.max(0, centerDistance - a.radius - b.radius);
}

export function getActorValue(actor: ContinuousCombatActor, shipsById: Map<string, GameShip>): number {
  if (actor.kind === "starbase") return actor.starbase.maxShield + actor.starbase.maxArmor + actor.starbase.maxHull;
  return getFleetLivingShips(actor.fleet, shipsById)
    .reduce((total, ship) => total + ship.maxShield + ship.maxArmor + ship.maxHull, 0);
}

export function isFleetAvailableForContinuousCombat(fleet: GameFleet, shipsById: Map<string, GameShip>): boolean {
  if (fleet.phase === "jumpingHyperlane" || fleet.phase === "missingInAction") return false;
  return getFleetLivingShips(fleet, shipsById).length > 0;
}

export function buildContinuousCombatActors(
  ctx: RuntimeContext,
  shipsById: Map<string, GameShip>,
): ContinuousCombatActor[] {
  const actors: ContinuousCombatActor[] = [];
  for (const fleet of ctx.state.fleets as GameFleet[]) {
    updateFleetTacticalProfile(ctx, fleet, shipsById);
    if (!isFleetAvailableForContinuousCombat(fleet, shipsById)) continue;
    actors.push({
      kind: "fleet",
      id: fleet.id,
      ownerId: fleet.ownerId,
      starId: fleet.currentStarId,
      position: getFleetAuthoritativeSystemPosition(ctx, fleet),
      radius: fleet.tacticalRadius,
      minWeaponRange: fleet.minWeaponRange,
      maxWeaponRange: fleet.maxWeaponRange,
      fleet,
    });
  }
  for (const starbase of ctx.state.starbases) {
    const mounts = getStarbaseWeaponMounts(starbase);
    const range = getMountRangeSummary(mounts);
    if (starbase.status !== "online" || starbase.hull <= 0 || range.max <= 0) continue;
    actors.push({
      kind: "starbase",
      id: starbase.id,
      ownerId: starbase.ownerId,
      starId: starbase.starId,
      position: cloneSystemPosition(starbase.systemPosition ?? getSystemStarbasePosition()),
      radius: STARBASE_TACTICAL_RADIUS,
      minWeaponRange: range.min,
      maxWeaponRange: range.max,
      starbase,
    });
  }
  return actors;
}

export function actorIsInFleetWeaponRange(
  source: ContinuousCombatActor,
  target: ContinuousCombatActor,
): boolean {
  const distance = effectiveActorDistance(source, target);
  return distance >= source.minWeaponRange && distance <= source.maxWeaponRange;
}

export function selectFleetCombatTarget(
  ctx: RuntimeContext,
  actor: Extract<ContinuousCombatActor, { kind: "fleet" }>,
  actors: ContinuousCombatActor[],
  shipsById: Map<string, GameShip>,
): ContinuousCombatActor | null {
  const fleet = actor.fleet;
  const order = fleet.currentTacticalOrder;
  const hostiles = actors.filter((target) => (
    target.id !== actor.id
    && target.starId === actor.starId
    && isHostileOwner(ctx, actor.ownerId, target.ownerId)
    && getCombatTrackQuality(ctx, actor.ownerId, target) !== "none"
  ));
  if (order?.type === "attack" && order.targetId && order.targetKind) {
    return hostiles.find((target) => target.id === order.targetId && target.kind === order.targetKind) ?? null;
  }
  const engagementRule = fleet.combatSettings.engagementRule ?? (fleet.combatStance === "passive" || fleet.combatStance === "evade" ? "avoid" : fleet.combatStance === "defendSystem" ? "defendSystem" : "engageSystem");
  const isBeingAttacked = ctx.state.combatProjectiles.some((projectile) => projectile.status === "inFlight" && projectile.targetActorId === fleet.id);
  if (engagementRule === "avoid" && !isBeingAttacked) return null;
  const guardPosition = order?.type === "guard"
    ? order.guardPosition ?? order.targetPosition ?? actor.position
    : actor.position;
  const candidates = hostiles.filter((target) => {
    if (fleet.combatStance === "holdPosition") return actorIsInFleetWeaponRange(actor, target);
    if (fleet.combatStance === "guardArea") {
      return Math.hypot(target.position.x - guardPosition.x, target.position.z - guardPosition.z) <= FLEET_GUARD_RADIUS + target.radius;
    }
    return true;
  });
  return candidates
    .map((target) => {
      const distance = effectiveActorDistance(actor, target);
      const targetHp = target.kind === "fleet" ? getFleetHealthRatio(target.fleet, shipsById) : (target.starbase.hull / Math.max(1, target.starbase.maxHull));
      let score = Math.max(0, 120 - distance) + (1 - targetHp) * 45 + getActorValue(target, shipsById) * 0.01;
      const doctrine = fleet.combatSettings.doctrine ?? "line";
      if (doctrine === "artillery") {
        if (target.kind === "starbase") score += 35;
        else score += getFleetLivingShips(target.fleet, shipsById).reduce((sum, ship) => sum + Math.max(0, shipHullTier(ship) - 2) * 12, 0);
      }
      if (doctrine === "assault") score += Math.max(0, 80 - distance * 1.4) + (1 - targetHp) * 25;
      if (doctrine === "escort" && ctx.state.combatProjectiles.some((projectile) => projectile.status === "inFlight" && projectile.sourceActorId === target.id && projectile.targetActorId === fleet.id)) score += 55;
      if (fleet.combatStance === "hunt" && target.kind === "fleet" && target.fleet.retreatState) score += 70;
      if (actorIsInFleetWeaponRange(actor, target)) score += 35;
      return { target, score };
    })
    .sort((a, b) => b.score - a.score)[0]?.target ?? null;
}

export function selectStarbaseCombatTarget(
  ctx: RuntimeContext,
  actor: Extract<ContinuousCombatActor, { kind: "starbase" }>,
  actors: ContinuousCombatActor[],
  shipsById: Map<string, GameShip>,
): ContinuousCombatActor | null {
  return actors
    .filter((target) => target.kind === "fleet" && target.starId === actor.starId && isHostileOwner(ctx, actor.ownerId, target.ownerId))
    .filter((target) => getCombatTrackQuality(ctx, actor.ownerId, target) !== "none")
    .filter((target) => actorIsInFleetWeaponRange(actor, target))
    .map((target) => ({
      target,
      score: Math.max(0, 140 - effectiveActorDistance(actor, target)) + getActorValue(target, shipsById) * 0.01,
    }))
    .sort((a, b) => b.score - a.score)[0]?.target ?? null;
}

export function desiredEffectiveRangeForFleet(fleet: GameFleet): number {
  const maxRange = Math.max(0, fleet.maxWeaponRange);
  const weightedRange = Math.max(fleet.minWeaponRange, Math.min(maxRange, fleet.weightedWeaponRange ?? maxRange));
  const doctrine = fleet.combatSettings.doctrine
    ?? (fleet.combatSettings.behavior === "brawler" || fleet.combatSettings.behavior === "swarm" ? "assault" : fleet.combatSettings.behavior === "defender" ? "escort" : fleet.combatSettings.behavior);
  if (doctrine === "artillery") return Math.min(maxRange, Math.max(fleet.minWeaponRange, weightedRange * 1.08));
  if (doctrine === "line") return weightedRange;
  if (doctrine === "escort") return Math.max(fleet.minWeaponRange, weightedRange * 0.85);
  return Math.max(fleet.minWeaponRange, Math.min(maxRange, 10));
}

export function positionAtRangeFromTarget(
  currentPosition: { x: number; y: number; z: number },
  targetPosition: { x: number; y: number; z: number },
  desiredCenterDistance: number,
): { x: number; y: number; z: number } {
  const dx = currentPosition.x - targetPosition.x;
  const dz = currentPosition.z - targetPosition.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= 0.0001) {
    return { x: targetPosition.x + desiredCenterDistance, y: SYSTEM_FLEET_Y, z: targetPosition.z };
  }
  const scale = desiredCenterDistance / distance;
  return { x: targetPosition.x + dx * scale, y: SYSTEM_FLEET_Y, z: targetPosition.z + dz * scale };
}

export function positionAtEffectiveRangeFromTarget(
  source: ContinuousCombatActor,
  target: ContinuousCombatActor,
  desiredEffectiveDistance: number,
): { x: number; y: number; z: number } {
  return positionAtRangeFromTarget(source.position, target.position, desiredEffectiveDistance + source.radius + target.radius);
}

export function findNearestFriendlyStarbase(ctx: RuntimeContext, fleet: GameFleet): ServerStarbase | null {
  const friendly = ctx.state.starbases.filter((starbase) => (
    starbase.ownerId === fleet.ownerId
    && starbase.status === "online"
  ));
  if (friendly.length === 0) return null;
  const from = ctx.state.stars[fleet.currentStarId];
  friendly.sort((a, b) => {
    const starA = ctx.state.stars[a.starId];
    const starB = ctx.state.stars[b.starId];
    const distanceA = from && starA ? Math.hypot(starA.x - from.x, starA.z - from.z) : Number.POSITIVE_INFINITY;
    const distanceB = from && starB ? Math.hypot(starB.x - from.x, starB.z - from.z) : Number.POSITIVE_INFINITY;
    return distanceA - distanceB;
  });
  return friendly[0] ?? null;
}

function normalizeSystemPositionValue(
  pos: { x: number; y: number; z: number } | null | undefined,
): { x: number; y: number; z: number } | null {
  if (!pos) return null;
  return { x: Number(pos.x) || 0, y: Number(pos.y) || SYSTEM_FLEET_Y, z: Number(pos.z) || 0 };
}

export function computeRetreatRoute(ctx: RuntimeContext, fleet: GameFleet): number[] | null {
  if (fleet.route.length > 1 && fleet.routeIndex > 0) {
    const routeBack = fleet.route.slice(0, fleet.routeIndex + 1).reverse();
    if (routeIsAllowed(ctx, routeBack, fleet.ownerId)) return routeBack;
  }

  const homeStarId = ctx.state.factions.find((faction) => faction.id === fleet.ownerId)?.homeStarId ?? fleet.currentStarId;
  const routeToHome = findRoute(ctx, fleet, homeStarId);
  if (routeToHome) return routeToHome;

  const neighbors = ctx.state.adjacency[fleet.currentStarId] ?? [];
  const fallback = neighbors.find((starId) => {
    const owner = getKnownOwnership(ctx, fleet.ownerId, starId);
    return owner === -1 || owner === fleet.ownerId;
  });
  if (fallback !== undefined) return [fleet.currentStarId, fallback];
  return [fleet.currentStarId];
}

export function resolveFleetRetreatDestination(
  ctx: RuntimeContext,
  fleet: GameFleet,
): { targetStarId: number; targetSystemPosition?: { x: number; y: number; z: number } | null } {
  const destination = fleet.combatSettings.retreatDestination ?? { kind: "nearestFriendlyStarbase" as const };
  if (destination.kind === "selectedSystem" && Number.isInteger(destination.targetStarId)) {
    return {
      targetStarId: destination.targetStarId!,
      targetSystemPosition: normalizeSystemPositionValue(destination.targetSystemPosition),
    };
  }
  const starbase = findNearestFriendlyStarbase(ctx, fleet);
  if (starbase) {
    return {
      targetStarId: starbase.starId,
      targetSystemPosition: getSystemStarbaseOrbitPosition(starbase.systemPosition),
    };
  }
  const route = computeRetreatRoute(ctx, fleet);
  return { targetStarId: route?.at(-1) ?? fleet.currentStarId, targetSystemPosition: null };
}

export function startFleetRetreat(ctx: RuntimeContext, fleet: GameFleet): void {
  if (fleet.battleSnapshot) fleet.battleSnapshot.retreated = true;
  const crippledShips = fleet.shipIds
    .map((shipId) => ctx.state.ships.find((ship) => ship.id === shipId))
    .filter((ship): ship is GameShip => !!ship && ship.subsystemState?.engineDisabled === true && ship.subsystemState.emergencyMobility !== true);
  if (crippledShips.length > 0 && crippledShips.length < fleet.shipIds.length) {
    const crippledIds = new Set(crippledShips.map((ship) => ship.id));
    const detachmentId = ctx.createRuntimeId("stranded-fleet", [fleet.ownerId, fleet.currentStarId]);
    const detachment: GameFleet = {
      ...fleet,
      id: detachmentId,
      shipIds: [...crippledIds],
      route: [fleet.currentStarId],
      routeIndex: 0,
      targetStarId: null,
      orderType: null,
      retreatState: null,
      movementPlan: null,
      hyperlanePosition: null,
      mergeTargetFleetId: null,
      combatSettings: { ...fleet.combatSettings, engagementRule: "defendSystem" },
      currentTacticalOrder: null,
      currentTargetId: null,
      currentTargetKind: null,
      combatStatus: "idle",
      battleSnapshot: null,
      repairOrder: null,
      phase: "idle",
      phaseProgress: 0,
      phaseElapsedMs: 0,
    };
    fleet.shipIds = fleet.shipIds.filter((id) => !crippledIds.has(id));
    for (const ship of crippledShips) ship.fleetId = detachmentId;
    ctx.state.fleets.push(detachment);
  }
  if (fleet.shipIds.every((shipId) => {
    const ship = ctx.state.ships.find((candidate) => candidate.id === shipId);
    return ship?.subsystemState?.engineDisabled && !ship.subsystemState.emergencyMobility;
  })) {
    fleet.retreatState = null;
    fleet.combatStatus = "engaging";
    return;
  }
  const targetStarId = fleet.retreatState?.mode === "system" ? fleet.retreatState.targetStarId : null;
  const route = targetStarId !== null && targetStarId !== undefined
    ? (targetStarId === fleet.currentStarId ? [fleet.currentStarId] : findRoute(ctx, fleet, targetStarId))
    : computeRetreatRoute(ctx, fleet);
  if (!route || route.length <= 1) {
    resetFleetTacticalMovement(ctx, fleet);
    fleet.retreatState = null;
    return;
  }
  fleet.route = route;
  fleet.routeIndex = 0;
  fleet.targetStarId = route[route.length - 1];
  fleet.orderType = "retreat";
  const retreatPosition = fleet.retreatState?.targetSystemPosition ?? null;
  const destination = retreatPosition
    ? { position: retreatPosition, orbitTarget: createStarOrbitTarget(fleet.targetStarId, retreatPosition) }
    : getDefaultMoveDestination(ctx, fleet.targetStarId);
  fleet.movementPlan = createFleetMovementPlan(ctx, fleet, route, "move", destination.position, destination.orbitTarget);
  if (fleet.retreatState) fleet.retreatState.status = "completed";
  applyFleetOrbitTarget(fleet, null);
  const firstSegment = fleet.movementPlan.segments[0];
  ctx.setFleetPhase(fleet, firstSegment?.kind === "hyperlane" ? "jumpingHyperlane" : "movingSystem");
  fleet.hyperlanePosition = null;
}

export function resetFleetTacticalMovement(ctx: RuntimeContext, fleet: GameFleet): void {
  const currentPosition = getFleetAuthoritativeSystemPosition(ctx, fleet);
  fleet.movementPlan = null;
  clearFleetOrbit(fleet);
  ctx.setFleetPhase(fleet, "idle");
  fleet.hyperlanePosition = null;
  fleet.systemPosition = currentPosition;
}

export function retreatFleetByDoctrine(ctx: RuntimeContext, fleet: GameFleet): boolean {
  if (fleet.retreatState) return false;
  const destination = resolveFleetRetreatDestination(ctx, fleet);
  fleet.retreatState = {
    mode: "system",
    status: "escaping",
    targetStarId: destination.targetStarId,
    targetSystemPosition: destination.targetSystemPosition ?? null,
    startedAtYear: ctx.state.clock.year,
  };
  fleet.currentTacticalOrder = { type: "retreat", issuedAtYear: ctx.state.clock.year };
  fleet.combatStatus = "retreating";
  startFleetRetreat(ctx, fleet);
  return true;
}

export function getShipEvasionForFleetCombat(
  ctx: RuntimeContext,
  ship: GameShip,
  fleet: GameFleet,
): number {
  const design = getShipDesignForShip(ctx, ship);
  const stats = calculateShipDesignStats(design);
  const bonus = FORMATION_EVASION_BONUS[fleet.formation] ?? 0;
  // Leader and government effects come from state-queries helpers (pass ctx.state)
  const leaderBonus = getFleetLeaderEffects(ctx.state, fleet.id).evasionBonus;
  const governmentBonus = getGovernmentFleetEffects(ctx.state, fleet.ownerId).evasionBonus;
  return clamp(stats.combat.evasion + bonus + leaderBonus + governmentBonus, 0, 0.9);
}


export function chooseTargetShip(targetFleet: GameFleet, shipsById: Map<string, GameShip>): GameShip | null {
  return getFleetLivingShips(targetFleet, shipsById)
    .sort((a, b) => {
      const aRatio = (a.shield + a.armor + a.hull) / Math.max(1, a.maxShield + a.maxArmor + a.maxHull);
      const bRatio = (b.shield + b.armor + b.hull) / Math.max(1, b.maxShield + b.maxArmor + b.maxHull);
      if (Math.abs(aRatio - bRatio) > 0.001) return aRatio - bRatio;
      return a.id.localeCompare(b.id);
    })[0] ?? null;
}

export function decrementWeaponCooldowns(ctx: RuntimeContext, elapsedGameHours: number): void {
  for (const ship of ctx.state.ships) {
    if (!ship.weaponCooldowns) continue;
    for (const key of Object.keys(ship.weaponCooldowns)) {
      ship.weaponCooldowns[key] = Math.max(0, (ship.weaponCooldowns[key] ?? 0) - elapsedGameHours);
    }
  }
  for (const starbase of ctx.state.starbases) {
    if (!starbase.weaponCooldowns) continue;
    for (const key of Object.keys(starbase.weaponCooldowns)) {
      starbase.weaponCooldowns[key] = Math.max(0, (starbase.weaponCooldowns[key] ?? 0) - elapsedGameHours);
    }
  }
}

export function recordContinuousCombatContact(
  ctx: RuntimeContext,
  contact: Omit<ServerCombatContact, "id" | "year">,
): void {
  ctx.state.recentCombatContacts.push({
    id: ctx.createRuntimeId("contact", [contact.sourceId, contact.targetId]),
    year: ctx.state.clock.year,
    ...contact,
  });
  ctx.state.recentCombatContacts = ctx.state.recentCombatContacts.slice(-RECENT_COMBAT_CONTACT_HISTORY);
}

export function captureStarbase(ctx: RuntimeContext, starbase: ServerStarbase, ownerId: number): boolean {
  if (starbase.ownerId === ownerId) return false;
  starbase.ownerId = ownerId;
  starbase.status = "online";
  starbase.shield = 0;
  starbase.armor = 0;
  starbase.hull = Math.max(1, Math.round(starbase.maxHull * 0.25));
  starbase.lastShieldDamageAtYear = null;
  starbase.weaponCooldowns = {};
  starbase.weaponReadyAtYears = {};
  const platformFleetIds = new Set(ctx.state.fleets.filter((fleet) => fleet.stationaryStarbaseId === starbase.id).map((fleet) => fleet.id));
  for (const fleet of ctx.state.fleets) {
    if (fleet.currentTargetId === starbase.id && fleet.currentTargetKind === "starbase") {
      fleet.currentTargetId = null;
      fleet.currentTargetKind = null;
      if (fleet.currentTacticalOrder?.targetId === starbase.id) fleet.currentTacticalOrder = null;
    }
  }
  for (const platformFleet of ctx.state.fleets.filter((fleet) => platformFleetIds.has(fleet.id))) {
    platformFleet.ownerId = ownerId;
    platformFleet.currentTargetId = null;
    platformFleet.currentTargetKind = null;
    platformFleet.combatStatus = "idle";
    for (const shipId of platformFleet.shipIds) {
      const platform = ctx.state.ships.find((ship) => ship.id === shipId);
      if (platform) {
        platform.ownerId = ownerId;
        platform.disabled = true;
        platform.weaponReadyAtYears = {};
      }
    }
  }
  for (const projectile of ctx.state.combatProjectiles) {
    if (projectile.targetActorId === starbase.id || projectile.sourceActorId === starbase.id || platformFleetIds.has(projectile.sourceActorId)) projectile.status = "expired";
  }
  ctx.state.starOwnership[starbase.starId] = ownerId;
  ctx.syncSystemOwnershipFromStarbases();
  ctx.recalculatePlanetEconomies();
  ctx.refreshFactionEconomyDeltas();
  return true;
}

export function updateFleetCombatMovement(
  ctx: RuntimeContext,
  actor: Extract<ContinuousCombatActor, { kind: "fleet" }>,
  target: ContinuousCombatActor | null,
  elapsedDays: number,
  shipsById: Map<string, GameShip>,
): boolean {
  const fleet = actor.fleet;
  if (fleet.stationaryStarbaseId) {
    fleet.currentTacticalOrder = null;
    fleet.combatStatus = target && actorIsInFleetWeaponRange(actor, target) ? "firing" : "idle";
    return false;
  }
  const retreatPreset = fleet.combatSettings.retreatPreset;
  const threshold = retreatPreset === "fightOn" ? 0 : retreatPreset === "balanced" ? 0.3 : retreatPreset === "preserveFleet" ? 0.5 : retreatPreset === "avoidLosses" ? 0.75 : (FLEET_RETREAT_THRESHOLDS[fleet.combatSettings.retreatPolicy] ?? 0);
  if (threshold > 0 && getFleetHealthRatio(fleet, shipsById) <= threshold) {
    return retreatFleetByDoctrine(ctx, fleet);
  }
  const order = fleet.currentTacticalOrder;
  if (order?.type === "retreat") return retreatFleetByDoctrine(ctx, fleet);
  const fleetSpeed = getFleetSpeedMultiplier(ctx.state, fleet);
  const engineMultiplier = getFleetLivingShips(fleet, shipsById).reduce((minimum, ship) => {
    if (!ship.subsystemState?.engineDisabled) return minimum;
    return Math.min(minimum, ship.subsystemState.emergencyMobility ? 0.25 : 0.1);
  }, 1);
  const step = Math.max(0, elapsedDays) * SYSTEM_FLEET_SPEED_UNITS_PER_DAY * Math.max(0.05, fleet.speed * fleetSpeed * engineMultiplier);
  if (step <= 0) return false;
  let destination: { x: number; y: number; z: number } | null = null;
  if ((order?.type === "move" || order?.type === "guard") && order.targetPosition) {
    destination = cloneSystemPosition(order.targetPosition);
  } else if ((fleet.combatSettings.engagementRule === "avoid" || fleet.combatStance === "evade") && target) {
    destination = positionAtRangeFromTarget(actor.position, target.position, FLEET_EVADE_DISTANCE + actor.radius + target.radius);
  } else if (target && fleet.combatStance !== "holdPosition" && fleet.combatStance !== "passive") {
    const effectiveDistance = effectiveActorDistance(actor, target);
    const desired = desiredEffectiveRangeForFleet(fleet);
    if ((fleet.combatSettings.doctrine ?? fleet.combatSettings.behavior) === "artillery" && effectiveDistance < desired * 0.75) {
      destination = positionAtEffectiveRangeFromTarget(actor, target, desired);
    } else if (effectiveDistance < fleet.minWeaponRange || effectiveDistance > fleet.maxWeaponRange * 0.92) {
      destination = positionAtEffectiveRangeFromTarget(actor, target, desired);
    }
  }
  if (!destination) {
    fleet.combatStatus = target && actorIsInFleetWeaponRange(actor, target) ? "firing" : "idle";
    return false;
  }
  const next = movePointToward(actor.position, destination, step);
  if (isSameSystemPosition(actor.position, next)) {
    if (order?.type === "move") fleet.currentTacticalOrder = null;
    return false;
  }
  clearFleetOrbit(fleet);
  fleet.movementPlan = null;
  fleet.route = [fleet.currentStarId];
  fleet.targetStarId = null;
  fleet.orderType = "move";
  fleet.systemPosition = next;
  fleet.combatStatus = "maneuvering";
  return true;
}

export function applyFleetSoftSeparation(
  ctx: RuntimeContext,
  shipsById: Map<string, GameShip>,
): boolean {
  let changed = false;
  const fleets = (ctx.state.fleets as GameFleet[]).filter((fleet) => isFleetAvailableForContinuousCombat(fleet, shipsById));
  for (let i = 0; i < fleets.length; i += 1) {
    for (let j = i + 1; j < fleets.length; j += 1) {
      const left = fleets[i];
      const right = fleets[j];
      if (left.currentStarId !== right.currentStarId) continue;
      const leftPos = getFleetAuthoritativeSystemPosition(ctx, left);
      const rightPos = getFleetAuthoritativeSystemPosition(ctx, right);
      const dx = rightPos.x - leftPos.x;
      const dz = rightPos.z - leftPos.z;
      const distance = Math.hypot(dx, dz);
      const minimum = (left.tacticalRadius + right.tacticalRadius) * 0.78;
      if (distance <= 0.001 || distance >= minimum) continue;
      if (left.stationaryStarbaseId && right.stationaryStarbaseId) continue;
      const push = (minimum - distance) * FLEET_SOFT_SEPARATION_FACTOR;
      const ux = dx / distance;
      const uz = dz / distance;
      if (!left.stationaryStarbaseId) {
        const amount = right.stationaryStarbaseId ? push : push / 2;
        left.systemPosition = { x: left.systemPosition.x - ux * amount, y: SYSTEM_FLEET_Y, z: left.systemPosition.z - uz * amount };
      }
      if (!right.stationaryStarbaseId) {
        const amount = left.stationaryStarbaseId ? push : push / 2;
        right.systemPosition = { x: right.systemPosition.x + ux * amount, y: SYSTEM_FLEET_Y, z: right.systemPosition.z + uz * amount };
      }
      changed = true;
    }
  }
  return changed;
}

function shipHullTier(ship: GameShip): number {
  return ship.shipKind === "battleship" ? 4 : ship.shipKind === "cruiser" ? 3 : ship.shipKind === "destroyer" ? 2 : 1;
}

function shipCommandWeight(ship: GameShip): number {
  return shipHullTier(ship) === 4 ? 8 : shipHullTier(ship) === 3 ? 4 : shipHullTier(ship) === 2 ? 2 : 1;
}

function shipDurabilityRatio(ship: GameShip): number {
  return (ship.shield + ship.armor + ship.hull) / Math.max(1, ship.maxShield + ship.maxArmor + ship.maxHull);
}

function chooseScreenedFleetShip(ctx: RuntimeContext, fleet: GameFleet, intended: GameShip, shipsById: Map<string, GameShip>): GameShip {
  const protectedPosition = getFleetAuthoritativeSystemPosition(ctx, fleet);
  const nearbyFriendlyFleets = (ctx.state.fleets as GameFleet[]).filter((candidate) => {
    if (candidate.ownerId !== fleet.ownerId || candidate.currentStarId !== fleet.currentStarId) return false;
    const position = getFleetAuthoritativeSystemPosition(ctx, candidate);
    return Math.hypot(position.x - protectedPosition.x, position.z - protectedPosition.z) <= 18 + fleet.tacticalRadius + candidate.tacticalRadius;
  });
  const screens = nearbyFriendlyFleets.flatMap((candidate) => getFleetLivingShips(candidate, shipsById))
    .filter((ship) => ship.id !== intended.id && shipHullTier(ship) < shipHullTier(intended) && ship.disabled !== true);
  if (screens.length === 0) return intended;
  const doctrineProximity = fleet.combatSettings.doctrine === "escort" ? 1.3 : fleet.combatSettings.doctrine === "artillery" ? 0.7 : fleet.combatSettings.doctrine === "assault" ? 1.1 : 1;
  const proximityWeight = (ship: GameShip): number => {
    const stableDistance = Math.abs(hashTacticalId(ship.id) - hashTacticalId(intended.id)) % 1000 / 1000;
    return doctrineProximity * (0.75 + (1 - stableDistance) * 0.25);
  };
  const screenStrength = screens.reduce((sum, ship) => sum + shipCommandWeight(ship) * shipDurabilityRatio(ship) * proximityWeight(ship), 0);
  const protectedWeight = shipCommandWeight(intended);
  const command = getFleetCommandProfile(ctx, fleet, shipsById);
  const chance = computeFleetScreeningChance(screenStrength, protectedWeight, command.coordinationMultiplier);
  if (Math.random() >= chance) return intended;
  const total = screens.reduce((sum, ship) => sum + shipCommandWeight(ship) * shipDurabilityRatio(ship) * proximityWeight(ship), 0);
  let roll = Math.random() * total;
  for (const screen of screens) {
    roll -= shipCommandWeight(screen) * shipDurabilityRatio(screen) * proximityWeight(screen);
    if (roll <= 0) return screen;
  }
  return screens[0] ?? intended;
}

function getStarbaseScreenCap(starbase: ServerStarbase): number {
  return starbase.level === "starFortress" ? 0.9 : starbase.level === "starhold" ? 0.7 : starbase.level === "starbase" ? 0.4 : 0.2;
}

function chooseStarbaseScreen(ctx: RuntimeContext, starbase: ServerStarbase, shipsById: Map<string, GameShip>): { fleet: GameFleet; ship: GameShip } | null {
  const candidates = (ctx.state.fleets as GameFleet[])
    .filter((fleet) => fleet.stationaryStarbaseId === starbase.id && fleet.ownerId === starbase.ownerId)
    .flatMap((fleet) => getFleetLivingShips(fleet, shipsById).filter((ship) => ship.disabled !== true).map((ship) => ({ fleet, ship })));
  const baseline = STARBASE_SHIP_DEFINITIONS.defensePlatform.combat;
  const baselineDurability = baseline.maxShield + baseline.maxArmor + baseline.maxHull;
  const platformStrength = (ship: GameShip): number => shipDurabilityRatio(ship) * Math.sqrt((ship.maxShield + ship.maxArmor + ship.maxHull) / Math.max(1, baselineDurability));
  const strength = candidates.reduce((sum, candidate) => sum + platformStrength(candidate.ship), 0);
  const chance = computeStarbaseScreeningChance(strength, getStarbaseScreenCap(starbase));
  if (candidates.length === 0 || Math.random() >= chance) return null;
  let roll = Math.random() * Math.max(0.001, strength);
  for (const candidate of candidates) {
    roll -= platformStrength(candidate.ship);
    if (roll <= 0) return candidate;
  }
  return candidates[0] ?? null;
}

function findIncomingProjectile(ctx: RuntimeContext, actor: Extract<ContinuousCombatActor, { kind: "fleet" }>, counterClass: import("../../src/game/CombatTypes").CombatCounterClass = "pointDefense"): ServerCombatProjectile | null {
  const protectedActorIds = new Set<string>([actor.id]);
  if (actor.fleet.combatSettings.doctrine === "escort") {
    for (const fleet of ctx.state.fleets as GameFleet[]) {
      if (fleet.ownerId !== actor.ownerId || fleet.currentStarId !== actor.starId) continue;
      const position = getFleetAuthoritativeSystemPosition(ctx, fleet);
      if (Math.hypot(position.x - actor.position.x, position.z - actor.position.z) <= 18 + actor.radius + fleet.tacticalRadius) protectedActorIds.add(fleet.id);
    }
  }
  return ctx.state.combatProjectiles
    .filter((projectile) => projectile.status === "inFlight" && projectile.ownerId !== actor.ownerId && projectile.starId === actor.starId)
    .filter((projectile) => protectedActorIds.has(projectile.targetActorId) || actor.fleet.shipIds.includes(projectile.targetShipId ?? ""))
    .filter((projectile) => projectile.interceptableBy.includes(counterClass))
    .sort((a, b) => a.impactYear - b.impactYear)[0] ?? null;
}

function launchCombatProjectile(
  ctx: RuntimeContext,
  source: ContinuousCombatActor,
  target: ContinuousCombatActor,
  mount: WeaponMountDefinition,
  launchYear: number,
  targetShip: GameShip | null,
  targetEvasion: number,
  accuracyMultiplier: number,
  targetProjectile: ServerCombatProjectile | null = null,
): ServerCombatProjectile {
  const shotMount = { ...mount, barrels: 1, accuracy: clamp(mount.accuracy * accuracyMultiplier, 0.02, 0.99) };
  const roll = rollWeaponShot(shotMount, targetProjectile?.evasion ?? targetEvasion);
  const distance = targetProjectile ? Math.min(6, effectiveActorDistance(source, target)) : effectiveActorDistance(source, target);
  const travelHours = Math.max(0.01, distance / Math.max(0.01, getWeaponTravelSpeed(mount)));
  const attackClass = getWeaponAttackClass(mount);
  const projectileHp = Math.max(1, mount.projectileHp ?? (attackClass === "torpedo" ? 5 : attackClass === "missile" ? 2 : 1));
  const projectile: ServerCombatProjectile = {
    id: ctx.createRuntimeId("projectile", [source.id, target.id, getWeaponId(mount)]),
    ownerId: source.ownerId,
    sourceActorId: source.id,
    sourceActorKind: source.kind,
    sourceShipId: source.kind === "fleet" ? null : null,
    sourceMountKey: getWeaponId(mount),
    targetActorId: target.id,
    targetActorKind: target.kind,
    targetShipId: targetShip?.id ?? null,
    targetProjectileId: targetProjectile?.id ?? null,
    starId: source.starId,
    attackClass,
    interceptableBy: getWeaponInterceptableBy(mount),
    launchYear,
    impactYear: launchYear + travelHours / GAME_HOURS_PER_YEAR,
    sourcePosition: cloneSystemPosition(source.position),
    targetPosition: cloneSystemPosition(target.position),
    damage: Math.max(0, mount.damage),
    shieldPenetration: clamp(mount.shieldPenetration, 0, 1),
    armorPenetration: clamp(mount.armorPenetration, 0, 1),
    shieldDamageMultiplier: Math.max(0.01, mount.shieldDamageMultiplier ?? 1),
    armorDamageMultiplier: Math.max(0.01, mount.armorDamageMultiplier ?? 1),
    hullDamageMultiplier: Math.max(0.01, mount.hullDamageMultiplier ?? 1),
    lockedHit: roll.hit,
    accuracyMiss: roll.accuracyMiss,
    dodged: roll.dodged,
    guided: mount.guided === true || attackClass === "missile" || attackClass === "torpedo",
    reacquired: false,
    hp: projectileHp,
    maxHp: projectileHp,
    evasion: clamp(mount.projectileEvasion ?? (attackClass === "torpedo" ? 0.62 : attackClass === "missile" ? 0.78 : 0), 0, 0.95),
    status: "inFlight",
  };
  ctx.state.combatProjectiles.push(projectile);
  return projectile;
}

function createProjectileMount(projectile: ServerCombatProjectile): WeaponMountDefinition {
  return {
    id: projectile.sourceMountKey,
    kind: projectile.attackClass === "beam" ? "laser" : projectile.attackClass === "kinetic" ? "railgun" : projectile.attackClass === "plasma" ? "plasma" : projectile.attackClass === "pointDefense" ? "pointDefense" : "missile",
    barrels: 1,
    damage: projectile.damage,
    shieldPenetration: projectile.shieldPenetration,
    armorPenetration: projectile.armorPenetration,
    shieldDamageMultiplier: projectile.shieldDamageMultiplier,
    armorDamageMultiplier: projectile.armorDamageMultiplier,
    hullDamageMultiplier: projectile.hullDamageMultiplier,
    accuracy: 1,
  };
}

function chooseStrayHitShip(ctx: RuntimeContext, projectile: ServerCombatProjectile, shipsById: Map<string, GameShip>): { fleet: GameFleet; ship: GameShip } | null {
  const candidates = (ctx.state.fleets as GameFleet[])
    .filter((fleet) => fleet.currentStarId === projectile.starId && isHostileOwner(ctx, projectile.ownerId, fleet.ownerId))
    .filter((fleet) => {
      const position = getFleetAuthoritativeSystemPosition(ctx, fleet);
      return Math.hypot(position.x - projectile.targetPosition.x, position.z - projectile.targetPosition.z) <= 28 + fleet.tacticalRadius;
    })
    .flatMap((fleet) => getFleetLivingShips(fleet, shipsById).filter((ship) => ship.id !== projectile.targetShipId).map((ship) => ({ fleet, ship })));
  const densityWeight = candidates.reduce((sum, candidate) => {
    const doctrineFactor = candidate.fleet.combatSettings.doctrine === "artillery" ? 0.7 : candidate.fleet.combatSettings.doctrine === "assault" ? 1.2 : candidate.fleet.combatSettings.doctrine === "escort" ? 1.1 : 1;
    return sum + shipCommandWeight(candidate.ship) * doctrineFactor;
  }, 0);
  const chance = computeStrayHitProbability(densityWeight);
  if (candidates.length === 0 || Math.random() >= chance) return null;
  let roll = Math.random() * densityWeight;
  for (const candidate of candidates) {
    const doctrineFactor = candidate.fleet.combatSettings.doctrine === "artillery" ? 0.7 : candidate.fleet.combatSettings.doctrine === "assault" ? 1.2 : candidate.fleet.combatSettings.doctrine === "escort" ? 1.1 : 1;
    roll -= shipCommandWeight(candidate.ship) * doctrineFactor;
    if (roll <= 0) return candidate;
  }
  return candidates[0] ?? null;
}

export function computeShipCriticalChances(hullDamage: number, maxHull: number, remainingHull: number): { weapon: number; engine: number; explosion: number } {
  if (hullDamage <= 0 || maxHull <= 0 || remainingHull <= 0) return { weapon: 0, engine: 0, explosion: 0 };
  const ratio = clamp(remainingHull / maxHull, 0, 1);
  const score = clamp(hullDamage / maxHull, 0, 1) * (1 - ratio) ** 2;
  return {
    weapon: Math.min(0.25, 2 * score),
    engine: Math.min(0.04, 0.25 * score),
    explosion: ratio < 0.35 ? Math.min(0.03, 0.4 * score * ((0.35 - ratio) / 0.35)) : 0,
  };
}

function applyShipCritical(ctx: RuntimeContext, ship: GameShip, hullDamage: number, mountCount: number): { critical: boolean; exploded: boolean } {
  if (hullDamage <= 0 || ship.maxHull <= 0 || ship.hull <= 0) return { critical: false, exploded: false };
  const chances = computeShipCriticalChances(hullDamage, ship.maxHull, ship.hull);
  ship.subsystemState ??= { disabledWeaponKeys: [], engineDisabled: false, emergencyMobility: false };
  if (Math.random() < chances.explosion) {
    ship.hull = 0;
    ship.hp = 0;
    return { critical: true, exploded: true };
  }
  if (!ship.subsystemState.engineDisabled && Math.random() < chances.engine) {
    ship.subsystemState.engineDisabled = true;
    ship.subsystemState.emergencyMobility = false;
    return { critical: true, exploded: false };
  }
  if (mountCount > ship.subsystemState.disabledWeaponKeys.length && Math.random() < chances.weapon) {
    const available = Array.from({ length: mountCount }, (_, index) => String(index)).filter((key) => !ship.subsystemState!.disabledWeaponKeys.includes(key));
    const key = available[Math.floor(Math.random() * available.length)];
    if (key !== undefined) ship.subsystemState.disabledWeaponKeys.push(key);
    return { critical: true, exploded: false };
  }
  return { critical: false, exploded: false };
}

function incrementFleetBattleMetric(ctx: RuntimeContext, fleetId: string | null | undefined, metric: "projectilesIntercepted" | "strayHits" | "subsystemCriticals", amount = 1): void {
  if (!fleetId) return;
  const snapshot = (ctx.state.fleets as GameFleet[]).find((fleet) => fleet.id === fleetId)?.battleSnapshot;
  if (!snapshot) return;
  snapshot[metric] = (snapshot[metric] ?? 0) + amount;
}

export function fireFleetWeaponsAtTarget(
  ctx: RuntimeContext,
  actor: Extract<ContinuousCombatActor, { kind: "fleet" }>,
  target: ContinuousCombatActor,
  shipsById: Map<string, GameShip>,
): { shipsChanged: boolean; starbasesChanged: boolean; contactsChanged: boolean; factionEconomiesChanged: boolean } {
  const shipsChanged = false;
  const starbasesChanged = false;
  let contactsChanged = false;
  const factionEconomiesChanged = false;
  const targetHostile = target.kind === "fleet"
    ? isHostileOwner(ctx, actor.ownerId, target.fleet.ownerId)
    : isHostileOwner(ctx, actor.ownerId, target.starbase.ownerId);
  if (!targetHostile && !findIncomingProjectile(ctx, actor)) {
    return { shipsChanged, starbasesChanged, contactsChanged, factionEconomiesChanged };
  }
  const distance = effectiveActorDistance(actor, target);
  const attackMultiplier = getFleetAttackMultiplier(ctx.state, actor.fleet);
  const command = getFleetCommandProfile(ctx, actor.fleet, shipsById);
  const trackMultiplier = getCombatTrackAccuracyMultiplier(getCombatTrackQuality(ctx, actor.ownerId, target));
  for (const ship of getFleetLivingShips(actor.fleet, shipsById)) {
    if (ship.disabled) continue;
    const mounts = calculateShipDesignStats(getShipDesignForShip(ctx, ship)).combat.weaponMounts;
    ship.weaponReadyAtYears ??= {};
    for (let index = 0; index < mounts.length; index += 1) {
      if (ship.subsystemState?.disabledWeaponKeys.includes(String(index))) continue;
      const mount = applyFleetAttackShortagePenalty(mounts[index], attackMultiplier);
      const cooldownKey = `${index}:${getWeaponId(mount)}`;
      const counterClass = getWeaponCounterClass(mount);
      const incoming = counterClass ? findIncomingProjectile(ctx, actor, counterClass) : null;
      if (!targetHostile && !incoming) continue;
      if (!incoming && !weaponCanFireAtDistance(mount, distance)) {
        ship.weaponReadyAtYears[cooldownKey] = Math.max(ship.weaponReadyAtYears[cooldownKey] ?? 0, ctx.state.clock.year);
        continue;
      }
      let launchYear = ship.weaponReadyAtYears[cooldownKey] ?? ctx.state.clock.year;
      const cooldownYears = getWeaponCooldownHours(mount) * command.cooldownMultiplier / GAME_HOURS_PER_YEAR;
      while (launchYear <= ctx.state.clock.year + 1e-10) {
        for (let barrel = 0; barrel < Math.max(1, Math.round(mount.barrels)); barrel += 1) {
          let actualTarget = target;
          let targetShip: GameShip | null = null;
          let targetEvasion = 0;
          if (target.kind === "fleet") {
            const intended = chooseTargetShip(target.fleet, shipsById);
            targetShip = intended ? chooseScreenedFleetShip(ctx, target.fleet, intended, shipsById) : null;
            targetEvasion = targetShip ? getShipEvasionForFleetCombat(ctx, targetShip, target.fleet) : 0;
          } else {
            const screen = chooseStarbaseScreen(ctx, target.starbase, shipsById);
            if (screen) {
              const screenActor = buildContinuousCombatActors(ctx, shipsById).find((candidate) => candidate.kind === "fleet" && candidate.id === screen.fleet.id);
              if (screenActor?.kind === "fleet") actualTarget = screenActor;
              targetShip = screen.ship;
              targetEvasion = getShipEvasionForFleetCombat(ctx, screen.ship, screen.fleet);
            } else {
              targetEvasion = STARBASE_LEVEL_DEFINITIONS[target.starbase.level]?.combat.evasion ?? 0;
            }
          }
          if (actualTarget.kind === "fleet" && !targetShip) continue;
          const projectile = launchCombatProjectile(ctx, actor, actualTarget, mount, launchYear, targetShip, targetEvasion, incoming ? command.coordinationMultiplier : command.accuracyMultiplier * trackMultiplier, incoming);
          projectile.sourceShipId = ship.id;
          contactsChanged = true;
        }
        launchYear += cooldownYears;
      }
      ship.weaponReadyAtYears[cooldownKey] = launchYear;
    }
  }
  return { shipsChanged, starbasesChanged, contactsChanged, factionEconomiesChanged };
}

export function fireStarbaseWeaponsAtTarget(
  ctx: RuntimeContext,
  actor: Extract<ContinuousCombatActor, { kind: "starbase" }>,
  target: ContinuousCombatActor,
  shipsById: Map<string, GameShip>,
): { shipsChanged: boolean; contactsChanged: boolean } {
  const shipsChanged = false;
  let contactsChanged = false;
  if (target.kind !== "fleet") return { shipsChanged, contactsChanged };
  const distance = effectiveActorDistance(actor, target);
  const mounts = getStarbaseWeaponMounts(actor.starbase);
  actor.starbase.weaponReadyAtYears ??= {};
  for (let index = 0; index < mounts.length; index += 1) {
    const mount = mounts[index];
    const cooldownKey = `${index}:${getWeaponId(mount)}`;
    if (!weaponCanFireAtDistance(mount, distance)) {
      actor.starbase.weaponReadyAtYears[cooldownKey] = Math.max(actor.starbase.weaponReadyAtYears[cooldownKey] ?? 0, ctx.state.clock.year);
      continue;
    }
    let launchYear = actor.starbase.weaponReadyAtYears[cooldownKey] ?? ctx.state.clock.year;
    const cooldownYears = getWeaponCooldownHours(mount) / GAME_HOURS_PER_YEAR;
    while (launchYear <= ctx.state.clock.year + 1e-10) {
      for (let barrel = 0; barrel < Math.max(1, Math.round(mount.barrels)); barrel += 1) {
        const intended = chooseTargetShip(target.fleet, shipsById);
        if (!intended) continue;
        const targetShip = chooseScreenedFleetShip(ctx, target.fleet, intended, shipsById);
        launchCombatProjectile(ctx, actor, target, mount, launchYear, targetShip, getShipEvasionForFleetCombat(ctx, targetShip, target.fleet), 1);
        contactsChanged = true;
      }
      launchYear += cooldownYears;
    }
    actor.starbase.weaponReadyAtYears[cooldownKey] = launchYear;
  }
  return { shipsChanged, contactsChanged };
}

export function processCombatProjectiles(
  ctx: RuntimeContext,
  shipsById: Map<string, GameShip>,
): { shipsChanged: boolean; starbasesChanged: boolean; contactsChanged: boolean; factionEconomiesChanged: boolean } {
  let shipsChanged = false;
  let starbasesChanged = false;
  let contactsChanged = false;
  let factionEconomiesChanged = false;
  const due = ctx.state.combatProjectiles
    .filter((projectile) => projectile.status === "inFlight" && projectile.impactYear <= ctx.state.clock.year + 1e-10)
    .sort((a, b) => a.impactYear - b.impactYear || a.id.localeCompare(b.id));

  for (const projectile of due) {
    if (projectile.status !== "inFlight") continue;
    contactsChanged = true;
    if (projectile.targetProjectileId) {
      const targetProjectile = ctx.state.combatProjectiles.find((candidate) => candidate.id === projectile.targetProjectileId && candidate.status === "inFlight");
      if (targetProjectile && projectile.lockedHit) {
        targetProjectile.hp = Math.max(0, targetProjectile.hp - projectile.damage);
        if (targetProjectile.hp <= 0) {
          targetProjectile.status = "intercepted";
          incrementFleetBattleMetric(ctx, projectile.sourceActorKind === "fleet" ? projectile.sourceActorId : null, "projectilesIntercepted");
        }
      }
      projectile.status = "impacted";
      contactsChanged = true;
      continue;
    }

    let targetFleet = projectile.targetActorKind === "fleet"
      ? (ctx.state.fleets as GameFleet[]).find((fleet) => fleet.id === projectile.targetActorId) ?? null
      : null;
    let targetStarbase = projectile.targetActorKind === "starbase"
      ? ctx.state.starbases.find((starbase) => starbase.id === projectile.targetActorId) ?? null
      : null;
    if (targetFleet && !isHostileOwner(ctx, projectile.ownerId, targetFleet.ownerId)) targetFleet = null;
    if (targetStarbase && !isHostileOwner(ctx, projectile.ownerId, targetStarbase.ownerId)) targetStarbase = null;
    let targetShip = projectile.targetShipId ? shipsById.get(projectile.targetShipId) ?? null : null;
    if (targetShip?.hull === 0 || (targetShip && !isHostileOwner(ctx, projectile.ownerId, targetShip.ownerId))) targetShip = null;

    if (!targetShip && projectile.guided && !projectile.reacquired) {
      const reacquireFleet = (ctx.state.fleets as GameFleet[])
        .filter((fleet) => fleet.currentStarId === projectile.starId && isHostileOwner(ctx, projectile.ownerId, fleet.ownerId))
        .filter((fleet) => getFleetLivingShips(fleet, shipsById).length > 0)
        .filter((fleet) => {
          const position = getFleetAuthoritativeSystemPosition(ctx, fleet);
          return Math.hypot(position.x - projectile.targetPosition.x, position.z - projectile.targetPosition.z) <= 28 + fleet.tacticalRadius;
        })
        .sort((left, right) => {
          const leftPosition = getFleetAuthoritativeSystemPosition(ctx, left);
          const rightPosition = getFleetAuthoritativeSystemPosition(ctx, right);
          return Math.hypot(leftPosition.x - projectile.targetPosition.x, leftPosition.z - projectile.targetPosition.z)
            - Math.hypot(rightPosition.x - projectile.targetPosition.x, rightPosition.z - projectile.targetPosition.z);
        })[0] ?? null;
      targetFleet = reacquireFleet;
      targetShip = reacquireFleet ? chooseTargetShip(reacquireFleet, shipsById) : null;
      projectile.reacquired = true;
      projectile.targetShipId = targetShip?.id ?? null;
      if (reacquireFleet) {
        projectile.targetActorId = reacquireFleet.id;
        projectile.targetActorKind = "fleet";
      }
    }

    let stray = false;
    if (!projectile.lockedHit || (!targetShip && !targetStarbase)) {
      const alternate = chooseStrayHitShip(ctx, projectile, shipsById);
      if (alternate) {
        targetFleet = alternate.fleet;
        targetStarbase = null;
        targetShip = alternate.ship;
        stray = true;
        incrementFleetBattleMetric(ctx, alternate.fleet.id, "strayHits");
      } else {
        projectile.status = "expired";
        continue;
      }
    }

    const layer = targetShip ?? targetStarbase;
    if (!layer) {
      projectile.status = "expired";
      continue;
    }
    const targetOwnerBeforeImpact = targetShip?.ownerId ?? targetStarbase?.ownerId ?? -1;
    const result = applyWeaponHit(createProjectileMount(projectile), layer as CombatLayerState);
    let destroyed = result.destroyed;
    if (targetShip) {
      targetShip.hp = targetShip.hull;
      if (result.shieldDamage > 0) targetShip.lastShieldDamageAtYear = projectile.impactYear;
      const mounts = calculateShipDesignStats(getShipDesignForShip(ctx, targetShip)).combat.weaponMounts;
      const critical = applyShipCritical(ctx, targetShip, result.hullDamage, mounts.length);
      if (critical.critical) incrementFleetBattleMetric(ctx, targetFleet?.id, "subsystemCriticals");
      destroyed ||= critical.exploded;
      shipsChanged = true;
    } else if (targetStarbase) {
      if (result.shieldDamage > 0) targetStarbase.lastShieldDamageAtYear = projectile.impactYear;
      if (destroyed) {
        const captured = captureStarbase(ctx, targetStarbase, projectile.ownerId);
        factionEconomiesChanged ||= captured;
        if (captured) {
          const sourceFleet = projectile.sourceActorKind === "fleet" ? (ctx.state.fleets as GameFleet[]).find((fleet) => fleet.id === projectile.sourceActorId) : null;
          if (sourceFleet?.battleSnapshot && !sourceFleet.battleSnapshot.capturedStarbaseIds?.includes(targetStarbase.id)) {
            (sourceFleet.battleSnapshot.capturedStarbaseIds ??= []).push(targetStarbase.id);
          }
        }
      }
      starbasesChanged = true;
    }
    recordContinuousCombatContact(ctx, {
      sourceId: projectile.sourceActorId,
      sourceKind: projectile.sourceActorKind,
      sourceOwnerId: projectile.ownerId,
      targetId: targetFleet?.id ?? targetStarbase?.id ?? projectile.targetActorId,
      targetKind: targetFleet ? "fleet" : "starbase",
      targetOwnerId: targetOwnerBeforeImpact,
      weaponId: projectile.sourceMountKey,
      weaponName: projectile.sourceMountKey,
      hit: true,
      accuracyMiss: stray ? projectile.accuracyMiss : false,
      dodged: stray ? projectile.dodged : false,
      shieldDamage: result.shieldDamage,
      armorDamage: result.armorDamage,
      hullDamage: result.hullDamage,
      targetDestroyed: destroyed,
      sourcePosition: cloneSystemPosition(projectile.sourcePosition),
      targetPosition: cloneSystemPosition(projectile.targetPosition),
    });
    projectile.status = "impacted";
    contactsChanged = true;
  }

  ctx.state.combatProjectiles = ctx.state.combatProjectiles.filter((projectile) => projectile.status === "inFlight");
  return { shipsChanged, starbasesChanged, contactsChanged, factionEconomiesChanged };
}

function processContinuousFleetCombatStep(
  ctx: RuntimeContext,
  elapsedGameHours: number,
  elapsedGameDays: number,
): {
  combatContactsChanged: boolean;
  shipsChanged: boolean;
  fleetsChanged: boolean;
  starbasesChanged: boolean;
  factionEconomiesChanged: boolean;
  visibilityChanged: boolean;
} {
  let combatContactsChanged = false;
  let shipsChanged = false;
  let fleetsChanged = false;
  let starbasesChanged = false;
  let factionEconomiesChanged = false;
  let visibilityChanged = false;
  const shipsById = new Map(ctx.state.ships.map((ship) => [ship.id, ship]));
  decrementWeaponCooldowns(ctx, elapsedGameHours);
  for (const fleet of ctx.state.fleets as GameFleet[]) {
    if (updateFleetTacticalProfile(ctx, fleet, shipsById)) fleetsChanged = true;
  }
  let actors = buildContinuousCombatActors(ctx, shipsById);
  for (const actor of actors.filter((candidate): candidate is Extract<ContinuousCombatActor, { kind: "fleet" }> => candidate.kind === "fleet")) {
    const target = selectFleetCombatTarget(ctx, actor, actors, shipsById);
    actor.fleet.currentTargetId = target?.id ?? null;
    actor.fleet.currentTargetKind = target?.kind ?? null;
    if (target) {
      actor.fleet.lastCombatAtYear = ctx.state.clock.year;
      ensureFleetBattleSnapshot(ctx, actor.fleet, shipsById);
      if (target.kind === "fleet") ensureFleetBattleSnapshot(ctx, target.fleet, shipsById);
    }
    if (updateFleetCombatMovement(ctx, actor, target, elapsedGameDays, shipsById)) fleetsChanged = true;
  }
  if (applyFleetSoftSeparation(ctx, shipsById)) fleetsChanged = true;
  actors = buildContinuousCombatActors(ctx, shipsById);
  const targetByFleetId = new Map<string, ContinuousCombatActor | null>();
  for (const actor of actors.filter((candidate): candidate is Extract<ContinuousCombatActor, { kind: "fleet" }> => candidate.kind === "fleet")) {
    targetByFleetId.set(actor.id, selectFleetCombatTarget(ctx, actor, actors, shipsById));
  }
  for (const actor of actors) {
    if (actor.kind === "fleet") {
      const inbound = findIncomingProjectile(ctx, actor);
      let target = targetByFleetId.get(actor.id) ?? null;
      if (!target && inbound) target = actors.find((candidate) => candidate.id === inbound.sourceActorId && candidate.ownerId !== actor.ownerId) ?? actor;
      actor.fleet.currentTargetId = target?.id ?? null;
      actor.fleet.currentTargetKind = target?.kind ?? null;
      if (!target || (!inbound && !actorIsInFleetWeaponRange(actor, target))) continue;
      const result = fireFleetWeaponsAtTarget(ctx, actor, target, shipsById);
      shipsChanged ||= result.shipsChanged;
      starbasesChanged ||= result.starbasesChanged;
      factionEconomiesChanged ||= result.factionEconomiesChanged;
      combatContactsChanged ||= result.contactsChanged;
      if (result.contactsChanged) {
        actor.fleet.combatStatus = "firing";
        actor.fleet.lastCombatAtYear = ctx.state.clock.year;
      }
      continue;
    }
    if (actor.ownerId !== actor.starbase.ownerId || actor.starbase.hull <= 0) continue;
    const target = selectStarbaseCombatTarget(ctx, actor, actors, shipsById);
    if (!target) continue;
    const result = fireStarbaseWeaponsAtTarget(ctx, actor, target, shipsById);
    shipsChanged ||= result.shipsChanged;
    combatContactsChanged ||= result.contactsChanged;
  }
  const projectileResult = processCombatProjectiles(ctx, shipsById);
  shipsChanged ||= projectileResult.shipsChanged;
  starbasesChanged ||= projectileResult.starbasesChanged;
  factionEconomiesChanged ||= projectileResult.factionEconomiesChanged;
  combatContactsChanged ||= projectileResult.contactsChanged;
  const destroyedShipIds = new Set(ctx.state.ships.filter((ship) => ship.hull <= 0).map((ship) => ship.id));
  if (destroyedShipIds.size > 0) {
    ctx.state.ships = ctx.state.ships.filter((ship) => !destroyedShipIds.has(ship.id));
    if (ctx.syncFleetMembership()) fleetsChanged = true;
    shipsChanged = true;
  }
  if (starbasesChanged) {
    ctx.refreshDiscovery();
    visibilityChanged = true;
  }
  for (const fleet of ctx.state.fleets as GameFleet[]) {
    if (!fleet.battleSnapshot || fleet.currentTargetId) continue;
    const hasProjectile = ctx.state.combatProjectiles.some((projectile) => projectile.status === "inFlight" && (projectile.sourceActorId === fleet.id || projectile.targetActorId === fleet.id));
    const quietHours = Number.isFinite(fleet.lastCombatAtYear) ? (ctx.state.clock.year - Number(fleet.lastCombatAtYear)) * GAME_HOURS_PER_YEAR : Number.POSITIVE_INFINITY;
    if (hasProjectile || quietHours < 60) continue;
    const existingIds = new Set(ctx.state.ships.map((ship) => ship.id));
    const participantFleetIds = (ctx.state.fleets as GameFleet[])
      .filter((participant) => participant.currentStarId === fleet.currentStarId && participant.battleSnapshot)
      .filter((participant) => Math.abs(participant.battleSnapshot!.startedAtYear - fleet.battleSnapshot!.startedAtYear) * GAME_HOURS_PER_YEAR <= 60)
      .map((participant) => participant.id);
    ctx.state.combatReports.push({
      id: ctx.createRuntimeId("combat-report", [fleet.ownerId, fleet.battleSnapshot.battleId]),
      ownerId: fleet.ownerId,
      starId: fleet.currentStarId,
      startedAtYear: fleet.battleSnapshot.startedAtYear,
      endedAtYear: ctx.state.clock.year,
      participantFleetIds,
      shipsLost: fleet.battleSnapshot.initialShipIds.filter((id) => !existingIds.has(id)),
      projectilesIntercepted: fleet.battleSnapshot.projectilesIntercepted ?? 0,
      strayHits: fleet.battleSnapshot.strayHits ?? 0,
      subsystemCriticals: fleet.battleSnapshot.subsystemCriticals ?? 0,
      capturedStarbaseIds: [...(fleet.battleSnapshot.capturedStarbaseIds ?? [])],
      retreatedFleetIds: fleet.battleSnapshot.retreated ? [fleet.id] : [],
      repairSpending: { ...(fleet.battleSnapshot.repairSpending ?? {}) },
    });
    ctx.state.combatReports = ctx.state.combatReports.slice(-200);
    fleet.battleSnapshot = null;
    fleetsChanged = true;
  }
  return { combatContactsChanged, shipsChanged, fleetsChanged, starbasesChanged, factionEconomiesChanged, visibilityChanged };
}

export function processContinuousFleetCombat(
  ctx: RuntimeContext,
  elapsedGameHours: number,
  elapsedGameDays: number,
): {
  combatContactsChanged: boolean;
  shipsChanged: boolean;
  fleetsChanged: boolean;
  starbasesChanged: boolean;
  factionEconomiesChanged: boolean;
  visibilityChanged: boolean;
} {
  const totalHours = Math.max(0, elapsedGameHours);
  if (totalHours <= 0.100001) return processContinuousFleetCombatStep(ctx, totalHours, Math.max(0, elapsedGameDays));
  const endYear = ctx.state.clock.year;
  let cursorYear = endYear - totalHours / GAME_HOURS_PER_YEAR;
  const aggregate = {
    combatContactsChanged: false,
    shipsChanged: false,
    fleetsChanged: false,
    starbasesChanged: false,
    factionEconomiesChanged: false,
    visibilityChanged: false,
  };
  let remaining = totalHours;
  while (remaining > 1e-9) {
    const stepHours = Math.min(0.1, remaining);
    cursorYear += stepHours / GAME_HOURS_PER_YEAR;
    ctx.state.clock.year = cursorYear;
    const result = processContinuousFleetCombatStep(ctx, stepHours, stepHours / 24);
    for (const key of Object.keys(aggregate) as Array<keyof typeof aggregate>) aggregate[key] ||= result[key];
    remaining -= stepHours;
  }
  ctx.state.clock.year = endYear;
  return aggregate;
}

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------

export function removeDestroyedShips(ctx: RuntimeContext): boolean {
  const destroyed = new Set(ctx.state.ships.filter((ship) => ship.hull <= 0).map((ship) => ship.id));
  if (destroyed.size === 0) return false;
  ctx.state.ships = ctx.state.ships.filter((ship) => !destroyed.has(ship.id));
  ctx.syncFleetMembership();
  return true;
}

export function clearFleetMovementNow(ctx: RuntimeContext, fleet: GameFleet): void {
  const currentPosition = getFleetAuthoritativeSystemPosition(ctx, fleet);
  fleet.systemPosition = currentPosition;
  fleet.targetStarId = null;
  fleet.route = [fleet.currentStarId];
  fleet.routeIndex = 0;
  fleet.orderType = null;
  fleet.hyperlanePosition = null;
  fleet.movementPlan = null;
  fleet.darkMatterBoostActive = false;
  fleet.darkMatterBoostPaidUntilYear = null;
  fleet.mergeTargetFleetId = null;
  clearFleetOrbit(fleet);
  clearFleetCombatIntent(fleet);
  ctx.setFleetPhase(fleet, "idle");
  fleet.phaseProgress = 0;
  fleet.phaseElapsedMs = 0;
}

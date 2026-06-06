import type { PlanetConfig, StarData } from "./StarMap";

export type SystemPosition = { x: number; y: number; z: number };

export const TAU = Math.PI * 2;

export const PLANET_VISUAL_DIAMETER_MULTIPLIER = 1.2;
export const MIN_PLANET_VISUAL_DIAMETER = 0.8;

export const PLANET_ORBIT_RADIUS_MULTIPLIER = 1.2;
export const DEFAULT_SYSTEM_ORBIT_BASE_OFFSET = 14;
export const DEFAULT_SYSTEM_ORBIT_SPACING = 11;

// Keep inner orbits close to the old client speed (orbitSpeed * 0.35), then
// apply a Kepler-like distance falloff so outer planets move much more slowly.
export const ORBIT_SPEED_BASE_MULTIPLIER = 0.35;
export const ORBIT_SPEED_DISTANCE_EXPONENT = 1.5;
export const ORBIT_SPEED_REFERENCE_RADIUS = 24;

export const DEFAULT_ORBIT_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0, 0);

export const SYSTEM_FLEET_Y = 4.8;
export const SYSTEM_HYPERLANE_EXIT_RADIUS = 52;
export const SYSTEM_HYPERLANE_EXIT_MARKER_Y = 2.8;

const SYSTEM_FLEET_STAGING_POSITION: SystemPosition = { x: 23, y: SYSTEM_FLEET_Y, z: -19 };
const SYSTEM_STAR_ORBIT_POSITION: SystemPosition = { x: 0, y: SYSTEM_FLEET_Y, z: -8 };
const LEGACY_SYSTEM_STARBASE_POSITION: SystemPosition = { x: 3.2, y: SYSTEM_FLEET_Y, z: -18 };
const SYSTEM_STARBASE_POSITION: SystemPosition = { x: 4.2, y: SYSTEM_FLEET_Y, z: -10.5 };
const SYSTEM_STARBASE_ORBIT_OFFSET: SystemPosition = { x: 6.5, y: 0, z: 0 };

export interface SystemOrbitLayout {
  orbitBaseOffset: number;
  orbitSpacing: number;
  orbitRadiusMultiplier: number;
}

export interface PlanetOrbitFields {
  orbitPhaseAtEpoch: number;
  orbitEpochMs: number;
}

type PlanetOrbitSeed = Pick<PlanetConfig, "name" | "orbitRadius" | "orbitSpeed"> & {
  id?: string;
  orbitPhaseAtEpoch?: number;
  orbitEpochMs?: number;
};

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

export function normalizeOrbitAngle(angle: number): number {
  const normalized = angle % TAU;
  return normalized < 0 ? normalized + TAU : normalized;
}

export function createDeterministicPlanetOrbitPhase(
  starId: number,
  planetIndex: number,
  planet: PlanetOrbitSeed,
): number {
  const hash = hashString([
    "planet-orbit-phase",
    starId,
    planetIndex,
    planet.id ?? "",
    planet.name,
    planet.orbitRadius.toFixed(3),
    planet.orbitSpeed.toFixed(5),
  ].join(":"));
  return (hash / 0x100000000) * TAU;
}

export function withPlanetOrbitFields<T extends PlanetOrbitSeed>(
  planet: T,
  starId: number,
  planetIndex: number,
): T & PlanetOrbitFields {
  const orbitPhaseAtEpoch = Number.isFinite(planet.orbitPhaseAtEpoch)
    ? normalizeOrbitAngle(planet.orbitPhaseAtEpoch!)
    : createDeterministicPlanetOrbitPhase(starId, planetIndex, planet);
  const orbitEpochMs = Number.isFinite(planet.orbitEpochMs)
    ? planet.orbitEpochMs!
    : DEFAULT_ORBIT_EPOCH_MS;

  return {
    ...planet,
    orbitPhaseAtEpoch,
    orbitEpochMs,
  };
}

export function normalizePlanetOrbitFields(
  planet: PlanetOrbitSeed,
  starId: number,
  planetIndex: number,
): boolean {
  const next = withPlanetOrbitFields(planet, starId, planetIndex);
  let changed = false;

  if (planet.orbitPhaseAtEpoch !== next.orbitPhaseAtEpoch) {
    planet.orbitPhaseAtEpoch = next.orbitPhaseAtEpoch;
    changed = true;
  }
  if (planet.orbitEpochMs !== next.orbitEpochMs) {
    planet.orbitEpochMs = next.orbitEpochMs;
    changed = true;
  }

  return changed;
}

export function getSystemOrbitLayout(starType?: string): SystemOrbitLayout {
  switch (starType) {
    case "M Red Giant":
      return { orbitBaseOffset: 28, orbitSpacing: 16, orbitRadiusMultiplier: PLANET_ORBIT_RADIUS_MULTIPLIER };
    case "T Brown Dwarf":
      return { orbitBaseOffset: 12, orbitSpacing: 10, orbitRadiusMultiplier: PLANET_ORBIT_RADIUS_MULTIPLIER };
    case "Neutron Star":
      return { orbitBaseOffset: 13, orbitSpacing: 10, orbitRadiusMultiplier: PLANET_ORBIT_RADIUS_MULTIPLIER };
    case "Pulsar":
      return { orbitBaseOffset: 14, orbitSpacing: 11, orbitRadiusMultiplier: PLANET_ORBIT_RADIUS_MULTIPLIER };
    case "Black Hole":
      return { orbitBaseOffset: 20, orbitSpacing: 14, orbitRadiusMultiplier: PLANET_ORBIT_RADIUS_MULTIPLIER };
    default:
      return {
        orbitBaseOffset: DEFAULT_SYSTEM_ORBIT_BASE_OFFSET,
        orbitSpacing: DEFAULT_SYSTEM_ORBIT_SPACING,
        orbitRadiusMultiplier: PLANET_ORBIT_RADIUS_MULTIPLIER,
      };
  }
}

export function getPlanetVisualDiameter(planet: Pick<PlanetConfig, "diameter">): number {
  return Math.max(MIN_PLANET_VISUAL_DIAMETER, planet.diameter * PLANET_VISUAL_DIAMETER_MULTIPLIER);
}

export function getPlanetSystemOrbitRadius(
  planet: Pick<PlanetConfig, "orbitRadius">,
  planetIndex: number,
  layout: SystemOrbitLayout = getSystemOrbitLayout(),
): number {
  return layout.orbitBaseOffset + planetIndex * layout.orbitSpacing + planet.orbitRadius * layout.orbitRadiusMultiplier;
}

export function getPlanetOrbitAngularSpeed(
  planet: Pick<PlanetConfig, "orbitSpeed">,
  systemOrbitRadius: number,
): number {
  const distanceScale = Math.pow(
    ORBIT_SPEED_REFERENCE_RADIUS / Math.max(systemOrbitRadius, ORBIT_SPEED_REFERENCE_RADIUS),
    ORBIT_SPEED_DISTANCE_EXPONENT,
  );
  return planet.orbitSpeed * ORBIT_SPEED_BASE_MULTIPLIER * distanceScale;
}

export function getPlanetOrbitAngle(
  planet: Pick<PlanetConfig, "orbitPhaseAtEpoch" | "orbitEpochMs">,
  nowMs: number,
  orbitAngularSpeed: number,
): number {
  const orbitPhaseAtEpoch = finiteOr(planet.orbitPhaseAtEpoch, 0);
  const orbitEpochMs = finiteOr(planet.orbitEpochMs, DEFAULT_ORBIT_EPOCH_MS);
  return normalizeOrbitAngle(orbitPhaseAtEpoch + orbitAngularSpeed * ((nowMs - orbitEpochMs) / 1000));
}

export function getPlanetSystemPosition(
  planet: Pick<PlanetConfig, "orbitPhaseAtEpoch" | "orbitEpochMs" | "orbitRadius" | "orbitSpeed">,
  planetIndex: number,
  nowMs: number,
  layout: SystemOrbitLayout = getSystemOrbitLayout(),
): SystemPosition {
  const orbitRadius = getPlanetSystemOrbitRadius(planet, planetIndex, layout);
  const orbitAngularSpeed = getPlanetOrbitAngularSpeed(planet, orbitRadius);
  const angle = getPlanetOrbitAngle(planet, nowMs, orbitAngularSpeed);

  // System-view positions are star-relative scene coordinates on the XZ plane.
  // Y is reserved as a visual lift for meshes like fleets and labels.
  return {
    x: Math.cos(angle) * orbitRadius,
    y: 0,
    z: Math.sin(angle) * orbitRadius,
  };
}

export function getSystemFleetStagingPosition(): SystemPosition {
  return { ...SYSTEM_FLEET_STAGING_POSITION };
}

export function getSystemStarOrbitPosition(): SystemPosition {
  return { ...SYSTEM_STAR_ORBIT_POSITION };
}

export function getSystemStarbasePosition(): SystemPosition {
  return { ...SYSTEM_STARBASE_POSITION };
}

export function normalizeSystemStarbasePosition(position: SystemPosition | undefined | null): SystemPosition {
  if (!position) return getSystemStarbasePosition();
  const matchesLegacyDefault =
    Math.abs(position.x - LEGACY_SYSTEM_STARBASE_POSITION.x) < 0.001
    && Math.abs(position.y - LEGACY_SYSTEM_STARBASE_POSITION.y) < 0.001
    && Math.abs(position.z - LEGACY_SYSTEM_STARBASE_POSITION.z) < 0.001;
  if (matchesLegacyDefault) return getSystemStarbasePosition();
  return { ...position };
}

export function getSystemStarbaseOrbitPosition(
  starbasePosition: SystemPosition = SYSTEM_STARBASE_POSITION,
): SystemPosition {
  const normalizedPosition = normalizeSystemStarbasePosition(starbasePosition);
  return {
    x: normalizedPosition.x + SYSTEM_STARBASE_ORBIT_OFFSET.x,
    y: SYSTEM_FLEET_Y,
    z: normalizedPosition.z + SYSTEM_STARBASE_ORBIT_OFFSET.z,
  };
}

export function interpolateSystemPosition(
  from: SystemPosition,
  to: SystemPosition,
  progress: number,
): SystemPosition {
  return {
    x: mix(from.x, to.x, progress),
    y: mix(from.y, to.y, progress),
    z: mix(from.z, to.z, progress),
  };
}

export function getHyperlaneDirection(fromStar: Pick<StarData, "x" | "z">, toStar: Pick<StarData, "x" | "z">): { dx: number; dz: number } {
  const dx = toStar.x - fromStar.x;
  const dz = toStar.z - fromStar.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= 0.0001) return { dx: 1, dz: 0 };
  return { dx: dx / distance, dz: dz / distance };
}

export function getHyperlaneExitSystemPosition(
  direction: { dx: number; dz: number },
  radius = SYSTEM_HYPERLANE_EXIT_RADIUS,
  y = SYSTEM_FLEET_Y,
): SystemPosition {
  const distance = Math.hypot(direction.dx, direction.dz);
  const dx = distance <= 0.0001 ? 1 : direction.dx / distance;
  const dz = distance <= 0.0001 ? 0 : direction.dz / distance;
  return { x: dx * radius, y, z: dz * radius };
}

export function getSystemHyperlaneExitPosition(fromStar: StarData, toStar: StarData): SystemPosition {
  return getHyperlaneExitSystemPosition(getHyperlaneDirection(fromStar, toStar));
}

export function getSystemHyperlaneEntryPosition(fromStar: StarData, toStar: StarData): SystemPosition {
  const direction = getHyperlaneDirection(toStar, fromStar);
  return getHyperlaneExitSystemPosition(direction);
}

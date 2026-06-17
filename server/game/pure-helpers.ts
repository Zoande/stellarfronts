import { getSystemFleetStagingPosition, SYSTEM_FLEET_Y } from "../../src/data/SystemCoordinates";
import { getWeaponMaxSystemRange, getWeaponMinSystemRange } from "../combat";
import type { WeaponMountDefinition } from "../../src/data/Starbase";
import { MIGRATION_DISTANCE_DECAY, MIGRATION_DISTANCE_FLOOR } from "./constants";

// --- Math utilities ---

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function roundTinyPressure(value: number): number {
  return Math.abs(value) < 0.000001 ? 0 : value;
}

// --- System position utilities ---

export function systemCenterPosition() {
  return getSystemFleetStagingPosition();
}

export function cloneSystemPosition(position: { x: number; y: number; z: number }): ReturnType<typeof systemCenterPosition> {
  return { x: position.x, y: position.y, z: position.z };
}

export function movePointToward(
  from: ReturnType<typeof systemCenterPosition>,
  to: ReturnType<typeof systemCenterPosition>,
  maxDistance: number,
): ReturnType<typeof systemCenterPosition> {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= 0.0001 || distance <= maxDistance) return cloneSystemPosition(to);
  const scale = maxDistance / distance;
  return { x: from.x + dx * scale, y: SYSTEM_FLEET_Y, z: from.z + dz * scale };
}

// --- Graph / migration utilities ---

export function computeJumpDistances(adjacency: number[][], sourceStarId: number, maxJumps: number): Map<number, number> {
  const distances = new Map<number, number>();
  if (sourceStarId < 0 || sourceStarId >= adjacency.length) return distances;
  distances.set(sourceStarId, 0);
  const queue: number[] = [sourceStarId];
  let head = 0;
  while (head < queue.length) {
    const starId = queue[head++];
    const distance = distances.get(starId) ?? 0;
    if (distance >= maxJumps) continue;
    for (const neighborId of adjacency[starId] ?? []) {
      if (neighborId < 0 || neighborId >= adjacency.length || distances.has(neighborId)) continue;
      distances.set(neighborId, distance + 1);
      queue.push(neighborId);
    }
  }
  return distances;
}

// Falloff applied to a migration flow based on hyperlane distance between the two systems.
// Neighbouring systems exchange the most; distant/unreachable systems still trickle (floor).
export function getMigrationDistanceMultiplier(distances: Map<number, number>, targetStarId: number): number {
  const distance = distances.get(targetStarId);
  if (distance === undefined) return MIGRATION_DISTANCE_FLOOR;
  if (distance <= 1) return 1;
  return clamp(Math.pow(MIGRATION_DISTANCE_DECAY, distance - 1), MIGRATION_DISTANCE_FLOOR, 1);
}

// --- Weapon range utilities ---

export function getMaxWeaponSystemRange(mounts: WeaponMountDefinition[]): number {
  return mounts.reduce((max, mount) => Math.max(max, getWeaponMaxSystemRange(mount)), 0);
}

export function getMountRangeSummary(mounts: WeaponMountDefinition[]): { min: number; max: number } {
  if (mounts.length === 0) return { min: 0, max: 0 };
  const min = mounts.reduce((lowest, mount) => Math.min(lowest, getWeaponMinSystemRange(mount)), Number.POSITIVE_INFINITY);
  const max = mounts.reduce((highest, mount) => Math.max(highest, getWeaponMaxSystemRange(mount)), 0);
  return { min: Number.isFinite(min) ? min : 0, max };
}

import type { SystemPosition } from "../data/SystemCoordinates";

export interface TacticalFormationOffset {
  x: number;
  y: number;
  z: number;
}

export const FLEET_FORMATION_SPACING = 1.35;
export const FLEET_FORMATION_LAYER_SIZE = 36;
export const FLEET_FORMATION_LAYER_HEIGHT = 0.72;
export const FLEET_FORMATION_MIN_RADIUS = 1.2;

export interface FleetFormationDimensions {
  columns: number;
  rows: number;
  layers: number;
  horizontalCount: number;
  radius: number;
}

export function hashTacticalId(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getFleetFormationDimensions(memberCount: number): FleetFormationDimensions {
  const count = Math.max(1, Math.floor(memberCount));
  const horizontalCount = Math.min(count, FLEET_FORMATION_LAYER_SIZE);
  let columns: number;
  if (horizontalCount <= 5) {
    columns = horizontalCount;
  } else {
    columns = Math.ceil(Math.sqrt(horizontalCount));
  }
  const rows = Math.max(1, Math.ceil(horizontalCount / columns));
  const layers = Math.max(1, Math.ceil(count / FLEET_FORMATION_LAYER_SIZE));
  const width = Math.max(0, columns - 1) * FLEET_FORMATION_SPACING;
  const depth = Math.max(0, rows - 1) * FLEET_FORMATION_SPACING;
  const oneRowFloor = Math.max(0, Math.min(horizontalCount, 5) - 1) * FLEET_FORMATION_SPACING / 2
    + FLEET_FORMATION_SPACING
    + Math.max(0, horizontalCount - 5) * 0.03;
  const radius = Math.max(FLEET_FORMATION_MIN_RADIUS, oneRowFloor, Math.hypot(width, depth) / 2 + FLEET_FORMATION_SPACING);
  return { columns, rows, layers, horizontalCount, radius };
}

export function getFleetTacticalRadius(memberCount: number): number {
  return getFleetFormationDimensions(memberCount).radius;
}

export function getLayeredFleetFormationOffset(memberIds: string[], memberId: string): TacticalFormationOffset {
  const count = Math.max(1, memberIds.length);
  const dimensions = getFleetFormationDimensions(count);
  const hash = hashTacticalId(memberId);
  const indexInFleet = memberIds.indexOf(memberId);
  const index = indexInFleet >= 0 ? indexInFleet : hash % count;
  const layer = Math.floor(index / FLEET_FORMATION_LAYER_SIZE);
  const indexInLayer = index % FLEET_FORMATION_LAYER_SIZE;
  const row = Math.floor(indexInLayer / dimensions.columns);
  const col = indexInLayer % dimensions.columns;
  const jitterX = (((hash >> 8) & 0xff) / 255 - 0.5) * 0.08;
  const jitterZ = (((hash >> 16) & 0xff) / 255 - 0.5) * 0.08;
  return {
    x: (col - (dimensions.columns - 1) / 2) * FLEET_FORMATION_SPACING + jitterX,
    y: layer * FLEET_FORMATION_LAYER_HEIGHT,
    z: (row - (dimensions.rows - 1) / 2) * FLEET_FORMATION_SPACING + jitterZ,
  };
}

export function getLayeredFleetFormationPosition(
  center: SystemPosition,
  yBase: number,
  memberIds: string[],
  memberId: string,
): SystemPosition {
  const offset = getLayeredFleetFormationOffset(memberIds, memberId);
  return {
    x: center.x + offset.x,
    y: yBase + offset.y,
    z: center.z + offset.z,
  };
}

export function getTacticalFormationOffset(
  groupId: string,
  memberIds: string[],
  memberId: string,
): TacticalFormationOffset {
  const hash = hashTacticalId(`${groupId}:${memberId}`);
  const indexInGroup = memberIds.indexOf(memberId);
  let slotIndex = indexInGroup >= 0 ? indexInGroup : hash;
  let ring = 0;
  let ringCapacity = 1;
  while (slotIndex >= ringCapacity) {
    slotIndex -= ringCapacity;
    ring += 1;
    ringCapacity = 6 + ring * 4;
  }
  const radius = ring === 0 ? 0.7 : 1.85 + ring * 1.05;
  const angleStep = (Math.PI * 2) / Math.max(1, ringCapacity);
  const angle = slotIndex * angleStep + ring * 0.31 + (hash % 31) * 0.003;
  const jitter = ring === 0 ? 0 : (((hash >> 12) & 0xff) / 255 - 0.5) * 0.22;
  return {
    x: Math.cos(angle) * (radius + jitter),
    y: (((hash >> 20) & 0xff) / 255 - 0.5) * 0.35,
    z: Math.sin(angle) * (radius + jitter),
  };
}

export function getTacticalFormationPosition(
  center: SystemPosition,
  yBase: number,
  groupId: string,
  memberIds: string[],
  memberId: string,
): SystemPosition {
  const offset = getTacticalFormationOffset(groupId, memberIds, memberId);
  return {
    x: center.x + offset.x,
    y: yBase + offset.y,
    z: center.z + offset.z,
  };
}

import type { SystemPosition } from "../data/SystemCoordinates";

export interface TacticalFormationOffset {
  x: number;
  y: number;
  z: number;
}

export function hashTacticalId(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
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

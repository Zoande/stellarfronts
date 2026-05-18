export type CombatStance =
  | "passive"
  | "evade"
  | "holdPosition"
  | "guardArea"
  | "defendSystem"
  | "aggressive"
  | "hunt";

export type FleetBehavior = "artillery" | "line" | "brawler" | "swarm" | "defender";

export type FleetChasePolicy =
  | "none"
  | "system"
  | "friendlySystems"
  | "neutralSystems"
  | "enemySystems";

export type FleetRetreatPolicy = "none" | "low" | "medium" | "high";

export type FleetTacticalOrderType = "move" | "attack" | "hold" | "guard" | "retreat";

export type CombatTargetKind = "fleet" | "starbase";

export type RangeBand = "pointBlank" | "close" | "medium" | "long" | "extreme" | "outOfRange";

export const RANGE_BANDS: RangeBand[] = ["pointBlank", "close", "medium", "long", "extreme", "outOfRange"];

export const RANGE_BAND_INDEX: Record<RangeBand, number> = {
  pointBlank: 0,
  close: 1,
  medium: 2,
  long: 3,
  extreme: 4,
  outOfRange: 5,
};

export function clampRangeBandIndex(index: number): number {
  return Math.max(0, Math.min(RANGE_BANDS.length - 1, Math.round(index)));
}

export function rangeBandFromIndex(index: number): RangeBand {
  return RANGE_BANDS[clampRangeBandIndex(index)] ?? "outOfRange";
}

export function compareRangeBands(a: RangeBand, b: RangeBand): number {
  return RANGE_BAND_INDEX[a] - RANGE_BAND_INDEX[b];
}

export type CombatStance = "passive" | "defensive" | "aggressive" | "evade" | "holdPosition";

export type RangeBand = "pointBlank" | "close" | "medium" | "long" | "extreme" | "outOfRange";

export type BattleGroupBehavior = "screen" | "brawler" | "line" | "artillery" | "defender";

export type BattleGroupChaseSetting =
  | "none"
  | "system"
  | "friendlySystems"
  | "neutralSystems"
  | "enemySystems";

export type BattleGroupOrderType = "move" | "attack" | "hold" | "protect" | "retreat";

export type BattleGroupRetreatMode = "none" | "hpPercent";

export type BattleGroupRetreatDestinationKind = "nearestFriendlyStarbase" | "selectedSystem";

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

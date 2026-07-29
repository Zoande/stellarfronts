export const DARK_MATTER_FLEET_SPEED_MULTIPLIER = 10;
export const DARK_MATTER_FLEET_COST_PER_MOVING_DAY = 1;
export const DARK_MATTER_CONSTRUCTION_COST_PER_REMAINING_DAY = 0.05;

export function getConstructionDarkMatterCost(remainingDays: number): number {
  const days = Math.max(0, Number.isFinite(remainingDays) ? remainingDays : 0);
  return Math.max(1, Math.ceil(days * DARK_MATTER_CONSTRUCTION_COST_PER_REMAINING_DAY));
}

import { GAME_DAYS_PER_YEAR } from "./GameTime";

export const DARK_MATTER_FLEET_SPEED_MULTIPLIER = 10;
export const DARK_MATTER_FLEET_COST_PER_MOVING_DAY = 1;
export const DARK_MATTER_CONSTRUCTION_COST_PER_REMAINING_DAY = 0.05;

export function getConstructionDarkMatterCost(remainingDays: number): number {
  const days = Math.max(0, Number.isFinite(remainingDays) ? remainingDays : 0);
  return Math.max(1, Math.ceil(days * DARK_MATTER_CONSTRUCTION_COST_PER_REMAINING_DAY));
}

export interface FleetDarkMatterBillingPlan {
  chargesDue: number;
  chargedDays: number;
  darkMatterCost: number;
  nextPaidUntilYear: number;
  exhaustedAtYear: number | null;
}

export function getFleetDarkMatterBillingPlan(
  paidUntilYear: number,
  targetYear: number,
  arrivalYear: number,
  availableDarkMatter: number,
): FleetDarkMatterBillingPlan {
  const oneDayYears = 1 / GAME_DAYS_PER_YEAR;
  const lastBillableYear = Math.min(targetYear, arrivalYear - oneDayYears * 1e-6);
  const chargesDue = lastBillableYear + Number.EPSILON < paidUntilYear
    ? 0
    : Math.max(0, Math.floor((lastBillableYear - paidUntilYear) / oneDayYears + 1 + 1e-7));
  const affordableDays = Math.max(
    0,
    Math.floor(availableDarkMatter / DARK_MATTER_FLEET_COST_PER_MOVING_DAY),
  );
  const chargedDays = Math.min(chargesDue, affordableDays);
  const nextPaidUntilYear = paidUntilYear + chargedDays * oneDayYears;
  return {
    chargesDue,
    chargedDays,
    darkMatterCost: chargedDays * DARK_MATTER_FLEET_COST_PER_MOVING_DAY,
    nextPaidUntilYear,
    exhaustedAtYear: chargedDays < chargesDue ? nextPaidUntilYear : null,
  };
}

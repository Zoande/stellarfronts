import {
  GAME_HOURS_PER_MONTH,
  GAME_HOURS_PER_QUARTER,
  GAME_HOURS_PER_DAY,
  REAL_MS_PER_GAME_HOUR,
} from "./GameTime";

export const RESOURCE_RATE_LABEL = "/min";
export const GAME_HOURS_PER_REAL_MINUTE = 60_000 / REAL_MS_PER_GAME_HOUR;

/** Converts a stored per-game-month economy value to its per-real-minute rate at standard speed. */
export function monthlyToRealMinute(value: number): number {
  return value * GAME_HOURS_PER_REAL_MINUTE / GAME_HOURS_PER_MONTH;
}

/** Converts a stored per-game-day value to its per-real-minute rate at standard speed. */
export function dailyToRealMinute(value: number): number {
  return value * GAME_HOURS_PER_REAL_MINUTE / GAME_HOURS_PER_DAY;
}

/** Converts a per-game-quarter value to its per-real-minute rate at standard speed. */
export function quarterlyToRealMinute(value: number): number {
  return value * GAME_HOURS_PER_REAL_MINUTE / GAME_HOURS_PER_QUARTER;
}

/** Converts a per-game-hour value to its per-real-minute rate at standard speed. */
export function gameHourToRealMinute(value: number): number {
  return value * GAME_HOURS_PER_REAL_MINUTE;
}

/** Converts a real-minute UI value back to the server's per-game-hour representation. */
export function realMinuteToGameHour(value: number): number {
  return value / GAME_HOURS_PER_REAL_MINUTE;
}

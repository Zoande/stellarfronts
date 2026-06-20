import {
  DEFAULT_TICK_SIZE_DAYS,
  DEFAULT_TICK_SPEED_SECONDS,
} from "./constants";
import {
  GAME_START_YEAR,
  GAME_DAYS_PER_YEAR,
  gameYearToWeekIndex,
} from "../../src/game/GameTime";
import type { GameState } from "./types";

export function computeSpeedMultiplier(tickSizeDays: number, tickSpeedSeconds: number, paused: boolean): number {
  if (paused) return 0;
  return Math.max(0, tickSizeDays * 24 / Math.max(0.01, tickSpeedSeconds));
}

export function normalizeClock(clock: Partial<GameState["clock"]> | undefined, now = Date.now()): GameState["clock"] {
  const tickSizeDays = Math.max(0.000001, Number(clock?.tickSizeDays) || DEFAULT_TICK_SIZE_DAYS);
  const tickSpeedSeconds = Math.max(0.01, Number(clock?.tickSpeedSeconds) || DEFAULT_TICK_SPEED_SECONDS);
  const paused = clock?.paused === true;
  return {
    year: Number.isFinite(clock?.year) ? Number(clock?.year) : GAME_START_YEAR,
    tickSizeDays,
    tickSpeedSeconds,
    paused,
    speedMultiplier: computeSpeedMultiplier(tickSizeDays, tickSpeedSeconds, paused),
    syncedAtMs: Number(clock?.syncedAtMs) || now,
    lastUpdatedAt: Number(clock?.lastUpdatedAt) || now,
    lastProcessedPopulationWeek: Number(clock?.lastProcessedPopulationWeek) || gameYearToWeekIndex(Number(clock?.year) || GAME_START_YEAR),
    lastProcessedLeaderDay: Number(clock?.lastProcessedLeaderDay) || Math.floor((Number(clock?.year) || GAME_START_YEAR) * GAME_DAYS_PER_YEAR),
  };
}

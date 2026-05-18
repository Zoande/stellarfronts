export const GAME_START_YEAR = 2100;
export const GAME_HOURS_PER_DAY = 24;
export const GAME_DAYS_PER_MONTH = 30;
export const GAME_MONTHS_PER_YEAR = 12;
export const GAME_DAYS_PER_YEAR = GAME_DAYS_PER_MONTH * GAME_MONTHS_PER_YEAR;
export const GAME_HOURS_PER_MONTH = GAME_DAYS_PER_MONTH * GAME_HOURS_PER_DAY;
export const GAME_HOURS_PER_YEAR = GAME_DAYS_PER_YEAR * GAME_HOURS_PER_DAY;
export const GAME_DAYS_PER_WEEK = 7;
export const GAME_HOURS_PER_WEEK = GAME_DAYS_PER_WEEK * GAME_HOURS_PER_DAY;
export const GAME_DAYS_PER_QUARTER = 120;
export const GAME_HOURS_PER_QUARTER = GAME_DAYS_PER_QUARTER * GAME_HOURS_PER_DAY;
export const REAL_MS_PER_GAME_HOUR = 1000;
export const REAL_MS_PER_GAME_DAY = REAL_MS_PER_GAME_HOUR * GAME_HOURS_PER_DAY;

export interface GameDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function gameYearToElapsedHours(yearValue: number): number {
  return yearValue * GAME_HOURS_PER_YEAR;
}

export function elapsedHoursToGameYear(elapsedHours: number): number {
  return elapsedHours / GAME_HOURS_PER_YEAR;
}

export function gameYearToMonthIndex(yearValue: number): number {
  return Math.floor(yearValue * GAME_MONTHS_PER_YEAR);
}

export function gameYearToHourIndex(yearValue: number): number {
  return Math.floor(gameYearToElapsedHours(yearValue));
}

export function gameYearToWeekIndex(yearValue: number): number {
  return Math.floor(gameYearToElapsedHours(yearValue) / GAME_HOURS_PER_WEEK);
}

export function gameYearToDateTime(yearValue: number): GameDateTime {
  const year = Math.floor(yearValue);
  const yearProgress = Math.max(0, yearValue - year);
  const exactHourOfYear = Math.max(0, Math.min(GAME_HOURS_PER_YEAR - 0.001, yearProgress * GAME_HOURS_PER_YEAR));
  const wholeHourOfYear = Math.floor(exactHourOfYear);
  const hourFraction = exactHourOfYear - wholeHourOfYear;
  const dayOfYear = Math.floor(wholeHourOfYear / GAME_HOURS_PER_DAY);
  const hour = wholeHourOfYear % GAME_HOURS_PER_DAY;
  const exactMinute = hourFraction * 60;
  const minute = Math.floor(exactMinute);
  const second = Math.floor((exactMinute - minute) * 60);

  return {
    year,
    month: Math.floor(dayOfYear / GAME_DAYS_PER_MONTH) + 1,
    day: (dayOfYear % GAME_DAYS_PER_MONTH) + 1,
    hour,
    minute,
    second,
  };
}

export function estimateClockYear(
  year: number,
  syncedAtMs: number,
  speedMultiplier: number,
  nowMs = Date.now(),
): number {
  const elapsedRealMs = Math.max(0, nowMs - syncedAtMs);
  const elapsedGameHours = (elapsedRealMs / REAL_MS_PER_GAME_HOUR) * Math.max(0, speedMultiplier);
  return year + elapsedGameHours / GAME_HOURS_PER_YEAR;
}

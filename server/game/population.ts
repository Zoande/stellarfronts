import { GAME_HOURS_PER_MONTH, GAME_HOURS_PER_WEEK } from "../../src/game/GameTime";
import { processMonthlyFamine } from "./population-famine";
import { processWeeklyPopulationGrowth } from "./population-growth";
import { processMonthlyMigration } from "./population-migration";
import type { RuntimeContext } from "./types";

export function processPopulationPeriods(
  ctx: RuntimeContext,
  targetWeek: number,
  targetMonth: number,
): boolean {
  let week = ctx.state.clock.lastProcessedPopulationWeek ?? targetWeek;
  let month = ctx.state.clock.lastProcessedPopulationMonth ?? targetMonth;
  if (week >= targetWeek && month >= targetMonth) return false;

  let changed = false;
  while (week < targetWeek || month < targetMonth) {
    const nextWeekHour = week < targetWeek ? (week + 1) * GAME_HOURS_PER_WEEK : Number.POSITIVE_INFINITY;
    const nextMonthHour = month < targetMonth ? (month + 1) * GAME_HOURS_PER_MONTH : Number.POSITIVE_INFINITY;

    if (nextWeekHour <= nextMonthHour) {
      changed = processWeeklyPopulationGrowth(ctx) || changed;
      week += 1;
      ctx.state.clock.lastProcessedPopulationWeek = week;
    }
    if (nextMonthHour <= nextWeekHour) {
      changed = processMonthlyFamine(ctx) || changed;
      if (changed) ctx.recalculatePlanetEconomies();
      month += 1;
      changed = processMonthlyMigration(ctx, month) || changed;
      ctx.state.clock.lastProcessedPopulationMonth = month;
    }
  }

  ctx.recalculatePlanetEconomies();
  ctx.refreshFactionEconomyDeltas();
  ctx.hasDirtyState = true;
  return changed;
}

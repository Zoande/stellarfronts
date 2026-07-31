import {
  LEADER_POOL_PER_CLASS,
  calculateLeaderLevel,
  getLeaderArchetypesByFaction,
  refreshLeaderPool,
} from "../../src/data/Leaders";
import { GAME_DAYS_PER_YEAR } from "../../src/game/GameTime";
import { clamp } from "./pure-helpers";
import type { RuntimeContext } from "./types";

function getLeaderDailyDeathChance(age: number, lifespan: number): number {
  if (age < lifespan - 8) return 0.000002;
  if (age < lifespan) return 0.00002;
  const overdue = Math.max(0, age - lifespan);
  return clamp(0.00025 + overdue * overdue * 0.000025, 0.00025, 0.03);
}

export function processLeaderDays(ctx: RuntimeContext, targetDay: number): {
  leadersChanged: boolean;
  planetEconomiesChanged: boolean;
  fleetEffectsChanged: boolean;
  governmentEffectsChanged: boolean;
} {
  const previousDay = ctx.state.clock.lastProcessedLeaderDay ?? targetDay;
  const days = Math.max(0, targetDay - previousDay);
  const factionIds = ctx.state.factions.map((faction) => faction.id);
  const archetypesByFaction = getLeaderArchetypesByFaction(ctx.state.factions, ctx.state.species);
  if (days <= 0) {
    const expectedPoolCount = factionIds.length * LEADER_POOL_PER_CLASS * 2;
    if (ctx.state.leaders.filter((leader) => leader.status === "pool").length >= expectedPoolCount) {
      return { leadersChanged: false, planetEconomiesChanged: false, fleetEffectsChanged: false, governmentEffectsChanged: false };
    }
    ctx.state.leaders = refreshLeaderPool(ctx.state.leaders, factionIds, targetDay, ctx.state.clock.year, archetypesByFaction);
    ctx.state.clock.lastProcessedLeaderDay = targetDay;
    ctx.hasDirtyState = true;
    return { leadersChanged: true, planetEconomiesChanged: false, fleetEffectsChanged: false, governmentEffectsChanged: false };
  }

  let leadersChanged = false;
  let planetEconomiesChanged = false;
  let fleetEffectsChanged = false;
  let governmentEffectsChanged = false;
  const ageIncrease = days / GAME_DAYS_PER_YEAR;
  for (const leader of ctx.state.leaders) {
    if (leader.status !== "recruited") continue;
    const previousLevel = leader.level;
    leader.age += ageIncrease;
    const dailyXp = leader.assignment ? (leader.class === "military" ? 0.2 : 0.16) : 0.03;
    leader.xp += dailyXp * days;
    leader.level = calculateLeaderLevel(leader.xp);
    leadersChanged = true;
    if (leader.level !== previousLevel && leader.assignment) {
      if (leader.assignment.kind === "planet") planetEconomiesChanged = true;
      if (leader.assignment.kind === "fleet") fleetEffectsChanged = true;
      if (leader.assignment.kind === "government") governmentEffectsChanged = true;
    }

    const dailyDeathChance = getLeaderDailyDeathChance(leader.age, leader.lifespan);
    const deathChance = 1 - Math.pow(1 - dailyDeathChance, days);
    if (Math.random() >= deathChance) continue;
    const oldAssignment = leader.assignment;
    leader.status = "dead";
    leader.assignment = null;
    leader.diedAtYear = ctx.state.clock.year;
    leadersChanged = true;
    if (oldAssignment?.kind === "planet") planetEconomiesChanged = true;
    if (oldAssignment?.kind === "fleet") fleetEffectsChanged = true;
    if (oldAssignment?.kind === "government") governmentEffectsChanged = true;
  }

  ctx.state.leaders = refreshLeaderPool(ctx.state.leaders, factionIds, targetDay, ctx.state.clock.year, archetypesByFaction);
  ctx.state.clock.lastProcessedLeaderDay = targetDay;
  leadersChanged = true;
  ctx.hasDirtyState = true;
  if (planetEconomiesChanged || governmentEffectsChanged) {
    ctx.recalculatePlanetEconomies();
    ctx.refreshFactionEconomyDeltas();
  } else if (fleetEffectsChanged) {
    ctx.refreshFactionEconomyDeltas();
  }
  return { leadersChanged, planetEconomiesChanged, fleetEffectsChanged, governmentEffectsChanged };
}

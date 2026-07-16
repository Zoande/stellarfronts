import { GAME_HOURS_PER_YEAR } from "../../src/game/GameTime";
import { processContinuousFleetCombat } from "./fleet-combat";
import type { RuntimeContext } from "./types";

export interface HeadlessCombatSimulationOptions {
  seed: number;
  stepHours?: number;
  maxHours?: number;
  starId?: number;
}

export interface HeadlessCombatSimulationResult {
  elapsedHours: number;
  steps: number;
  survivingOwners: number[];
  shipsRemaining: number;
  projectilesResolved: number;
  reportsCreated: number;
}

export function createSeededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * Advances the authoritative combat runtime with deterministic randomness.
 * It deliberately calls the production event/projectile resolver rather than
 * maintaining a second balance-only combat implementation.
 */
export function simulateHeadlessCombat(
  ctx: RuntimeContext,
  options: HeadlessCombatSimulationOptions,
): HeadlessCombatSimulationResult {
  const stepHours = Math.max(0.01, options.stepHours ?? 1);
  const maxHours = Math.max(stepHours, options.maxHours ?? 24 * 60);
  const reportsBefore = ctx.state.combatReports.length;
  let projectilesResolved = 0;
  let elapsedHours = 0;
  let steps = 0;
  const previousRandom = Math.random;
  Math.random = createSeededRandom(options.seed);
  try {
    while (elapsedHours < maxHours) {
      const before = ctx.state.combatProjectiles.length;
      ctx.state.clock.year += stepHours / GAME_HOURS_PER_YEAR;
      processContinuousFleetCombat(ctx, stepHours, stepHours / 24);
      const after = ctx.state.combatProjectiles.length;
      projectilesResolved += Math.max(0, before - after);
      elapsedHours += stepHours;
      steps += 1;
      const owners = new Set(ctx.state.fleets
        .filter((fleet) => options.starId === undefined || fleet.currentStarId === options.starId)
        .filter((fleet) => fleet.shipIds.some((id) => ctx.state.ships.some((ship) => ship.id === id && ship.hull > 0)))
        .map((fleet) => fleet.ownerId));
      if (owners.size <= 1 && ctx.state.combatProjectiles.length === 0) break;
    }
  } finally {
    Math.random = previousRandom;
  }
  const survivingOwners = Array.from(new Set(ctx.state.fleets
    .filter((fleet) => options.starId === undefined || fleet.currentStarId === options.starId)
    .filter((fleet) => fleet.shipIds.some((id) => ctx.state.ships.some((ship) => ship.id === id && ship.hull > 0)))
    .map((fleet) => fleet.ownerId))).sort((a, b) => a - b);
  return {
    elapsedHours,
    steps,
    survivingOwners,
    shipsRemaining: ctx.state.ships.filter((ship) => ship.hull > 0).length,
    projectilesResolved,
    reportsCreated: Math.max(0, ctx.state.combatReports.length - reportsBefore),
  };
}

import { applyPopulationGrowth } from "../../src/data/Economy";
import { applyPlanetStatesToStars } from "../../src/data/StarMap";
import {
  getPlanetDistrictLimitsFromState,
  getPlanetSpeciesContext,
  getPlanetTechnologyModifiers,
} from "./state-queries";
import type { RuntimeContext } from "./types";

export function processWeeklyPopulationGrowth(ctx: RuntimeContext): boolean {
  let changed = false;
  ctx.state.planetStates = ctx.state.planetStates.map((planet) => {
    if (!planet.isHabited) return planet;
    const next = applyPopulationGrowth(
      planet,
      getPlanetDistrictLimitsFromState(ctx.state, planet),
      1,
      getPlanetTechnologyModifiers(ctx.state, planet),
      getPlanetSpeciesContext(ctx.state, planet),
    );
    if (next.population === planet.population) return next;
    changed = true;
    ctx.queuePlanetDetailRefresh(planet.id);
    return next;
  });
  if (changed) {
    applyPlanetStatesToStars(ctx.state.stars, ctx.state.planetStates);
    ctx.hasDirtyState = true;
  }
  return changed;
}

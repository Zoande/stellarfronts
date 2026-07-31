import { sumSpeciesPopulation } from "../../src/data/Economy";
import { applyPlanetStatesToStars } from "../../src/data/StarMap";
import { MIN_HABITED_POPULATION } from "../../src/data/Population";
import type { SpeciesId } from "../../src/data/Species";
import type { RuntimeContext } from "./types";

function applySpeciesDeaths(
  populations: Array<{ speciesId: SpeciesId; population: number }>,
  requestedDeaths: Map<SpeciesId, number>,
): Array<{ speciesId: SpeciesId; population: number }> {
  const total = sumSpeciesPopulation(populations);
  let remainingRemovable = Math.max(0, total - MIN_HABITED_POPULATION);
  return populations
    .map((entry) => {
      const deaths = Math.min(
        entry.population,
        remainingRemovable,
        Math.max(0, Math.round(requestedDeaths.get(entry.speciesId) ?? 0)),
      );
      remainingRemovable -= deaths;
      return { ...entry, population: entry.population - deaths };
    })
    .filter((entry) => entry.population > 0);
}

export function processMonthlyFamine(ctx: RuntimeContext): boolean {
  let changed = false;
  ctx.state.planetStates = ctx.state.planetStates.map((planet) => {
    if (!planet.isHabited || !planet.economy.populationDecline.active) return planet;
    const requestedDeaths = new Map(
      planet.economy.populationDecline.speciesChanges.map((entry) => [
        entry.speciesId,
        Math.max(0, -entry.deltaPerMonth),
      ]),
    );
    const speciesPopulations = applySpeciesDeaths(planet.speciesPopulations, requestedDeaths);
    const population = sumSpeciesPopulation(speciesPopulations);
    if (population === planet.population) return planet;
    changed = true;
    ctx.queuePlanetDetailRefresh(planet.id);
    return { ...planet, population, speciesPopulations };
  });
  if (changed) {
    applyPlanetStatesToStars(ctx.state.stars, ctx.state.planetStates);
    ctx.hasDirtyState = true;
  }
  return changed;
}

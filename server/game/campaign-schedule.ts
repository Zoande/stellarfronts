import { GAME_DAYS_PER_YEAR } from "../../src/game/GameTime";
import { TECHNOLOGY_BY_ID } from "../../src/data/Technology";
import type { GameState } from "./types";

/** Peace skips wall-clock waiting, not AI decisions or travel/project boundaries.
 * Hostile system contact and ground battles use the production 100 ms cadence. */
export function campaignStep(state: Readonly<GameState>, maximumMs: number, msPerDay: number) {
  const wars = state.diplomacy.wars.filter((war) => !war.endedAtYear);
  const hostile = (a: number, b: number) => wars.some((war) => war.attackerFactionId === a && war.defenderFactionId === b || war.attackerFactionId === b && war.defenderFactionId === a);
  const contact = state.fleets.some((fleet) => fleet.phase !== "missingInAction" && (state.fleets.some((other) => other.id !== fleet.id && other.currentStarId === fleet.currentStarId && other.phase !== "missingInAction" && hostile(fleet.ownerId, other.ownerId))
    || state.starbases.some((base) => base.starId === fleet.currentStarId && hostile(fleet.ownerId, base.ownerId))));
  if (contact || state.groundBattles.length > 0 || state.fleets.some((fleet) => ["engaging", "firing", "evading", "retreating"].includes(fleet.combatStatus))) return { ms: Math.min(100, maximumMs), reason: "combat-production-cadence" };
  let ms = Math.min(maximumMs, msPerDay), reason = "peace-daily";
  const boundary = (days: number, nextReason: string) => {
    // Round to the next production tick; never jump over a known transition.
    const proposed = Math.max(100, Math.ceil(days * msPerDay / 100 - 1e-6) * 100);
    if (days > 1e-9 && proposed < ms) { ms = proposed; reason = nextReason; }
  };
  for (const fleet of state.fleets) for (const segment of fleet.movementPlan?.segments ?? []) boundary((segment.endYear - state.clock.year) * GAME_DAYS_PER_YEAR, "travel-boundary");
  for (const episode of [...Object.values(state.activeEpisodes ?? {}), ...Object.values(state.passiveEpisodes ?? {}), ...Object.values(state.caretakerEpisodes ?? {})]) boundary((episode.nextDecisionYear - state.clock.year) * GAME_DAYS_PER_YEAR, "ai-decision");
  for (const site of [...state.planetStates, ...state.starbases]) for (const item of [...site.constructionQueue, ...("defense" in site ? site.defense.shipQueue : site.shipQueue)]) boundary(item.remainingDays, "project-boundary");
  for (const technology of state.factionTechnologies) {
    const id = technology.activeTechId;
    const rate = state.factionEconomies.find((economy) => economy.factionId === technology.factionId)?.monthlyDelta.research ?? 0;
    if (id && rate > 0) boundary((TECHNOLOGY_BY_ID[id].cost - (technology.progressByTechId[id]?.totalProgress ?? 0)) / rate * 30, "research-boundary");
  }
  return { ms, reason };
}

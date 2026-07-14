// Compatibility facade for callers that still use the old visibility names.
// All answers now come from the field-level intelligence evaluator.

import type { GalaxyPerspective } from "../../src/data/Factions";
import type { ServerFleet } from "../../src/game/GameProtocol";
import type { GameState, RuntimeContext } from "./types";
import {
  getCurrentStarIds,
  getKnownStarIds,
  getKnownSystemOwner,
  refreshIntelligence,
} from "./intelligence";

export function addDiscoveryFrom(
  nextState: GameState,
  _sourceStarId: number,
  visible: Set<number>,
): void {
  // Deprecated compatibility helper. Sensor sources are definition-driven, so
  // callers cannot inject hull/ownership vision by naming a star anymore.
  for (const faction of nextState.factions) {
    for (const starId of getCurrentStarIds(nextState, faction.id)) visible.add(starId);
  }
}

export function computeCurrentVisibleSet(nextState: GameState, factionId: number): Set<number> {
  return getCurrentStarIds(nextState, factionId);
}

export function markFactionsMet(_nextState: GameState, _a: number, _b: number): void {
  // First contact was removed. Public identity and all foreign facts use intel fields.
}

export function refreshDiscovery(nextState: GameState): void {
  refreshIntelligence(nextState);
}

export function getVisibleSet(ctx: RuntimeContext, perspective: GalaxyPerspective): Set<number> | null {
  return perspective.mode === "observer" ? null : getCurrentStarIds(ctx.state, perspective.factionId);
}

export function getKnownSet(ctx: RuntimeContext, perspective: GalaxyPerspective): Set<number> | null {
  return perspective.mode === "observer" ? null : getKnownStarIds(ctx.state, perspective.factionId);
}

export function getKnownOwnership(ctx: RuntimeContext, ownerId: number, starId: number): number {
  return getKnownSystemOwner(ctx.state, ownerId, starId);
}

export function isFleetVisible(fleet: ServerFleet, visible: Set<number> | null, perspective: GalaxyPerspective): boolean {
  if (visible === null) return true;
  if (perspective.mode !== "faction") return true;
  if (fleet.hyperlanePosition) return fleet.ownerId === perspective.factionId;
  return visible.has(fleet.currentStarId);
}

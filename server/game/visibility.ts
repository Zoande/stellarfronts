// =============================================================================
// Discovery & visibility — extracted from server/index.ts
//
// Two related concerns:
//   1. Discovery propagation (refreshDiscovery and friends) — mutate the
//      monotonic discovered/met/last-known-ownership records on a GameState.
//   2. Per-perspective visibility queries (visible/known sets, fleet visibility,
//      last-known ownership) used by the snapshot/view builders.
//
// Everything here reads a GameState (or RuntimeContext for the ctx-scoped
// queries); none of it touches the WebSocket layer.
// =============================================================================

import { computeVisibleStarIds } from "../../src/data/Factions";
import type { GalaxyPerspective } from "../../src/data/Factions";
import type { ServerFleet } from "../../src/game/GameProtocol";
import { DISCOVERY_JUMPS } from "./constants";
import type { GameState, RuntimeContext } from "./types";

export function addDiscoveryFrom(nextState: GameState, sourceStarId: number, visible: Set<number>): void {
  if (sourceStarId < 0 || sourceStarId >= nextState.adjacency.length) return;
  for (const starId of computeVisibleStarIds(nextState.adjacency, sourceStarId, DISCOVERY_JUMPS)) {
    visible.add(starId);
  }
}

export function computeCurrentVisibleSet(nextState: GameState, factionId: number): Set<number> {
  const visible = new Set<number>();
  const faction = nextState.factions.find((candidate) => candidate.id === factionId);
  if (faction) addDiscoveryFrom(nextState, faction.homeStarId, visible);

  for (const starbase of nextState.starbases) {
    if (starbase.ownerId === factionId && starbase.status === "online") {
      addDiscoveryFrom(nextState, starbase.starId, visible);
    }
  }

  for (const fleet of nextState.fleets) {
    if (fleet.ownerId !== factionId) continue;
    addDiscoveryFrom(nextState, fleet.currentStarId, visible);
    if (fleet.hyperlanePosition) {
      addDiscoveryFrom(nextState, fleet.hyperlanePosition.fromStarId, visible);
      addDiscoveryFrom(nextState, fleet.hyperlanePosition.toStarId, visible);
    }
  }

  return visible;
}

export function markFactionsMet(nextState: GameState, a: number, b: number): void {
  if (a === b || a < 0 || b < 0) return;
  for (const [self, other] of [[a, b], [b, a]] as const) {
    const key = String(self);
    const met = new Set<number>(nextState.metByFaction[key] ?? []);
    if (met.has(other)) continue;
    met.add(other);
    nextState.metByFaction[key] = Array.from(met).sort((x, y) => x - y);
  }
}

export function refreshDiscovery(nextState: GameState): void {
  for (const faction of nextState.factions) {
    const visible = computeCurrentVisibleSet(nextState, faction.id);
    const discovered = new Set<number>(nextState.discoveredByFaction[String(faction.id)] ?? []);
    for (const starId of visible) discovered.add(starId);
    nextState.discoveredByFaction[String(faction.id)] = Array.from(discovered).sort((a, b) => a - b);

    const lastKnown = nextState.lastKnownOwnershipByFaction[String(faction.id)] ?? [];
    while (lastKnown.length < nextState.stars.length) lastKnown.push(-1);
    for (const starId of visible) {
      lastKnown[starId] = nextState.starOwnership[starId] ?? -1;
    }
    nextState.lastKnownOwnershipByFaction[String(faction.id)] = lastKnown.slice(0, nextState.stars.length);
  }

  // First contact: a faction has "met" every other faction whose territory it has
  // ever discovered. Derived from the (monotonic) discovered sets, recorded symmetrically.
  for (const faction of nextState.factions) {
    const discovered = nextState.discoveredByFaction[String(faction.id)] ?? [];
    for (const starId of discovered) {
      const owner = nextState.starOwnership[starId] ?? -1;
      if (owner >= 0 && owner !== faction.id) markFactionsMet(nextState, faction.id, owner);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-perspective visibility queries
// ---------------------------------------------------------------------------

export function getVisibleSet(ctx: RuntimeContext, perspective: GalaxyPerspective): Set<number> | null {
  if (perspective.mode === "observer") return null;
  return computeCurrentVisibleSet(ctx.state, perspective.factionId);
}

export function getKnownSet(ctx: RuntimeContext, perspective: GalaxyPerspective): Set<number> | null {
  if (perspective.mode === "observer") return null;
  return new Set(ctx.state.discoveredByFaction[String(perspective.factionId)] ?? []);
}

export function getKnownOwnership(ctx: RuntimeContext, ownerId: number, starId: number): number {
  const knownOwnership = ctx.state.lastKnownOwnershipByFaction[String(ownerId)] ?? [];
  return knownOwnership[starId] ?? -1;
}

export function isFleetVisible(fleet: ServerFleet, visible: Set<number> | null, perspective: GalaxyPerspective): boolean {
  if (visible === null) return true;
  if (perspective.mode === "faction" && fleet.ownerId === perspective.factionId) return true;
  if (visible.has(fleet.currentStarId)) return true;
  return !!fleet.hyperlanePosition
    && (visible.has(fleet.hyperlanePosition.fromStarId) || visible.has(fleet.hyperlanePosition.toStarId));
}

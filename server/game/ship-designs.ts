// =============================================================================
// Ship design resolution helpers — extracted from server/index.ts
//
// These are the foundational lookups that map a ship (owner + kind + designId)
// to a concrete ShipDesign, with sensible fallbacks. The pure-array variants
// (findShipDesign / findShipDesignById / getNewestActiveShipDesign) take the
// shipDesigns array explicitly and never touch RuntimeContext; the ctx-aware
// resolveShipDesign / getShipDesignForShip wrap them with the live game state.
// =============================================================================

import {
  STARBASE_SHIP_DEFINITIONS,
  isStarbaseShipKind,
} from "../../src/data/Starbase";
import type { StarbaseShipKind } from "../../src/data/Starbase";
import { createDefaultShipDesign } from "../../src/data/ShipDesigns";
import type { ShipDesign } from "../../src/data/ShipDesigns";
import type { ServerShip } from "../../src/game/GameProtocol";
import { GAME_START_YEAR } from "../../src/game/GameTime";
import type { RuntimeContext } from "./types";

export function getShipDefinition(shipKind?: string) {
  const kind = shipKind && isStarbaseShipKind(shipKind) ? shipKind : "corvette";
  return STARBASE_SHIP_DEFINITIONS[kind];
}

export function findShipDesignById(
  shipDesigns: ShipDesign[],
  ownerId: number,
  shipKind: StarbaseShipKind,
  designId: string | null | undefined,
  includeDecommissioned = true,
): ShipDesign | null {
  if (!designId) return null;
  return shipDesigns.find((design) => (
    design.id === designId
    && design.ownerId === ownerId
    && design.shipKind === shipKind
    && (includeDecommissioned || design.status === "active")
  )) ?? null;
}

export function findShipDesign(
  shipDesigns: ShipDesign[],
  ownerId: number,
  shipKind: StarbaseShipKind,
  designId?: string | null,
  includeDecommissioned = true,
): ShipDesign | null {
  if (designId) {
    const explicit = findShipDesignById(shipDesigns, ownerId, shipKind, designId, includeDecommissioned);
    if (explicit) return explicit;
  }
  return shipDesigns.find((design) => (
    design.ownerId === ownerId
    && design.shipKind === shipKind
    && design.status === "active"
  )) ?? shipDesigns.find((design) => (
    design.ownerId === ownerId
    && design.shipKind === shipKind
    && includeDecommissioned
  )) ?? null;
}

export function getNewestActiveShipDesign(
  shipDesigns: ShipDesign[],
  ownerId: number,
  shipKind: StarbaseShipKind,
): ShipDesign | null {
  return shipDesigns
    .filter((design) => design.ownerId === ownerId && design.shipKind === shipKind && design.status === "active")
    .sort((a, b) => {
      const yearDelta = (b.updatedAtYear ?? b.createdAtYear) - (a.updatedAtYear ?? a.createdAtYear);
      if (yearDelta !== 0) return yearDelta;
      return b.createdAtYear - a.createdAtYear;
    })[0] ?? null;
}

export function resolveShipDesign(
  shipDesigns: ShipDesign[],
  ownerId: number,
  shipKind: StarbaseShipKind,
  designId?: string | null,
  fallbackYear: number = GAME_START_YEAR,
): ShipDesign {
  return findShipDesign(shipDesigns, ownerId, shipKind, designId, true)
    ?? createDefaultShipDesign(ownerId, shipKind, fallbackYear);
}

export function getShipDesignForShip(
  ctx: RuntimeContext,
  ship: Pick<ServerShip, "ownerId" | "shipKind" | "designId">,
): ShipDesign {
  return resolveShipDesign(
    ctx.state.shipDesigns,
    ship.ownerId,
    ship.shipKind,
    ship.designId,
    ctx.state?.clock?.year ?? GAME_START_YEAR,
  );
}

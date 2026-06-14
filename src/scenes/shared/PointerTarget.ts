/**
 * Scene-agnostic description of "what is under the pointer", produced by each
 * scene's `resolvePointerTarget` and consumed by selection + the right-click
 * context menu. Keeping one shared shape lets both the Galaxy and System views
 * drive selection and actions through the same code paths, and lets new object
 * kinds (e.g. ground armies / invadable planets) be added by extending this
 * union and the per-scene action builders rather than rewiring picking.
 */
export type PointerTargetKind =
  | "fleet"
  | "ship"
  | "planet"
  | "starbase"
  | "star"
  | "hyperlaneGate"
  | "empty";

export interface PointerWorldPosition {
  x: number;
  y: number;
  z: number;
}

export interface PointerTarget {
  kind: PointerTargetKind;
  /** Entity id where applicable: fleetId / shipId / planetId / starbaseId. */
  id?: string;
  /** Star id this target belongs to (the system for planets/starbases/gates). */
  starId?: number;
  /** Destination star for a hyperlane gate. */
  toStarId?: number;
  /** Owner faction id where known (fleet/ship/starbase/star). */
  ownerId?: number | null;
  /** Human-readable label used as the context-menu title. */
  label?: string;
  /** World position (scene coordinates) for movement / empty-space clicks. */
  position?: PointerWorldPosition;
}

/** Capabilities of the currently selected fleet, used to filter actions. */
export interface FleetActionCapabilities {
  isOwn: boolean;
  canColonize: boolean;
  canBuildStarbase: boolean;
}

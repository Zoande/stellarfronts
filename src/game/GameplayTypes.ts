import type { SystemPosition } from "../data/SystemCoordinates";

export type ShipAction =
  | "move"
  | "build"
  | "attack"
  | "merge"
  | "retreat"
  | "retreatTo"
  | "emergencyRetreatTo"
  | "orbit"
  | "hold"
  | "guard"
  | "protect";

export interface GalaxyShipTransit {
  fromStarId: number;
  toStarId: number;
  progress: number;
}

export interface HyperlaneExitPoint {
  starId: number;
  name: string;
  dx: number;
  dz: number;
  systemPosition: SystemPosition;
}

export type ShipAction = "move" | "build" | "attack" | "merge";

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
}

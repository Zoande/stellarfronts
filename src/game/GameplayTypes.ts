export type ShipAction = "move" | "build" | "attack" | "merge" | "retreat";

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

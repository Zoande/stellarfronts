// /src/types/game.ts
// Shared contract for game logic and UI

/**
 * GameTypeContract - Defines all shared types, interfaces, and enums for Stellarfronts.
 * This file is the single source of truth for cross-agent communication.
 */

export type PlayerId = string;

export interface GameRules {
  victoryCondition: string;
  defeatCondition: string;
  maxTurns: number;
}

export interface GameObjective {
  id: string;
  description: string;
  isCompleted: boolean;
}

export interface GameState {
  turn: number;
  year: number;
  players: PlayerState[];
  galaxy: GalaxyState;
  objectives: GameObjective[];
  rules: GameRules;
  status: 'playing' | 'victory' | 'defeat' | 'paused';
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  factionId: number;
  resources: Record<string, number>;
  fleets: FleetState[];
  ownedStars: number[];
  score: number;
  isAlive: boolean;
}

export interface FleetState {
  id: string;
  name: string;
  ships: ShipState[];
  locationStarId: number;
  destinationStarId?: number;
  eta?: number;
  status: 'idle' | 'moving' | 'engaged' | 'destroyed';
}

export interface ShipState {
  id: string;
  kind: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  status: 'active' | 'destroyed';
}

export interface GalaxyState {
  stars: StarState[];
  hyperlanes: HyperlaneState[];
}

export interface StarState {
  id: number;
  name: string;
  ownerId?: PlayerId;
  planetCount: number;
  hasStarbase: boolean;
  resources: Record<string, number>;
}

export interface HyperlaneState {
  fromStarId: number;
  toStarId: number;
  isActive: boolean;
}

// Add more shared types as needed for gameplay and UI contract.

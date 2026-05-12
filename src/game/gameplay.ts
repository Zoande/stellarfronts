// src/game/gameplay.ts
// Expanded gameplay logic for Stellarfronts
import type { GameState, PlayerState, FleetState, ShipState, StarState } from "../types/game";

/**
 * GameplayActions - Implements player actions and game mechanics.
 */
export class GameplayActions {
  constructor(private state: GameState) {}

  moveFleet(playerId: string, fleetId: string, destinationStarId: number, eta: number) {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return false;
    const fleet = player.fleets.find(f => f.id === fleetId);
    if (!fleet || fleet.status !== 'idle') return false;
    fleet.destinationStarId = destinationStarId;
    fleet.eta = eta;
    fleet.status = 'moving';
    return true;
  }

  buildShip(playerId: string, fleetId: string, kind: string) {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return false;
    const fleet = player.fleets.find(f => f.id === fleetId);
    if (!fleet) return false;
    // Example: cost and resource check
    const cost = 10; // TODO: dynamic cost by kind
    if ((player.resources['alloys'] ?? 0) < cost) return false;
    player.resources['alloys'] -= cost;
    const newShip: ShipState = {
      id: `ship_${Date.now()}`,
      kind,
      hp: 10,
      maxHp: 10,
      attack: 2,
      defense: 1,
      speed: 1,
      status: 'active',
    };
    fleet.ships.push(newShip);
    return true;
  }

  captureStar(playerId: string, starId: number) {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return false;
    const star = this.state.galaxy.stars.find(s => s.id === starId);
    if (!star) return false;
    star.ownerId = playerId;
    if (!player.ownedStars.includes(starId)) player.ownedStars.push(starId);
    return true;
  }

  resolveCombat(starId: number) {
    // Find all fleets at this star
    const fleetsAtStar: FleetState[] = [];
    for (const player of this.state.players) {
      fleetsAtStar.push(...player.fleets.filter(f => f.locationStarId === starId && f.status !== 'destroyed'));
    }
    if (fleetsAtStar.length < 2) return;
    // Simple combat: strongest fleet wins
    let winner: FleetState | null = null;
    let maxPower = -1;
    for (const fleet of fleetsAtStar) {
      const power = fleet.ships.reduce((sum, s) => sum + s.attack + s.defense + s.hp, 0);
      if (power > maxPower) {
        maxPower = power;
        winner = fleet;
      }
    }
    for (const fleet of fleetsAtStar) {
      if (fleet !== winner) fleet.status = 'destroyed';
    }
  }
}

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
    // Dynamic cost and stats by kind
    const shipTypes: Record<string, { cost: number; hp: number; attack: number; defense: number; speed: number }> = {
      corvette: { cost: 10, hp: 10, attack: 2, defense: 1, speed: 1 },
      destroyer: { cost: 18, hp: 18, attack: 4, defense: 2, speed: 1 },
      cruiser: { cost: 30, hp: 30, attack: 7, defense: 4, speed: 0.8 },
    };
    const type = shipTypes[kind] ?? shipTypes['corvette'];
    if ((player.resources['alloys'] ?? 0) < type.cost) return false;
    player.resources['alloys'] -= type.cost;
    const newShip: ShipState = {
      id: `ship_${Date.now()}_${Math.floor(Math.random()*10000)}`,
      kind,
      hp: type.hp,
      maxHp: type.hp,
      attack: type.attack,
      defense: type.defense,
      speed: type.speed,
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
    // Bonus: gain resources for capturing
    player.resources['minerals'] = (player.resources['minerals'] ?? 0) + 5;
    player.score += 2;
    return true;
  }

  resolveCombat(starId: number) {
    // Find all fleets at this star
    const fleetsAtStar: FleetState[] = [];
    for (const player of this.state.players) {
      fleetsAtStar.push(...player.fleets.filter(f => f.locationStarId === starId && f.status !== 'destroyed'));
    }
    if (fleetsAtStar.length < 2) return;
    // Tactical combat: strongest fleet wins, others take damage
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
      if (fleet !== winner) {
        for (const ship of fleet.ships) {
          ship.hp = Math.max(0, ship.hp - 5);
          if (ship.hp === 0) ship.status = 'destroyed';
        }
        fleet.status = fleet.ships.every(s => s.status === 'destroyed') ? 'destroyed' : 'idle';
      }
    }
  }
  upgradeStarbase(playerId: string, starId: number) {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return false;
    if ((player.resources['alloys'] ?? 0) < 15) return false;
    player.resources['alloys'] -= 15;
    player.score += 7;
    return true;
  }

  researchTech(playerId: string) {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return false;
    if ((player.resources['research'] ?? 0) < 20) return false;
    player.resources['research'] -= 20;
    player.score += 10;
    return true;
  }
}

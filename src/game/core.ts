// src/game/core.ts
// Main game logic and state management for Stellarfronts
import type { GameState, PlayerState, GameRules, GameObjective, FleetState, ShipState, GalaxyState, StarState, HyperlaneState } from "../types/game";

/**
 * GameCore - Handles the main game loop, state transitions, and rule enforcement.
 */
export class GameCore {
  state: GameState;

  constructor(players: PlayerState[], galaxy: GalaxyState, rules: GameRules, objectives: GameObjective[]) {
    this.state = {
      turn: 1,
      year: 2200,
      players,
      galaxy,
      objectives,
      rules,
      status: 'playing',
    };
  }

  nextTurn() {
    if (this.state.status !== 'playing') return;
    this.state.turn++;
    this.state.year++;
    // TODO: Process all fleets, resources, battles, and objectives
    this.processFleets();
    this.processObjectives();
    this.checkVictoryConditions();
  }

  processFleets() {
    // Move fleets, resolve battles, update statuses
    for (const player of this.state.players) {
      for (const fleet of player.fleets) {
        if (fleet.status === 'moving' && fleet.eta && fleet.eta > 0) {
          fleet.eta--;
          if (fleet.eta === 0 && fleet.destinationStarId !== undefined) {
            fleet.locationStarId = fleet.destinationStarId;
            fleet.destinationStarId = undefined;
            fleet.status = 'idle';
            // TODO: Check for battles at new location
          }
        }
      }
    }
  }

  processObjectives() {
    // Update objectives for all players
    for (const obj of this.state.objectives) {
      // Example: Victory by controlling all stars
      if (obj.id === 'control_all_stars') {
        obj.isCompleted = this.state.players.some(p => p.ownedStars.length === this.state.galaxy.stars.length);
      }
    }
  }

  checkVictoryConditions() {
    // Example: Win by completing all objectives
    if (this.state.objectives.every(obj => obj.isCompleted)) {
      this.state.status = 'victory';
    }
    // Example: Lose if all players are dead
    if (this.state.players.every(p => !p.isAlive)) {
      this.state.status = 'defeat';
    }
    // Example: Max turns
    if (this.state.turn >= this.state.rules.maxTurns) {
      this.state.status = 'defeat';
    }
  }

  getInstructions(): string {
    return `Welcome to Stellarfronts!\n\nGoal: ${this.state.rules.victoryCondition}\nLose: ${this.state.rules.defeatCondition}\n\nHow to Play:\n- Each turn, move your fleets between stars using hyperlanes.\n- Capture stars to gain resources.\n- Build ships and starbases to strengthen your position.\n- Defeat your opponents by controlling the galaxy or achieving objectives.\n- The game ends in victory if objectives are met, or defeat if all players are eliminated or max turns reached.`;
  }
}

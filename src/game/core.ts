// src/game/core.ts
// Main game logic and state management for Stellarfronts
import type { GameState, PlayerState, GameRules, GameObjective, FleetState, ShipState, GalaxyState, StarState, HyperlaneState } from "../types/game";
import { triggerRandomEvent } from "./events";

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

  nextTurn(): string[] {
    if (this.state.status !== 'playing') return [];
    this.state.turn++;
    this.state.year++;
    const logs: string[] = [];
    logs.push(...this.processFleets());
    logs.push(...this.processResources());
    logs.push(...this.processStarbaseUpgrades());
    logs.push(...this.processObjectives());
    logs.push(...this.processPlayerProgression());
    const eventMsg = triggerRandomEvent(this.state);
    if (eventMsg) logs.push(`[Event] ${eventMsg}`);
    this.checkVictoryConditions();
    return logs;
  }

  processFleets(): string[] {
    // Move fleets, resolve battles, update statuses
    const logs: string[] = [];
    for (const player of this.state.players) {
      for (const fleet of player.fleets) {
        if (fleet.status === 'moving' && fleet.eta && fleet.eta > 0) {
          fleet.eta -= Math.random() < 0.5 ? 1 : 0.5; // Smooth movement
          if (fleet.eta <= 0 && fleet.destinationStarId !== undefined) {
            fleet.locationStarId = fleet.destinationStarId;
            fleet.destinationStarId = undefined;
            fleet.status = 'idle';
            logs.push(`${player.name}'s fleet ${fleet.name} arrived at star ${fleet.locationStarId}`);
            // Check for battles at new location
            if (this.resolveCombat(fleet.locationStarId)) {
              logs.push(`Combat occurred at star ${fleet.locationStarId}!`);
            }
          }
        }
      }
    }
    return logs;
  }

  processObjectives(): string[] {
    const logs: string[] = [];
    for (const obj of this.state.objectives) {
      // Example: Victory by controlling all stars
      if (obj.id === 'control_all_stars') {
        obj.isCompleted = this.state.players.some(p => p.ownedStars.length === this.state.galaxy.stars.length);
        if (obj.isCompleted) logs.push(`Objective completed: ${obj.description}`);
      }
      // Example: Build a starbase
      if (obj.id === 'build_starbase') {
        obj.isCompleted = this.state.players.some(p => p.fleets.some(f => f.ships.length > 0));
        if (obj.isCompleted) logs.push(`Objective completed: ${obj.description}`);
      }
    }
    return logs;
  }
  processResources(): string[] {
    // Each owned star produces resources for its owner
    const logs: string[] = [];
    for (const player of this.state.players) {
      let income = 0;
      for (const starId of player.ownedStars) {
        player.resources['minerals'] = (player.resources['minerals'] ?? 0) + 2;
        player.resources['energy'] = (player.resources['energy'] ?? 0) + 1;
        income += 2;
      }
      if (income > 0) logs.push(`${player.name} gained ${income} minerals from owned stars.`);
    }
    return logs;
  }

  processStarbaseUpgrades(): string[] {
    // Example: Each turn, starbases can be upgraded if resources allow
    const logs: string[] = [];
    for (const player of this.state.players) {
      for (const fleet of player.fleets) {
        // If fleet is idle at a star and player has enough alloys, upgrade starbase
        if (fleet.status === 'idle' && (player.resources['alloys'] ?? 0) >= 10) {
          player.resources['alloys'] -= 10;
          player.score += 5;
          logs.push(`${player.name} upgraded a starbase at star ${fleet.locationStarId}.`);
        }
      }
    }
    return logs;
  }

  processPlayerProgression(): string[] {
    // Example: Award achievements or tech upgrades
    const logs: string[] = [];
    for (const player of this.state.players) {
      if ((player.resources['research'] ?? 0) >= 20) {
        player.resources['research'] -= 20;
        player.score += 10;
        logs.push(`${player.name} unlocked a new technology!`);
      }
    }
    return logs;
  }

  resolveCombat(starId: number): boolean {
    // Find all fleets at this star
    const fleetsAtStar: FleetState[] = [];
    for (const player of this.state.players) {
      fleetsAtStar.push(...player.fleets.filter(f => f.locationStarId === starId && f.status !== 'destroyed'));
    }
    if (fleetsAtStar.length < 2) return false;
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
    return true;
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

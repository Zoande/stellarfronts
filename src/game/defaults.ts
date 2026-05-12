// src/game/defaults.ts
// Default rules, objectives, and setup for Stellarfronts
import type { GameRules, GameObjective } from "../types/game";

export const DEFAULT_GAME_RULES: GameRules = {
  victoryCondition: "Control all stars or complete all objectives.",
  defeatCondition: "All your fleets are destroyed or max turns reached.",
  maxTurns: 100,
};

export const DEFAULT_OBJECTIVES: GameObjective[] = [
  {
    id: "control_all_stars",
    description: "Control every star in the galaxy.",
    isCompleted: false,
  },
  {
    id: "build_starbase",
    description: "Build a starbase at any star.",
    isCompleted: false,
  },
  // Add more objectives as needed
];

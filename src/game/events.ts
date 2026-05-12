// src/game/events.ts
// Random events and galaxy anomalies for Stellarfronts
import type { GameState, PlayerState } from "../types/game";

export type GameEvent = {
  id: string;
  description: string;
  effect: (state: GameState) => void;
};

export const RANDOM_EVENTS: GameEvent[] = [
  {
    id: "pirate_attack",
    description: "Pirate raiders attack a random star! Fleets at that star take damage.",
    effect: (state) => {
      const stars = state.galaxy.stars;
      if (stars.length === 0) return;
      const star = stars[Math.floor(Math.random() * stars.length)];
      for (const player of state.players) {
        for (const fleet of player.fleets) {
          if (fleet.locationStarId === star.id && fleet.status !== 'destroyed') {
            for (const ship of fleet.ships) {
              ship.hp = Math.max(0, ship.hp - 3);
              if (ship.hp === 0) ship.status = 'destroyed';
            }
          }
        }
      }
    },
  },
  {
    id: "resource_boon",
    description: "A rich asteroid field is discovered. All players gain bonus minerals.",
    effect: (state) => {
      for (const player of state.players) {
        player.resources['minerals'] = (player.resources['minerals'] ?? 0) + 10;
      }
    },
  },
  {
    id: "anomaly",
    description: "A strange anomaly boosts research at a random star.",
    effect: (state) => {
      const stars = state.galaxy.stars;
      if (stars.length === 0) return;
      const star = stars[Math.floor(Math.random() * stars.length)];
      for (const player of state.players) {
        if (player.ownedStars.includes(star.id)) {
          player.resources['research'] = (player.resources['research'] ?? 0) + 5;
        }
      }
    },
  },
];

export function triggerRandomEvent(state: GameState): string | null {
  if (Math.random() < 0.25) { // 25% chance per turn
    const event = RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
    event.effect(state);
    return event.description;
  }
  return null;
}

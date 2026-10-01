import {
  DEFAULT_ORBIT_EPOCH_MS, getPlanetSystemPosition, getSystemOrbitLayout,
  interpolateSystemPosition, SYSTEM_FLEET_Y,
} from "../../src/data/SystemCoordinates";
import type { PlanetConfig, StarData } from "../../src/data/StarMap";
import { GAME_DAYS_PER_YEAR, GAME_START_YEAR, REAL_MS_PER_GAME_DAY } from "../../src/game/GameTime";
import type { GameFleet, GameState } from "./types";
import { SYSTEM_PLANET_ORBIT_DISTANCE } from "./constants";

export function getPlanetSystemPositionAt(star: StarData, planet: PlanetConfig, planetIndex: number, year: number) {
  const nowMs = DEFAULT_ORBIT_EPOCH_MS + (year - GAME_START_YEAR) * GAME_DAYS_PER_YEAR * REAL_MS_PER_GAME_DAY;
  return getPlanetSystemPosition(planet, planetIndex, nowMs, getSystemOrbitLayout(star.type));
}

export function getFleetSystemPosition(state: GameState, fleet: GameFleet, year = state.clock.year) {
  if (fleet.movementPlan) {
    const segment = fleet.movementPlan.segments.find((candidate) => year >= candidate.startYear && year < candidate.endYear);
    if (segment) {
      const progress = Math.max(0, Math.min(1, (year - segment.startYear) / Math.max(0.000001, segment.endYear - segment.startYear)));
      return interpolateSystemPosition(segment.from, segment.to, progress);
    }
    const finalSegment = fleet.movementPlan.segments.at(-1);
    if (finalSegment) return { ...finalSegment.to };
  }
  if (fleet.orbitTargetPlanetId) {
    const star = state.stars[fleet.currentStarId];
    const planetIndex = star?.system.planets.findIndex((planet) => planet.id === fleet.orbitTargetPlanetId) ?? -1;
    const planet = planetIndex >= 0 ? star.system.planets[planetIndex] : null;
    if (star && planet) {
      const position = getPlanetSystemPositionAt(star, planet, planetIndex, year);
      const offset = fleet.orbitOffset ?? { x: SYSTEM_PLANET_ORBIT_DISTANCE, y: SYSTEM_FLEET_Y, z: 0 };
      return { x: position.x + offset.x, y: offset.y, z: position.z + offset.z };
    }
  }
  return { ...(fleet.systemPosition ?? { x: 0, y: SYSTEM_FLEET_Y, z: 0 }) };
}

/**
 * GalaxyMap — Galaxy-level configuration.
 * Defines overall map dimensions and camera limits.
 * This is the top-level data layer: GalaxyMap → StarMap → (future: planets, objects)
 */

export interface GalaxyMapConfig {
  /** Full width of the galaxy plane (X axis, centered at 0) */
  width: number;
  /** Full height of the galaxy plane (Z axis, centered at 0) */
  height: number;

  /** Galaxy shape */
  shape: {
    /** Inner radius of the star ring (empty center) as fraction of galaxy half-size */
    innerRadiusFraction: number;
    /** Outer radius as fraction of galaxy half-size */
    outerRadiusFraction: number;
    /** Number of spiral arms (0 = uniform ring) */
    spiralArms: number;
    /** How tightly wound the spiral is (higher = more turns) */
    spiralTightness: number;
    /** How much stars scatter perpendicular to spiral arms */
    armSpread: number;
  };
  /** Number of stars to generate */
  starCount: number;
  /** Seed for deterministic procedural generation */
  seed: number;
  /** Minimum distance between any two stars */
  minStarSpacing: number;

  /** Camera configuration */
  camera: {
    minRadius: number;
    maxRadius: number;
    startRadius: number;
    startAlpha: number;
    startBeta: number;
    minBeta: number;
    maxBeta: number;
    /** Percentage of radius per scroll tick (exponential zoom) */
    wheelDeltaPercentage: number;
    inertia: number;
  };
}

export const GALAXY_MAP: GalaxyMapConfig = {
  width: 1500,
  height: 1000,
  starCount: 500,
  seed: 42,
  minStarSpacing: 24,

  shape: {
    innerRadiusFraction: 0.25,
    outerRadiusFraction: 0.92,
    spiralArms: 4,
    spiralTightness: 2.5,
    armSpread: 0.35,
  },

  camera: {
    minRadius: 2,
    maxRadius: 1500,
    startRadius: 1200,
    startAlpha: -Math.PI / 2,
    startBeta: Math.PI / 4,
    minBeta: 0.1,
    maxBeta: Math.PI / 2.2,
    wheelDeltaPercentage: 0.08,
    inertia: 0.85,
  },
};

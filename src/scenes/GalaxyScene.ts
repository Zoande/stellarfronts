/**
 * GalaxyScene
 * Pure galaxy-map view with stars and camera controls.
 * Clicking a star requests navigation into a separate SystemScene.
 */

import {
  Scene,
  Vector3,
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  Texture,
  PointerEventTypes,
} from "@babylonjs/core";
import type { AbstractEngine, LinesMesh, Mesh, Observer, PointerInfo } from "@babylonjs/core";
import type { IGameScene } from "../SceneManager";
import { GALAXY_MAP } from "../data/GalaxyMap";
import {
  FOG_OF_WAR_MAX_JUMPS,
  buildFactions,
  buildHomeSystemOwnership,
  getPerspectiveVisibleStarIds,
} from "../data/Factions";
import type { FactionInfo, GalaxyPerspective } from "../data/Factions";
import { applyPlanetStatesToStars, generateStarMap, PLANET_TYPES } from "../data/StarMap";
import type { PlanetConfig, StarData } from "../data/StarMap";
import type { PlanetState } from "../data/Economy";
import type { LeaderState } from "../data/Leaders";
import { CameraController } from "../systems/CameraController";
import { OwnershipOverlayRenderer } from "../systems/OwnershipOverlayRenderer";
import { NebulaFieldRenderer } from "../systems/NebulaFieldRenderer";
import { buildNebulaStarIdSet, connectNebulaeWithHyperlanes, findNebulaForStar } from "../data/Nebula";
import type { NebulaRegion } from "../data/Nebula";
import { StarFieldRenderer } from "../systems/StarFieldRenderer";
import type { GalaxyIconClickType, GalaxyShipIcon, ShipIconStyle } from "../systems/StarFieldRenderer";
import { SelectionPanel } from "../ui/SelectionPanel";
import type { FleetPolicyControl, FleetPolicyValue, SelectionData, SelectionShipData } from "../ui/SelectionPanel";
import { CelestialObjectPanel } from "../ui/CelestialObjectPanel";
import { StarbasePanel } from "../ui/StarbasePanel";
import { SHIP_HULL_DEFINITIONS } from "../data/ShipDesigns";
import type { ShipDesign } from "../data/ShipDesigns";
import { computeStarbasePower } from "../game/combatPower";
import {
  getEmpireDisplayColor,
  getEmpireSystemRelation,
} from "../game/EmpireDisplayColors";
import type { EmpireSystemRelation } from "../game/EmpireDisplayColors";
import type { CombatStance, FleetBehavior, FleetChasePolicy, FleetRetreatPolicy } from "../game/CombatTypes";
import type { GalaxyShipTransit, ShipAction } from "../game/GameplayTypes";
import type { ClientCommand, DiplomacyMovementPayload, ServerFleet, ServerShip, ServerStarbase, ServerStarbaseSummary } from "../game/GameProtocol";
import type { FactionTechnologyView } from "../data/Technology";
import { GAME_DAYS_PER_YEAR, REAL_MS_PER_GAME_DAY } from "../game/GameTime";
import { ContextActionMenu } from "./shared/ContextActionMenu";
import type { ContextMenuItem } from "./shared/ContextActionMenu";
import { getCanvasPoint } from "./shared/pointerMath";
import { createProceduralSpaceSkybox, getGalaxySkyboxSettings } from "../utils/proceduralSpaceSkybox";

type EnterSystemHandler = (star: StarData) => void | Promise<void>;

export interface GalaxyViewState {
  alpha: number;
  beta: number;
  radius: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

export interface GalaxySceneOptions {
  stars?: StarData[];
  nebulae?: NebulaRegion[];
  initialViewState?: GalaxyViewState;
  factions?: FactionInfo[];
  perspective?: GalaxyPerspective;
  visibilityJumps?: number;
  visibleStarIds?: Iterable<number> | null;
  knownStarIds?: Iterable<number> | null;
  starOwnership?: number[];
  diplomacy?: DiplomacyMovementPayload;
  playerFactionId?: number;
  playerShipStarId?: number;
  playerShipSystemIds?: Iterable<number>;
  playerShipTransit?: GalaxyShipTransit | null;
  clockYear?: number;
  serverFleets?: ServerFleet[];
  serverShips?: ServerShip[];
  shipDesigns?: ShipDesign[];
  starbaseSystemIds?: Iterable<number>;
  promotedStarbaseSystemIds?: Iterable<number>;
  starbases?: ServerStarbaseSummary[];
  planetStates?: PlanetState[];
  leaders?: LeaderState[];
  technology?: FactionTechnologyView | null;
  habitedPlanetSystemIds?: Iterable<number>;
  selectedFleetIds?: Iterable<string>;
  onGameplayFrame?: (deltaTime: number) => void;
  onShipCommand?: (action: ShipAction, targetStarId: number, shipId?: string) => void;
  onFleetCommand?: (command: ClientCommand) => void;
  onSelectedFleetIdsChange?: (fleetIds: string[]) => void;
  onPlanetCommand?: (command: ClientCommand) => void;
  onReleasePlanetDetails?: (planetId: string) => void;
  onRequestStarbaseDetails?: (starbaseId: string) => Promise<ServerStarbase | null>;
  onReleaseStarbaseDetails?: (starbaseId: string) => void;
  onOpenHabitedPlanet?: (starId: number) => void | Promise<void>;
}

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const HYPERLANE_MIN_CONNECTIONS = 2;
const HYPERLANE_MAX_CONNECTIONS = 3;
const HYPERLANE_BASE_VISIBILITY = 0.052;
const HYPERLANE_ZOOM_VISIBILITY_BOOST = 0.15;
const HYPERLANE_BASE_ALPHA = 0.011;
const HYPERLANE_DISTANCE_ALPHA_BOOST = 0.026;
const HYPERLANE_ENDPOINT_ALPHA_FACTOR = 0.14;
const HYPERLANE_STAR_ENDPOINT_OFFSET_FACTOR = 0.2;
const HYPERLANE_STAR_ENDPOINT_OFFSET_MIN = 4;
const HYPERLANE_STAR_ENDPOINT_OFFSET_MAX = 10;
const OWNERSHIP_FACTION_COUNT = 15;
const OWNERSHIP_TEXTURE_SIZE = 2400;
const OWNERSHIP_OVERLAY_PADDING_FACTOR = 0.16;
const OWNERSHIP_OVERLAY_Y = 0.055;
const NEBULA_TEXTURE_SIZE = 2048;
const NEBULA_OVERLAY_Y = 0.06;
// Rendering-group stack (groups draw strictly low→high, ignoring depth). The
// nebula gas is the load-bearing layer here: it sits ABOVE the additive star glow
// (group 1) so a dense cluster of stars no longer sums their halos to white over
// the cloud, but BELOW the crisp star cores, icons and lanes (group 3) so systems
// stay visible and clickable through the gas. Star sprites split halo↔core across
// groups 1 and 3 in StarFieldRenderer to straddle the gas.
//   0 territory tint (ownership) + galactic core   →  1 star glow (halos)
//   2 nebula gas                                    →  3 star cores, icons, lanes
const BACKGROUND_RENDERING_GROUP = 0;
const NEBULA_RENDERING_GROUP = 2;
const FOREGROUND_RENDERING_GROUP = 3;
const OWNERSHIP_TIE_EPSILON = 0.0001;
const STAR_PICK_RADIUS_MIN = 5.5;
const STAR_PICK_RADIUS_MAX = 10;
const STAR_PICK_RADIUS_CAMERA_FACTOR = 0.012;
const SHIP_TARGET_SCALE_BOOST = 1.36;
const ACTION_MENU_STYLE_ID = "space-action-menu-style";
// Stationary ship icons sit just off their star so they neither cover the star
// nor each other; a moving ship is pushed at least this far along its lane so it
// always clears the system it just left (and the one it is approaching).
const SHIP_ICON_OFFSET_X = 7;
const SHIP_ICON_OFFSET_Z = -7;
const SHIP_ICON_TRANSIT_MIN_CLEARANCE = 13;
const FLEET_ROUTE_LINE_Y = 1.2;
const FLEET_ROUTE_LINE_COLOR = new Color3(1, 0.55, 0.08);

const OWNERSHIP_COLOR_BANK: Array<[number, number, number]> = [
  [224, 83, 83],
  [230, 128, 74],
  [216, 172, 79],
  [186, 196, 86],
  [123, 185, 85],
  [77, 183, 121],
  [66, 176, 152],
  [74, 171, 219],
  [92, 132, 222],
  [121, 106, 216],
  [158, 102, 204],
  [194, 98, 188],
  [217, 97, 152],
  [213, 109, 121],
  [173, 130, 102],
  [145, 170, 191],
  [130, 158, 95],
  [193, 146, 86],
  [173, 104, 86],
  [122, 144, 186],
  [94, 162, 206],
  [119, 188, 161],
  [178, 187, 107],
  [206, 125, 164],
];

function pickOwnershipPalette(factionCount: number, rng: () => number): Color3[] {
  const available = OWNERSHIP_COLOR_BANK.slice();
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = available[i];
    available[i] = available[j];
    available[j] = temp;
  }

  const palette: Color3[] = [];
  for (let i = 0; i < factionCount; i++) {
    const [r, g, b] = available[i % available.length];
    const jitter = (rng() - 0.5) * 0.07;
    palette.push(
      new Color3(
        clamp(r / 255 + jitter, 0.08, 1),
        clamp(g / 255 + jitter, 0.08, 1),
        clamp(b / 255 + jitter, 0.08, 1),
      ),
    );
  }
  return palette;
}

function ensureActionMenuStyles(): void {
  if (document.getElementById(ACTION_MENU_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = ACTION_MENU_STYLE_ID;
  style.textContent = `
.spaceActionMenu {
  position: fixed;
  z-index: 80;
  min-width: 150px;
  border: 1px solid rgba(150, 200, 230, 0.72);
  border-radius: 5px;
  background: linear-gradient(180deg, rgba(16, 22, 30, 0.98), rgba(8, 12, 18, 0.98));
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.46);
  padding: 6px;
  pointer-events: auto;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
}

.spaceActionMenuTitle {
  padding: 6px 8px 8px;
  color: rgba(214, 226, 242, 0.94);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-bottom: 1px solid rgba(136, 151, 171, 0.38);
  margin-bottom: 5px;
}

.spaceActionMenuBtn {
  width: 100%;
  min-height: 30px;
  border: 1px solid rgba(136, 151, 171, 0.42);
  border-radius: 4px;
  background: rgba(18, 25, 33, 0.96);
  color: #c4d1e2;
  cursor: pointer;
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-top: 5px;
}

.spaceActionMenuBtn:hover {
  border-color: rgba(90, 220, 255, 0.86);
  color: #edfaff;
  background: rgba(29, 43, 57, 0.98);
}

.spaceActionMenuBtn:disabled {
  cursor: default;
  opacity: 0.45;
  border-color: rgba(90, 100, 112, 0.38);
  color: rgba(160, 168, 178, 0.58);
}

.spaceBuildPicker {
  position: fixed;
  z-index: 81;
  width: 220px;
  border: 1px solid rgba(102, 236, 199, 0.72);
  border-radius: 5px;
  background: linear-gradient(180deg, rgba(13, 29, 29, 0.98), rgba(6, 14, 18, 0.98));
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.5);
  padding: 8px;
  pointer-events: auto;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
}

.spaceBuildPickerTitle {
  padding: 6px 8px 8px;
  color: rgba(205, 255, 239, 0.95);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  border-bottom: 1px solid rgba(102, 236, 199, 0.36);
  margin-bottom: 6px;
}

.spaceBuildPickerBtn {
  width: 100%;
  min-height: 38px;
  border: 1px solid rgba(102, 236, 199, 0.48);
  border-radius: 4px;
  background: rgba(10, 41, 34, 0.94);
  color: rgba(226, 255, 246, 0.96);
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.spaceBuildPickerBtn:hover {
  border-color: rgba(139, 255, 219, 0.9);
  background: rgba(16, 58, 47, 0.98);
}
`;
  document.head.appendChild(style);
}

function selectOwnershipSeedIndices(
  stars: StarData[],
  factionCount: number,
  mapWidth: number,
  mapHeight: number,
  rng: () => number,
): number[] {
  const targetCount = Math.max(0, Math.min(factionCount, stars.length));
  if (targetCount === 0) return [];

  const seeds: number[] = [];
  const used = new Set<number>();

  for (let i = 0; i < targetCount; i++) {
    const startX = (rng() - 0.5) * mapWidth;
    const startZ = (rng() - 0.5) * mapHeight;
    let bestIndex = -1;
    let bestDistanceSq = Number.POSITIVE_INFINITY;

    for (let starIndex = 0; starIndex < stars.length; starIndex++) {
      if (used.has(starIndex)) continue;
      const dx = stars[starIndex].x - startX;
      const dz = stars[starIndex].z - startZ;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestIndex = starIndex;
      }
    }

    if (bestIndex >= 0) {
      used.add(bestIndex);
      seeds.push(bestIndex);
    }
  }

  if (seeds.length < targetCount) {
    for (let starIndex = 0; starIndex < stars.length && seeds.length < targetCount; starIndex++) {
      if (used.has(starIndex)) continue;
      used.add(starIndex);
      seeds.push(starIndex);
    }
  }

  return seeds;
}

function computeHyperlaneJumpDistances(adjacency: number[][], seedIndex: number): number[] {
  const count = adjacency.length;
  const distances = new Array<number>(count).fill(-1);
  if (seedIndex < 0 || seedIndex >= count) return distances;

  const queue: number[] = [seedIndex];
  let head = 0;
  distances[seedIndex] = 0;

  while (head < queue.length) {
    const current = queue[head++];
    const nextDistance = distances[current] + 1;
    const neighbors = adjacency[current] ?? [];
    for (const neighbor of neighbors) {
      if (neighbor < 0 || neighbor >= count) continue;
      if (distances[neighbor] >= 0) continue;
      distances[neighbor] = nextDistance;
      queue.push(neighbor);
    }
  }

  return distances;
}

function assignOwnershipToStars(
  stars: StarData[],
  seedIndices: number[],
  adjacency: number[][],
): number[] {
  if (seedIndices.length === 0) return new Array<number>(stars.length).fill(-1);

  // Ownership is determined by lane-jump distance from each faction seed.
  // Factions that run out of reachable neighbors simply stop expanding.
  const jumpMaps = seedIndices.map((seed) => computeHyperlaneJumpDistances(adjacency, seed));
  const ownerByStar = new Array<number>(stars.length).fill(-1);

  for (let starIndex = 0; starIndex < stars.length; starIndex++) {
    let bestOwner = -1;
    let bestJumps = Number.POSITIVE_INFINITY;
    let bestSeedDistanceSq = Number.POSITIVE_INFINITY;

    for (let ownerIndex = 0; ownerIndex < seedIndices.length; ownerIndex++) {
      const jumps = jumpMaps[ownerIndex][starIndex];
      if (jumps < 0) continue;

      const seed = stars[seedIndices[ownerIndex]];
      const star = stars[starIndex];
      const dx = star.x - seed.x;
      const dz = star.z - seed.z;
      const distanceSq = dx * dx + dz * dz;

      if (jumps < bestJumps) {
        bestOwner = ownerIndex;
        bestJumps = jumps;
        bestSeedDistanceSq = distanceSq;
        continue;
      }

      if (jumps === bestJumps) {
        if (
          distanceSq < bestSeedDistanceSq - OWNERSHIP_TIE_EPSILON
          || (Math.abs(distanceSq - bestSeedDistanceSq) <= OWNERSHIP_TIE_EPSILON
            && (bestOwner < 0 || ownerIndex < bestOwner))
        ) {
          bestOwner = ownerIndex;
          bestJumps = jumps;
          bestSeedDistanceSq = distanceSq;
        }
      }
    }

    ownerByStar[starIndex] = bestOwner;
  }

  return ownerByStar;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normalizeAngle(angle: number): number {
  let a = angle % TAU;
  if (a < 0) a += TAU;
  return a;
}

function shortestAngleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % TAU;
  return d > Math.PI ? TAU - d : d;
}

export type CoreTextureShape = {
  innerRadiusFraction: number;
  outerRadiusFraction: number;
  spiralArms: number;
  spiralTightness: number;
  armSpread: number;
};

type StarArmMeta = {
  armIndex: number;
  spiralPhase: number;
  normalizedR: number;
};

type HyperlaneCandidate = {
  index: number;
  distance: number;
  score: number;
  sameArm: boolean;
};

function buildStarArmMetadata(
  stars: StarData[],
  width: number,
  height: number,
  shape: CoreTextureShape,
): StarArmMeta[] {
  const minAxis = Math.min(width, height);
  const xScale = width / minAxis;
  const zScale = height / minAxis;
  const halfSize = minAxis / 2;
  const innerR = halfSize * shape.innerRadiusFraction;
  const outerR = halfSize * shape.outerRadiusFraction;
  const radialSpan = Math.max(0.0001, outerR - innerR);
  const armCount = Math.max(0, Math.floor(shape.spiralArms));
  const armSector = armCount > 0 ? TAU / armCount : TAU;

  const metadata: StarArmMeta[] = [];
  for (const star of stars) {
    const nx = star.x / xScale;
    const nz = star.z / zScale;
    const r = Math.hypot(nx, nz);
    const theta = Math.atan2(nz, nx);
    const normalizedR = clamp((r - innerR) / radialSpan, 0, 1);
    const twist = normalizedR * shape.spiralTightness * Math.PI;
    const spiralPhase = normalizeAngle(theta - twist);

    let armIndex = 0;
    if (armCount > 0) {
      armIndex = Math.round(spiralPhase / armSector) % armCount;
      if (armIndex < 0) armIndex += armCount;
    }

    metadata.push({ armIndex, spiralPhase, normalizedR });
  }

  return metadata;
}

export function buildHyperlanePairs(
  stars: StarData[],
  width: number,
  height: number,
  shape: CoreTextureShape,
  seed: number,
): Array<[number, number]> {
  if (stars.length < 2) return [];

  const rng = mulberry32(seed ^ 0x9e3779b1);
  const armCount = Math.max(0, Math.floor(shape.spiralArms));
  const starMeta = buildStarArmMetadata(stars, width, height, shape);

  const minAxis = Math.min(width, height);
  const maxCandidateDistance = minAxis * 0.34;
  const minBridgeDistance = minAxis * 0.1;
  const candidatePoolSize = 26;

  const candidates: HyperlaneCandidate[][] = Array.from({ length: stars.length }, () => []);

  for (let i = 0; i < stars.length; i++) {
    const localCandidates: HyperlaneCandidate[] = [];
    for (let j = 0; j < stars.length; j++) {
      if (i === j) continue;

      const dx = stars[j].x - stars[i].x;
      const dz = stars[j].z - stars[i].z;
      const distance = Math.hypot(dx, dz);
      if (distance > maxCandidateDistance) continue;

      const sameArm = armCount > 0 && starMeta[i].armIndex === starMeta[j].armIndex;
      const radialDelta = Math.abs(starMeta[i].normalizedR - starMeta[j].normalizedR);
      const spiralDelta = shortestAngleDiff(starMeta[i].spiralPhase, starMeta[j].spiralPhase);

      let score = distance;
      if (armCount > 0) {
        if (sameArm) {
          score *= 0.78 + radialDelta * 0.32;
          score *= 1 + (spiralDelta / Math.PI) * 0.18;
        } else {
          score *= 1.18 + Math.max(0, 0.1 - radialDelta) * 0.6;
          score *= 1 + ((Math.PI - spiralDelta) / Math.PI) * 0.08;
        }
      }

      localCandidates.push({ index: j, distance, score, sameArm });
    }

    if (localCandidates.length === 0) {
      for (let j = 0; j < stars.length; j++) {
        if (i === j) continue;
        const dx = stars[j].x - stars[i].x;
        const dz = stars[j].z - stars[i].z;
        localCandidates.push({
          index: j,
          distance: Math.hypot(dx, dz),
          score: Math.hypot(dx, dz),
          sameArm: armCount > 0 && starMeta[i].armIndex === starMeta[j].armIndex,
        });
      }
    }

    localCandidates.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.distance - b.distance;
    });
    candidates[i] = localCandidates.slice(0, candidatePoolSize);
  }

  const degree = new Uint8Array(stars.length);
  const targetDegree = new Uint8Array(stars.length);
  for (let i = 0; i < stars.length; i++) {
    targetDegree[i] = rng() < 0.42 ? 3 : 2;
  }

  const edges = new Set<string>();
  const hyperlanes: Array<[number, number]> = [];

  const edgeKey = (a: number, b: number): string => {
    const x = Math.min(a, b);
    const y = Math.max(a, b);
    return `${x}:${y}`;
  };

  const connect = (a: number, b: number): boolean => {
    if (a === b) return false;
    if (degree[a] >= HYPERLANE_MAX_CONNECTIONS || degree[b] >= HYPERLANE_MAX_CONNECTIONS) {
      return false;
    }

    const key = edgeKey(a, b);
    if (edges.has(key)) return false;

    edges.add(key);
    degree[a] += 1;
    degree[b] += 1;
    hyperlanes.push([Math.min(a, b), Math.max(a, b)]);
    return true;
  };

  // Pass 1: ensure each star reaches at least 2 links where possible.
  for (let pass = 0; pass < HYPERLANE_MIN_CONNECTIONS; pass++) {
    for (let i = 0; i < stars.length; i++) {
      while (degree[i] <= pass && degree[i] < HYPERLANE_MIN_CONNECTIONS) {
        const candidate = candidates[i].find((c) => {
          if (degree[c.index] >= HYPERLANE_MAX_CONNECTIONS) return false;
          return !edges.has(edgeKey(i, c.index));
        });
        if (!candidate) break;
        connect(i, candidate.index);
      }
    }
  }

  // Pass 2: fill some stars to 3 links, mostly preserving lane structure.
  for (let i = 0; i < stars.length; i++) {
    if (degree[i] >= targetDegree[i]) continue;

    const candidate = candidates[i].find((c) => {
      if (degree[c.index] >= HYPERLANE_MAX_CONNECTIONS) return false;
      if (edges.has(edgeKey(i, c.index))) return false;
      return c.sameArm || rng() < 0.24;
    });

    if (candidate) connect(i, candidate.index);
  }

  // Pass 3: occasional inter-arm bridges to create cross-lane navigation.
  if (armCount > 1) {
    for (let i = 0; i < stars.length; i++) {
      if (degree[i] >= HYPERLANE_MAX_CONNECTIONS) continue;
      if (rng() > 0.18) continue;

      const bridge = candidates[i].find((c) => {
        if (c.sameArm) return false;
        if (c.distance < minBridgeDistance) return false;
        if (degree[c.index] >= HYPERLANE_MAX_CONNECTIONS) return false;
        return !edges.has(edgeKey(i, c.index));
      });

      if (bridge) connect(i, bridge.index);
    }
  }

  // Final rescue: try to pull low-degree stars up to 2 links.
  for (let i = 0; i < stars.length; i++) {
    while (degree[i] < HYPERLANE_MIN_CONNECTIONS) {
      const candidate = candidates[i].find((c) => {
        if (degree[c.index] >= HYPERLANE_MAX_CONNECTIONS) return false;
        return !edges.has(edgeKey(i, c.index));
      });
      if (!candidate) break;
      connect(i, candidate.index);
    }
  }

  return hyperlanes;
}

export function buildHyperlaneAdjacency(
  hyperlanes: Array<[number, number]>,
  starCount: number,
): number[][] {
  const adjacency: number[][] = Array.from({ length: starCount }, () => []);
  for (const [a, b] of hyperlanes) {
    if (a < 0 || b < 0 || a >= starCount || b >= starCount) continue;
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  return adjacency;
}

function createGalacticCoreTextureDataURL(
  size: number,
  shape: CoreTextureShape,
  axisRatio: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP4z8AAAAMBAQAY0x6sAAAAAElFTkSuQmCC";
  }

  const c = size / 2;
  ctx.clearRect(0, 0, size, size);

  const majorStretch = Math.max(1.05, Math.min(1.34, axisRatio * 0.88));
  const minorStretch = Math.max(0.74, Math.min(0.98, 1 / (majorStretch * 0.96)));
  const armCount = Math.max(2, shape.spiralArms);
  const armTightness = Math.max(1.35, shape.spiralTightness);
  const armSpread = Math.max(0.12, shape.armSpread);

  // Keep the core physically broad, but make brightness drop much faster.
  const decayRadius =
    c
    * Math.max(0.56, Math.min(0.74, shape.innerRadiusFraction * 1.9 + 0.18));
  const shoulderRadius = c * Math.max(0.78, Math.min(0.96, decayRadius / c + 0.26));

  const base = ctx.createRadialGradient(c, c, 0, c, c, decayRadius);
  base.addColorStop(0, "rgba(255,244,220,1)");
  base.addColorStop(0.08, "rgba(255,230,196,0.84)");
  base.addColorStop(0.2, "rgba(255,208,160,0.46)");
  base.addColorStop(0.36, "rgba(255,187,138,0.17)");
  base.addColorStop(0.52, "rgba(255,170,120,0.05)");
  base.addColorStop(1, "rgba(255,164,116,0)");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  const diffuse = ctx.createRadialGradient(c, c, decayRadius * 0.68, c, c, shoulderRadius);
  diffuse.addColorStop(0, "rgba(255,224,186,0)");
  diffuse.addColorStop(0.52, "rgba(255,188,134,0.08)");
  diffuse.addColorStop(1, "rgba(255,176,124,0)");
  ctx.fillStyle = diffuse;
  ctx.fillRect(0, 0, size, size);

  const rng = mulberry32(7331);
  ctx.globalCompositeOperation = "screen";

  // Irregular warm cloud field with mixed directional drift.
  // Still favors galaxy elongation, but spreads into diagonal/vertical directions too.
  for (let i = 0; i < 360; i++) {
    const ang = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 1.85) * size * 0.46;
    const directionMode = rng();
    let dirX = 0;
    let dirY = 0;
    if (directionMode < 0.46) {
      dirX = (rng() < 0.5 ? -1 : 1) * (0.42 + rng() * 0.58);
      dirY = (rng() - 0.5) * 0.48;
    } else if (directionMode < 0.78) {
      dirX = (rng() < 0.5 ? -1 : 1) * (0.34 + rng() * 0.54);
      dirY = (rng() < 0.5 ? -1 : 1) * (0.34 + rng() * 0.54);
    } else {
      dirX = (rng() - 0.5) * 0.44;
      dirY = (rng() < 0.5 ? -1 : 1) * (0.44 + rng() * 0.56);
    }
    const dirPull = size * (0.004 + rng() * 0.048) * (0.4 + r / (size * 0.46));
    const x =
      c
      + Math.cos(ang) * r * majorStretch
      + dirX * dirPull;
    const y =
      c
      + Math.sin(ang) * r * minorStretch * (0.72 + rng() * 0.28)
      + dirY * dirPull * 0.92
      + Math.sin(ang * (1.2 + rng() * 0.8)) * size * 0.01;
    const blobRadius = size * (0.01 + rng() * 0.09);
    const alpha = 0.02 + rng() * 0.11 + (1 - r / (size * 0.46)) * 0.07;
    const warmR = 255;
    const warmG = 204 + Math.floor(rng() * 36);
    const warmB = 150 + Math.floor(rng() * 40);

    const blob = ctx.createRadialGradient(x, y, 0, x, y, blobRadius);
    blob.addColorStop(0, `rgba(${warmR},${warmG},${warmB},${alpha})`);
    blob.addColorStop(1, `rgba(${warmR},${warmG},${warmB},0)`);

    ctx.fillStyle = blob;
    ctx.beginPath();
    ctx.arc(x, y, blobRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Secondary isotropic plume layer to spread energy off the major axis.
  for (let i = 0; i < 120; i++) {
    const ang = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 1.55) * size * 0.4;
    const radialWarp = 0.88 + rng() * 0.28;
    const x = c + Math.cos(ang) * r * radialWarp;
    const y = c + Math.sin(ang) * r * radialWarp;
    const rr = size * (0.012 + rng() * 0.065);
    const alpha = 0.012 + rng() * 0.055;
    const plume = ctx.createRadialGradient(x, y, 0, x, y, rr);
    plume.addColorStop(0, `rgba(255,198,142,${alpha})`);
    plume.addColorStop(1, "rgba(255,174,120,0)");
    ctx.fillStyle = plume;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = "lighter";
  // Arm-like wisps anchored to galaxy settings, with jitter so it does not look ringed/even.
  for (let arm = 0; arm < armCount; arm++) {
    const strands = 4 + Math.floor(rng() * 3);
    for (let s = 0; s < strands; s++) {
      const phase = (arm / armCount) * Math.PI * 2 + (rng() - 0.5) * 0.48;
      const jitterA = rng() * Math.PI * 2;
      const jitterB = rng() * Math.PI * 2;
      const wobbleAmp = size * (0.004 + rng() * 0.012);
      const lineAlpha = 0.018 + rng() * 0.035;
      const armLength = size * (0.24 + rng() * 0.34);
      const sideSkew = rng() < 0.68 ? 1 : -1;
      const verticalSkew = (rng() < 0.5 ? -1 : 1) * size * (0.004 + rng() * 0.01);
      ctx.lineWidth = Math.max(1, size * (0.0014 + rng() * 0.0032));
      ctx.beginPath();
      for (let t = 0; t <= 1; t += 0.015) {
        const swirl = t * armTightness * Math.PI + Math.sin(t * 7 + jitterA) * 0.18;
        const rr = Math.pow(t, 1.25) * armLength;
        const scatter = Math.sin(t * 15 + jitterB) * wobbleAmp * (0.5 + t);
        const sidePull = sideSkew * size * 0.014 * t * t;
        const x = c + Math.cos(phase + swirl) * rr * majorStretch + scatter + sidePull;
        const y =
          c
          + Math.sin(phase + swirl) * rr * minorStretch
          + Math.cos(t * 11 + jitterA * 0.7) * wobbleAmp * 0.8
          + Math.sin(t * 6 + jitterB) * size * armSpread * 0.009
          + verticalSkew * t * t;
        if (t === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(255,204,150,${lineAlpha})`;
      ctx.stroke();
    }
  }

  // Mixed-direction drifting veils break ring cues while spreading beyond horizontal.
  for (let i = 0; i < 34; i++) {
    const dirMode = rng();
    let angle: number;
    if (dirMode < 0.42) {
      angle = (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.56;
    } else if (dirMode < 0.76) {
      angle = (rng() < 0.5 ? Math.PI / 4 : -Math.PI / 4) + (rng() - 0.5) * 0.68;
    } else {
      angle = (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + (rng() - 0.5) * 0.58;
    }

    const perp = angle + Math.PI / 2;
    const startRadius = size * (0.03 + rng() * 0.09);
    const length = size * (0.14 + rng() * 0.28);
    const bend = size * (0.05 + rng() * 0.18);

    const startX = c + Math.cos(angle + (rng() - 0.5) * 0.8) * startRadius;
    const startY = c + Math.sin(angle + (rng() - 0.5) * 0.8) * startRadius;
    const endX = startX + Math.cos(angle) * length + Math.cos(perp) * (rng() - 0.5) * bend;
    const endY = startY + Math.sin(angle) * length + Math.sin(perp) * (rng() - 0.5) * bend;
    const cpX = c + Math.cos(angle) * length * (0.45 + rng() * 0.22);
    const cpY = c + Math.sin(angle) * length * (0.45 + rng() * 0.22);

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(cpX, cpY, endX, endY);
    ctx.strokeStyle = `rgba(255,194,140,${0.011 + rng() * 0.024})`;
    ctx.lineWidth = size * (0.003 + rng() * 0.008);
    ctx.lineCap = "round";
    ctx.stroke();
  }

  // Carve uneven dust channels and pits to destroy concentric ring cues.
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 24; i++) {
    const laneRadius = size * (0.08 + rng() * 0.3);
    const laneStart = rng() * Math.PI * 2;
    const laneSweep = (0.2 + rng() * 0.55) * Math.PI;
    const laneWidth = size * (0.006 + rng() * 0.018);

    ctx.save();
    ctx.translate(c + (rng() - 0.35) * size * 0.08, c + (rng() - 0.5) * size * 0.08);
    ctx.rotate((rng() - 0.5) * 0.9);
    ctx.scale(majorStretch * (0.86 + rng() * 0.24), minorStretch * (0.72 + rng() * 0.28));
    ctx.beginPath();
    ctx.arc(0, 0, laneRadius, laneStart, laneStart + laneSweep);
    ctx.strokeStyle = `rgba(0,0,0,${0.03 + rng() * 0.07})`;
    ctx.lineWidth = laneWidth;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }

  for (let i = 0; i < 32; i++) {
    const x = c + (rng() - 0.5) * size * 0.8;
    const y = c + (rng() - 0.5) * size * 0.56;
    const rr = size * (0.01 + rng() * 0.04);
    const pit = ctx.createRadialGradient(x, y, 0, x, y, rr);
    pit.addColorStop(0, `rgba(0,0,0,${0.04 + rng() * 0.09})`);
    pit.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = pit;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Keep center punchy while the outer glow fades quickly.
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 24; i++) {
    const ang = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 2.5) * size * 0.11;
    const x = c + Math.cos(ang) * r * majorStretch;
    const y = c + Math.sin(ang) * r * minorStretch;
    const rr = size * (0.016 + rng() * 0.04);
    const knot = ctx.createRadialGradient(x, y, 0, x, y, rr);
    knot.addColorStop(0, `rgba(255,240,208,${0.16 + rng() * 0.2})`);
    knot.addColorStop(1, "rgba(255,224,182,0)");
    ctx.fillStyle = knot;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Keep very faint asymmetrical haze with multi-direction distribution.
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 24; i++) {
    const mode = rng();
    let ang: number;
    if (mode < 0.45) {
      ang = (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.7;
    } else if (mode < 0.76) {
      ang = (rng() < 0.5 ? Math.PI / 3 : -Math.PI / 3) + (rng() - 0.5) * 0.78;
    } else {
      ang = (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + (rng() - 0.5) * 0.64;
    }
    const radial = size * (0.1 + rng() * 0.28);
    const x = c + Math.cos(ang) * radial * (0.92 + rng() * 0.24);
    const y = c + Math.sin(ang) * radial * (0.92 + rng() * 0.24);
    const rr = size * (0.08 + rng() * 0.16);
    const haze = ctx.createRadialGradient(x, y, 0, x, y, rr);
    haze.addColorStop(0, `rgba(255,184,128,${0.015 + rng() * 0.03})`);
    haze.addColorStop(1, "rgba(255,166,112,0)");
    ctx.fillStyle = haze;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = "source-over";
  return canvas.toDataURL("image/png");
}

export class GalaxyScene implements IGameScene {
  public scene: Scene;
  private engine: AbstractEngine;
  private canvas!: HTMLCanvasElement;
  private cam!: CameraController;
  private starField!: StarFieldRenderer;
  private stars: StarData[] = [];
  private clickPlane!: Mesh;
  private hyperlaneMesh: Mesh | null = null;
  private ownershipOverlayMesh: Mesh | null = null;
  private ownershipRenderer: OwnershipOverlayRenderer | null = null;
  private nebulaOverlayMesh: Mesh | null = null;
  private nebulaRenderer: NebulaFieldRenderer | null = null;
  private nebulae: NebulaRegion[] = [];
  private hyperlanePairs: Array<[number, number]> = [];
  private hyperlaneAdjacency: number[][] = [];
  private starOwnership: number[] = [];
  private openBorderFactionIds = new Set<number>();
  private warFactionIds = new Set<number>();
  private factions: FactionInfo[] = [];
  private perspective: GalaxyPerspective = { mode: "observer" };
  private visibleStarIds: Set<number> | null = null;
  private knownStarIds: Set<number> | null = null;
  private explicitVisibleStarIds: Set<number> | null | undefined = undefined;
  private explicitKnownStarIds: Set<number> | null | undefined = undefined;
  private playerFactionId = 0;
  private playerShipStarId = -1;
  private playerShipSystemIds = new Set<number>();
  private playerShipTransit: GalaxyShipTransit | null = null;
  private clockYear = 2100;
  private serverFleets: ServerFleet[] = [];
  private serverShips: ServerShip[] = [];
  private shipDesigns: ShipDesign[] = [];
  private starbases: ServerStarbaseSummary[] = [];
  private planetStates: PlanetState[] = [];
  private leaders: LeaderState[] = [];
  private hasExplicitHabitedPlanetSystemIds = false;
  private starbaseSystemIds = new Set<number>();
  private promotedStarbaseSystemIds = new Set<number>();
  private selectedShip = false;
  private selectedCommandShipStarId = -1;
  private selectedCommandShipId: string | null = null;
  private selectedFleetIds = new Set<string>();
  private shipIconCycleKey: string | null = null;
  private shipIconCycleIndex = 0;
  private fleetRouteLines: LinesMesh[] = [];
  private fleetRouteSignature = "";
  private activeShipAction: ShipAction | null = null;
  private targetableStarIds = new Set<number>();
  private readonly contextMenu = new ContextActionMenu();
  private buildPickerElement: HTMLDivElement | null = null;
  private galacticCoreMeshes: Mesh[] = [];
  private galacticCoreSpinSpeeds: number[] = [];
  private hoveredStarId = -1;
  private readonly hoverScaleBoost = 1.3;
  private selectionPanel!: SelectionPanel;
  private objectPanel!: CelestialObjectPanel;
  private starbasePanel!: StarbasePanel;

  private hyperlanesVisible = true;
  private centerCloudVisible = true;
  private starsVisible = true;
  private bloomEnabled = true;
  private ownershipVisible = true;

  private pointerObserver: Observer<PointerInfo> | null = null;
  private isNavigating = false;
  private readonly onEnterSystem: EnterSystemHandler;
  private readonly options: GalaxySceneOptions;

  private readonly onContextMenu = (ev: MouseEvent): void => {
    ev.preventDefault();
  };

  private readonly onCanvasPointerLeave = (): void => {
    this.hoveredStarId = -1;
  };

  constructor(
    engine: AbstractEngine,
    onEnterSystem: EnterSystemHandler,
    options?: GalaxySceneOptions,
  ) {
    this.engine = engine;
    this.onEnterSystem = onEnterSystem;
    this.options = options ?? {};
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0, 0, 0, 1);
  }

  async setup(): Promise<void> {
    this.canvas = this.engine.getRenderingCanvas()!;
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    this.canvas.addEventListener("mouseleave", this.onCanvasPointerLeave);

    const cfg = GALAXY_MAP;
    this.stars =
      this.options.stars && this.options.stars.length > 0
        ? this.options.stars
        : generateStarMap(
          cfg.width,
          cfg.height,
          cfg.starCount,
          cfg.seed,
          cfg.minStarSpacing,
          cfg.shape,
        );
    this.nebulae = this.options.nebulae ?? [];
    this.planetStates = this.options.planetStates ?? [];
    applyPlanetStatesToStars(this.stars, this.planetStates);
    this.factions =
      this.options.factions && this.options.factions.length > 0
        ? this.options.factions
        : buildFactions(this.stars, cfg);
    this.perspective = this.options.perspective ?? { mode: "observer" };
    this.playerFactionId = this.options.playerFactionId
      ?? (this.perspective.mode === "faction" ? this.perspective.factionId : 0);
    this.playerShipStarId = this.options.playerShipStarId
      ?? this.factions[this.playerFactionId]?.homeStarId
      ?? this.factions[0]?.homeStarId
      ?? -1;
    this.playerShipSystemIds = new Set(
      this.options.playerShipSystemIds
        ? Array.from(this.options.playerShipSystemIds)
        : this.factions.map((faction) => faction.homeStarId),
    );
    if (this.playerShipStarId >= 0) {
      this.playerShipSystemIds.add(this.playerShipStarId);
    }
    this.playerShipTransit = this.options.playerShipTransit ?? null;
    this.clockYear = this.options.clockYear ?? 2100;
    this.serverFleets = this.options.serverFleets ?? [];
    this.serverShips = this.options.serverShips ?? [];
    this.shipDesigns = this.options.shipDesigns ?? [];
    this.leaders = this.options.leaders ?? [];
    this.applyDiplomacyMovement(this.options.diplomacy);
    this.selectedFleetIds = new Set(this.options.selectedFleetIds ?? []);
    this.starbases = this.options.starbases ?? [];
    this.starbaseSystemIds = new Set(
      this.options.starbaseSystemIds
        ? Array.from(this.options.starbaseSystemIds)
        : this.factions.map((faction) => faction.homeStarId),
    );
    this.promotedStarbaseSystemIds = new Set(
      this.options.promotedStarbaseSystemIds
        ? Array.from(this.options.promotedStarbaseSystemIds)
        : this.getPromotedStarbaseSystemIds(),
    );
    if ("visibleStarIds" in this.options) {
      this.explicitVisibleStarIds = this.options.visibleStarIds
        ? new Set(this.options.visibleStarIds)
        : null;
    }
    if ("knownStarIds" in this.options) {
      this.explicitKnownStarIds = this.options.knownStarIds
        ? new Set(this.options.knownStarIds)
        : null;
    }

    const initialViewState = this.options.initialViewState;

    this.cam = new CameraController(this.scene, this.canvas, {
      alpha: initialViewState?.alpha ?? cfg.camera.startAlpha,
      beta: initialViewState?.beta ?? cfg.camera.startBeta,
      radius: initialViewState?.radius ?? cfg.camera.startRadius,
      target: initialViewState
        ? new Vector3(
          initialViewState.targetX,
          initialViewState.targetY,
          initialViewState.targetZ,
        )
        : Vector3.Zero(),
      lowerRadiusLimit: cfg.camera.minRadius,
      upperRadiusLimit: cfg.camera.maxRadius,
      lowerBetaLimit: cfg.camera.minBeta,
      upperBetaLimit: cfg.camera.maxBeta,
      wheelDeltaPercentage: cfg.camera.wheelDeltaPercentage,
      inertia: cfg.camera.inertia,
    });

    this.cam.setBounds(
      -cfg.width / 2,
      cfg.width / 2,
      -cfg.height / 2,
      cfg.height / 2,
    );

    this.clickPlane = MeshBuilder.CreateGround(
      "galaxyClickPlane",
      { width: cfg.width * 1.5, height: cfg.height * 1.5 },
      this.scene,
    );
    this.clickPlane.isVisible = false;
    this.clickPlane.isPickable = true;

    const generatedSkybox = createProceduralSpaceSkybox(this.scene, {
      name: "galaxySkybox",
      materialName: "galaxySkyboxMat",
      size: 5000,
      render: getGalaxySkyboxSettings(),
      textureLevel: 0.78,
      environmentIntensity: 0.2,
    });
    if (!generatedSkybox) {
      const bgSphere = MeshBuilder.CreateSphere(
        "galaxyBackground",
        { diameter: 5000, segments: 24 },
        this.scene,
      );
      const bgMat = new StandardMaterial("galaxyBackgroundMat", this.scene);
      bgMat.emissiveTexture = new Texture("/textures/galaxy_bg.webp", this.scene);
      bgMat.disableLighting = true;
      bgMat.backFaceCulling = false;
      bgSphere.material = bgMat;
      bgSphere.isPickable = false;
      bgSphere.infiniteDistance = true;
    }

    this.setupGalacticCore(cfg.width, cfg.height);
    this.setupHyperlanes(cfg.width, cfg.height, cfg.shape, cfg.seed);
    this.setupOwnershipLayer(cfg.width, cfg.height, cfg.seed);
    this.setupNebulaLayer(cfg.width, cfg.height);

    this.starField = new StarFieldRenderer(
      this.scene,
      this.stars,
      this.playerShipStarId,
      Array.from(this.promotedStarbaseSystemIds),
      Array.from(this.playerShipSystemIds),
      this.getShipIconStyles(),
      this.getSystemRelations(),
    );
    this.starField.setVisibleStarIds(this.visibleStarIds);
    this.starField.setKnownStarIds(this.knownStarIds);
    // Damp the halos of stars inside nebulas so their clustered glow stops washing
    // the coloured gas white (the gas itself supplies the regional glow).
    this.starField.setNebulaStarIds(buildNebulaStarIdSet(this.nebulae));
    if (this.options.habitedPlanetSystemIds) {
      this.hasExplicitHabitedPlanetSystemIds = true;
      this.starField.setHabitedPlanetSystemIds(this.options.habitedPlanetSystemIds);
    }
    this.starField.setPlayerShipState(this.playerShipStarId, this.playerShipTransit);

    this.selectionPanel = new SelectionPanel(this.canvas, {
      onShipAction: (action, selection) => this.beginShipAction(action, selection),
      onFleetPolicyChange: (control, value, selection) => this.setFleetPolicy(control, value, selection),
    });
    this.renderSelectedFleetPanels();
    this.objectPanel = new CelestialObjectPanel();
    this.starbasePanel = new StarbasePanel();
    this.starField.setIconClickCallback((type, shiftKey, starId) => {
      this.handleIconClick(type, shiftKey, starId);
    });
    this.starField.setShipIconClickCallback((fleetIds, shiftKey) => {
      this.handleShipIconClick(fleetIds, shiftKey);
    });

    this.pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
        this.updateHoveredStarFromPointer();
        return;
      }

      if (pointerInfo.type !== PointerEventTypes.POINTERDOWN) return;
      const ev = pointerInfo.event as PointerEvent;
      if (this.isNavigating) return;

      if (ev.button === 2) {
        ev.preventDefault();
        this.openShipActionMenuAtPointer(ev);
        return;
      }

      if (ev.button !== 0) return;
      this.closeActionMenu();

      if (this.tryIssueActiveShipActionAtPointer()) {
        return;
      }
      
      // Check for icon click first
      const point = getCanvasPoint(this.canvas, ev);
      if (point && this.starField.checkIconClick(point.canvasX, point.canvasY, {width: this.canvas.width, height: this.canvas.height}, ev.shiftKey)) {
        return;
      }

      if (this.tryEnterSystemAtPointer()) {
        return;
      }
      if (!ev.shiftKey) this.clearFleetSelection();
    });

    await this.scene.whenReadyAsync();
  }

  onBeforeRender(): void {
    const dt = this.engine.getDeltaTime() / 1000;
    this.options.onGameplayFrame?.(dt);
    this.cam.updatePanning(dt);

    const camera = this.cam.camera;
    const minRadius = camera.lowerRadiusLimit ?? GALAXY_MAP.camera.minRadius;
    const maxRadius = camera.upperRadiusLimit ?? GALAXY_MAP.camera.maxRadius;
    const zoomOutBlend =
      (this.cam.radius - minRadius) / Math.max(0.0001, maxRadius - minRadius);

    this.starField.update(dt);
    this.starField.resetOverrides();
    if (this.hoveredStarId >= 0 && this.hoveredStarId < this.stars.length) {
      this.starField.setStarScale(this.hoveredStarId, this.hoverScaleBoost);
    }
    for (const starId of this.targetableStarIds) {
      this.starField.setStarScale(starId, SHIP_TARGET_SCALE_BOOST);
    }
    this.starField.setSelectionMarkerStar(this.hoveredStarId);
    this.starField.setZoomOutBlend(zoomOutBlend);
    this.starField.setStarsVisible(this.starsVisible);
    this.starField.setBloomEnabled(this.bloomEnabled);
    this.starField.setGalaxyShipIcons(this.buildGalaxyShipIcons());
    this.updateFleetRouteLines();
    this.starField.applyVisuals();

    if (this.hyperlaneMesh) {
      this.hyperlaneMesh.visibility = this.hyperlanesVisible
        ? HYPERLANE_BASE_VISIBILITY + zoomOutBlend * HYPERLANE_ZOOM_VISIBILITY_BOOST
        : 0;
    }

    for (let i = 0; i < this.galacticCoreMeshes.length; i++) {
      this.galacticCoreMeshes[i].setEnabled(this.centerCloudVisible);
      this.galacticCoreMeshes[i].rotation.y += this.galacticCoreSpinSpeeds[i] * dt;
    }
  }

  private updateVisibilityFromPerspective(): void {
    if (this.explicitVisibleStarIds !== undefined) {
      this.visibleStarIds = this.explicitVisibleStarIds
        ? new Set(this.explicitVisibleStarIds)
        : null;
    } else {
      this.visibleStarIds = getPerspectiveVisibleStarIds(
        this.perspective,
        this.factions,
        this.hyperlaneAdjacency,
        this.options.visibilityJumps ?? FOG_OF_WAR_MAX_JUMPS,
      );
    }

    if (this.explicitKnownStarIds !== undefined) {
      this.knownStarIds = this.explicitKnownStarIds
        ? new Set(this.explicitKnownStarIds)
        : null;
    } else {
      this.knownStarIds = this.visibleStarIds;
    }
  }

  private isStarVisibleToPerspective(starId: number): boolean {
    return this.visibleStarIds === null || this.visibleStarIds.has(starId);
  }

  private isStarKnownToPerspective(starId: number): boolean {
    return this.knownStarIds === null || this.knownStarIds.has(starId);
  }

  private areVisibleStarSetsEqual(a: Set<number> | null, b: Set<number> | null): boolean {
    if (a === null || b === null) return a === b;
    if (a.size !== b.size) return false;
    for (const value of a) {
      if (!b.has(value)) return false;
    }
    return true;
  }

  private applyVisibilityToOwnership(ownerByStar: number[]): number[] {
    if (this.knownStarIds === null) return ownerByStar;

    return ownerByStar.map((owner, starId) => (
      this.knownStarIds?.has(starId) ? owner : -1
    ));
  }

  private setupHyperlanes(
    width: number,
    height: number,
    shape: CoreTextureShape,
    seed: number,
  ): void {
    // Mirror the server (state-bootstrap): weld each nebula's members into one
    // connected region so the lanes and adjacency match the authoritative state.
    const hyperlanes = connectNebulaeWithHyperlanes(
      buildHyperlanePairs(this.stars, width, height, shape, seed),
      this.nebulae,
      this.stars,
    );
    this.hyperlanePairs = hyperlanes;
    this.hyperlaneAdjacency = buildHyperlaneAdjacency(hyperlanes, this.stars.length);
    this.updateVisibilityFromPerspective();
    this.rebuildHyperlaneMesh(width, height);
  }

  private rebuildHyperlaneMesh(width: number, height: number): void {
    this.hyperlaneMesh?.dispose();
    this.hyperlaneMesh = null;
    const hyperlanes = this.hyperlanePairs;
    if (hyperlanes.length === 0) return;

    const minAxis = Math.min(width, height);
    const maxLaneDistance = minAxis * 0.34;
    const lineSegments: Vector3[][] = [];
    const lineColors: Color4[][] = [];

    for (const [a, b] of hyperlanes) {
      const knownA = this.isStarKnownToPerspective(a);
      const knownB = this.isStarKnownToPerspective(b);
      if (!knownA && !knownB) {
        continue;
      }

      const starA = this.stars[a];
      const starB = this.stars[b];

      const dx = starB.x - starA.x;
      const dz = starB.z - starA.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.0001) continue;

      const endpointInset = clamp(
        distance * HYPERLANE_STAR_ENDPOINT_OFFSET_FACTOR,
        HYPERLANE_STAR_ENDPOINT_OFFSET_MIN,
        HYPERLANE_STAR_ENDPOINT_OFFSET_MAX,
      );

      const ux = dx / distance;
      const uz = dz / distance;
      const ax = starA.x + ux * endpointInset;
      const az = starA.z + uz * endpointInset;
      const bx = starB.x - ux * endpointInset;
      const bz = starB.z - uz * endpointInset;
      const mx = (ax + bx) * 0.5;
      const mz = (az + bz) * 0.5;

      const shortLaneFactor = 1 - clamp(distance / maxLaneDistance, 0, 1);
      const midAlpha = HYPERLANE_BASE_ALPHA + shortLaneFactor * HYPERLANE_DISTANCE_ALPHA_BOOST;
      const endAlpha = midAlpha * HYPERLANE_ENDPOINT_ALPHA_FACTOR;

      let laneColorStart = new Color4(0.53, 0.57, 0.62, endAlpha);
      let laneColorMid = new Color4(0.56, 0.61, 0.67, midAlpha);
      let laneColorEnd = new Color4(0.53, 0.57, 0.62, endAlpha);

      if (knownA !== knownB) {
        const knownColor = new Color4(0.62, 0.72, 0.76, midAlpha * 1.2);
        const fadeColor = new Color4(0.43, 0.46, 0.49, midAlpha * 0.52);
        const unknownColor = new Color4(0.31, 0.32, 0.35, endAlpha * 0.12);
        laneColorStart = knownA ? knownColor : unknownColor;
        laneColorMid = fadeColor;
        laneColorEnd = knownB ? knownColor : unknownColor;
      }

      lineSegments.push([
        new Vector3(ax, 0.06, az),
        new Vector3(mx, 0.06, mz),
        new Vector3(bx, 0.06, bz),
      ]);
      lineColors.push([laneColorStart, laneColorMid, laneColorEnd]);
    }

    if (lineSegments.length === 0) return;

    this.hyperlaneMesh = MeshBuilder.CreateLineSystem(
      "galaxyHyperlanes",
      {
        lines: lineSegments,
        colors: lineColors,
        updatable: false,
      },
      this.scene,
    );
    this.hyperlaneMesh.isPickable = false;
    this.hyperlaneMesh.alwaysSelectAsActiveMesh = true;
    this.hyperlaneMesh.renderingGroupId = FOREGROUND_RENDERING_GROUP;
    this.hyperlaneMesh.visibility = this.hyperlanesVisible
      ? HYPERLANE_BASE_VISIBILITY + HYPERLANE_ZOOM_VISIBILITY_BOOST
      : 0;
  }

  private setupOwnershipLayer(width: number, height: number, seed: number): void {
    if (this.stars.length === 0) return;

    const factionCount = Math.min(this.factions.length, this.stars.length);
    if (factionCount <= 0) return;

    const palette = this.getRelationshipPalette().slice(0, factionCount);
    this.starOwnership = this.options.starOwnership
      ? this.options.starOwnership.slice(0, this.stars.length)
      : buildHomeSystemOwnership(this.stars, this.factions);
    while (this.starOwnership.length < this.stars.length) {
      this.starOwnership.push(-1);
    }
    const ownershipPadding = Math.min(width, height) * OWNERSHIP_OVERLAY_PADDING_FACTOR;
    const ownershipWidth = width + ownershipPadding * 2;
    const ownershipHeight = height + ownershipPadding * 2;

    this.ownershipRenderer = new OwnershipOverlayRenderer(this.scene, {
      textureSize: OWNERSHIP_TEXTURE_SIZE,
      mapWidth: ownershipWidth,
      mapHeight: ownershipHeight,
      stars: this.stars,
      palette,
      hyperlanePairs: this.hyperlanePairs,
    });
    this.ownershipRenderer.updateOwnership(this.applyVisibilityToOwnership(this.starOwnership));

    const overlay = MeshBuilder.CreateGround(
      "galaxyOwnershipOverlay",
      { width: ownershipWidth, height: ownershipHeight },
      this.scene,
    );
    overlay.position.y = OWNERSHIP_OVERLAY_Y;
    overlay.isPickable = false;
    overlay.alwaysSelectAsActiveMesh = true;
    // Territory tint sits on the floor of the stack, beneath the gas and stars.
    overlay.renderingGroupId = BACKGROUND_RENDERING_GROUP;

    const tex = this.ownershipRenderer.texture;

    const mat = new StandardMaterial("galaxyOwnershipOverlayMat", this.scene);
    mat.diffuseTexture = tex;
    mat.opacityTexture = tex;
    mat.emissiveTexture = tex;
    mat.diffuseColor = Color3.White();
    mat.emissiveColor = Color3.White();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 1;

    overlay.material = mat;
    overlay.setEnabled(this.ownershipVisible);
    this.ownershipOverlayMesh = overlay;
  }

  private setupNebulaLayer(width: number, height: number): void {
    if (this.stars.length === 0 || this.nebulae.length === 0) return;

    const padding = Math.min(width, height) * OWNERSHIP_OVERLAY_PADDING_FACTOR;
    const nebulaWidth = width + padding * 2;
    const nebulaHeight = height + padding * 2;

    this.nebulaRenderer = new NebulaFieldRenderer(this.scene, {
      textureSize: NEBULA_TEXTURE_SIZE,
      mapWidth: nebulaWidth,
      mapHeight: nebulaHeight,
      stars: this.stars,
      nebulae: this.nebulae,
      hyperlanePairs: this.hyperlanePairs,
    });

    const overlay = MeshBuilder.CreateGround(
      "galaxyNebulaOverlay",
      { width: nebulaWidth, height: nebulaHeight },
      this.scene,
    );
    overlay.position.y = NEBULA_OVERLAY_Y;
    overlay.isPickable = false;
    overlay.alwaysSelectAsActiveMesh = true;
    overlay.renderingGroupId = NEBULA_RENDERING_GROUP;

    const tex = this.nebulaRenderer.texture;
    // Mirror the ownership overlay's material EXACTLY — it is the proven path for
    // showing a DynamicTexture's true colours on a galaxy-plane ground. The earlier
    // setup (no diffuseTexture, black diffuse, a forced ALPHA_COMBINE alphaMode) made
    // the cloud render as flat white — its painted hues were dropped and only the
    // texture's alpha shaped a white blob. Sampling diffuse+emissive from the texture
    // with white tint colours (and letting the opacityTexture drive Babylon's own
    // transparency, no manual alphaMode) is what makes the colour read.
    const mat = new StandardMaterial("galaxyNebulaOverlayMat", this.scene);
    mat.diffuseTexture = tex;
    mat.opacityTexture = tex;
    mat.emissiveTexture = tex;
    mat.diffuseColor = Color3.White();
    mat.emissiveColor = Color3.White();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 1;

    overlay.material = mat;
    this.nebulaOverlayMesh = overlay;
  }

  private setupGalacticCore(width: number, height: number): void {
    const minSize = Math.min(width, height);
    const axisRatio = width / Math.max(1, height);
    const coreTextureDataURL = createGalacticCoreTextureDataURL(
      1024,
      GALAXY_MAP.shape,
      axisRatio,
    );
    const majorScale = Math.max(1.08, Math.min(1.32, axisRatio * 0.88));
    const minorScale = Math.max(0.76, Math.min(0.98, 1 / (majorScale * 0.96)));

    const layers = [
      {
        name: "galaxyCoreOuter",
        radius: minSize * 0.62,
        alpha: 0.065,
        color: new Color3(1.0, 0.69, 0.47),
        spin: 0.0019,
        scaleX: majorScale * 1.03,
        scaleZ: minorScale * 1.1,
        offsetX: minSize * 0.012,
        offsetZ: -minSize * 0.016,
        yaw: 0.11,
        texScale: 1.02,
        texOffsetU: -0.012,
        texOffsetV: 0.01,
      },
      {
        name: "galaxyCoreMid",
        radius: minSize * 0.49,
        alpha: 0.115,
        color: new Color3(1.0, 0.74, 0.51),
        spin: -0.0036,
        scaleX: majorScale * 0.99,
        scaleZ: minorScale * 1.07,
        offsetX: -minSize * 0.008,
        offsetZ: minSize * 0.014,
        yaw: -0.15,
        texScale: 1.0,
        texOffsetU: 0.007,
        texOffsetV: -0.013,
      },
      {
        name: "galaxyCoreInner",
        radius: minSize * 0.35,
        alpha: 0.195,
        color: new Color3(1.0, 0.81, 0.6),
        spin: 0.0058,
        scaleX: majorScale * 0.94,
        scaleZ: minorScale * 0.99,
        offsetX: minSize * 0.004,
        offsetZ: minSize * 0.009,
        yaw: 0.08,
        texScale: 0.985,
        texOffsetU: -0.004,
        texOffsetV: 0.011,
      },
      {
        name: "galaxyCoreNucleus",
        radius: minSize * 0.24,
        alpha: 0.285,
        color: new Color3(1.0, 0.88, 0.7),
        spin: -0.0105,
        scaleX: majorScale * 0.89,
        scaleZ: minorScale * 0.92,
        offsetX: -minSize * 0.003,
        offsetZ: -minSize * 0.006,
        yaw: -0.06,
        texScale: 0.97,
        texOffsetU: 0.003,
        texOffsetV: -0.007,
      },
    ];

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const disc = MeshBuilder.CreateDisc(
        layer.name,
        { radius: layer.radius, tessellation: 96 },
        this.scene,
      );
      disc.rotation.x = Math.PI / 2;
      disc.rotation.z = layer.yaw;
      disc.position.y = 0.02 + i * 0.01;
      disc.position.x = layer.offsetX;
      disc.position.z = layer.offsetZ;
      disc.scaling.x = layer.scaleX;
      disc.scaling.y = layer.scaleZ;
      disc.isPickable = false;

      const layerTexture = new Texture(coreTextureDataURL, this.scene);
      layerTexture.hasAlpha = true;
      layerTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
      layerTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
      layerTexture.uScale = layer.texScale;
      layerTexture.vScale = layer.texScale * (0.97 + i * 0.012);
      layerTexture.uOffset = layer.texOffsetU;
      layerTexture.vOffset = layer.texOffsetV;

      const mat = new StandardMaterial(`${layer.name}Mat`, this.scene);
      mat.emissiveTexture = layerTexture;
      mat.opacityTexture = layerTexture;
      mat.emissiveColor = layer.color;
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mat.alpha = layer.alpha;

      disc.material = mat;
      this.galacticCoreMeshes.push(disc);
      this.galacticCoreSpinSpeeds.push(layer.spin);
    }
  }

  private getShipOwnerForStarId(starId: number): FactionInfo | null {
    const serverFleet = this.serverFleets.find((fleet) => fleet.currentStarId === starId);
    if (serverFleet) {
      return this.factions.find((faction) => faction.id === serverFleet.ownerId) ?? null;
    }
    return this.factions.find((faction) => faction.homeStarId === starId) ?? null;
  }

  private getFleetForStarId(starId: number): ServerFleet | null {
    return this.serverFleets.find((fleet) => fleet.currentStarId === starId) ?? null;
  }

  private getShipsForFleet(fleetId: string | null): ServerShip[] {
    if (!fleetId) return [];
    return this.serverShips.filter((ship) => ship.fleetId === fleetId);
  }

  private getFleetDefense(fleetId: string | null): {
    shield: number;
    maxShield: number;
    armor: number;
    maxArmor: number;
    hull: number;
    maxHull: number;
  } {
    const ships = this.getShipsForFleet(fleetId);
    if (ships.length === 0) {
      return { shield: 0, maxShield: 0, armor: 0, maxArmor: 0, hull: 0, maxHull: 0 };
    }
    return ships.reduce(
      (total, ship) => ({
        shield: total.shield + ship.shield,
        maxShield: total.maxShield + ship.maxShield,
        armor: total.armor + ship.armor,
        maxArmor: total.maxArmor + ship.maxArmor,
        hull: total.hull + ship.hull,
        maxHull: total.maxHull + ship.maxHull,
      }),
      { shield: 0, maxShield: 0, armor: 0, maxArmor: 0, hull: 0, maxHull: 0 },
    );
  }

  private getShipIconStyles(): ShipIconStyle[] {
    const styles: ShipIconStyle[] = [];
    for (const starId of this.playerShipSystemIds) {
      const owner = this.getShipOwnerForStarId(starId);
      if (!owner) continue;
      styles.push({ starId, color: owner.color });
    }
    return styles;
  }

  private isOwnShipOwner(ownerId: number | null): boolean {
    return ownerId !== null && ownerId === this.playerFactionId;
  }

  private getCurrentCommandOriginStarId(): number {
    return this.playerShipTransit?.toStarId
      ?? (this.selectedCommandShipStarId >= 0 ? this.selectedCommandShipStarId : this.playerShipStarId);
  }

  private getSelectedCommandFleet(): ServerFleet | null {
    return this.selectedCommandShipId
      ? this.serverFleets.find((fleet) => fleet.id === this.selectedCommandShipId) ?? null
      : null;
  }

  private fleetCanBuildStarbase(fleet: ServerFleet | null | undefined): boolean {
    if (!fleet || fleet.ownerId !== this.playerFactionId) return false;
    return this.getShipsForFleet(fleet.id).some((ship) => ship.shipKind === "constructionShip" && ship.hull > 0);
  }

  private fleetCanColonize(fleet: ServerFleet | null | undefined): boolean {
    if (!fleet || fleet.ownerId !== this.playerFactionId) return false;
    return this.getShipsForFleet(fleet.id).some((ship) => ship.shipKind === "colonizationShip" && ship.hull > 0);
  }

  private getFleetActions(fleet: ServerFleet | null | undefined): ShipAction[] {
    const actions: ShipAction[] = ["move"];
    if (this.fleetCanBuildStarbase(fleet)) actions.push("build");
    if (this.fleetCanColonize(fleet)) actions.push("colonize");
    actions.push("attack", "stop", "merge", "retreat", "retreatTo", "emergencyRetreatTo");
    return actions;
  }

  private hasHostilePresenceAtStar(starId: number): boolean {
    const owner = this.starOwnership[starId] ?? -1;
    if (owner >= 0 && owner !== this.playerFactionId && this.warFactionIds.has(owner)) return true;
    return this.starbases.some((starbase) => (
      starbase.starId === starId
      && starbase.ownerId !== this.playerFactionId
      && this.warFactionIds.has(starbase.ownerId)
    )) || this.serverFleets.some((fleet) => (
      fleet.currentStarId === starId
      && fleet.ownerId !== this.playerFactionId
      && this.warFactionIds.has(fleet.ownerId)
    ));
  }

  private canEnterStar(starId: number): boolean {
    const owner = this.starOwnership[starId] ?? -1;
    if (owner < 0 || owner === this.playerFactionId) return true;
    if (this.warFactionIds.has(owner)) return true;
    return this.openBorderFactionIds.has(owner);
  }

  private getReachableStarIds(action: ShipAction): Set<number> {
    const reachable = new Set<number>();
    if (action === "emergencyRetreatTo") {
      if (this.knownStarIds === null) {
        this.stars.forEach((star) => reachable.add(star.id));
      } else {
        for (const starId of this.knownStarIds) reachable.add(starId);
      }
      return reachable;
    }

    const start = this.getCurrentCommandOriginStarId();
    if (start < 0 || start >= this.hyperlaneAdjacency.length) return reachable;
    if (!this.isStarKnownToPerspective(start)) return reachable;

    const queue: number[] = [start];
    let head = 0;
    reachable.add(start);

    while (head < queue.length) {
      const current = queue[head++];
      for (const neighbor of this.hyperlaneAdjacency[current] ?? []) {
        if (neighbor < 0 || neighbor >= this.hyperlaneAdjacency.length) continue;
        if (reachable.has(neighbor)) continue;
        if (!this.canEnterStar(neighbor)) continue;

        reachable.add(neighbor);
        // Only keep expanding through known systems — undiscovered systems are
        // reachable via their visible (fading) hyperlane but can't be used as
        // stepping stones into further unknown space.
        if (this.isStarKnownToPerspective(neighbor)) queue.push(neighbor);
      }
    }

    if (action === "move" || action === "retreatTo") {
      reachable.delete(start);
      return reachable;
    }

    if (action === "attack") {
      for (const starId of Array.from(reachable)) {
        if (!this.hasHostilePresenceAtStar(starId)) reachable.delete(starId);
      }
      return reachable;
    }

    for (const starId of Array.from(reachable)) {
      if (this.starbaseSystemIds.has(starId)) {
        reachable.delete(starId);
      }
    }
    return reachable;
  }

  private beginShipAction(action: ShipAction, selection?: SelectionData): void {
    if (selection?.id) {
      const selectedFleet = this.serverFleets.find((fleet) => fleet.id === selection.id);
      if (selectedFleet && this.selectedFleetIds.has(selectedFleet.id)) {
        this.selectedShip = true;
        this.selectedCommandShipStarId = selectedFleet.currentStarId;
        this.selectedCommandShipId = selectedFleet.id;
      }
    }

    if (!this.selectedShip || this.selectedCommandShipStarId < 0) {
      this.clearShipAction();
      return;
    }

    if (action === "merge") {
      this.mergeSelectedFleetWithSelectedFleets();
      return;
    }

    if (action === "stop") {
      if (this.selectedCommandShipId) {
        this.options.onFleetCommand?.({ type: "stopFleet", fleetId: this.selectedCommandShipId });
      }
      this.clearShipAction();
      return;
    }

    if (action === "retreat") {
      if (this.selectedCommandShipId) {
        this.options.onFleetCommand?.({ type: "retreatFleet", fleetId: this.selectedCommandShipId });
      }
      this.clearShipAction();
      return;
    }

    if (action === "attack") {
      this.activateShipActionTargeting("attack");
      return;
    }

    if (action === "build") {
      this.openBuildPicker(() => this.activateShipActionTargeting("build"));
      return;
    }

    if (action === "colonize") {
      const fleetId = this.selectedCommandShipId;
      const star = this.stars[this.selectedCommandShipStarId];
      if (!fleetId || !star) {
        this.clearShipAction();
        return;
      }
      this.clearShipAction();
      Promise.resolve(this.onEnterSystem(star))
        .then(() => this.options.onShipCommand?.("colonize", star.id, fleetId))
        .catch((error) => console.error("Failed to open system for colonization", error));
      return;
    }

    this.activateShipActionTargeting(action);
  }

  private activateShipActionTargeting(action: ShipAction): void {
    if (this.activeShipAction === action) {
      this.clearShipAction();
      return;
    }

    this.activeShipAction = action;
    this.targetableStarIds = this.getReachableStarIds(action);
    this.starField.setHighlightedStarIds(this.targetableStarIds);
    this.selectionPanel.setActiveShipAction(action);
  }

  private setFleetPolicy(control: FleetPolicyControl, value: FleetPolicyValue, selection?: SelectionData): void {
    const fleetId = selection?.id ?? this.selectedCommandShipId;
    if (!fleetId) return;
    const fleet = this.serverFleets.find((candidate) => candidate.id === fleetId);
    if (!fleet || !this.isOwnShipOwner(fleet.ownerId)) return;

    if (control === "stance") {
      const options: CombatStance[] = ["passive", "evade", "holdPosition", "guardArea", "defendSystem", "aggressive", "hunt"];
      if (!options.includes(value as CombatStance)) return;
      this.options.onFleetCommand?.({
        type: "setFleetCombatSettings",
        fleetId,
        combatSettings: {},
        combatStance: value as CombatStance,
      });
      return;
    }

    if (control === "behavior") {
      const options: FleetBehavior[] = ["artillery", "line", "brawler", "swarm", "defender"];
      if (!options.includes(value as FleetBehavior)) return;
      this.options.onFleetCommand?.({
        type: "setFleetCombatSettings",
        fleetId,
        combatSettings: { behavior: value as FleetBehavior },
      });
      return;
    }

    if (control === "chase") {
      const options: FleetChasePolicy[] = ["none", "system", "friendlySystems", "neutralSystems", "enemySystems"];
      if (!options.includes(value as FleetChasePolicy)) return;
      this.options.onFleetCommand?.({
        type: "setFleetCombatSettings",
        fleetId,
        combatSettings: { chasePolicy: value as FleetChasePolicy },
      });
      return;
    }

    const options: FleetRetreatPolicy[] = ["none", "low", "medium", "high"];
    if (!options.includes(value as FleetRetreatPolicy)) return;
    this.options.onFleetCommand?.({
      type: "setFleetCombatSettings",
      fleetId,
      combatSettings: { retreatPolicy: value as FleetRetreatPolicy },
    });
  }

  private mergeSelectedFleetWithSelectedFleets(): void {
    const targetFleetId = this.selectedCommandShipId;
    if (!targetFleetId) {
      this.clearShipAction();
      return;
    }
    const targetFleet = this.serverFleets.find((fleet) => fleet.id === targetFleetId);
    if (!targetFleet || targetFleet.ownerId !== this.playerFactionId) {
      this.clearShipAction();
      return;
    }
    const sourceFleetIds = Array.from(this.selectedFleetIds).filter((fleetId) => fleetId !== targetFleet.id);
    if (sourceFleetIds.length === 0) {
      this.clearShipAction();
      return;
    }
    this.options.onFleetCommand?.({ type: "mergeFleets", targetFleetId: targetFleet.id, sourceFleetIds });
    this.clearShipAction();
  }

  private issueBasicAttack(fleetId: string): void {
    const fleet = this.serverFleets.find((candidate) => candidate.id === fleetId);
    if (!fleet) return;
    const hostileFleet = this.serverFleets.find((candidate) => (
      candidate.id !== fleet.id
      && candidate.currentStarId === fleet.currentStarId
      && candidate.ownerId !== fleet.ownerId
      && this.warFactionIds.has(candidate.ownerId)
    ));
    if (hostileFleet) {
      this.options.onFleetCommand?.({
        type: "attackTarget",
        fleetId,
        targetKind: "fleet",
        targetId: hostileFleet.id,
      });
      return;
    }
    const hostileStarbase = this.starbases.find((candidate) => (
      candidate.starId === fleet.currentStarId
      && candidate.ownerId !== fleet.ownerId
      && this.warFactionIds.has(candidate.ownerId)
    ));
    if (hostileStarbase) {
      this.options.onFleetCommand?.({
        type: "attackTarget",
        fleetId,
        targetKind: "starbase",
        targetId: hostileStarbase.id,
      });
    }
  }

  private openBuildPicker(onSelectStarbase: () => void): void {
    ensureActionMenuStyles();
    this.closeActionMenu();
    this.closeBuildPicker();

    const panel = document.createElement("div");
    panel.className = "spaceBuildPicker";
    panel.style.left = "18px";
    panel.style.bottom = "278px";

    const title = document.createElement("div");
    title.className = "spaceBuildPickerTitle";
    title.textContent = "Build";
    panel.appendChild(title);

    const starbaseButton = document.createElement("button");
    starbaseButton.type = "button";
    starbaseButton.className = "spaceBuildPickerBtn";
    starbaseButton.textContent = "Starbase";
    starbaseButton.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.closeBuildPicker();
      onSelectStarbase();
    });
    panel.appendChild(starbaseButton);

    panel.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    panel.addEventListener("click", (ev) => ev.stopPropagation());
    document.body.appendChild(panel);
    this.buildPickerElement = panel;
  }

  private closeBuildPicker(): void {
    this.buildPickerElement?.remove();
    this.buildPickerElement = null;
  }

  private clearShipAction(): void {
    this.closeBuildPicker();
    this.activeShipAction = null;
    this.targetableStarIds.clear();
    this.starField.setHighlightedStarIds([]);
    this.selectionPanel?.setActiveShipAction(null);
  }

  private tryIssueActiveShipActionAtPointer(): boolean {
    if (!this.activeShipAction) return false;

    const nearestStar = this.findNearestStarAtPointer();
    if (!nearestStar) return true;
    if (!this.targetableStarIds.has(nearestStar.id)) return true;

    const action = this.activeShipAction;
    const shipId = this.selectedCommandShipId ?? undefined;
    this.clearShipAction();
    this.options.onShipCommand?.(action, nearestStar.id, shipId);
    return true;
  }

  private openShipActionMenuAtPointer(ev: PointerEvent): void {
    const star = this.findNearestStarAtPointer();
    if (!star || !this.selectedShip) {
      this.closeActionMenu();
      return;
    }

    const commandFleet = this.getSelectedCommandFleet();
    const fleetId = this.selectedCommandShipId ?? undefined;
    const issue = (action: ShipAction): ContextMenuItem["onSelect"] => () => {
      this.options.onShipCommand?.(action, star.id, fleetId);
    };
    const reachable = (action: ShipAction): boolean => this.getReachableStarIds(action).has(star.id);

    const items: ContextMenuItem[] = [
      { label: "Move", disabled: !reachable("move"), onSelect: issue("move") },
    ];
    if (this.hasHostilePresenceAtStar(star.id)) {
      items.push({ label: "Attack", disabled: !reachable("attack"), onSelect: issue("attack") });
    }
    if (this.fleetCanBuildStarbase(commandFleet)) {
      items.push({ label: "Build Starbase", disabled: !reachable("build"), onSelect: issue("build") });
    }
    if (this.fleetCanColonize(commandFleet) && commandFleet?.currentStarId === star.id) {
      // Colonize enters the system and arms the colonize action there.
      items.push({ label: "Colonize", onSelect: () => this.beginShipAction("colonize") });
    }
    items.push({ label: "Retreat To", disabled: !reachable("retreatTo"), onSelect: issue("retreatTo") });
    items.push({ label: "Emergency Retreat", disabled: !reachable("emergencyRetreatTo"), onSelect: issue("emergencyRetreatTo") });

    this.contextMenu.open({ x: ev.clientX, y: ev.clientY, title: star.name, items });
  }

  private closeActionMenu(): void {
    this.contextMenu.close();
  }

  private findNearestStarAtPointer(): StarData | null {
    const pick = this.scene.pick(
      this.scene.pointerX,
      this.scene.pointerY,
      (mesh) => mesh === this.clickPlane,
      false,
      this.cam.camera,
    );

    if (!pick?.hit || !pick.pickedPoint) return null;

    const clickX = pick.pickedPoint.x;
    const clickZ = pick.pickedPoint.z;
    const pickRadius = clamp(
      this.cam.radius * STAR_PICK_RADIUS_CAMERA_FACTOR,
      STAR_PICK_RADIUS_MIN,
      STAR_PICK_RADIUS_MAX,
    );
    const pickRadiusSq = pickRadius * pickRadius;

    let nearestStar: StarData | null = null;
    let nearestDistSq = Infinity;

    for (const star of this.stars) {
      const dx = clickX - star.x;
      const dz = clickZ - star.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < nearestDistSq) {
        nearestDistSq = dSq;
        nearestStar = star;
      }
    }

    if (!nearestStar || nearestDistSq > pickRadiusSq) return null;
    return nearestStar;
  }

  private updateHoveredStarFromPointer(): void {
    const hovered = this.findNearestStarAtPointer();
    this.hoveredStarId = hovered ? hovered.id : -1;
  }

  private tryEnterSystemAtPointer(): boolean {
    const nearestStar = this.findNearestStarAtPointer();
    if (!nearestStar) return false;
    this.requestEnterSystem(nearestStar);
    return true;
  }

  private updateSelectedFleetIds(fleetId: string | null, shiftKey: boolean): void {
    if (!shiftKey) this.selectedFleetIds.clear();
    if (fleetId) this.selectedFleetIds.add(fleetId);
    this.options.onSelectedFleetIdsChange?.(Array.from(this.selectedFleetIds));
  }

  private clearFleetSelection(clearPanel = true): void {
    this.selectedFleetIds.clear();
    this.shipIconCycleKey = null;
    this.shipIconCycleIndex = 0;
    this.selectedShip = false;
    this.selectedCommandShipStarId = -1;
    this.selectedCommandShipId = null;
    this.clearShipAction();
    if (clearPanel) this.selectionPanel?.clear();
    this.options.onSelectedFleetIdsChange?.([]);
  }

  private renderSelectedFleetPanels(): void {
    if (!this.selectionPanel || this.selectedFleetIds.size === 0) return;
    this.selectionPanel.clear();
    let append = false;
    for (const fleetId of this.selectedFleetIds) {
      const fleet = this.serverFleets.find((candidate) => candidate.id === fleetId);
      if (!fleet) continue;
      this.selectionPanel.select(this.createFleetSelectionData(fleet), append);
      append = true;
      if (!this.selectedCommandShipId) {
        this.selectedShip = true;
        this.selectedCommandShipStarId = fleet.currentStarId;
        this.selectedCommandShipId = fleet.id;
      }
    }
    if (!append) {
      this.clearFleetSelection(false);
    }
  }

  private createFleetSelectionData(fleet: ServerFleet): SelectionData {
    const owner = this.factions.find((faction) => faction.id === fleet.ownerId) ?? null;
    const canCommand = this.isOwnShipOwner(owner?.id ?? null);
    const fleetShips = this.getShipsForFleet(fleet.id);
    const fleetSize = fleet.shipIds.length || fleetShips.length || 1;
    const defense = this.getFleetDefense(fleet.id);
    const engaged = fleet.combatStatus === "engaging" || fleet.combatStatus === "firing" || fleet.combatStatus === "retreating";
    const actions = this.getFleetActions(fleet);
    return {
      type: "fleet",
      id: fleet.id,
      readoutId: this.formatFleetReadoutId(fleet),
      name: owner ? `${owner.name} Fleet` : "Unidentified Fleet",
      hp: defense.hull,
      maxHp: defense.maxHull,
      shield: defense.shield,
      maxShield: defense.maxShield,
      armor: defense.armor,
      maxArmor: defense.maxArmor,
      hull: defense.hull,
      maxHull: defense.maxHull,
      shipCount: fleetSize,
      ships: this.createSelectionShipRows(fleet, owner),
      class: fleetSize === 1 ? "Single-Ship Fleet" : `${fleetSize} Ships`,
      status: engaged ? fleet.combatStatus : this.formatSelectionFleetStatus(fleet),
      detail: canCommand
        ? this.formatFleetNavigationDetail(fleet)
        : "Foreign fleet. Command controls unavailable.",
      movement: this.createFleetMovementSelectionData(fleet),
      ownerName: owner?.name ?? "Unknown",
      ownerColor: owner?.color,
      canCommand,
      actions: canCommand ? actions : undefined,
      combatStance: fleet.combatStance,
      combatBehavior: fleet.combatSettings.behavior,
      chasePolicy: fleet.combatSettings.chasePolicy,
      retreatPolicy: fleet.combatSettings.retreatPolicy,
      leader: this.getAssignedLeader("fleet", fleet.id),
    };
  }

  private createFleetMovementSelectionData(fleet: ServerFleet | null): SelectionData["movement"] {
    if (!fleet?.movementPlan) return undefined;
    const destination = fleet.movementPlan.destinationPlanetId
      ? this.findPlanetName(fleet.movementPlan.destinationPlanetId)
      : (fleet.movementPlan.destinationOrbitTarget
        ? this.formatOrbitTargetName(fleet.movementPlan.destinationOrbitTarget)
        : this.getStarName(fleet.movementPlan.destinationStarId));
    return {
      destination,
      arrivalYear: fleet.movementPlan.endsAtYear,
    };
  }

  private createSelectionShipRows(fleet: ServerFleet, owner: FactionInfo | null): SelectionShipData[] {
    const order = new Map(fleet.shipIds.map((shipId, index) => [shipId, index]));
    return this.getShipsForFleet(fleet.id)
      .slice()
      .sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER))
      .map((ship, index) => {
        const hull = SHIP_HULL_DEFINITIONS[ship.shipKind];
        const design = ship.designId
          ? this.shipDesigns.find((candidate) => candidate.id === ship.designId && candidate.ownerId === ship.ownerId)
          : undefined;
        const shipCode = `${this.formatFactionShipPrefix(owner, ship.ownerId)}S-${String(index + 1).padStart(2, "0")}`;
        return {
          id: ship.id,
          shipKind: ship.shipKind,
          name: `${shipCode} ${this.formatShipDisplayName(design, hull?.baseClassName ?? hull?.label ?? ship.shipKind)}`,
          designName: design?.name ?? `${hull?.baseClassName ?? hull?.label ?? ship.shipKind}-class`,
          className: hull?.label ?? this.formatPolicyLikeValue(ship.shipKind),
          shield: ship.shield,
          maxShield: ship.maxShield,
          armor: ship.armor,
          maxArmor: ship.maxArmor,
          hull: ship.hull,
          maxHull: ship.maxHull,
          ownerColor: owner?.color,
        };
      });
  }

  private formatFleetReadoutId(fleet: ServerFleet): string {
    return `CF-${String(fleet.ownerId + 1).padStart(3, "0")}`;
  }

  private formatFactionShipPrefix(owner: FactionInfo | null, ownerId: number): string {
    const colorMatch = owner?.name.match(/^Color\s+(\d+)$/i);
    if (colorMatch) return `C${colorMatch[1]}`;
    if (owner?.name) {
      const initials = owner.name
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .replace(/[^a-z0-9]/gi, "")
        .slice(0, 2)
        .toUpperCase();
      if (initials) return initials;
    }
    return `F${ownerId + 1}`;
  }

  private formatShipDisplayName(design: ShipDesign | undefined, fallback: string): string {
    const raw = design?.name ?? fallback;
    const withoutClass = raw
      .replace(/-class\s+.*/i, "")
      .replace(/\s+class\s+.*/i, "")
      .trim();
    return withoutClass || raw;
  }

  private formatSelectionFleetStatus(fleet: ServerFleet): string {
    if (fleet.retreatState) return fleet.retreatState.status;
    switch (fleet.phase) {
      case "departingSystem":
        return "departing";
      case "arrivingSystem":
        return "arriving";
      case "buildingStarbase":
        return "building";
      case "jumpingHyperlane":
        return "in transit";
      case "movingSystem":
        return fleet.orderType === "merge" ? "merging" : "maneuvering";
      case "orbiting":
      case "orbitingPlanet":
        return "orbiting";
      case "idle":
      default:
        return fleet.orbitTarget || fleet.orbitTargetPlanetId ? "orbiting" : "operational";
    }
  }

  private formatPolicyLikeValue(value: string): string {
    return value
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (char) => char.toUpperCase());
  }

  private requestEnterSystem(star: StarData): void {
    if (this.isNavigating) return;
    this.isNavigating = true;
    Promise.resolve(this.onEnterSystem(star))
      .catch((err) => console.error("Failed to open system view", err))
      .finally(() => {
        this.isNavigating = false;
      });
  }

  private handleIconClick(type: GalaxyIconClickType, shiftKey: boolean, starId?: number): void {
    if (type === "ship") {
      const shipStarId = starId ?? this.playerShipStarId;
      this.selectFleetFromIcon(this.getFleetForStarId(shipStarId), shipStarId, shiftKey);
      return;
    }

    if (type === "starbase") {
      if (!shiftKey) {
        this.clearFleetSelection(false);
      }
      if (starId !== undefined) {
        this.openStarbasePanelForStar(starId);
      }
      return;
    }

    if (type === "habitedPlanet" && starId !== undefined) {
      if (!shiftKey) this.clearFleetSelection();
      if (this.options.onOpenHabitedPlanet) {
        void Promise.resolve(this.options.onOpenHabitedPlanet(starId))
          .catch((error) => console.error("Failed to open habited planet details", error));
        return;
      }
      this.showFirstHabitedPlanet(starId);
    }
  }

  /**
   * Resolve a ship-icon click to a concrete fleet, cycling through every fleet
   * sharing a system on repeated clicks of the same icon.
   */
  private handleShipIconClick(fleetIds: string[], shiftKey: boolean): void {
    const available = fleetIds.filter((id) => this.serverFleets.some((fleet) => fleet.id === id));
    if (available.length === 0) {
      // Fallback for the synthetic player ship (observer / no server fleets).
      this.handleIconClick("ship", shiftKey, this.playerShipStarId);
      return;
    }

    const key = available.join(",");
    if (key === this.shipIconCycleKey && !shiftKey) {
      this.shipIconCycleIndex = (this.shipIconCycleIndex + 1) % available.length;
    } else {
      this.shipIconCycleKey = key;
      this.shipIconCycleIndex = 0;
    }

    const fleet = this.serverFleets.find((candidate) => candidate.id === available[this.shipIconCycleIndex]) ?? null;
    this.selectFleetFromIcon(fleet, fleet?.currentStarId ?? this.playerShipStarId, shiftKey);
  }

  private selectFleetFromIcon(serverFleet: ServerFleet | null, shipStarId: number, shiftKey: boolean): void {
    const owner = serverFleet
      ? this.factions.find((faction) => faction.id === serverFleet.ownerId) ?? null
      : this.getShipOwnerForStarId(shipStarId);
    const ownerId = owner?.id ?? null;
    const canCommand = this.isOwnShipOwner(ownerId);
    const fleetShips = this.getShipsForFleet(serverFleet?.id ?? null);
    const fleetSize = serverFleet?.shipIds.length ?? (fleetShips.length || 1);
    const defense = this.getFleetDefense(serverFleet?.id ?? null);
    const engaged = serverFleet?.combatStatus === "engaging"
      || serverFleet?.combatStatus === "firing"
      || serverFleet?.combatStatus === "retreating";
    const actions = this.getFleetActions(serverFleet);

    if (canCommand) {
      this.selectedShip = true;
      this.selectedCommandShipStarId = shipStarId;
      this.selectedCommandShipId = serverFleet?.id ?? null;
      this.updateSelectedFleetIds(serverFleet?.id ?? null, shiftKey);
    } else if (!shiftKey) {
      this.selectedShip = false;
      this.selectedCommandShipStarId = -1;
      this.selectedCommandShipId = null;
      this.clearShipAction();
      this.updateSelectedFleetIds(null, false);
    }

    this.selectionPanel.select(
      {
        type: "fleet",
        id: serverFleet?.id ?? String(shipStarId),
        readoutId: serverFleet ? this.formatFleetReadoutId(serverFleet) : `SYS-${String(shipStarId).padStart(3, "0")}`,
        name: owner ? `${owner.name} Fleet` : "Unidentified Fleet",
        hp: defense.hull,
        maxHp: defense.maxHull,
        shield: defense.shield,
        maxShield: defense.maxShield,
        armor: defense.armor,
        maxArmor: defense.maxArmor,
        hull: defense.hull,
        maxHull: defense.maxHull,
        shipCount: fleetSize,
        ships: serverFleet ? this.createSelectionShipRows(serverFleet, owner) : [],
        class: fleetSize === 1 ? "Single-Ship Fleet" : `${fleetSize} Ships`,
        status: engaged
          ? serverFleet?.combatStatus ?? "engaged"
          : serverFleet
            ? this.formatSelectionFleetStatus(serverFleet)
            : this.playerShipTransit && shipStarId === this.playerShipStarId ? "Moving" : "Operational",
        detail: canCommand
          ? this.formatFleetNavigationDetail(serverFleet)
          : "Foreign fleet. Command controls unavailable.",
        movement: this.createFleetMovementSelectionData(serverFleet),
        ownerName: owner?.name ?? "Unknown",
        ownerColor: owner?.color,
        canCommand,
        actions: canCommand ? actions : undefined,
        combatStance: serverFleet?.combatStance,
        combatBehavior: serverFleet?.combatSettings.behavior,
        chasePolicy: serverFleet?.combatSettings.chasePolicy,
        retreatPolicy: serverFleet?.combatSettings.retreatPolicy,
        leader: serverFleet ? this.getAssignedLeader("fleet", serverFleet.id) : null,
      },
      shiftKey,
    );
  }

  /**
   * Build the galaxy ship icons for this frame from the authoritative server
   * fleets. Fleets sharing a system collapse into one (cyclable) icon; fleets in
   * a hyperlane get their own icon nudged clear of both endpoints.
   */
  private buildGalaxyShipIcons(): GalaxyShipIcon[] {
    const icons: GalaxyShipIcon[] = [];
    const year = this.getClockYearEstimate();
    const stationaryByStar = new Map<number, ServerFleet[]>();

    for (const fleet of this.serverFleets) {
      const transit = this.getFleetGalaxyTransit(fleet, year);
      if (transit) {
        const from = this.stars[transit.fromStarId];
        const to = this.stars[transit.toStarId];
        if (!from || !to) continue;
        if (!this.isStarKnownToPerspective(transit.fromStarId)
          && !this.isStarKnownToPerspective(transit.toStarId)) continue;

        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const length = Math.hypot(dx, dz) || 1;
        // Keep the icon away from both systems so it never overlaps a parked ship.
        const clearanceFraction = Math.min(0.45, SHIP_ICON_TRANSIT_MIN_CLEARANCE / length);
        const t = Math.min(Math.max(transit.progress, clearanceFraction), 1 - clearanceFraction);
        icons.push({
          fleetIds: [fleet.id],
          x: from.x + dx * t,
          z: from.z + dz * t,
          color: this.getFleetIconColor(fleet),
          moving: true,
          selected: this.selectedFleetIds.has(fleet.id),
        });
        continue;
      }

      const starId = fleet.currentStarId;
      if (starId < 0 || !this.isStarKnownToPerspective(starId)) continue;
      const list = stationaryByStar.get(starId);
      if (list) list.push(fleet);
      else stationaryByStar.set(starId, [fleet]);
    }

    for (const [starId, fleets] of stationaryByStar) {
      const star = this.stars[starId];
      if (!star) continue;
      fleets.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const colorFleet = fleets.find((fleet) => fleet.ownerId === this.playerFactionId) ?? fleets[0];
      icons.push({
        fleetIds: fleets.map((fleet) => fleet.id),
        x: star.x + SHIP_ICON_OFFSET_X,
        z: star.z + SHIP_ICON_OFFSET_Z,
        color: this.getFleetIconColor(colorFleet),
        moving: false,
        selected: fleets.some((fleet) => this.selectedFleetIds.has(fleet.id)),
      });
    }

    // Fallback: synthetic player ship when the snapshot has no server fleets.
    if (this.serverFleets.length === 0
      && this.playerShipStarId >= 0
      && this.isStarKnownToPerspective(this.playerShipStarId)) {
      const star = this.stars[this.playerShipStarId];
      if (star) {
        const owner = this.factions[this.playerFactionId] ?? this.factions[0] ?? null;
        icons.push({
          fleetIds: [],
          x: star.x + SHIP_ICON_OFFSET_X,
          z: star.z + SHIP_ICON_OFFSET_Z,
          color: owner?.color ?? [1, 1, 1],
          moving: false,
        });
      }
    }

    return icons;
  }

  private getFleetIconColor(fleet: ServerFleet): [number, number, number] {
    const owner = this.factions.find((faction) => faction.id === fleet.ownerId);
    return owner?.color ?? [1, 1, 1];
  }

  /** Active hyperlane transit for a fleet at `year`, or null if it is in-system. */
  private getFleetGalaxyTransit(
    fleet: ServerFleet,
    year: number,
  ): { fromStarId: number; toStarId: number; progress: number } | null {
    if (fleet.movementPlan) {
      const segment = fleet.movementPlan.segments.find((candidate) => (
        candidate.kind === "hyperlane"
        && year >= candidate.startYear
        && year < candidate.endYear
      ));
      if (segment) {
        return {
          fromStarId: segment.fromStarId,
          toStarId: segment.toStarId,
          progress: clamp((year - segment.startYear) / Math.max(0.000001, segment.endYear - segment.startYear), 0, 1),
        };
      }
    }
    if (fleet.hyperlanePosition) return fleet.hyperlanePosition;
    if (fleet.phase === "jumpingHyperlane") {
      const fromStarId = fleet.route[fleet.routeIndex];
      const toStarId = fleet.route[fleet.routeIndex + 1];
      if (fromStarId !== undefined && toStarId !== undefined) {
        const elapsedDays = (year - fleet.phaseStartedAtYear) * GAME_DAYS_PER_YEAR;
        const progress = fleet.phaseDurationDays > 0 ? clamp(elapsedDays / fleet.phaseDurationDays, 0, 1) : 0;
        return { fromStarId, toStarId, progress };
      }
    }
    return null;
  }

  /**
   * Redraw the orange route lines for selected player fleets. The route follows
   * the fleet's remaining hyperlane hops from system to system. Rebuilt only when
   * the waypoint set changes to avoid per-frame mesh churn.
   */
  private updateFleetRouteLines(): void {
    const routes: Vector3[][] = [];
    // Only the primary (command) fleet draws a route line, to avoid clutter when
    // several fleets are selected at once.
    const primaryFleetId = this.selectedCommandShipId;
    if (primaryFleetId) {
      const fleet = this.serverFleets.find((candidate) => candidate.id === primaryFleetId);
      if (fleet && fleet.ownerId === this.playerFactionId) {
        const points = this.getFleetRouteStarIds(fleet)
          .map((starId) => this.stars[starId])
          .filter((star): star is StarData => !!star)
          .map((star) => new Vector3(star.x, FLEET_ROUTE_LINE_Y, star.z));
        if (points.length >= 2) routes.push(points);
      }
    }

    const signature = routes
      .map((points) => points.map((point) => `${point.x.toFixed(1)},${point.z.toFixed(1)}`).join("|"))
      .join(";");
    if (signature === this.fleetRouteSignature) return;
    this.fleetRouteSignature = signature;

    this.disposeFleetRouteLines();
    for (let i = 0; i < routes.length; i++) {
      const line = MeshBuilder.CreateLines(`galaxyFleetRoute_${i}`, { points: routes[i] }, this.scene);
      line.color = FLEET_ROUTE_LINE_COLOR;
      line.alpha = 0.92;
      line.isPickable = false;
      line.renderingGroupId = FOREGROUND_RENDERING_GROUP;
      this.fleetRouteLines.push(line);
    }
  }

  private getFleetRouteStarIds(fleet: ServerFleet): number[] {
    const year = this.getClockYearEstimate();
    if (fleet.movementPlan) {
      const hops = fleet.movementPlan.segments.filter((segment) => (
        segment.kind === "hyperlane" && segment.endYear > year
      ));
      if (hops.length === 0) return [];
      const ids: number[] = [hops[0].fromStarId];
      for (const hop of hops) ids.push(hop.toStarId);
      return ids;
    }
    if (fleet.route.length > 1 && fleet.routeIndex < fleet.route.length - 1) {
      return fleet.route.slice(fleet.routeIndex);
    }
    return [];
  }

  private disposeFleetRouteLines(): void {
    for (const line of this.fleetRouteLines) line.dispose();
    this.fleetRouteLines = [];
  }

  private showFirstHabitedPlanet(starId: number): void {
    this.clearFleetSelection();
    const star = this.stars[starId];
    const planet = star?.system.planets.find((candidate) => candidate.isHabited === true);
    if (!star || !planet) return;
    const planetState = this.getPlanetState(planet.id);
    this.objectPanel.show({
      kind: "planet",
      objectId: planet.id,
      name: planet.name,
      subtitle: `${star.name} System`,
      isHabited: planet.isHabited === true,
      objectDetails: planet.objectDetails,
      planetState,
      imageUrl: this.getPlanetTextureUrl(planet),
      accentColor: "rgba(102, 236, 199, 0.95)",
      technology: this.options.technology,
      assignedLeader: this.getAssignedLeader("planet", planet.id),
      canManageLeaders: this.starOwnership[star.id] === this.playerFactionId,
      onPlanetCommand: (command) => this.options.onPlanetCommand?.(command),
      onClose: (objectId, kind) => {
        if (kind === "planet") this.options.onReleasePlanetDetails?.(objectId);
      },
    });
  }

  private openStarbasePanelForStar(starId: number): void {
    this.clearFleetSelection();
    const star = this.stars[starId];
    if (!star) return;
    const starbase = this.starbases.find((candidate) => candidate.starId === starId);
    const ownerId = starbase?.ownerId ?? this.starOwnership[starId] ?? -1;
    const owner = this.factions.find((faction) => faction.id === ownerId) ?? null;

    this.starbasePanel.show({
      id: starbase?.id ?? `starbase-${starId}`,
      name: `${star.name} Station`,
      systemName: `${star.name} System`,
      ownerName: owner?.name,
      ownerColor: owner?.color,
      status: starbase?.status ?? "online",
      power: this.formatStarbasePower(starbase),
      technology: this.options.technology,
      nebulaKind: findNebulaForStar(this.nebulae, starId)?.kind ?? null,
      onStarbaseCommand: (command) => this.options.onPlanetCommand?.(command),
      onClose: (starbaseId) => this.options.onReleaseStarbaseDetails?.(starbaseId),
    });
    if (starbase) {
      void this.options.onRequestStarbaseDetails?.(starbase.id).then((detail) => {
        if (detail) this.starbasePanel.refreshStarbase(detail);
      });
    }
  }

  private formatStarbasePower(starbase?: ServerStarbaseSummary): string {
    if (!starbase) return "0K";
    const power = computeStarbasePower(starbase);
    return power >= 1_000_000 ? `${(power / 1_000_000).toFixed(1)}M` : `${Math.round(power / 1000)}K`;
  }

  private getPlanetState(planetId: string): PlanetState | undefined {
    return this.planetStates.find((planetState) => planetState.id === planetId);
  }

  private formatFleetNavigationDetail(fleet: ServerFleet | null): string {
    if (!fleet?.movementPlan) return "Select a command, then choose a highlighted system.";
    const destination = this.createFleetMovementSelectionData(fleet)?.destination ?? this.getStarName(fleet.movementPlan.destinationStarId);
    const remainingDays = Math.max(0, (fleet.movementPlan.endsAtYear - this.getClockYearEstimate()) * GAME_DAYS_PER_YEAR);
    const remainingMinutes = remainingDays * REAL_MS_PER_GAME_DAY / 60_000;
    return `Destination: ${destination}. Time remaining: ${remainingDays.toFixed(1)} days (${remainingMinutes.toFixed(1)} minutes).`;
  }

  private getClockYearEstimate(): number {
    return this.clockYear;
  }

  private findPlanetName(planetId: string): string {
    for (const star of this.stars) {
      const planet = star.system.planets.find((candidate) => candidate.id === planetId);
      if (planet) return planet.name;
    }
    return planetId;
  }

  private getStarName(starId: number): string {
    return this.stars[starId]?.name ?? `Star ${starId}`;
  }

  private formatOrbitTargetName(target: NonNullable<ServerFleet["orbitTarget"]>): string {
    if (target.kind === "planet" && target.planetId) return this.findPlanetName(target.planetId);
    if (target.kind === "star") return this.getStarName(target.starId);
    if (target.kind === "starbase") return `${this.getStarName(target.starId)} Starbase`;
    if (target.kind === "hyperlane") {
      return target.connectedStarId !== null && target.connectedStarId !== undefined
        ? `${this.getStarName(target.starId)} Hyperlane to ${this.getStarName(target.connectedStarId)}`
        : `${this.getStarName(target.starId)} Hyperlane`;
    }
    if (target.kind === "fleet") return "Fleet rendezvous";
    return this.getStarName(target.starId);
  }

  private getPlanetTextureUrl(planet: PlanetConfig): string {
    const cfg = PLANET_TYPES[planet.type];
    const variation = String(planet.textureVariation + 1).padStart(2, "0");
    return `${cfg.texturePrefix}_${variation}-1024x512.webp`;
  }

  getStars(): StarData[] {
    return this.stars;
  }

  getConnectedStars(starId: number): StarData[] {
    if (starId < 0 || starId >= this.hyperlaneAdjacency.length) return [];
    const neighborIds = this.hyperlaneAdjacency[starId] ?? [];
    const out: StarData[] = [];
    for (const neighborId of neighborIds) {
      if (!this.isStarKnownToPerspective(neighborId)) continue;
      const star = this.stars[neighborId];
      if (star) out.push(star);
    }
    return out;
  }

  setHyperlanesVisible(visible: boolean): void {
    this.hyperlanesVisible = visible;
    if (this.hyperlaneMesh) {
      this.hyperlaneMesh.visibility = visible
        ? HYPERLANE_BASE_VISIBILITY + HYPERLANE_ZOOM_VISIBILITY_BOOST
        : 0;
    }
  }

  setCenterCloudVisible(visible: boolean): void {
    this.centerCloudVisible = visible;
    for (const mesh of this.galacticCoreMeshes) {
      mesh.setEnabled(visible);
    }
  }

  setStarsVisible(visible: boolean): void {
    this.starsVisible = visible;
  }

  setBloomEnabled(enabled: boolean): void {
    this.bloomEnabled = enabled;
  }

  setOwnershipVisible(visible: boolean): void {
    this.ownershipVisible = visible;
    this.ownershipOverlayMesh?.setEnabled(visible);
  }

  setVisibleStarIds(starIds: Iterable<number> | null): void {
    const previousVisibleStarIds = this.visibleStarIds ? new Set(this.visibleStarIds) : null;
    this.explicitVisibleStarIds = starIds ? new Set(starIds) : null;
    this.updateVisibilityFromPerspective();
    const visibilityChanged = !this.areVisibleStarSetsEqual(previousVisibleStarIds, this.visibleStarIds);
    if (!visibilityChanged) return;

    this.starField?.setVisibleStarIds(this.visibleStarIds);
    this.starField?.setKnownStarIds(this.knownStarIds);
    this.ownershipRenderer?.updateOwnership(this.applyVisibilityToOwnership(this.starOwnership));
    this.rebuildHyperlaneMesh(GALAXY_MAP.width, GALAXY_MAP.height);
    if (this.activeShipAction) {
      this.targetableStarIds = this.getReachableStarIds(this.activeShipAction);
      this.starField?.setHighlightedStarIds(this.targetableStarIds);
    }
  }

  setKnownStarIds(starIds: Iterable<number> | null): void {
    const previousKnownStarIds = this.knownStarIds ? new Set(this.knownStarIds) : null;
    this.explicitKnownStarIds = starIds ? new Set(starIds) : null;
    this.updateVisibilityFromPerspective();
    const knownChanged = !this.areVisibleStarSetsEqual(previousKnownStarIds, this.knownStarIds);
    if (!knownChanged) return;

    this.starField?.setKnownStarIds(this.knownStarIds);
    this.ownershipRenderer?.updateOwnership(this.applyVisibilityToOwnership(this.starOwnership));
    this.rebuildHyperlaneMesh(GALAXY_MAP.width, GALAXY_MAP.height);
    if (this.activeShipAction) {
      this.targetableStarIds = this.getReachableStarIds(this.activeShipAction);
      this.starField?.setHighlightedStarIds(this.targetableStarIds);
    }
  }

  setPlayerShipState(starId: number, transit: GalaxyShipTransit | null): void {
    this.playerShipStarId = starId;
    if (starId >= 0) {
      this.playerShipSystemIds.add(starId);
    }
    this.playerShipTransit = transit;
    this.starField?.setPlayerShipSystemIds(this.playerShipSystemIds);
    this.starField?.setShipIconStyles(this.getShipIconStyles());
    this.starField?.setPlayerShipState(starId, transit);
  }

  setServerShips(ships: ServerShip[]): void {
    this.serverShips = ships;
    this.starField?.setShipIconStyles(this.getShipIconStyles());
    if (this.selectedFleetIds.size > 0) this.renderSelectedFleetPanels();
  }

  setShipDesigns(shipDesigns: ShipDesign[]): void {
    this.shipDesigns = shipDesigns;
    if (this.selectedFleetIds.size > 0) this.renderSelectedFleetPanels();
  }

  setFactions(factions: FactionInfo[]): void {
    this.factions = factions;
    this.refreshEmpireRelationshipVisuals();
    if (this.selectedFleetIds.size > 0) this.renderSelectedFleetPanels();
  }

  setServerFleets(fleets: ServerFleet[]): void {
    this.serverFleets = fleets;
    this.playerShipSystemIds = new Set(
      fleets
        .map((fleet) => fleet.currentStarId)
        .filter((starId) => starId >= 0),
    );
    if (this.playerShipStarId >= 0) {
      this.playerShipSystemIds.add(this.playerShipStarId);
    }
    if (this.selectedCommandShipId && !fleets.some((fleet) => fleet.id === this.selectedCommandShipId)) {
      this.selectedShip = false;
      this.selectedCommandShipStarId = -1;
      this.selectedCommandShipId = null;
      this.clearShipAction();
    }
    let selectionChanged = false;
    for (const fleetId of Array.from(this.selectedFleetIds)) {
      if (!fleets.some((fleet) => fleet.id === fleetId)) {
        this.selectedFleetIds.delete(fleetId);
        selectionChanged = true;
      }
    }
    if (selectionChanged) {
      this.options.onSelectedFleetIdsChange?.(Array.from(this.selectedFleetIds));
    }
    if (this.selectedFleetIds.size > 0) {
      this.renderSelectedFleetPanels();
    } else if (selectionChanged) {
      this.selectionPanel?.clear();
    }
    this.starField?.setPlayerShipSystemIds(this.playerShipSystemIds);
    this.starField?.setShipIconStyles(this.getShipIconStyles());
    if (this.activeShipAction) {
      this.targetableStarIds = this.getReachableStarIds(this.activeShipAction);
      this.starField?.setHighlightedStarIds(this.targetableStarIds);
    }
  }

  setClockYear(year: number): void {
    this.clockYear = year;
    this.selectionPanel?.setClockYear(year);
    this.objectPanel?.setClockYear(year);
  }

  selectFleetById(fleetId: string): boolean {
    const fleet = this.serverFleets.find((candidate) => candidate.id === fleetId);
    if (!fleet) return false;
    this.selectedFleetIds = new Set([fleetId]);
    this.selectedShip = true;
    this.selectedCommandShipStarId = fleet.currentStarId;
    this.selectedCommandShipId = fleet.id;
    this.options.onSelectedFleetIdsChange?.([fleetId]);
    this.renderSelectedFleetPanels();
    return true;
  }

  startFleetAction(fleetId: string, action: ShipAction): void {
    const fleet = this.serverFleets.find((candidate) => candidate.id === fleetId);
    if (!fleet) return;
    this.selectedFleetIds = new Set([fleetId]);
    this.selectedShip = true;
    this.selectedCommandShipStarId = fleet.currentStarId;
    this.selectedCommandShipId = fleet.id;
    this.options.onSelectedFleetIdsChange?.([fleetId]);
    this.renderSelectedFleetPanels();
    this.beginShipAction(action);
  }

  setPlanetStates(planetStates: PlanetState[]): void {
    this.planetStates = planetStates;
    applyPlanetStatesToStars(this.stars, planetStates);
    for (const planetState of planetStates) {
      const planet = this.stars[planetState.starId]?.system.planets[planetState.planetIndex];
      if (planet) {
        this.objectPanel?.refreshPlanetState(planet.id, planetState, planet.objectDetails, planet.isHabited === true);
      }
    }
    if (!this.hasExplicitHabitedPlanetSystemIds) {
      const habitedSystemIds = this.stars
        .filter((star) => star.system.planets.some((planet) => planet.isHabited === true))
        .map((star) => star.id);
      this.starField?.setHabitedPlanetSystemIds(habitedSystemIds);
    }
  }

  setHabitedPlanetSystemIds(starIds: Iterable<number>): void {
    this.hasExplicitHabitedPlanetSystemIds = true;
    this.starField?.setHabitedPlanetSystemIds(starIds);
  }

  setTechnology(technology: FactionTechnologyView | null): void {
    this.options.technology = technology;
  }

  setLeaders(leaders: LeaderState[]): void {
    this.leaders = leaders;
    if (this.selectedFleetIds.size > 0) this.renderSelectedFleetPanels();
    const currentObjectId = this.objectPanel?.getCurrentObjectId();
    if (currentObjectId && this.objectPanel?.getCurrentKind() === "planet") {
      this.objectPanel.refreshAssignedLeader(
        currentObjectId,
        this.getAssignedLeader("planet", currentObjectId),
      );
    }
    if (this.objectPanel) {
      for (const planetState of this.planetStates) {
        const planet = this.stars[planetState.starId]?.system.planets[planetState.planetIndex];
        if (planet) {
          this.objectPanel.refreshAssignedLeader(
            planet.id,
            this.getAssignedLeader("planet", planet.id),
            this.starOwnership[planetState.starId] === this.playerFactionId,
          );
        }
      }
    }
  }

  private getAssignedLeader(kind: "planet" | "fleet", targetId: string): LeaderState | null {
    return this.leaders.find((leader) => (
      leader.status === "recruited"
      && leader.assignment?.kind === kind
      && leader.assignment.targetId === targetId
    )) ?? null;
  }

  showPlanetDetails(star: StarData, planet: PlanetConfig, planetState: PlanetState): void {
    this.objectPanel.show({
      kind: "planet",
      objectId: planet.id,
      name: planet.name,
      subtitle: `${star.name} System`,
      isHabited: planet.isHabited === true,
      objectDetails: planet.objectDetails,
      planetState,
      imageUrl: this.getPlanetTextureUrl(planet),
      accentColor: "rgba(102, 236, 199, 0.95)",
      technology: this.options.technology,
      assignedLeader: this.getAssignedLeader("planet", planet.id),
      canManageLeaders: this.starOwnership[star.id] === this.playerFactionId,
      onPlanetCommand: (command) => this.options.onPlanetCommand?.(command),
    });
  }

  refreshPlanetDetails(planet: PlanetConfig, planetState: PlanetState): void {
    const nextPlanetStates = this.planetStates.filter((candidate) => candidate.id !== planetState.id);
    nextPlanetStates.push(planetState);
    this.planetStates = nextPlanetStates;
    if (this.stars[planetState.starId]?.system.planets[planetState.planetIndex]) {
      this.stars[planetState.starId].system.planets[planetState.planetIndex] = planet;
    }
    applyPlanetStatesToStars(this.stars, this.planetStates);
    this.objectPanel?.refreshPlanetState(
      planet.id,
      planetState,
      planet.objectDetails,
      planet.isHabited === true,
    );
  }

  setStarbaseSystemIds(starIds: Iterable<number>): void {
    this.starbaseSystemIds = new Set(starIds);
    if (this.activeShipAction) {
      this.targetableStarIds = this.getReachableStarIds(this.activeShipAction);
      this.starField?.setHighlightedStarIds(this.targetableStarIds);
    }
  }

  setPromotedStarbaseSystemIds(starIds: Iterable<number>): void {
    this.promotedStarbaseSystemIds = new Set(starIds);
    this.starField?.setStarbaseSystemIds(this.promotedStarbaseSystemIds);
  }

  setServerStarbases(starbases: ServerStarbaseSummary[]): void {
    this.starbases = starbases;
    this.setPromotedStarbaseSystemIds(this.getPromotedStarbaseSystemIds());
    if (this.activeShipAction) {
      this.targetableStarIds = this.getReachableStarIds(this.activeShipAction);
      this.starField?.setHighlightedStarIds(this.targetableStarIds);
    }
  }

  refreshStarbaseDetails(starbase: ServerStarbase): void {
    this.starbasePanel?.refreshStarbase(starbase);
  }

  private getPromotedStarbaseSystemIds(): number[] {
    return this.starbases
      .filter((starbase) => starbase.status === "online" && starbase.level !== "outpost")
      .map((starbase) => starbase.starId);
  }

  setStarOwnership(starId: number, owner: number): void {
    if (starId < 0 || starId >= this.starOwnership.length) return;
    this.starOwnership[starId] = owner;
    this.ownershipRenderer?.setStarOwner(
      starId,
      this.isStarKnownToPerspective(starId) ? owner : -1,
    );
    this.starField?.setSystemRelation(starId, this.getEmpireRelation(owner));
    if (this.activeShipAction) {
      this.targetableStarIds = this.getReachableStarIds(this.activeShipAction);
      this.starField?.setHighlightedStarIds(this.targetableStarIds);
    }
  }

  setStarOwnerships(ownerByStar: number[]): void {
    if (
      ownerByStar.length === this.starOwnership.length
      && ownerByStar.every((owner, index) => owner === this.starOwnership[index])
    ) {
      return;
    }

    this.starOwnership = ownerByStar.slice(0, this.stars.length);
    while (this.starOwnership.length < this.stars.length) {
      this.starOwnership.push(-1);
    }
    this.ownershipRenderer?.updateOwnership(this.applyVisibilityToOwnership(this.starOwnership));
    this.starField?.setSystemRelations(this.getSystemRelations());
    if (this.activeShipAction) {
      this.targetableStarIds = this.getReachableStarIds(this.activeShipAction);
      this.starField?.setHighlightedStarIds(this.targetableStarIds);
    }
  }

  setDiplomacyMovement(diplomacy: DiplomacyMovementPayload | undefined): void {
    this.applyDiplomacyMovement(diplomacy);
    this.refreshEmpireRelationshipVisuals();
    if (this.activeShipAction) {
      this.targetableStarIds = this.getReachableStarIds(this.activeShipAction);
      this.starField?.setHighlightedStarIds(this.targetableStarIds);
    }
  }

  private applyDiplomacyMovement(diplomacy: DiplomacyMovementPayload | undefined): void {
    this.openBorderFactionIds = new Set(diplomacy?.openBorderFactionIds ?? []);
    this.warFactionIds = new Set(diplomacy?.warFactionIds ?? []);
  }

  private getEmpireRelation(ownerFactionId: number): EmpireSystemRelation {
    return getEmpireSystemRelation(ownerFactionId, this.playerFactionId, this.warFactionIds);
  }

  private getSystemRelations(): EmpireSystemRelation[] {
    return this.stars.map((_star, starId) => (
      this.getEmpireRelation(this.starOwnership[starId] ?? -1)
    ));
  }

  private getRelationshipPalette(): Color3[] {
    return this.factions.map((faction) => {
      const color = getEmpireDisplayColor(faction.color, this.getEmpireRelation(faction.id));
      return new Color3(color[0], color[1], color[2]);
    });
  }

  private refreshEmpireRelationshipVisuals(): void {
    this.ownershipRenderer?.setPalette(this.getRelationshipPalette());
    this.starField?.setSystemRelations(this.getSystemRelations());
  }

  captureViewState(): GalaxyViewState | null {
    if (!this.cam) return null;

    const target = this.cam.target;
    return {
      alpha: this.cam.camera.alpha,
      beta: this.cam.camera.beta,
      radius: this.cam.radius,
      targetX: target.x,
      targetY: target.y,
      targetZ: target.z,
    };
  }

  dispose(): void {
    this.closeActionMenu();
    this.closeBuildPicker();
    if (this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
      this.pointerObserver = null;
    }
    this.canvas?.removeEventListener("contextmenu", this.onContextMenu);
    this.canvas?.removeEventListener("mouseleave", this.onCanvasPointerLeave);
    this.selectionPanel?.clear();
    this.objectPanel?.dispose();
    this.starbasePanel?.dispose();
    this.hyperlaneMesh?.dispose();
    this.hyperlaneMesh = null;
    if (this.ownershipOverlayMesh) {
      const ownershipMaterial = this.ownershipOverlayMesh.material;
      this.ownershipOverlayMesh.material = null;
      this.ownershipOverlayMesh.dispose();
      ownershipMaterial?.dispose(false, false);
      this.ownershipOverlayMesh = null;
    }
    this.ownershipRenderer?.dispose();
    this.ownershipRenderer = null;
    if (this.nebulaOverlayMesh) {
      const nebulaMaterial = this.nebulaOverlayMesh.material;
      this.nebulaOverlayMesh.material = null;
      this.nebulaOverlayMesh.dispose();
      nebulaMaterial?.dispose(false, false);
      this.nebulaOverlayMesh = null;
    }
    this.nebulaRenderer?.dispose();
    this.nebulaRenderer = null;
    this.nebulae = [];
    this.hyperlanePairs = [];
    this.hyperlaneAdjacency = [];
    this.starOwnership = [];
    this.hoveredStarId = -1;
    this.galacticCoreMeshes = [];
    this.galacticCoreSpinSpeeds = [];
    this.disposeFleetRouteLines();
    this.fleetRouteSignature = "";
    this.clickPlane?.dispose();
    this.starField?.dispose();
    this.cam?.dispose();
    this.scene.dispose();
  }
}

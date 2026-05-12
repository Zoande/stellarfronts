/**
 * StarFieldRenderer
 * Renders all stars as layered billboard sprites using Babylon's SpriteManager.
 * Each star gets two sprites:
 * - soft halo (broad additive falloff)
 * - bright core (tight highlight)
 *
 * Supports:
 * - Per-star alpha for smooth transitions
 * - Per-star scale for highlight / shrink effects
 * - Type-specific color/size styling
 * - Type-specific pulse behavior (notably pulsars)
 */

import {
  SpriteManager,
  Sprite,
  Vector3,
  Color3,
  Color4,
  Material,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  GlowLayer,
  Matrix,
  DynamicTexture,
} from "@babylonjs/core";
import type { Mesh, Scene } from "@babylonjs/core";
import { STAR_TYPES, StarType } from "../data/StarMap";
import type { StarData } from "../data/StarMap";
import type { GalaxyShipTransit } from "../game/GameplayTypes";

export interface ShipIconStyle {
  starId: number;
  color: [number, number, number];
}

export type GalaxyIconClickType = "ship" | "starbase" | "habitedPlanet";

const SPRITE_BLEND_ADD = 1; // ALPHA_ADD
const STAR_TEXTURE_SIZE = 128;

/** Base multipliers from star luminosity to sprite world-unit size */
const CORE_SIZE_FACTOR = 1.8;
const HALO_SIZE_FACTOR = 6.2;

const CORE_BASE_ALPHA = 0.95;
const HALO_BASE_ALPHA = 0.38;

// Slight anti-blur tuning: keep stars visible but tighten halo falloff.
const HALO_TEXTURE_MIDDLE_STOP = 0.24;
const HALO_TEXTURE_EDGE_STOP = 0.62;
const HALO_TEXTURE_MIDDLE_ALPHA = 0.28;
const HALO_TEXTURE_EDGE_ALPHA = 0.05;

// Galaxy readability rebalance requested by design:
// - oversized blue/red stars are reduced
// - the rest are slightly boosted to stay legible at all zooms
const LARGE_STAR_SIZE_SCALE = 0.8;
const NORMAL_STAR_SIZE_SCALE = 1.2;
const LARGE_STAR_BLOOM_SCALE = 0.8;
const NORMAL_STAR_BLOOM_SCALE = 1.2;
const TINY_STAR_CORE_THRESHOLD = 0.85;
const TINY_STAR_SIZE_BOOST = 1.5;
const TINY_STAR_BLOOM_ALPHA_BOOST = 1.25;

// Small yellow/red stars need stronger gameplay readability at full zoom-out.
const SMALL_YELLOW_RED_CORE_SIZE_BOOST = 1.7;
const SMALL_YELLOW_RED_HALO_SIZE_BOOST = 2.0;
const SMALL_YELLOW_RED_BLOOM_ALPHA_BOOST = 1.55;

// Hard visibility floors used in galaxy view so all stars remain readable.
const HARD_RENDER_LUMINOSITY_FLOOR = 0.55;
const HARD_CORE_SIZE_FLOOR = 1.0;
const HARD_HALO_SIZE_FLOOR = 3.4;
const HARD_CORE_ALPHA_FLOOR = 0.42;
const HARD_HALO_ALPHA_FLOOR = 0.28;

// Compact objects should read as smaller than giants, but still gameplay-visible.
const BIG_STAR_GAMEPLAY_CORE_REFERENCE = 4.4;
const BIG_STAR_GAMEPLAY_HALO_REFERENCE = 14.2;
const COMPACT_OBJECT_SIZE_RATIO = 0.65;
const COMPACT_OBJECT_CORE_SIZE_FLOOR =
  BIG_STAR_GAMEPLAY_CORE_REFERENCE * COMPACT_OBJECT_SIZE_RATIO;
const COMPACT_OBJECT_HALO_SIZE_FLOOR =
  BIG_STAR_GAMEPLAY_HALO_REFERENCE * COMPACT_OBJECT_SIZE_RATIO;

const BLACK_HOLE_CORE_ALPHA_FLOOR = 0.55;
const BLACK_HOLE_HALO_ALPHA_FLOOR = 0.4;

// Relative bloom guarantee: every star keeps at least half of the strongest bloom profile.
const MIN_RELATIVE_BLOOM_RATIO = 0.5;

// Pulse tuning:
// - strong pulsing stars never drop below a visible glow floor
// - pulsing cadence is intentionally slower for readability
const STRONG_PULSE_FLOOR = 0.35;
const SUBTLE_PULSE_FLOOR = 0.85;
const STRONG_PULSE_SPEED_SCALE = 0.22;
const SUBTLE_PULSE_SPEED_SCALE = 0.6;

const SELECTION_MARKER_Y = 0.72;
const SELECTION_MARKER_RADIUS = 15;
const SELECTION_RECT_WIDTH = 8.4;
const SELECTION_RECT_HEIGHT = 4.4;
const SELECTION_RECT_THICKNESS = 0.9;
const SELECTION_MARKER_ALPHA_MIN = 0.34;
const SELECTION_MARKER_ALPHA_MAX = 0.54;
const SELECTION_MARKER_PULSE_SPEED = 4.2;
const SELECTION_MARKER_ROTATION_SPEED = 0.34;
const SELECTION_MARKER_SCALE_PULSE = 0.035;
const SELECTION_MARKER_EMISSIVE_MIN = 1.4;
const SELECTION_MARKER_EMISSIVE_MAX = 2.4;
const SELECTION_MARKER_GLOW_MIN = 0.32;
const SELECTION_MARKER_GLOW_MAX = 0.68;
const SELECTION_MARKER_COLOR = new Color3(0.18, 1.0, 0.9);

const PLAYER_SHIP_ICON_TEXTURE_SIZE = 1024;
const PLAYER_SHIP_ICON_MIN_SIZE = 11;
const PLAYER_SHIP_ICON_MAX_SIZE = 19;
const PLAYER_SHIP_ICON_Y = 2.4;
const PLAYER_SHIP_ICON_OFFSET_X = 8;
const PLAYER_SHIP_ICON_OFFSET_Z = -8;
const PLAYER_SHIP_ICON_PULSE_SPEED = 2.3;
const PLAYER_SHIP_ICON_PULSE_SCALE = 0.09;

const STARBASE_ICON_TEXTURE_SIZE = 1024;
const STARBASE_ICON_MIN_SIZE = 16;
const STARBASE_ICON_MAX_SIZE = 28;
const STARBASE_ICON_Y = 2.4;
const STARBASE_ICON_OFFSET_X = 8;
const STARBASE_ICON_OFFSET_Z = -8;
const STARBASE_ICON_PULSE_SPEED = 2.05;
const STARBASE_ICON_PULSE_SCALE = 0.08;

/** Star label visibility threshold (0 = fully zoomed out, 1 = fully zoomed in) */
const STAR_LABEL_ZOOM_THRESHOLD = 0.65;
const STAR_LABEL_FONT_SIZE = 78;
const STAR_LABEL_MIN_FONT_SIZE = 42;
const STAR_LABEL_TEXTURE_WIDTH = 512;
const STAR_LABEL_TEXTURE_HEIGHT = 128;
const STAR_LABEL_TEXTURE_PADDING_X = 34;
const STAR_LABEL_FONT_FAMILY = '"Segoe UI", Arial, sans-serif';
const NORMAL_STAR_LABEL_SCALE = 2;
const STARBASE_LABEL_SCALE = 3;
const STARBASE_BADGE_U = 429 / STAR_LABEL_TEXTURE_WIDTH;
const HABITED_PLANET_LEFT_BADGE_U = 43 / STAR_LABEL_TEXTURE_WIDTH;
const STARBASE_BADGE_V = 0.5;
const STARBASE_BADGE_RADIUS_U = 42 / STAR_LABEL_TEXTURE_WIDTH;
const STARBASE_BADGE_RADIUS_V = 42 / STAR_LABEL_TEXTURE_HEIGHT;
const FOGGED_STAR_COLOR = new Color4(0.4, 0.43, 0.48, 1);
const STALE_STAR_LABEL_COLOR = new Color3(0.56, 0.6, 0.66);
const FOGGED_CORE_ALPHA_SCALE = 0.36;
const FOGGED_HALO_ALPHA_SCALE = 0.12;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function softenColor(color: [number, number, number], preservation: number): Color4 {
  return new Color4(
    mix(1, color[0], preservation),
    mix(1, color[1], preservation),
    mix(1, color[2], preservation),
    1,
  );
}

function createRadialTextureDataURL(
  size: number,
  middleStop: number,
  edgeStop: number,
  middleAlpha: number,
  edgeAlpha = 0.08,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // Transparent 1x1 fallback if canvas context is unavailable.
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP4z8AAAAMBAQAY0x6sAAAAAElFTkSuQmCC";
  }

  const c = size / 2;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(middleStop, `rgba(255,255,255,${middleAlpha})`);
  grad.addColorStop(edgeStop, `rgba(255,255,255,${edgeAlpha})`);
  grad.addColorStop(1, "rgba(255,255,255,0)");

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  return canvas.toDataURL("image/png");
}

function createSelectionMarkerMaterial(scene: Scene): StandardMaterial {
  const mat = new StandardMaterial("starSelectionMarkerMat", scene);
  mat.diffuseColor = SELECTION_MARKER_COLOR.scale(0.16);
  mat.emissiveColor = SELECTION_MARKER_COLOR.scale(SELECTION_MARKER_EMISSIVE_MAX);
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.alpha = SELECTION_MARKER_ALPHA_MAX;
  mat.alphaMode = 2; // ALPHA_COMBINE
  return mat;
}

function createSelectionMarkerBoxes(
  scene: Scene,
  parent: TransformNode,
  material: StandardMaterial,
): Mesh[] {
  const meshes: Mesh[] = [];
  const angles = [-Math.PI / 2, Math.PI / 6, (Math.PI * 5) / 6];

  for (let i = 0; i < angles.length; i++) {
    const angle = angles[i];
    const radialX = Math.cos(angle);
    const radialZ = Math.sin(angle);

    const box = MeshBuilder.CreateBox(
      `starSelectionMarkerRect_${i}`,
      {
        width: SELECTION_RECT_WIDTH,
        height: SELECTION_RECT_THICKNESS,
        depth: SELECTION_RECT_HEIGHT,
      },
      scene,
    );
    box.parent = parent;
    box.position.set(
      radialX * SELECTION_MARKER_RADIUS,
      0,
      radialZ * SELECTION_MARKER_RADIUS,
    );
    box.rotation.y = -angle - Math.PI / 2;
    box.material = material;
    box.isPickable = false;
    box.alwaysSelectAsActiveMesh = true;
    meshes.push(box);
  }

  return meshes;
}

export class StarFieldRenderer {
  private scene: Scene;
  private haloManager: SpriteManager;
  private coreManager: SpriteManager;
  private haloSprites: Sprite[] = [];
  private coreSprites: Sprite[] = [];
  private baseColors: Color4[] = [];
  private baseCoreSizes: number[] = [];
  private baseHaloSizes: number[] = [];
  private starPositions: Array<{ x: number; z: number }> = [];
  private selectionMarkerRoot: TransformNode;
  private selectionMarkerMeshes: Mesh[] = [];
  private selectionMarkerMaterial: StandardMaterial;
  private selectionGlowLayer: GlowLayer;
  private selectionMarkerStarId = -1;
  private playerShipIconManager: SpriteManager;
  private playerShipIconSprites: Sprite[] = [];
  private starbaseIconManager: SpriteManager;
  private starbaseIconSprites: Sprite[] = [];
  private playerShipStarId = -1;
  private playerShipSystemIds = new Set<number>();
  private playerShipIconColors = new Map<number, Color4>();
  private playerShipTransit: GalaxyShipTransit | null = null;
  private displayedPlayerShipTransit: GalaxyShipTransit | null = null;
  private playerShipTransitRatePerSecond = 0;
  private playerShipTransitUpdatedAt = 0;
  private starbaseSystemIds = new Set<number>();
  private highlightedStarIds = new Set<number>();
  private targetMarkerRoots: TransformNode[] = [];
  private targetMarkerMeshes: Mesh[] = [];
  private targetMarkerStarIds: number[] = [];

  private starLabelMeshes: Mesh[] = [];
  private starNames: string[] = [];
  private starHasHabitedPlanet: boolean[] = [];
  private visibleStarIds: Set<number> | null = null;
  private knownStarIds: Set<number> | null = null;

  // Current per-star overrides (applied each frame via applyVisuals)
  private alphaOverrides: Float32Array;
  private scaleOverrides: Float32Array;
  private coreBaseAlphas: Float32Array;
  private haloBaseAlphas: Float32Array;
  private pulseAmplitude: Float32Array;
  private pulseFrequency: Float32Array;
  private pulseFloor: Float32Array;
  private pulsePhase: Float32Array;

  private zoomOutBlend = 1;
  private elapsedTime = 0;
  private starsVisible = true;
  private bloomEnabled = true;
  private onIconClick?: (type: GalaxyIconClickType, shiftKey: boolean, starId?: number) => void;

  constructor(
    scene: Scene,
    stars: StarData[],
    playerShipStarId = -1,
    starbaseSystemIds: number[] = [],
    playerShipSystemIds: number[] = [],
    shipIconStyles: ShipIconStyle[] = [],
  ) {
    this.scene = scene;
    this.playerShipStarId = playerShipStarId;
    this.playerShipSystemIds = new Set(playerShipSystemIds);
    if (playerShipStarId >= 0) {
      this.playerShipSystemIds.add(playerShipStarId);
    }
    this.setShipIconStyles(shipIconStyles);
    this.starbaseSystemIds = new Set(starbaseSystemIds);
    const haloTexture = createRadialTextureDataURL(
      STAR_TEXTURE_SIZE,
      HALO_TEXTURE_MIDDLE_STOP,
      HALO_TEXTURE_EDGE_STOP,
      HALO_TEXTURE_MIDDLE_ALPHA,
      HALO_TEXTURE_EDGE_ALPHA,
    );
    const coreTexture = createRadialTextureDataURL(STAR_TEXTURE_SIZE, 0.07, 0.33, 0.92);

    this.haloManager = new SpriteManager(
      "starHaloSprites",
      haloTexture,
      stars.length,
      { width: STAR_TEXTURE_SIZE, height: STAR_TEXTURE_SIZE },
      scene,
    );

    this.coreManager = new SpriteManager(
      "starCoreSprites",
      coreTexture,
      stars.length,
      { width: STAR_TEXTURE_SIZE, height: STAR_TEXTURE_SIZE },
      scene,
    );

    this.haloManager.isPickable = false;
    this.coreManager.isPickable = false;

    this.haloManager.fogEnabled = false;
    this.coreManager.fogEnabled = false;

    this.haloManager.blendMode = SPRITE_BLEND_ADD;
    this.coreManager.blendMode = SPRITE_BLEND_ADD;

    this.selectionMarkerRoot = new TransformNode("starSelectionMarker", scene);
    this.selectionMarkerMaterial = createSelectionMarkerMaterial(scene);
    this.selectionGlowLayer = new GlowLayer("starSelectionMarkerGlow", scene, {
      blurKernelSize: 28,
      mainTextureRatio: 0.35,
    });
    this.selectionGlowLayer.intensity = SELECTION_MARKER_GLOW_MAX;
    this.selectionMarkerMeshes = createSelectionMarkerBoxes(
      scene,
      this.selectionMarkerRoot,
      this.selectionMarkerMaterial,
    );
    for (const mesh of this.selectionMarkerMeshes) {
      this.selectionGlowLayer.addIncludedOnlyMesh(mesh);
    }
    this.selectionMarkerRoot.setEnabled(false);

    this.playerShipIconManager = new SpriteManager(
      "playerShipIconSprites",
      "/textures/own_ship_icon.png",
      Math.max(1, stars.length),
      {
        width: PLAYER_SHIP_ICON_TEXTURE_SIZE,
        height: PLAYER_SHIP_ICON_TEXTURE_SIZE,
      },
      scene,
    );
    this.playerShipIconManager.isPickable = false;
    this.playerShipIconManager.fogEnabled = false;
    for (let i = 0; i < stars.length; i++) {
      const sprite = new Sprite(`player_ship_icon_${i}`, this.playerShipIconManager);
      sprite.isVisible = false;
      sprite.position.y = PLAYER_SHIP_ICON_Y;
      this.playerShipIconSprites.push(sprite);
    }

    this.starbaseIconManager = new SpriteManager(
      "starbaseIconSprites",
      new URL("../../own_starbase_icon.png", import.meta.url).toString(),
      Math.max(1, stars.length),
      {
        width: STARBASE_ICON_TEXTURE_SIZE,
        height: STARBASE_ICON_TEXTURE_SIZE,
      },
      scene,
    );
    this.starbaseIconManager.isPickable = false;
    this.starbaseIconManager.fogEnabled = false;
    for (let i = 0; i < stars.length; i++) {
      const sprite = new Sprite(`starbase_icon_${i}`, this.starbaseIconManager);
      sprite.isVisible = false;
      sprite.position.y = STARBASE_ICON_Y;
      this.starbaseIconSprites.push(sprite);
    }

    this.alphaOverrides = new Float32Array(stars.length).fill(1);
    this.scaleOverrides = new Float32Array(stars.length).fill(1);
    this.coreBaseAlphas = new Float32Array(stars.length).fill(CORE_BASE_ALPHA);
    this.haloBaseAlphas = new Float32Array(stars.length).fill(HALO_BASE_ALPHA);
    this.pulseAmplitude = new Float32Array(stars.length).fill(0);
    this.pulseFrequency = new Float32Array(stars.length).fill(1);
    this.pulseFloor = new Float32Array(stars.length).fill(SUBTLE_PULSE_FLOOR);
    this.pulsePhase = new Float32Array(stars.length).fill(0);

    for (let i = 0; i < stars.length; i++) {
      this.starNames.push(stars[i].name);
      const hasStarbase = this.starbaseSystemIds.has(stars[i].id);
      const hasHabitedPlanet = this.hasHabitedPlanet(stars[i]);
      this.starHasHabitedPlanet[stars[i].id] = hasHabitedPlanet;
      const labelMesh = this.createStarLabel(stars[i], hasStarbase, hasHabitedPlanet);
      this.starLabelMeshes.push(labelMesh);
    }

    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      const typeCfg = STAR_TYPES[star.type];

      const halo = new Sprite(`star_halo_${star.id}`, this.haloManager);
      const core = new Sprite(`star_core_${star.id}`, this.coreManager);

      const pos = new Vector3(star.x, 0, star.z);
      halo.position = pos.clone();
      core.position = pos;

      const isLargeBlueOrRedStar =
        star.type === StarType.B
        || star.type === StarType.A
        || typeCfg.kind === "red-giant";

      const sizeScale = isLargeBlueOrRedStar ? LARGE_STAR_SIZE_SCALE : NORMAL_STAR_SIZE_SCALE;
      const bloomScale = isLargeBlueOrRedStar ? LARGE_STAR_BLOOM_SCALE : NORMAL_STAR_BLOOM_SCALE;
      const isBlackHole = typeCfg.kind === "black-hole";
      const isCompactObject =
        typeCfg.kind === "black-hole"
        || typeCfg.kind === "neutron-star"
        || typeCfg.kind === "pulsar";
      const isSmallYellowOrRedStar =
        star.type === StarType.G
        || star.type === StarType.K
        || star.type === StarType.M;

      const coreSizeBoost = isSmallYellowOrRedStar ? SMALL_YELLOW_RED_CORE_SIZE_BOOST : 1;
      const haloSizeBoost = isSmallYellowOrRedStar ? SMALL_YELLOW_RED_HALO_SIZE_BOOST : 1;
      const bloomAlphaBoost = isSmallYellowOrRedStar ? SMALL_YELLOW_RED_BLOOM_ALPHA_BOOST : 1;

      const renderLuminosity = Math.max(star.luminosity, HARD_RENDER_LUMINOSITY_FLOOR);
      let coreSize =
        renderLuminosity * CORE_SIZE_FACTOR * typeCfg.galaxyCoreScale * sizeScale * coreSizeBoost;
      let haloSize =
        renderLuminosity * HALO_SIZE_FACTOR * typeCfg.galaxyHaloScale * sizeScale * haloSizeBoost;

      const tinySizeBoost = coreSize < TINY_STAR_CORE_THRESHOLD ? TINY_STAR_SIZE_BOOST : 1;
      const tinyBloomBoost = tinySizeBoost > 1 ? TINY_STAR_BLOOM_ALPHA_BOOST : 1;

      coreSize = Math.max(
        coreSize * tinySizeBoost,
        isCompactObject ? COMPACT_OBJECT_CORE_SIZE_FLOOR : HARD_CORE_SIZE_FLOOR,
      );
      haloSize = Math.max(
        haloSize * tinySizeBoost,
        isCompactObject ? COMPACT_OBJECT_HALO_SIZE_FLOOR : HARD_HALO_SIZE_FLOOR,
      );

      core.width = coreSize;
      core.height = coreSize;
      halo.width = haloSize;
      halo.height = haloSize;

      const c = softenColor(star.color, typeCfg.galaxyColorPreservation);

      let coreAlpha = CORE_BASE_ALPHA;
      let haloAlpha = HALO_BASE_ALPHA;

      switch (typeCfg.kind) {
        case "red-giant":
          haloAlpha = 0.5;
          break;
        case "brown-dwarf":
          coreAlpha = 0.72;
          haloAlpha = 0.24;
          break;
        case "neutron-star":
          coreAlpha = 1.0;
          haloAlpha = 0.3;
          break;
        case "pulsar":
          coreAlpha = 1.0;
          haloAlpha = 0.5;
          break;
        case "black-hole":
          coreAlpha = 0.22;
          haloAlpha = 0.34;
          break;
        default:
          break;
      }

      coreAlpha = clamp01(coreAlpha * (isLargeBlueOrRedStar ? 0.9 : 1.08));
      haloAlpha = clamp01(haloAlpha * bloomScale * tinyBloomBoost * bloomAlphaBoost);

      coreAlpha = Math.max(
        coreAlpha,
        isBlackHole ? BLACK_HOLE_CORE_ALPHA_FLOOR : HARD_CORE_ALPHA_FLOOR,
      );
      haloAlpha = Math.max(
        haloAlpha,
        isBlackHole ? BLACK_HOLE_HALO_ALPHA_FLOOR : HARD_HALO_ALPHA_FLOOR,
      );

      core.color = new Color4(c.r, c.g, c.b, coreAlpha);
      halo.color = new Color4(c.r, c.g, c.b, haloAlpha);

      this.coreSprites.push(core);
      this.haloSprites.push(halo);
      this.baseColors.push(c.clone());
      this.baseCoreSizes.push(coreSize);
      this.baseHaloSizes.push(haloSize);
      this.starPositions.push({ x: star.x, z: star.z });

      this.coreBaseAlphas[i] = coreAlpha;
      this.haloBaseAlphas[i] = haloAlpha;
      this.pulseAmplitude[i] = star.galaxyPulseAmplitude;
      const isStrongPulser = typeCfg.kind === "pulsar" || typeCfg.kind === "neutron-star";
      this.pulseFrequency[i] = star.galaxyPulseFrequency
        * (isStrongPulser ? STRONG_PULSE_SPEED_SCALE : SUBTLE_PULSE_SPEED_SCALE);
      this.pulseFloor[i] = isStrongPulser ? STRONG_PULSE_FLOOR : SUBTLE_PULSE_FLOOR;
      this.pulsePhase[i] = (star.id * 2.399963229728653) % (Math.PI * 2);
    }

    this.enforceRelativeBloomFloor(MIN_RELATIVE_BLOOM_RATIO);
  }

  private enforceRelativeBloomFloor(minRatio: number): void {
    if (this.baseHaloSizes.length === 0) return;

    let maxHaloSize = 0;
    let maxHaloAlpha = 0;
    for (let i = 0; i < this.baseHaloSizes.length; i++) {
      if (this.baseHaloSizes[i] > maxHaloSize) maxHaloSize = this.baseHaloSizes[i];
      if (this.haloBaseAlphas[i] > maxHaloAlpha) maxHaloAlpha = this.haloBaseAlphas[i];
    }

    const minHaloSize = maxHaloSize * minRatio;
    const minHaloAlpha = maxHaloAlpha * minRatio;

    for (let i = 0; i < this.baseHaloSizes.length; i++) {
      const haloSize = Math.max(this.baseHaloSizes[i], minHaloSize);
      const haloAlpha = Math.max(this.haloBaseAlphas[i], minHaloAlpha);

      this.baseHaloSizes[i] = haloSize;
      this.haloBaseAlphas[i] = haloAlpha;

      const halo = this.haloSprites[i];
      const base = this.baseColors[i];
      halo.width = haloSize;
      halo.height = haloSize;
      halo.color.set(base.r, base.g, base.b, clamp01(haloAlpha));
    }
  }

  update(deltaTime: number): void {
    this.elapsedTime += deltaTime;
    this.updateDisplayedPlayerShipTransit(deltaTime);
    
    // Update star label visibility based on zoom level
    // zoomOutBlend = 0 when zoomed in, 1 when zoomed out
    // We want labels visible when ZOOMED IN (zoomOutBlend closer to 0)
    const labelsVisible = this.zoomOutBlend < STAR_LABEL_ZOOM_THRESHOLD;
    
    for (let i = 0; i < this.starLabelMeshes.length; i++) {
      const labelMesh = this.starLabelMeshes[i];
      const labelVisible = labelsVisible && this.isStarKnown(i);
      
      if (labelMesh.isVisible !== labelVisible) {
        labelMesh.isVisible = labelVisible;
      }

      const labelMaterial = labelMesh.material as StandardMaterial | null;
      if (labelMaterial) {
        const labelColor = this.isStarCurrentlyVisible(i) ? Color3.White() : STALE_STAR_LABEL_COLOR;
        labelMaterial.diffuseColor = labelColor;
        labelMaterial.emissiveColor = labelColor;
      }
      
      // Keep plane facing camera
      if (labelVisible && this.scene.activeCamera) {
        const cameraPosition = this.scene.activeCamera.position;
        labelMesh.lookAt(cameraPosition);
        labelMesh.rotation.y += Math.PI;
      }
    }
  }

  private hasHabitedPlanet(star: StarData): boolean {
    return star.system.planets.some((planet) => planet.isHabited === true);
  }

  private createStarLabel(star: StarData, hasStarbase = false, hasHabitedPlanet = false): Mesh {
    const hasNameplate = hasStarbase || hasHabitedPlanet;

    const labelTexture = new DynamicTexture(
      "starLabelTexture_" + star.id,
      { width: STAR_LABEL_TEXTURE_WIDTH, height: STAR_LABEL_TEXTURE_HEIGHT },
      this.scene,
      false,
    );
    labelTexture.hasAlpha = true;

    const ctx = labelTexture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, STAR_LABEL_TEXTURE_WIDTH, STAR_LABEL_TEXTURE_HEIGHT);

    const labelText = star.name;
    ctx.direction = "ltr";
    ctx.textAlign = hasNameplate ? "center" : "right";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    if (hasNameplate) {
      this.drawGalaxyNameplate(ctx, hasStarbase, hasHabitedPlanet);
    }

    const maxTextWidth = hasNameplate
      ? 300
      : STAR_LABEL_TEXTURE_WIDTH - STAR_LABEL_TEXTURE_PADDING_X * 2;
    let fontSize = hasNameplate ? 64 : STAR_LABEL_FONT_SIZE;
    do {
      ctx.font = `${hasNameplate ? 800 : 700} ${fontSize}px ${STAR_LABEL_FONT_FAMILY}`;
      if (ctx.measureText(labelText).width <= maxTextWidth) break;
      fontSize -= 4;
    } while (fontSize > STAR_LABEL_MIN_FONT_SIZE);

    const x = hasNameplate ? 240 : STAR_LABEL_TEXTURE_WIDTH - STAR_LABEL_TEXTURE_PADDING_X;
    const y = STAR_LABEL_TEXTURE_HEIGHT / 2;
    ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.95)";
    ctx.lineWidth = Math.max(hasNameplate ? 4 : 6, fontSize * (hasNameplate ? 0.07 : 0.12));
    ctx.strokeText(labelText, x, y);
    ctx.fillStyle = hasNameplate ? "rgba(230, 255, 250, 0.98)" : "rgba(255, 255, 255, 0.96)";
    ctx.fillText(labelText, x, y);
    
    labelTexture.update(true);

    // Create material with texture
    const material = new StandardMaterial("starLabelMat_" + star.id, this.scene);
    material.diffuseTexture = labelTexture;
    material.emissiveTexture = labelTexture;
    material.opacityTexture = labelTexture;
    material.diffuseColor = Color3.White();
    material.emissiveColor = Color3.White();
    material.specularColor = Color3.Black();
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.useAlphaFromDiffuseTexture = true;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    material.alpha = 1.0;

    // Create plane mesh
    const labelMesh = MeshBuilder.CreatePlane(
      "starLabel_mesh_" + star.id,
      {
        width: (hasNameplate ? 11.4 : 10) * (hasNameplate ? STARBASE_LABEL_SCALE : NORMAL_STAR_LABEL_SCALE),
        height: (hasNameplate ? 2.85 : 2.5) * (hasNameplate ? STARBASE_LABEL_SCALE : NORMAL_STAR_LABEL_SCALE),
      },
      this.scene,
    );
    labelMesh.position = new Vector3(star.x, hasNameplate ? 9.75 : 6, star.z);
    labelMesh.material = material;
    labelMesh.isPickable = false;
    labelMesh.isVisible = false;
    labelMesh.renderingGroupId = 1;

    return labelMesh;
  }

  private drawGalaxyNameplate(ctx: CanvasRenderingContext2D, hasStarbase: boolean, hasHabitedPlanet: boolean): void {
    const plateX = 72;
    const plateY = 31;
    const plateW = 334;
    const plateH = 66;
    const leftBadgeX = 43;
    const rightBadgeX = 429;
    const badgeY = STAR_LABEL_TEXTURE_HEIGHT / 2;
    const badgeR = 38;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.82)";
    ctx.shadowBlur = 9;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = "rgba(5, 45, 39, 0.94)";
    ctx.strokeStyle = "rgba(152, 240, 219, 0.86)";
    ctx.lineWidth = 4;
    this.drawRoundedRect(ctx, plateX, plateY, plateW, plateH, 4);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(35, 137, 116, 0.34)";
    ctx.fillRect(plateX + 6, plateY + 7, plateW - 12, 8);
    if (hasStarbase) {
      this.drawHexBadge(ctx, rightBadgeX, badgeY, badgeR);
    }
    if (hasHabitedPlanet) {
      const badgeX = hasStarbase ? leftBadgeX : rightBadgeX;
      this.drawHabitedPlanetBadge(ctx, badgeX, badgeY, badgeR);
    }
    ctx.restore();
  }

  private drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  private drawHexBadge(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
    const drawHex = (r: number): void => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = -Math.PI / 6 + (i * Math.PI * 2) / 6;
        const px = x + Math.cos(angle) * r;
        const py = y + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.82)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    drawHex(radius);
    ctx.fillStyle = "rgba(224, 239, 235, 0.98)";
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(66, 86, 82, 0.96)";
    ctx.stroke();

    drawHex(radius * 0.64);
    ctx.fillStyle = "rgba(245, 252, 250, 1)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(92, 112, 108, 0.86)";
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(78, 93, 90, 0.98)";
    const nodeR = radius * 0.12;
    const nodes = [
      [x, y - radius * 0.22],
      [x - radius * 0.22, y + radius * 0.12],
      [x + radius * 0.22, y + radius * 0.12],
    ];
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(78, 93, 90, 0.95)";
    ctx.beginPath();
    ctx.moveTo(nodes[0][0], nodes[0][1]);
    ctx.lineTo(nodes[1][0], nodes[1][1]);
    ctx.lineTo(nodes[2][0], nodes[2][1]);
    ctx.lineTo(nodes[0][0], nodes[0][1]);
    ctx.stroke();
    for (const [nx, ny] of nodes) {
      ctx.beginPath();
      ctx.arc(nx, ny, nodeR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawHabitedPlanetBadge(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
    const drawHex = (r: number): void => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = -Math.PI / 6 + (i * Math.PI * 2) / 6;
        const px = x + Math.cos(angle) * r;
        const py = y + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.82)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;

    drawHex(radius);
    const bg = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
    bg.addColorStop(0, "rgba(24, 171, 126, 0.98)");
    bg.addColorStop(0.58, "rgba(21, 100, 137, 0.98)");
    bg.addColorStop(1, "rgba(226, 166, 61, 0.98)");
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(194, 255, 231, 0.96)";
    ctx.stroke();

    drawHex(radius * 0.76);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(7, 35, 40, 0.72)";
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.ellipse(x, y, radius * 0.45, radius * 0.32, -0.18, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(210, 252, 230, 0.98)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(9, 50, 51, 0.88)";
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(x - radius * 0.1, y - radius * 0.02, radius * 0.5, radius * 0.16, -0.34, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 232, 134, 0.95)";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = "rgba(34, 124, 92, 0.9)";
    ctx.beginPath();
    ctx.moveTo(x - radius * 0.27, y - radius * 0.06);
    ctx.bezierCurveTo(x - radius * 0.1, y - radius * 0.2, x + radius * 0.08, y - radius * 0.14, x + radius * 0.17, y);
    ctx.bezierCurveTo(x + radius * 0.02, y + radius * 0.05, x - radius * 0.12, y + radius * 0.08, x - radius * 0.27, y - radius * 0.06);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 226, 105, 0.96)";
    const lightR = Math.max(1.5, radius * 0.045);
    const lights = [
      [x - radius * 0.11, y + radius * 0.1],
      [x + radius * 0.03, y + radius * 0.07],
      [x + radius * 0.18, y + radius * 0.02],
    ];
    for (const [lx, ly] of lights) {
      ctx.beginPath();
      ctx.arc(lx, ly, lightR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private rebuildStarLabel(starId: number): void {
    if (starId < 0 || starId >= this.starPositions.length) return;
    const starPosition = this.starPositions[starId];
    const starName = this.starNames[starId];
    if (!starPosition || !starName) return;

    const oldLabel = this.starLabelMeshes[starId];
    if (oldLabel) {
      const material = oldLabel.material as StandardMaterial | null;
      material?.diffuseTexture?.dispose();
      material?.dispose();
      oldLabel.dispose();
    }

    const star = {
      id: starId,
      name: starName,
      x: starPosition.x,
      z: starPosition.z,
    } as StarData;
    this.starLabelMeshes[starId] = this.createStarLabel(
      star,
      this.starbaseSystemIds.has(starId),
      this.starHasHabitedPlanet[starId] === true,
    );
  }

  private isStarCurrentlyVisible(starId: number): boolean {
    return this.visibleStarIds === null || this.visibleStarIds.has(starId);
  }

  private isStarKnown(starId: number): boolean {
    return this.knownStarIds === null || this.knownStarIds.has(starId);
  }

  setVisibleStarIds(starIds: Iterable<number> | null): void {
    this.visibleStarIds = starIds ? new Set(starIds) : null;
  }

  setKnownStarIds(starIds: Iterable<number> | null): void {
    this.knownStarIds = starIds ? new Set(starIds) : null;
  }

  setPlayerShipState(starId: number, transit: GalaxyShipTransit | null = null): void {
    this.playerShipStarId = starId;
    if (starId >= 0) {
      this.playerShipSystemIds.add(starId);
    }
    const now = performance.now();
    if (transit && this.playerShipTransit
      && transit.fromStarId === this.playerShipTransit.fromStarId
      && transit.toStarId === this.playerShipTransit.toStarId) {
      const elapsedSeconds = Math.max(0.001, (now - this.playerShipTransitUpdatedAt) / 1000);
      const progressDelta = transit.progress - this.playerShipTransit.progress;
      this.playerShipTransitRatePerSecond = progressDelta > 0
        ? progressDelta / elapsedSeconds
        : this.playerShipTransitRatePerSecond;
      if (this.displayedPlayerShipTransit) {
        this.displayedPlayerShipTransit.progress = Math.max(
          transit.progress,
          this.displayedPlayerShipTransit.progress,
        );
      }
    } else {
      this.playerShipTransitRatePerSecond = 0;
      this.displayedPlayerShipTransit = transit ? { ...transit } : null;
    }
    this.playerShipTransit = transit;
    this.playerShipTransitUpdatedAt = now;
  }

  setPlayerShipSystemIds(starIds: Iterable<number>): void {
    this.playerShipSystemIds = new Set(starIds);
    if (this.playerShipStarId >= 0) {
      this.playerShipSystemIds.add(this.playerShipStarId);
    }
  }

  setShipIconStyles(styles: Iterable<ShipIconStyle>): void {
    this.playerShipIconColors.clear();
    for (const style of styles) {
      this.playerShipIconColors.set(
        style.starId,
        new Color4(style.color[0], style.color[1], style.color[2], 1),
      );
    }
  }

  setStarbaseSystemIds(starIds: Iterable<number>): void {
    const nextIds = new Set(starIds);
    if (this.areSetsEqual(this.starbaseSystemIds, nextIds)) return;

    const changedStarIds = new Set<number>([...this.starbaseSystemIds, ...nextIds]);
    this.starbaseSystemIds = nextIds;
    for (const starId of changedStarIds) {
      this.rebuildStarLabel(starId);
    }
  }

  setHabitedPlanetSystemIds(starIds: Iterable<number>): void {
    const nextIds = new Set(starIds);
    let changed = false;
    const changedStarIds = new Set<number>();

    for (let starId = 0; starId < this.starHasHabitedPlanet.length; starId++) {
      const nextValue = nextIds.has(starId);
      if ((this.starHasHabitedPlanet[starId] === true) === nextValue) continue;
      this.starHasHabitedPlanet[starId] = nextValue;
      changedStarIds.add(starId);
      changed = true;
    }

    if (!changed) return;
    for (const starId of changedStarIds) {
      this.rebuildStarLabel(starId);
    }
  }

  setHighlightedStarIds(starIds: Iterable<number>): void {
    const nextIds = new Set(starIds);
    if (this.areSetsEqual(this.highlightedStarIds, nextIds)) return;

    this.highlightedStarIds = nextIds;
    this.rebuildTargetMarkers();
  }

  /** Set alpha for a specific star (0 = invisible, 1 = full). */
  setStarAlpha(starId: number, alpha: number): void {
    if (starId >= 0 && starId < this.coreSprites.length) {
      this.alphaOverrides[starId] = alpha;
    }
  }

  /** Set scale for a specific star's glow (1 = normal, 0 = invisible). */
  setStarScale(starId: number, scale: number): void {
    if (starId >= 0 && starId < this.coreSprites.length) {
      this.scaleOverrides[starId] = scale;
    }
  }

  setSelectionMarkerStar(starId: number): void {
    this.selectionMarkerStarId = starId;
  }

  /**
   * Set zoom blend where 0 = fully zoomed-in and 1 = fully zoomed-out.
   * At higher values stars get larger and brighter for map readability.
   */
  setZoomOutBlend(zoomOutBlend: number): void {
    this.zoomOutBlend = clamp01(zoomOutBlend);
  }

  setStarsVisible(visible: boolean): void {
    this.starsVisible = visible;
  }

  setBloomEnabled(enabled: boolean): void {
    this.bloomEnabled = enabled;
  }

  /**
   * Suppress (fade + shrink) all stars within `radius` of the focus star.
   * @param focusStarId  The star being zoomed into (excluded from suppression).
   * @param radius       World-unit radius around the focus star.
   * @param strength     0 = no suppression, 1 = full suppression.
   * @param minAlpha     Floor alpha for suppressed stars (so they don't fully vanish).
   * @param shrinkFactor At full strength, scale becomes this (e.g. 0.3 = 30% size).
   */
  suppressNeighbors(
    focusStarId: number,
    radius: number,
    strength: number,
    minAlpha = 0.05,
    shrinkFactor = 0.3,
  ): void {
    if (focusStarId < 0 || focusStarId >= this.coreSprites.length) return;

    const cx = this.starPositions[focusStarId].x;
    const cz = this.starPositions[focusStarId].z;
    const rSq = radius * radius;

    for (let i = 0; i < this.coreSprites.length; i++) {
      if (i === focusStarId) continue;

      const dx = this.starPositions[i].x - cx;
      const dz = this.starPositions[i].z - cz;
      const distSq = dx * dx + dz * dz;

      if (distSq < rSq) {
        const dist = Math.sqrt(distSq);
        const proximity = 1 - dist / radius;
        const localStrength = strength * proximity;

        const targetAlpha = 1 - localStrength * (1 - minAlpha);
        const targetScale = 1 - localStrength * (1 - shrinkFactor);

        this.alphaOverrides[i] = Math.min(this.alphaOverrides[i], targetAlpha);
        this.scaleOverrides[i] = Math.min(this.scaleOverrides[i], targetScale);
      }
    }
  }

  /**
   * Reset all star overrides to defaults (alpha=1, scale=1).
   * Call at the start of each frame before applying new suppression.
   */
  resetOverrides(): void {
    this.alphaOverrides.fill(1);
    this.scaleOverrides.fill(1);
  }

  /**
   * Apply all alpha + scale overrides to actual sprite visuals.
   * Call once per frame after all suppression / per-star changes are set.
   */
  applyVisuals(): void {
    const coreScaleBoost = mix(1.0, 1.45, this.zoomOutBlend);
    const haloScaleBoost = mix(1.0, 1.65, this.zoomOutBlend);
    const coreAlphaBoost = mix(0.95, 1.35, this.zoomOutBlend);
    const haloAlphaBoost = mix(1.0, 1.65, this.zoomOutBlend);
    const starsVisibilityAlpha = this.starsVisible ? 1 : 0;
    const bloomVisibilityAlpha = this.bloomEnabled ? 1 : 0;

    for (let i = 0; i < this.coreSprites.length; i++) {
      const base = this.baseColors[i];
      const known = this.isStarKnown(i);
      const current = this.isStarCurrentlyVisible(i);
      const renderColor = known ? base : FOGGED_STAR_COLOR;
      const coreFogScale = current ? 1 : FOGGED_CORE_ALPHA_SCALE;
      const haloFogScale = current ? 1 : FOGGED_HALO_ALPHA_SCALE;
      const a = this.alphaOverrides[i];
      const s = this.scaleOverrides[i];
      const coreSize = this.baseCoreSizes[i];
      const haloSize = this.baseHaloSizes[i];

      const pulseWave =
        0.5 + 0.5 * Math.sin(this.elapsedTime * this.pulseFrequency[i] + this.pulsePhase[i]);
      const pulseTarget = this.pulseFloor[i] + (1 - this.pulseFloor[i]) * pulseWave;
      const pulseInfluence = clamp01(this.pulseAmplitude[i] * 2.0);

      const corePulseScale = mix(1, pulseTarget, pulseInfluence);
      const haloPulseScale = mix(1, pulseTarget, clamp01(pulseInfluence * 1.1));
      const alphaPulse = mix(1, pulseTarget, pulseInfluence);

      const core = this.coreSprites[i];
      const halo = this.haloSprites[i];

      core.width = coreSize * s * coreScaleBoost * corePulseScale;
      core.height = coreSize * s * coreScaleBoost * corePulseScale;
      halo.width = haloSize * s * haloScaleBoost * haloPulseScale;
      halo.height = haloSize * s * haloScaleBoost * haloPulseScale;

      core.color.set(
        renderColor.r,
        renderColor.g,
        renderColor.b,
        clamp01(
          this.coreBaseAlphas[i]
          * a
          * coreAlphaBoost
          * alphaPulse
          * starsVisibilityAlpha
          * coreFogScale,
        ),
      );
      halo.color.set(
        renderColor.r,
        renderColor.g,
        renderColor.b,
        clamp01(
          this.haloBaseAlphas[i]
          * a
          * haloAlphaBoost
          * alphaPulse
          * starsVisibilityAlpha
          * bloomVisibilityAlpha
          * haloFogScale,
        ),
      );
    }

    this.applySelectionMarkerVisual();
    this.applyTargetMarkerVisuals();
    this.applyPlayerShipIconVisual();
    this.hideStarbaseIconVisuals();
  }

  private areSetsEqual(a: Set<number>, b: Set<number>): boolean {
    if (a.size !== b.size) return false;
    for (const value of a) {
      if (!b.has(value)) return false;
    }
    return true;
  }

  private rebuildTargetMarkers(): void {
    for (const mesh of this.targetMarkerMeshes) {
      mesh.dispose();
    }
    for (const root of this.targetMarkerRoots) {
      root.dispose();
    }
    this.targetMarkerMeshes = [];
    this.targetMarkerRoots = [];
    this.targetMarkerStarIds = [];

    for (const starId of this.highlightedStarIds) {
      if (starId < 0 || starId >= this.starPositions.length) continue;
      const root = new TransformNode(`starTargetMarker_${starId}`, this.scene);
      const pos = this.starPositions[starId];
      root.position.set(pos.x, SELECTION_MARKER_Y, pos.z);
      root.scaling.setAll(0.82);
      const meshes = createSelectionMarkerBoxes(this.scene, root, this.selectionMarkerMaterial);
      for (const mesh of meshes) {
        this.selectionGlowLayer.addIncludedOnlyMesh(mesh);
        this.targetMarkerMeshes.push(mesh);
      }
      this.targetMarkerRoots.push(root);
      this.targetMarkerStarIds.push(starId);
    }
  }

  private applySelectionMarkerVisual(): void {
    const starId = this.selectionMarkerStarId;
    const hasSelection =
      this.starsVisible
      && starId >= 0
      && starId < this.starPositions.length
      && this.isStarKnown(starId);

    if (!hasSelection) {
      this.selectionMarkerRoot.setEnabled(false);
      this.selectionGlowLayer.intensity = 0;
      return;
    }

    if (this.highlightedStarIds.has(starId)) {
      this.selectionMarkerRoot.setEnabled(false);
      return;
    }

    const pulse = 0.5 + 0.5 * Math.sin(this.elapsedTime * SELECTION_MARKER_PULSE_SPEED);
    const markerScale = 1 - SELECTION_MARKER_SCALE_PULSE + pulse * SELECTION_MARKER_SCALE_PULSE * 2;
    const pos = this.starPositions[starId];
    this.selectionMarkerRoot.position.set(pos.x, SELECTION_MARKER_Y, pos.z);
    this.selectionMarkerRoot.rotation.y = this.elapsedTime * SELECTION_MARKER_ROTATION_SPEED;
    this.selectionMarkerRoot.scaling.set(markerScale, markerScale, markerScale);
    this.selectionMarkerMaterial.alpha = mix(
      SELECTION_MARKER_ALPHA_MIN,
      SELECTION_MARKER_ALPHA_MAX,
      pulse,
    );
    this.selectionMarkerMaterial.emissiveColor = SELECTION_MARKER_COLOR.scale(
      mix(SELECTION_MARKER_EMISSIVE_MIN, SELECTION_MARKER_EMISSIVE_MAX, pulse),
    );
    this.selectionGlowLayer.intensity = this.bloomEnabled
      ? mix(SELECTION_MARKER_GLOW_MIN, SELECTION_MARKER_GLOW_MAX, pulse)
      : 0;
    this.selectionMarkerRoot.setEnabled(true);
  }

  private applyTargetMarkerVisuals(): void {
    if (this.targetMarkerRoots.length === 0) return;

    const pulse = 0.5 + 0.5 * Math.sin(this.elapsedTime * (SELECTION_MARKER_PULSE_SPEED * 0.82));
    const markerScale = 0.8 + pulse * 0.08;
    const hasHoveredTarget = this.highlightedStarIds.has(this.selectionMarkerStarId);
    if (this.starsVisible && this.bloomEnabled) {
      this.selectionGlowLayer.intensity = Math.max(
        this.selectionGlowLayer.intensity,
        mix(
          SELECTION_MARKER_GLOW_MIN,
          SELECTION_MARKER_GLOW_MAX * (hasHoveredTarget ? 1.2 : 0.8),
          pulse,
        ),
      );
    }
    for (let i = 0; i < this.targetMarkerRoots.length; i++) {
      const root = this.targetMarkerRoots[i];
      const isHoveredTarget = this.targetMarkerStarIds[i] === this.selectionMarkerStarId;
      const hoverScaleBoost = isHoveredTarget ? 1.24 : 1;
      root.rotation.y = -this.elapsedTime * (SELECTION_MARKER_ROTATION_SPEED * 0.65) + i * 0.21;
      root.scaling.set(
        markerScale * hoverScaleBoost,
        markerScale * hoverScaleBoost,
        markerScale * hoverScaleBoost,
      );
      root.setEnabled(this.starsVisible);
    }
  }

  private applyPlayerShipIconVisual(): void {
    for (const sprite of this.playerShipIconSprites) {
      sprite.isVisible = false;
    }
    if (!this.starsVisible) return;

    const transit = this.displayedPlayerShipTransit ?? this.playerShipTransit;
    if (transit) {
      const sprite = this.playerShipIconSprites[this.playerShipStarId] ?? this.playerShipIconSprites[0];
      const shipPosition = this.getPlayerShipGalaxyPosition();
      const hasTransitShip =
        !!sprite
        && !!shipPosition
        && (this.isStarKnown(transit.fromStarId)
          || this.isStarKnown(transit.toStarId));

      if (hasTransitShip && shipPosition) {
        sprite.color = this.playerShipIconColors.get(this.playerShipStarId) ?? new Color4(1, 1, 1, 1);
        sprite.position.set(
          shipPosition.x + PLAYER_SHIP_ICON_OFFSET_X,
          PLAYER_SHIP_ICON_Y,
          shipPosition.z + PLAYER_SHIP_ICON_OFFSET_Z,
        );
        sprite.width = PLAYER_SHIP_ICON_MAX_SIZE;
        sprite.height = PLAYER_SHIP_ICON_MAX_SIZE;
        sprite.angle = Math.sin(this.elapsedTime * 0.9) * 0.06;
        sprite.isVisible = true;
      }
    }

    for (const starId of this.playerShipSystemIds) {
      if (starId < 0 || starId >= this.starPositions.length) continue;
      if (!this.isStarKnown(starId)) continue;

      const sprite = this.playerShipIconSprites[starId];
      const pos = this.starPositions[starId];
      if (!sprite || !pos) continue;
      if (transit && sprite.isVisible) continue;

      const pulse = 0.5 + 0.5 * Math.sin(
        this.elapsedTime * PLAYER_SHIP_ICON_PULSE_SPEED + starId * 0.37,
      );
      const size = mix(
        PLAYER_SHIP_ICON_MIN_SIZE,
        PLAYER_SHIP_ICON_MAX_SIZE,
        1 - PLAYER_SHIP_ICON_PULSE_SCALE + pulse * PLAYER_SHIP_ICON_PULSE_SCALE,
      );

      sprite.position.set(
        pos.x + PLAYER_SHIP_ICON_OFFSET_X,
        PLAYER_SHIP_ICON_Y,
        pos.z + PLAYER_SHIP_ICON_OFFSET_Z,
      );
      sprite.color = this.playerShipIconColors.get(starId) ?? new Color4(1, 1, 1, 1);
      sprite.width = size;
      sprite.height = size;
      sprite.angle = Math.sin(this.elapsedTime * 0.9 + starId * 0.37) * 0.06;
      sprite.isVisible = true;
    }
  }

  private hideStarbaseIconVisuals(): void {
    for (let i = 0; i < this.starbaseIconSprites.length; i++) {
      this.starbaseIconSprites[i].isVisible = false;
    }
  }

  private getPlayerShipGalaxyPosition(): { x: number; z: number } | null {
    const transit = this.displayedPlayerShipTransit ?? this.playerShipTransit;
    if (transit) {
      const from = this.starPositions[transit.fromStarId];
      const to = this.starPositions[transit.toStarId];
      if (!from || !to) return null;
      const t = clamp01(transit.progress);
      return {
        x: mix(from.x, to.x, t),
        z: mix(from.z, to.z, t),
      };
    }

    const pos = this.starPositions[this.playerShipStarId];
    return pos ? { x: pos.x, z: pos.z } : null;
  }

  dispose(): void {
    this.playerShipIconManager.dispose();
    this.starbaseIconManager.dispose();
    this.selectionGlowLayer.dispose();
    for (const mesh of this.targetMarkerMeshes) {
      mesh.dispose();
    }
    for (const root of this.targetMarkerRoots) {
      root.dispose();
    }
    for (const mesh of this.selectionMarkerMeshes) {
      mesh.dispose();
    }
    this.selectionMarkerMaterial.dispose();
    this.selectionMarkerRoot.dispose();
    for (const labelMesh of this.starLabelMeshes) {
      if (labelMesh.material) {
        (labelMesh.material as StandardMaterial).emissiveTexture?.dispose();
        labelMesh.material.dispose();
      }
      labelMesh.dispose();
    }
    this.haloManager.dispose();
    this.coreManager.dispose();
    this.haloSprites = [];
    this.coreSprites = [];
    this.baseColors = [];
    this.baseCoreSizes = [];
    this.baseHaloSizes = [];
    this.starPositions = [];
    this.starLabelMeshes = [];
    this.starNames = [];
    this.starHasHabitedPlanet = [];
    this.playerShipIconSprites = [];
    this.starbaseIconSprites = [];
    this.playerShipSystemIds.clear();
    this.starbaseSystemIds.clear();
    this.highlightedStarIds.clear();
    this.targetMarkerMeshes = [];
    this.targetMarkerRoots = [];
    this.targetMarkerStarIds = [];
  }

  public setIconClickCallback(
    callback: (type: GalaxyIconClickType, shiftKey: boolean, starId?: number) => void,
  ): void {
    this.onIconClick = callback;
  }

  private updateDisplayedPlayerShipTransit(deltaTime: number): void {
    if (!this.playerShipTransit) {
      this.displayedPlayerShipTransit = null;
      return;
    }

    if (!this.displayedPlayerShipTransit
      || this.displayedPlayerShipTransit.fromStarId !== this.playerShipTransit.fromStarId
      || this.displayedPlayerShipTransit.toStarId !== this.playerShipTransit.toStarId) {
      this.displayedPlayerShipTransit = { ...this.playerShipTransit };
      return;
    }

    const targetProgress = clamp01(this.playerShipTransit.progress);
    const predictedProgress = this.displayedPlayerShipTransit.progress
      + this.playerShipTransitRatePerSecond * deltaTime;
    const catchupProgress = mix(
      predictedProgress,
      targetProgress,
      Math.min(1, deltaTime * 2.5),
    );
    this.displayedPlayerShipTransit.progress = clamp01(
      Math.max(targetProgress, catchupProgress),
    );
  }

  public checkIconClick(screenX: number, screenY: number, viewport: {width: number; height: number}, shiftKey: boolean): boolean {
    if (!this.onIconClick) {
      return false;
    }

    const camera = this.scene.activeCamera;
    if (!camera) return false;

    // Create a ray from camera through the click point
    const ray = camera.getScene().createPickingRay(
      screenX,
      screenY,
      Matrix.Identity(),
      camera,
    );

    if (!ray) return false;

    for (let starId = 0; starId < this.playerShipIconSprites.length; starId++) {
      const shipSprite = this.playerShipIconSprites[starId];
      const shipHitDist = this.distanceFromRayToPoint(ray, shipSprite.position);
      if (shipHitDist < 5 && shipSprite.isVisible) {
        this.onIconClick("ship", shiftKey, starId);
        return true;
      }
    }

    for (const starId of this.starbaseSystemIds) {
      const labelMesh = this.starLabelMeshes[starId];
      if (!labelMesh?.isVisible) continue;
      if (this.hitLabelBadge(ray, labelMesh, STARBASE_BADGE_U)) {
        this.onIconClick("starbase", shiftKey, starId);
        return true;
      }
    }

    for (let starId = 0; starId < this.starHasHabitedPlanet.length; starId++) {
      if (!this.starHasHabitedPlanet[starId]) continue;
      const labelMesh = this.starLabelMeshes[starId];
      if (!labelMesh?.isVisible) continue;
      const badgeU = this.starbaseSystemIds.has(starId)
        ? HABITED_PLANET_LEFT_BADGE_U
        : STARBASE_BADGE_U;
      if (this.hitLabelBadge(ray, labelMesh, badgeU)) {
        this.onIconClick("habitedPlanet", shiftKey, starId);
        return true;
      }
    }
    return false;
  }

  private hitLabelBadge(ray: any, labelMesh: Mesh, badgeU: number): boolean {
    const normal = labelMesh.getDirection(Vector3.Forward());
    const denominator = Vector3.Dot(ray.direction, normal);
    if (Math.abs(denominator) < 0.0001) return false;

    const t = Vector3.Dot(labelMesh.position.subtract(ray.origin), normal) / denominator;
    if (t < 0) return false;

    const hitPoint = ray.origin.add(ray.direction.scale(t));
    const inverseWorld = labelMesh.getWorldMatrix().clone().invert();
    const local = Vector3.TransformCoordinates(hitPoint, inverseWorld);
    const width = labelMesh.getBoundingInfo().boundingBox.extendSize.x * 2;
    const height = labelMesh.getBoundingInfo().boundingBox.extendSize.y * 2;
    const u = local.x / width + 0.5;
    const v = 0.5 - local.y / height;
    const dx = (u - badgeU) / STARBASE_BADGE_RADIUS_U;
    const dy = (v - STARBASE_BADGE_V) / STARBASE_BADGE_RADIUS_V;
    return dx * dx + dy * dy <= 1;
  }

  private distanceFromRayToPoint(ray: any, point: Vector3): number {
    // Ray defined as: origin + direction * t
    // Find closest point on ray to the given point
    const rayOrigin = ray.origin;
    const rayDir = ray.direction;
    
    const toPoint = point.subtract(rayOrigin);
    const t = Vector3.Dot(toPoint, rayDir) / Vector3.Dot(rayDir, rayDir);
    const closestPointOnRay = rayOrigin.add(rayDir.scale(Math.max(0, t)));
    
    return Vector3.Distance(closestPointOnRay, point);
  }
}



/**
 * SystemScene
 * Dedicated star-system view entered from the galaxy map.
 * Escape triggers a scene-level exit callback back to GalaxyScene.
 */

import {
  Scene,
  Vector3,
  Color3,
  Color4,
  ArcRotateCamera,
  HemisphericLight,
  PointLight,
  MeshBuilder,
  StandardMaterial,
  MultiMaterial,
  Texture,
  GlowLayer,
  TransformNode,
  SceneLoader,
  DynamicTexture,
  Material,
  Mesh,
  Ray,
  Quaternion,
  Matrix,
} from "@babylonjs/core";
import type { AbstractEngine, AbstractMesh, LinesMesh } from "@babylonjs/core";
import "@babylonjs/loaders/OBJ/objFileLoader";
import "@babylonjs/loaders/glTF";
import type { IGameScene } from "../SceneManager";
import { STAR_TYPES, StarType, PLANET_TYPES, PlanetType } from "../data/StarMap";
import type { PlanetConfig, StarData, StarVisualKind } from "../data/StarMap";
import { OrbitSystem } from "../systems/OrbitSystem";
import type { GalaxyShipTransit, HyperlaneExitPoint } from "../game/GameplayTypes";
// OBJ and glTF loading are handled by @babylonjs/loaders modules

type ExitSystemHandler = () => void | Promise<void>;

export interface SystemSceneOptions {
  homeSystemStarIds?: number[];
  playerShipStarId?: number;
  playerShipSystemIds?: number[];
  shipSystemPositions?: Record<number, { x: number; y: number; z: number }>;
  starbaseSystemIds?: number[];
  shipTransit?: GalaxyShipTransit | null;
  hyperlaneExits?: HyperlaneExitPoint[];
  onGameplayFrame?: (deltaTime: number) => void;
}

const PLAYER_SHIP_MODEL_ROOT = "/ships/fighter_01/";
const PLAYER_SHIP_MODEL_FILE = "Fighter_01.obj";
const PLAYER_SHIP_TARGET_SIZE = 0.8;
const PLAYER_SHIP_BASE_POSITION = new Vector3(23, 4.8, -19);

const STARBASE_MODEL_URL = "/starbase/star_trek_-_starbase_375.glb";
const HYPERLANE_EXIT_RADIUS = 38;
const HYPERLANE_EXIT_Y = 2.8;
const SHIP_EXIT_END_PROGRESS = 0.28;
const SHIP_ENTRY_START_PROGRESS = 0.72;
const SYSTEM_LABEL_TEXTURE_WIDTH = 2048;
const SYSTEM_LABEL_TEXTURE_HEIGHT = 512;
const SYSTEM_LABEL_U_SCALE = -1;
const SYSTEM_LABEL_U_OFFSET = 1;

export class SystemScene implements IGameScene {
  public scene: Scene;
  private engine: AbstractEngine;
  private star: StarData;
  private starCount: number;  // Track actual star count for player ship detection
  private homeSystemStarIds: Set<number>;
  private playerShipStarId: number;
  private playerShipSystemIds: Set<number>;
  private shipSystemPositions: Record<number, { x: number; y: number; z: number }>;
  private starbaseSystemIds: Set<number>;
  private shipTransit: GalaxyShipTransit | null;
  private hyperlaneExits: HyperlaneExitPoint[];
  private readonly onExitSystem: ExitSystemHandler;

  private camera!: ArcRotateCamera;
  private glowLayer!: GlowLayer;
  private starMesh: Mesh | null = null;
  private starDetailMesh: Mesh | null = null;
  private starCoronaMesh: Mesh | null = null;
  private starDiameter = 1.2;
  private starLight: PointLight | null = null;
  private fillLight: PointLight | null = null;

  private pulsarBeamPivot: TransformNode | null = null;
  private pulsarBeamMaterial: StandardMaterial | null = null;

  private blackHoleDiskOuter: Mesh | null = null;
  private blackHoleDiskInner: Mesh | null = null;
  private playerShipRoot: TransformNode | null = null;
  private playerShipLight: PointLight | null = null;
  private playerShipThrusterMaterial: StandardMaterial | null = null;
  private playerShipBasePosition = PLAYER_SHIP_BASE_POSITION.clone();
  private playerShipTargetPosition = PLAYER_SHIP_BASE_POSITION.clone();

  private starbaseRoot: TransformNode | null = null;
  private starbaseLight: PointLight | null = null;
  private hyperlaneExitMeshes: Mesh[] = [];
  private hyperlaneExitMaterial: StandardMaterial | null = null;

  private orbitSystem = new OrbitSystem();
  private orbitRings: LinesMesh[] = [];
  private planetMeshes: Mesh[] = [];
  private planetLabelMeshes: Mesh[] = [];
  private planetDiameters: number[] = [];
  private starLabelMesh: Mesh | null = null;
  private starOccluded = false;
  private debugLogOccluder = true;
  private deepDebug = false;
  private isExiting = false;
  private elapsed = 0;
  private starsVisible = true;
  private bloomEnabled = true;

  private starKind: StarVisualKind = "main-sequence";

  // Tunable visual profile (configured per star type)
  private glowBaseIntensity = 1.7;
  private glowPulseAmplitude = 0.18;
  private glowPulseSpeed = 1.3;

  private coronaPulseAmplitude = 0.035;
  private coronaPulseSpeed = 1.8;

  private starRotationSpeed = 0.04;
  private starDetailRotationSpeed = -0.09;
  private starDetailTiltSpeed = 0.015;

  private starBaseEmissiveScale = 1.75;
  private starDetailEmissiveScale = 1.3;
  private starDetailTextureLevel = 1.5;
  private starDetailAlpha = 0.68;
  private starCoronaScale = 1.22;
  private starCoronaAlpha = 0.34;
  private systemScaleMultiplier = 1.15;
  private detailTexturePath = "/textures/star_surface.png";

  private ambientIntensity = 0.2;
  private bounceIntensity = 0.08;
  private starLightIntensity = 3.2;
  private starLightRange = 220;
  private fillIntensity = 0.55;
  private fillColor = new Color3(0.32, 0.38, 0.5);

  private orbitBaseOffset = 14;
  private orbitSpacing = 11;
  private planetNightLift = new Color3(0.12, 0.12, 0.15);

  private readonly onEscapeKey = (ev: KeyboardEvent): void => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    this.requestExit();
  };

  constructor(
    engine: AbstractEngine,
    star: StarData,
    onExitSystem: ExitSystemHandler,
    starCount: number = 500,
    options: SystemSceneOptions = {},
  ) {
    this.engine = engine;
    this.star = star;
    this.starCount = starCount;
    this.homeSystemStarIds = new Set(options.homeSystemStarIds ?? []);
    this.playerShipStarId = options.playerShipStarId ?? (options.homeSystemStarIds?.[0] ?? -1);
    this.playerShipSystemIds = new Set(
      options.playerShipSystemIds
        ?? options.homeSystemStarIds
        ?? (this.playerShipStarId >= 0 ? [this.playerShipStarId] : []),
    );
    this.shipSystemPositions = options.shipSystemPositions ?? {};
    this.starbaseSystemIds = new Set(options.starbaseSystemIds ?? options.homeSystemStarIds ?? []);
    this.shipTransit = options.shipTransit ?? null;
    this.hyperlaneExits = options.hyperlaneExits ?? [];
    this.onExitSystem = onExitSystem;
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.01, 0.015, 0.03, 1);
    console.log(`📍 SystemScene init: star.id=${star.id}, totalStarCount=${starCount}`);
  }

  private hasPlayerShipPresence(): boolean {
    if (this.shipSystemPositions[this.star.id]) return true;
    if (this.playerShipSystemIds.has(this.star.id)) return true;
    if (this.playerShipStarId === this.star.id) return true;
    return !!this.shipTransit
      && (this.shipTransit.fromStarId === this.star.id || this.shipTransit.toStarId === this.star.id);
  }

  private hasStarbasePresence(): boolean {
    return this.starbaseSystemIds.has(this.star.id);
  }

  private async createStarbaseIfPresent(): Promise<void> {
    console.log(`🔍 Checking starbase: star.id=${this.star.id}, using starCount=${this.starCount}`);
    if (!this.hasStarbasePresence() || this.starbaseRoot) return;
    console.log(`✅ This is the starbase system!`);

    const starRadius = Math.max(0.6, this.starDiameter * 0.5);
    const starbaseBasePosition = new Vector3(
      3.2,
      8.5,
      -(starRadius + 4.5 + 10),
    );
    this.starbaseRoot = new TransformNode("starbaseRoot", this.scene);
    this.starbaseRoot.position = starbaseBasePosition.clone();
    this.starbaseRoot.rotation.set(0.18, 0.2, 0.05);
    console.log(`📍 Starbase root position: ${JSON.stringify(starbaseBasePosition)}`);

    try {
      console.log(`📦 Importing starbase GLB from ${STARBASE_MODEL_URL}`);
      const result = await SceneLoader.ImportMeshAsync("", "", STARBASE_MODEL_URL, this.scene);

      console.log(`✓ Loaded ${result.meshes.length} total meshes from GLB`);
      const meshes = result.meshes.filter((mesh) => (
        typeof mesh.getTotalVertices === "function" && mesh.getTotalVertices() > 0
      ));
      console.log(`✓ Filtered to ${meshes.length} renderable meshes`);
      if (meshes.length === 0) {
        throw new Error("star_trek_-_starbase_375.glb did not produce renderable meshes.");
      }

      const bounds = this.computeMeshBounds(meshes);
      const maxDimension = Math.max(
        0.001,
        bounds.max.x - bounds.min.x,
        bounds.max.y - bounds.min.y,
        bounds.max.z - bounds.min.z,
      );
      console.log(`📐 Bounds: min=${JSON.stringify(bounds.min)}, max=${JSON.stringify(bounds.max)}, maxDim=${maxDimension}`);

      const starbaseTargetSize = 15.0;
      const starbaseScale = starbaseTargetSize / maxDimension;
      console.log(`📏 Scaling to ${starbaseTargetSize} world units: scale=${starbaseScale}`);

      const assetRoot = new TransformNode("starbaseAssetRoot", this.scene);
      assetRoot.parent = this.starbaseRoot;
      assetRoot.position = bounds.center.scale(-1);

      for (const mesh of meshes) {
        this.trimStarbaseVertexData(mesh);
        mesh.parent = assetRoot;
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        this.glowLayer.addIncludedOnlyMesh(mesh as Mesh);
      }

      this.starbaseRoot.scaling.setAll(starbaseScale);

      this.starbaseLight = new PointLight(
        "starbaseInspectionLight",
        new Vector3(0, 6, -10),
        this.scene,
      );
      this.starbaseLight.parent = this.starbaseRoot;
      this.starbaseLight.intensity = 1.0;
      this.starbaseLight.range = 42;
      this.starbaseLight.diffuse = new Color3(0.58, 0.86, 1.0);
      this.starbaseLight.specular = new Color3(0.85, 0.92, 1.0);

      console.log(`✅ Starbase GLB loaded successfully! Root position: ${JSON.stringify(this.starbaseRoot.position)}`);
    } catch (err) {
      console.warn("❌ Failed to load starbase GLB, falling back to procedural starbase", err);
      this.createProceduralStarbaseFallback();
    }
  }

  private trimStarbaseVertexData(mesh: AbstractMesh): void {
    const allowedKinds = new Set(["position", "normal", "uv"]);
    const concreteMesh = mesh as Mesh;
    const kinds = concreteMesh.getVerticesDataKinds();

    for (const kind of kinds) {
      if (!allowedKinds.has(kind)) {
        concreteMesh.removeVerticesData(kind);
      }
    }

    console.log(`🧹 Trimmed ${mesh.name}: ${kinds.join(", ")}`);
  }

  private createProceduralStarbaseFallback(): void {
    if (!this.starbaseRoot) return;

    const hullMat = new StandardMaterial("starbaseHullMat", this.scene);
    hullMat.diffuseColor = new Color3(0.2, 0.24, 0.3);
    hullMat.specularColor = new Color3(0.45, 0.5, 0.58);
    hullMat.emissiveColor = new Color3(0.03, 0.05, 0.08);

    const accentMat = new StandardMaterial("starbaseAccentMat", this.scene);
    accentMat.diffuseColor = Color3.Black();
    accentMat.specularColor = Color3.Black();
    accentMat.disableLighting = true;
    accentMat.emissiveColor = new Color3(0.48, 0.84, 1.0).scale(1.5);
    accentMat.alpha = 0.95;

    const hubMat = new StandardMaterial("starbaseHubMat", this.scene);
    hubMat.diffuseColor = new Color3(0.34, 0.38, 0.46);
    hubMat.specularColor = new Color3(0.62, 0.68, 0.75);
    hubMat.emissiveColor = new Color3(0.04, 0.06, 0.1);

    const core = MeshBuilder.CreateCylinder(
      "starbaseCore",
      {
        height: 2.8,
        diameterTop: 1.7,
        diameterBottom: 1.9,
        tessellation: 28,
      },
      this.scene,
    );
    core.parent = this.starbaseRoot;
    core.material = hullMat;
    core.isPickable = false;

    const ring = MeshBuilder.CreateTorus(
      "starbaseRing",
      {
        diameter: 5.2,
        thickness: 0.28,
        tessellation: 64,
      },
      this.scene,
    );
    ring.parent = this.starbaseRoot;
    ring.rotation.x = Math.PI / 2;
    ring.material = accentMat;
    ring.isPickable = false;

    const hub = MeshBuilder.CreateSphere(
      "starbaseHub",
      { diameter: 1.25, segments: 20 },
      this.scene,
    );
    hub.parent = this.starbaseRoot;
    hub.material = hubMat;
    hub.isPickable = false;

    this.glowLayer.addIncludedOnlyMesh(core);
    this.glowLayer.addIncludedOnlyMesh(ring);
    this.glowLayer.addIncludedOnlyMesh(hub);

    this.starbaseLight = new PointLight(
      "starbaseInspectionLight",
      new Vector3(0, 6, -10),
      this.scene,
    );
    this.starbaseLight.parent = this.starbaseRoot;
    this.starbaseLight.intensity = 1.0;
    this.starbaseLight.range = 42;
    this.starbaseLight.diffuse = new Color3(0.58, 0.86, 1.0);
    this.starbaseLight.specular = new Color3(0.85, 0.92, 1.0);
  }

  async setup(): Promise<void> {
    const canvas = this.engine.getRenderingCanvas()!;

    this.configureVisualPreset();
    this.setupBackground();
    this.setupCamera(canvas);
    this.setupLighting();
    this.buildSystemObjects();
    await this.createPlayerShipIfPresent();
    await this.createStarbaseIfPresent();
    this.setStarsVisible(this.starsVisible);
    this.setBloomEnabled(this.bloomEnabled);

    window.addEventListener("keydown", this.onEscapeKey);
    await this.scene.whenReadyAsync();
  }

  onBeforeRender(): void {
    const dt = this.engine.getDeltaTime() / 1000;
    this.elapsed += dt;

    this.orbitSystem.update(dt);

    if (this.starMesh) {
      this.starMesh.rotation.y += this.starRotationSpeed * dt;
    }
    if (this.starDetailMesh) {
      this.starDetailMesh.rotation.y += this.starDetailRotationSpeed * dt;
      this.starDetailMesh.rotation.x += this.starDetailTiltSpeed * dt;
    }

    if (this.starCoronaMesh && this.starKind !== "black-hole") {
      const coronaPulse = 1 + this.coronaPulseAmplitude * Math.sin(this.elapsed * this.coronaPulseSpeed);
      this.starCoronaMesh.scaling.setAll(coronaPulse);
    }

    if (this.playerShipRoot) {
      const t = Math.min(1, dt * 4.5);
      this.playerShipBasePosition.x = this.playerShipBasePosition.x + (this.playerShipTargetPosition.x - this.playerShipBasePosition.x) * t;
      this.playerShipBasePosition.y = this.playerShipBasePosition.y + (this.playerShipTargetPosition.y - this.playerShipBasePosition.y) * t;
      this.playerShipBasePosition.z = this.playerShipBasePosition.z + (this.playerShipTargetPosition.z - this.playerShipBasePosition.z) * t;
      this.playerShipRoot.position.x = this.playerShipBasePosition.x;
      this.playerShipRoot.position.y =
        this.playerShipBasePosition.y + Math.sin(this.elapsed * 1.15) * 0.32;
      this.playerShipRoot.position.z = this.playerShipBasePosition.z;
      this.playerShipRoot.rotation.y += dt * 0.16;
    }
    if (this.playerShipThrusterMaterial) {
      const thrusterPulse = 0.65 + 0.35 * Math.sin(this.elapsed * 5.8);
      this.playerShipThrusterMaterial.alpha = 0.45 + thrusterPulse * 0.45;
      this.playerShipThrusterMaterial.emissiveColor = new Color3(0.32, 0.72, 1.0).scale(
        1.8 + thrusterPulse * 1.2,
      );
    }

    if (this.starKind === "pulsar") {
      const beamPulse = 0.5 + 0.5 * Math.abs(Math.sin(this.elapsed * this.glowPulseSpeed));

      if (this.pulsarBeamPivot) {
        this.pulsarBeamPivot.rotation.y += 8.5 * dt;
        this.pulsarBeamPivot.rotation.z = 0.25 * Math.sin(this.elapsed * 0.8);
      }
      if (this.pulsarBeamMaterial) {
        this.pulsarBeamMaterial.alpha = 0.2 + 0.65 * beamPulse;
      }
      if (this.starLight) {
        this.starLight.intensity = this.starLightIntensity * (0.6 + 0.95 * beamPulse);
      }
      if (this.fillLight) {
        this.fillLight.intensity = this.fillIntensity * (0.5 + 0.8 * beamPulse);
      }

      this.glowLayer.intensity = this.glowBaseIntensity + this.glowPulseAmplitude * beamPulse;
    } else if (this.starKind === "black-hole") {
      if (this.blackHoleDiskOuter) {
        this.blackHoleDiskOuter.rotation.y += 0.28 * dt;
      }
      if (this.blackHoleDiskInner) {
        this.blackHoleDiskInner.rotation.y -= 0.4 * dt;
      }

      const diskPulse = 0.7 + 0.3 * Math.sin(this.elapsed * this.glowPulseSpeed);
      this.glowLayer.intensity = this.glowBaseIntensity + this.glowPulseAmplitude * diskPulse;
    } else {
      this.glowLayer.intensity =
        this.glowBaseIntensity + this.glowPulseAmplitude * Math.sin(this.elapsed * this.glowPulseSpeed);
    }

    if (!this.bloomEnabled) {
      this.glowLayer.intensity = 0;
    }

    this.updatePlanetLabels();
    this.updateStarOcclusionAndGlow();
  }

  private updatePlanetLabels(): void {
    // Update planet labels
    for (let i = 0; i < this.planetMeshes.length; i++) {
      const planetMesh = this.planetMeshes[i];
      const labelMesh = this.planetLabelMeshes[i];
      const diameter = this.planetDiameters[i];
      if (labelMesh && planetMesh && diameter) {
        // Position label above planet based on its actual diameter
        const offsetDistance = diameter * 0.6 + 1.2;
        labelMesh.position = new Vector3(
          planetMesh.position.x,
          planetMesh.position.y + offsetDistance,
          planetMesh.position.z,
        );
        this.faceSystemLabelToCamera(labelMesh);
      }
    }

    // Update star label
    if (this.starLabelMesh && this.starMesh) {
      const offsetDistance = this.starDiameter * 0.6 + 1.2;
      this.starLabelMesh.position = new Vector3(
        this.starMesh.position.x,
        this.starMesh.position.y + offsetDistance,
        this.starMesh.position.z,
      );
      this.faceSystemLabelToCamera(this.starLabelMesh);
    }
  }

  private faceSystemLabelToCamera(labelMesh: Mesh): void {
    const camera = this.scene.activeCamera ?? this.camera;
    if (!camera) return;

    const toCamera = camera.position.subtract(labelMesh.position);
    if (toCamera.lengthSquared() < 0.0001) return;

    const normal = toCamera.normalize();
    const cameraRight = camera.getDirection(Vector3.Right()).normalize();
    const cameraUp = camera.getDirection(Vector3.Up()).normalize();

    let right = cameraRight.subtract(normal.scale(Vector3.Dot(cameraRight, normal)));
    if (right.lengthSquared() < 0.0001) {
      right = Vector3.Cross(Vector3.Up(), normal);
    }
    if (right.lengthSquared() < 0.0001) {
      right = Vector3.Right();
    }
    right.normalize();
    if (Vector3.Dot(right, cameraRight) < 0) {
      right.scaleInPlace(-1);
    }

    let up = Vector3.Cross(normal, right);
    if (Vector3.Dot(up, cameraUp) < 0) {
      right.scaleInPlace(-1);
      up = Vector3.Cross(normal, right);
    }
    up.normalize();

    const rotationMatrix = Matrix.Identity();
    Matrix.FromXYZAxesToRef(right, up, normal, rotationMatrix);
    labelMesh.rotationQuaternion = Quaternion.FromRotationMatrix(rotationMatrix);
  }

  private updateStarOcclusionAndGlow(): void {
    if (!this.starMesh || !this.camera || !this.glowLayer) return;

    const camPos = this.camera.position;
    const starPos = this.starMesh.position;
    const dir = starPos.subtract(camPos);
    const dist = dir.length();
    if (dist <= 0.0001) return;

    const ray = new Ray(camPos, dir.normalize(), dist - 0.001);
    const pick = this.scene.pickWithRay(ray, (mesh) => {
      if (!mesh) return false;
      // Ignore star's own meshes
      if (mesh === this.starMesh || mesh === this.starDetailMesh || mesh === this.starCoronaMesh) return false;
      // Ignore label planes (they are UI-like and should not occlude glow)
      if (mesh.name && (mesh.name.startsWith("planetLabel_mesh") || mesh.name.includes("Label"))) return false;
      return true;
    });

    const occluded = !!(pick && pick.hit && pick.pickedPoint);
    this.starOccluded = occluded;

    if (this.debugLogOccluder && occluded && pick && pick.pickedMesh) {
      console.log(`🌑 Star occluded by mesh: ${pick.pickedMesh.name}`);
      if (this.deepDebug) {
        // Dump material info for the occluding mesh
        this.dumpMeshMaterialInfo(pick.pickedMesh);

        // Find a starbase mesh (if present) to compare materials
        const sb = this.scene.meshes.find((m) => m.name.toLowerCase().includes("starbase") && m.material);
        if (sb) {
          console.log("🔎 Example starbase mesh for comparison:", sb.name);
          this.dumpMeshMaterialInfo(sb);
        }

        // If the occluder is not a planet, also dump the nearest planet material
        if (!pick.pickedMesh.name.startsWith("systemPlanet")) {
          const planet = this.planetMeshes.length > 0 ? this.planetMeshes[0] : null;
          if (planet) {
            console.log(`🔎 Example planet mesh for comparison: ${planet.name}`);
            this.dumpMeshMaterialInfo(planet);
          }
        }
      }
    }

    const target = occluded ? this.glowBaseIntensity * 0.12 : this.glowBaseIntensity;
    const current = this.glowLayer.intensity;
    this.glowLayer.intensity = current + (target - current) * 0.18;
  }

  private dumpMeshMaterialInfo(mesh: AbstractMesh | null): void {
    if (!mesh) return;
    try {
      mesh.computeWorldMatrix(true);
      console.log(`  • Mesh: ${mesh.name}, renderingGroupId=${(mesh as Mesh).renderingGroupId}, isPickable=${mesh.isPickable}, alwaysSelectAsActiveMesh=${mesh.alwaysSelectAsActiveMesh}`);
      const material = (mesh as Mesh).material as any;
      if (!material) {
        console.log("    - No material attached");
        return;
      }

      // Handle MultiMaterial
      if (material.subMaterials) {
        console.log(`    - MultiMaterial with ${material.subMaterials.length} subMaterials`);
        material.subMaterials.forEach((m: any, idx: number) => {
          console.log(`    - subMaterial[${idx}]: ${m.name || "<anon>"}`);
          this.logMaterialFields(m);
        });
        return;
      }

      console.log(`    - Material: ${material.name || "<anon>"}, type=${material.getClassName ? material.getClassName() : typeof material}`);
      this.logMaterialFields(material);
    } catch (err) {
      console.warn("Failed to dump material info", err);
    }
  }

  private logMaterialFields(mat: any): void {
    if (!mat) return;
    const entries: string[] = [];
    try {
      entries.push(`alpha=${mat.alpha}`);
      if (typeof mat.transparencyMode !== "undefined") entries.push(`transparencyMode=${mat.transparencyMode}`);
      if (typeof mat.useAlphaFromDiffuseTexture !== "undefined") entries.push(`useAlphaFromDiffuseTexture=${mat.useAlphaFromDiffuseTexture}`);
      if (typeof mat.needDepthPrePass !== "undefined") entries.push(`needDepthPrePass=${mat.needDepthPrePass}`);
      if (typeof mat.backFaceCulling !== "undefined") entries.push(`backFaceCulling=${mat.backFaceCulling}`);
      if (typeof (mat as any).forceDepthWrite !== "undefined") entries.push(`forceDepthWrite=${(mat as any).forceDepthWrite}`);
      if (typeof mat.disableLighting !== "undefined") entries.push(`disableLighting=${mat.disableLighting}`);
      if (mat.emissiveColor) entries.push(`emissiveColor=${mat.emissiveColor.r?.toFixed(2)},${mat.emissiveColor.g?.toFixed(2)},${mat.emissiveColor.b?.toFixed(2)}`);
      if (mat.diffuseTexture) entries.push(`diffuseTexture=${mat.diffuseTexture.name || mat.diffuseTexture.url || '<texture>'}`);
      if (mat.opacityTexture) entries.push(`opacityTexture=${mat.opacityTexture?.name || mat.opacityTexture?.url || '<texture>'}`);
      if (mat.emissiveTexture) entries.push(`emissiveTexture=${mat.emissiveTexture?.name || mat.emissiveTexture?.url || '<texture>'}`);
    } catch (err) {
      entries.push(`(failed reading fields: ${err})`);
    }
    for (const e of entries) console.log(`      - ${e}`);
  }

  private configureVisualPreset(): void {
    const typeCfg = STAR_TYPES[this.star.type];
    this.starKind = typeCfg.kind;

    // Defaults
    this.glowBaseIntensity = 1.7;
    this.glowPulseAmplitude = 0.18;
    this.glowPulseSpeed = 1.3;

    this.coronaPulseAmplitude = 0.035;
    this.coronaPulseSpeed = 1.8;

    this.starRotationSpeed = 0.04;
    this.starDetailRotationSpeed = -0.09;
    this.starDetailTiltSpeed = 0.015;

    this.starBaseEmissiveScale = 1.75;
    this.starDetailEmissiveScale = 1.3;
    this.starDetailTextureLevel = 1.5;
    this.starDetailAlpha = 0.68;
    this.starCoronaScale = 1.22;
    this.starCoronaAlpha = 0.34;
    this.systemScaleMultiplier = 1.15;
    this.detailTexturePath = "/textures/star_surface.png";

    this.ambientIntensity = 0.2;
    this.bounceIntensity = 0.08;
    this.starLightIntensity = 3.2;
    this.starLightRange = 220;
    this.fillIntensity = 0.55;
    this.fillColor = new Color3(0.32, 0.38, 0.5);

    this.orbitBaseOffset = 14;
    this.orbitSpacing = 11;
    this.planetNightLift = new Color3(0.12, 0.12, 0.15);

    switch (this.star.type) {
      case StarType.B:
        this.starBaseEmissiveScale = 2.1;
        this.starDetailEmissiveScale = 1.6;
        this.starDetailTextureLevel = 1.9;
        this.starCoronaScale = 1.38;
        this.starCoronaAlpha = 0.46;

        this.starRotationSpeed = 0.07;
        this.starDetailRotationSpeed = -0.16;
        this.starDetailTiltSpeed = 0.02;

        this.glowBaseIntensity = 2.05;
        this.glowPulseAmplitude = 0.24;
        this.glowPulseSpeed = 1.9;

        this.starLightIntensity = 4.2;
        this.starLightRange = 260;
        this.fillIntensity = 0.7;
        this.fillColor = new Color3(0.36, 0.43, 0.62);
        break;

      case StarType.A:
        this.starBaseEmissiveScale = 1.95;
        this.starDetailEmissiveScale = 1.45;
        this.starDetailTextureLevel = 1.7;
        this.starCoronaScale = 1.32;
        this.starCoronaAlpha = 0.4;

        this.starRotationSpeed = 0.06;
        this.starDetailRotationSpeed = -0.13;
        this.starDetailTiltSpeed = 0.018;

        this.glowBaseIntensity = 1.9;
        this.glowPulseAmplitude = 0.18;
        this.glowPulseSpeed = 1.6;

        this.starLightIntensity = 3.8;
        this.starLightRange = 245;
        this.fillIntensity = 0.62;
        this.fillColor = new Color3(0.36, 0.41, 0.56);
        break;

      case StarType.F:
        this.starBaseEmissiveScale = 1.72;
        this.starDetailEmissiveScale = 1.28;
        this.starDetailTextureLevel = 1.45;
        this.starCoronaScale = 1.24;
        this.starCoronaAlpha = 0.34;

        this.starLightIntensity = 3.3;
        this.starLightRange = 225;
        this.fillIntensity = 0.58;
        this.fillColor = new Color3(0.4, 0.4, 0.45);
        break;

      case StarType.G:
        this.starBaseEmissiveScale = 1.62;
        this.starDetailEmissiveScale = 1.22;
        this.starDetailTextureLevel = 1.38;
        this.starCoronaScale = 1.2;
        this.starCoronaAlpha = 0.3;

        this.starLightIntensity = 3.0;
        this.starLightRange = 215;
        this.fillIntensity = 0.52;
        this.fillColor = new Color3(0.38, 0.35, 0.32);
        break;

      case StarType.K:
        this.starBaseEmissiveScale = 1.45;
        this.starDetailEmissiveScale = 1.1;
        this.starDetailTextureLevel = 1.25;
        this.starCoronaScale = 1.16;
        this.starCoronaAlpha = 0.28;

        this.starRotationSpeed = 0.03;
        this.starDetailRotationSpeed = -0.07;

        this.glowBaseIntensity = 1.45;
        this.glowPulseAmplitude = 0.12;

        this.starLightIntensity = 2.6;
        this.starLightRange = 200;
        this.fillIntensity = 0.48;
        this.fillColor = new Color3(0.4, 0.3, 0.26);
        break;

      case StarType.M:
        this.starBaseEmissiveScale = 1.2;
        this.starDetailEmissiveScale = 1.0;
        this.starDetailTextureLevel = 1.18;
        this.starDetailAlpha = 0.72;
        this.starCoronaScale = 1.15;
        this.starCoronaAlpha = 0.26;

        this.starRotationSpeed = 0.028;
        this.starDetailRotationSpeed = -0.05;

        this.glowBaseIntensity = 1.2;
        this.glowPulseAmplitude = 0.2;
        this.glowPulseSpeed = 1.15;

        this.starLightIntensity = 2.0;
        this.starLightRange = 175;
        this.fillIntensity = 0.44;
        this.fillColor = new Color3(0.34, 0.25, 0.23);
        break;

      case StarType.MRedGiant:
        this.starBaseEmissiveScale = 1.55;
        this.starDetailEmissiveScale = 1.12;
        this.starDetailTextureLevel = 1.35;
        this.starDetailAlpha = 0.62;
        this.starCoronaScale = 1.72;
        this.starCoronaAlpha = 0.52;
        this.systemScaleMultiplier = 1.75;

        this.starRotationSpeed = 0.018;
        this.starDetailRotationSpeed = -0.042;
        this.starDetailTiltSpeed = 0.01;

        this.glowBaseIntensity = 1.95;
        this.glowPulseAmplitude = 0.28;
        this.glowPulseSpeed = 0.75;

        this.ambientIntensity = 0.24;
        this.bounceIntensity = 0.11;
        this.starLightIntensity = 4.0;
        this.starLightRange = 350;
        this.fillIntensity = 0.75;
        this.fillColor = new Color3(0.5, 0.32, 0.22);

        this.orbitBaseOffset = 28;
        this.orbitSpacing = 16;
        this.planetNightLift = new Color3(0.14, 0.13, 0.14);
        break;

      case StarType.TBrownDwarf:
        this.starBaseEmissiveScale = 0.72;
        this.starDetailEmissiveScale = 0.62;
        this.starDetailTextureLevel = 1.0;
        this.starDetailAlpha = 0.78;
        this.starCoronaScale = 1.08;
        this.starCoronaAlpha = 0.12;
        this.systemScaleMultiplier = 1.0;
        this.detailTexturePath = "/textures/gas_giant.png";

        this.starRotationSpeed = 0.03;
        this.starDetailRotationSpeed = -0.05;

        this.glowBaseIntensity = 0.95;
        this.glowPulseAmplitude = 0.08;
        this.glowPulseSpeed = 0.9;

        this.ambientIntensity = 0.16;
        this.bounceIntensity = 0.07;
        this.starLightIntensity = 1.2;
        this.starLightRange = 130;
        this.fillIntensity = 0.42;
        this.fillColor = new Color3(0.3, 0.22, 0.2);

        this.orbitBaseOffset = 12;
        this.orbitSpacing = 10;
        this.planetNightLift = new Color3(0.16, 0.15, 0.16);
        break;

      case StarType.NeutronStar:
        this.starBaseEmissiveScale = 3.0;
        this.starDetailEmissiveScale = 2.3;
        this.starDetailTextureLevel = 2.2;
        this.starDetailAlpha = 0.45;
        this.starCoronaScale = 1.55;
        this.starCoronaAlpha = 0.28;
        this.systemScaleMultiplier = 0.48;

        this.starRotationSpeed = 0.34;
        this.starDetailRotationSpeed = -0.55;
        this.starDetailTiltSpeed = 0.03;

        this.glowBaseIntensity = 2.35;
        this.glowPulseAmplitude = 0.42;
        this.glowPulseSpeed = 3.2;

        this.ambientIntensity = 0.18;
        this.bounceIntensity = 0.07;
        this.starLightIntensity = 4.8;
        this.starLightRange = 190;
        this.fillIntensity = 0.62;
        this.fillColor = new Color3(0.35, 0.43, 0.62);

        this.orbitBaseOffset = 13;
        this.orbitSpacing = 10;
        this.planetNightLift = new Color3(0.14, 0.14, 0.16);
        break;

      case StarType.Pulsar:
        this.starBaseEmissiveScale = 3.3;
        this.starDetailEmissiveScale = 2.5;
        this.starDetailTextureLevel = 2.4;
        this.starDetailAlpha = 0.5;
        this.starCoronaScale = 1.65;
        this.starCoronaAlpha = 0.35;
        this.systemScaleMultiplier = 0.42;

        this.starRotationSpeed = 0.85;
        this.starDetailRotationSpeed = -1.4;
        this.starDetailTiltSpeed = 0.06;

        this.glowBaseIntensity = 2.6;
        this.glowPulseAmplitude = 0.95;
        this.glowPulseSpeed = 7.5;

        this.ambientIntensity = 0.17;
        this.bounceIntensity = 0.07;
        this.starLightIntensity = 3.0;
        this.starLightRange = 220;
        this.fillIntensity = 0.35;
        this.fillColor = new Color3(0.3, 0.4, 0.58);

        this.orbitBaseOffset = 14;
        this.orbitSpacing = 11;
        this.planetNightLift = new Color3(0.14, 0.14, 0.17);
        break;

      case StarType.BlackHole:
        this.starBaseEmissiveScale = 0;
        this.starDetailEmissiveScale = 0;
        this.starDetailTextureLevel = 0;
        this.starDetailAlpha = 0;
        this.starCoronaScale = 1.0;
        this.starCoronaAlpha = 0;
        this.systemScaleMultiplier = 0.9;

        this.starRotationSpeed = 0;
        this.starDetailRotationSpeed = 0;
        this.starDetailTiltSpeed = 0;

        this.glowBaseIntensity = 1.25;
        this.glowPulseAmplitude = 0.16;
        this.glowPulseSpeed = 1.1;

        this.ambientIntensity = 0.14;
        this.bounceIntensity = 0.05;
        this.starLightIntensity = 1.25;
        this.starLightRange = 280;
        this.fillIntensity = 0.55;
        this.fillColor = new Color3(0.42, 0.34, 0.28);

        this.orbitBaseOffset = 20;
        this.orbitSpacing = 14;
        this.planetNightLift = new Color3(0.18, 0.18, 0.2);
        break;
    }
  }

  private setupBackground(): void {
    const bgSphere = MeshBuilder.CreateSphere(
      "systemBackground",
      { diameter: 4000, segments: 20 },
      this.scene,
    );
    const bgMat = new StandardMaterial("systemBackgroundMat", this.scene);
    bgMat.emissiveTexture = new Texture("/textures/galaxy_bg.png", this.scene);
    bgMat.disableLighting = true;
    bgMat.backFaceCulling = false;
    bgSphere.material = bgMat;
    bgSphere.isPickable = false;
    bgSphere.infiniteDistance = true;
  }

  private setupCamera(canvas: HTMLCanvasElement): void {
    this.camera = new ArcRotateCamera(
      "systemCamera",
      -Math.PI / 2,
      Math.PI / 2.6,
      65,
      Vector3.Zero(),
      this.scene,
    );

    this.camera.attachControl(canvas, true);
    this.camera.lowerRadiusLimit = 12;
    this.camera.upperRadiusLimit = 260;
    this.camera.lowerBetaLimit = 0.12;
    this.camera.upperBetaLimit = Math.PI / 2.05;
    this.camera.wheelDeltaPercentage = 0.06;
    this.camera.inertia = 0.84;

    this.camera.panningSensibility = 0;
    this.camera.keysUp = [];
    this.camera.keysDown = [];
    this.camera.keysLeft = [];
    this.camera.keysRight = [];
  }

  private setupLighting(): void {
    const hemi = new HemisphericLight("systemAmbient", new Vector3(0, 1, 0), this.scene);
    hemi.intensity = this.ambientIntensity;
    hemi.diffuse = new Color3(0.45, 0.48, 0.55);
    hemi.specular = new Color3(0.25, 0.25, 0.3);

    const bounce = new HemisphericLight("systemBounce", new Vector3(0, -1, 0), this.scene);
    bounce.intensity = this.bounceIntensity * 1.3;
    bounce.diffuse = new Color3(0.2, 0.22, 0.26);
    bounce.specular = new Color3(0.05, 0.05, 0.08);

    const starLightColor =
      this.starKind === "black-hole"
        ? new Color3(1.0, 0.82, 0.56)
        : new Color3(this.star.color[0], this.star.color[1], this.star.color[2]);

    this.starLight = new PointLight("systemStarLight", Vector3.Zero(), this.scene);
    this.starLight.intensity = this.starLightIntensity;
    this.starLight.range = this.starLightRange;
    this.starLight.diffuse = starLightColor;
    this.starLight.specular = new Color3(0.8, 0.8, 0.85);

    this.fillLight = new PointLight("systemFillLight", new Vector3(0, -28, 0), this.scene);
    this.fillLight.intensity = this.fillIntensity;
    this.fillLight.range = 320;
    this.fillLight.diffuse = this.fillColor;

    this.glowLayer = new GlowLayer("systemGlow", this.scene, {
      mainTextureFixedSize: 1024,
      blurKernelSize: 48,
    });
    this.glowLayer.intensity = this.glowBaseIntensity;
    this.scene.ambientColor = new Color3(0.18, 0.2, 0.24);

    // Debug: allow toggling glow with 'g' key to quickly test occlusion behavior
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", (ev: KeyboardEvent) => {
        if (ev.key.toLowerCase() === "g") {
          this.glowLayer!.isEnabled = !this.glowLayer!.isEnabled;
          console.log(`🔆 Glow layer toggled: ${this.glowLayer!.isEnabled}`);
        }
        if (ev.key.toLowerCase() === "d") {
          this.deepDebug = !this.deepDebug;
          console.log(`🐞 Deep debug toggled: ${this.deepDebug}`);
        }
      });
    }
  }

  private buildSystemObjects(): void {
    const typeCfg = STAR_TYPES[this.star.type];
    const starTint = new Color3(this.star.color[0], this.star.color[1], this.star.color[2]);
    const starDiameter = Math.max(1.2, typeCfg.systemDiameter * this.systemScaleMultiplier);
    this.starDiameter = starDiameter;

    this.starMesh = MeshBuilder.CreateSphere(
      "systemStar",
      { diameter: starDiameter, segments: 40 },
      this.scene,
    );

    const starBaseMat = new StandardMaterial("systemStarBaseMat", this.scene);
    starBaseMat.emissiveColor =
      this.starKind === "black-hole"
        ? Color3.Black()
        : starTint.scale(this.starBaseEmissiveScale);
    starBaseMat.diffuseColor = Color3.Black();
    starBaseMat.specularColor = Color3.Black();
    starBaseMat.disableLighting = true;
    this.starMesh.material = starBaseMat;
    this.starMesh.isPickable = false;

    this.starDetailMesh = MeshBuilder.CreateSphere(
      "systemStarDetail",
      { diameter: starDiameter * 1.008, segments: 40 },
      this.scene,
    );
    this.starDetailMesh.parent = this.starMesh;

    const detailMat = new StandardMaterial("systemStarDetailMat", this.scene);
    if (this.starDetailTextureLevel > 0.01) {
      detailMat.emissiveTexture = new Texture(this.detailTexturePath, this.scene);
      detailMat.emissiveTexture.level = this.starDetailTextureLevel;
    }
    detailMat.emissiveColor =
      this.starKind === "black-hole"
        ? new Color3(0.05, 0.05, 0.06)
        : starTint.scale(this.starDetailEmissiveScale);
    detailMat.diffuseColor = Color3.Black();
    detailMat.specularColor = Color3.Black();
    detailMat.disableLighting = true;
    detailMat.alpha = this.starDetailAlpha;
    detailMat.backFaceCulling = false;
    this.starDetailMesh.material = detailMat;
    this.starDetailMesh.isPickable = false;

    this.starCoronaMesh = MeshBuilder.CreateSphere(
      "systemStarCorona",
      { diameter: starDiameter * this.starCoronaScale, segments: 28 },
      this.scene,
    );
    this.starCoronaMesh.parent = this.starMesh;

    const coronaMat = new StandardMaterial("systemStarCoronaMat", this.scene);
    coronaMat.emissiveColor =
      this.starKind === "black-hole"
        ? new Color3(0.05, 0.05, 0.07)
        : starTint.scale(1.2);
    coronaMat.diffuseColor = Color3.Black();
    coronaMat.specularColor = Color3.Black();
    coronaMat.disableLighting = true;
    coronaMat.backFaceCulling = false;
    coronaMat.alpha = this.starCoronaAlpha;
    this.starCoronaMesh.material = coronaMat;
    this.starCoronaMesh.isPickable = false;

    if (this.starKind !== "black-hole") {
      // Avoid adding the base star mesh to the glow layer — the glow render
      // pass can cause emissive effect to appear over occluders. Only include
      // detail/corona meshes which will be depth-checked.
      // this.glowLayer.addIncludedOnlyMesh(this.starMesh);
      if (this.starDetailMesh) {
        // Ensure the detail material participates in depth tests to avoid
        // drawing over nearer occluders like planets.
        const detMat = this.starDetailMesh.material as StandardMaterial | null;
        if (detMat) {
          detMat.needDepthPrePass = true as any;
          // Force write to depth buffer so occluders hide the detail when needed
          (detMat as any).forceDepthWrite = true;
        }
        this.glowLayer.addIncludedOnlyMesh(this.starDetailMesh);
      }
      if (this.starCoronaMesh && this.starCoronaAlpha > 0.01) {
        const coronaMat = this.starCoronaMesh.material as StandardMaterial | null;
        if (coronaMat) {
          coronaMat.needDepthPrePass = true as any;
          (coronaMat as any).forceDepthWrite = true;
        }
        this.glowLayer.addIncludedOnlyMesh(this.starCoronaMesh);
      }
    }

    if (this.starKind === "red-giant") {
      this.createRedGiantAtmosphere(starDiameter, starTint);
    }
    if (this.starKind === "pulsar") {
      this.createPulsarBeams(starDiameter, starTint);
    }
    if (this.starKind === "black-hole") {
      this.createBlackHoleFeatures(starDiameter);
    }

    const planets =
      this.star.system.planets.length > 0
        ? this.star.system.planets
        : this.createFallbackPlanets(this.starKind);

    // Mark one random planet as habited if this is a starting owned system
    const isOwnedSystem = this.homeSystemStarIds.has(this.star.id);
    if (isOwnedSystem && planets.length > 0) {
      const habitedIndex = Math.floor(Math.random() * planets.length);
      planets[habitedIndex].isHabited = true;
    }

    for (let i = 0; i < planets.length; i++) {
      this.createPlanet(i, planets[i]);
    }

    // Create star label
    this.starLabelMesh = this.createStarLabel();
  }

  private async createPlayerShipIfPresent(): Promise<void> {
    console.log(`🔍 Checking player ship: star.id=${this.star.id}, using starCount=${this.starCount}`);
    if (!this.hasPlayerShipPresence() || this.playerShipRoot) return;
    console.log(`✅ This is the player ship system!`);

    console.log(`🚀 Loading player ship for star ID ${this.star.id}`);

    this.playerShipBasePosition = PLAYER_SHIP_BASE_POSITION.clone();
    this.playerShipTargetPosition = PLAYER_SHIP_BASE_POSITION.clone();
    const serverPosition = this.shipSystemPositions[this.star.id];
    if (serverPosition) {
      this.playerShipBasePosition.set(serverPosition.x, serverPosition.y, serverPosition.z);
      this.playerShipTargetPosition.copyFrom(this.playerShipBasePosition);
    }
    this.playerShipRoot = new TransformNode("playerShipRoot", this.scene);
    this.playerShipRoot.position = this.playerShipBasePosition.clone();
    this.playerShipRoot.rotation.set(0.18, -0.7, -0.08);
    console.log(`📍 Player ship root position: ${JSON.stringify(this.playerShipBasePosition)}`);

    try {
      console.log(`📦 Importing ${PLAYER_SHIP_MODEL_FILE} from ${PLAYER_SHIP_MODEL_ROOT}`);
      const result = await SceneLoader.ImportMeshAsync(
        "",
        PLAYER_SHIP_MODEL_ROOT,
        PLAYER_SHIP_MODEL_FILE,
        this.scene,
      );

      console.log(`✓ Loaded ${result.meshes.length} total meshes from OBJ`);
      const meshes = result.meshes.filter((mesh) => (
        typeof mesh.getTotalVertices === "function" && mesh.getTotalVertices() > 0
      ));
      console.log(`✓ Filtered to ${meshes.length} renderable meshes`);
      if (meshes.length === 0) {
        throw new Error("Fighter_01.obj did not produce renderable meshes.");
      }

      const bounds = this.computeMeshBounds(meshes);
      const maxDimension = Math.max(
        0.001,
        bounds.max.x - bounds.min.x,
        bounds.max.y - bounds.min.y,
        bounds.max.z - bounds.min.z,
      );
      console.log(`📐 Bounds: min=${JSON.stringify(bounds.min)}, max=${JSON.stringify(bounds.max)}, maxDim=${maxDimension}`);
      const shipScale = PLAYER_SHIP_TARGET_SIZE / maxDimension;
      console.log(`📏 Scaling to ${PLAYER_SHIP_TARGET_SIZE} world units: scale=${shipScale}`);

      const assetRoot = new TransformNode("playerShipAssetRoot", this.scene);
      assetRoot.parent = this.playerShipRoot;
      assetRoot.position = bounds.center.scale(-1);

      for (const mesh of meshes) {
        mesh.parent = assetRoot;
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        console.log(`  - Mesh "${mesh.name}": vertices=${mesh.getTotalVertices()}`);
        this.applyPlayerShipMaterialStyle(mesh.material);
      }

      this.playerShipRoot.scaling.setAll(shipScale);
      this.createPlayerShipReadabilityLight();
      console.log(`✅ Player ship loaded successfully! Root position: ${JSON.stringify(this.playerShipRoot.position)}, rotation: ${JSON.stringify(this.playerShipRoot.rotation)}`);
    } catch (err) {
      console.warn("❌ Failed to load player ship model", err);
      this.createFallbackPlayerShip();
    }
  }

  private computeMeshBounds(meshes: AbstractMesh[]): {
    min: Vector3;
    max: Vector3;
    center: Vector3;
  } {
    const min = new Vector3(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    );
    const max = new Vector3(
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    );

    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      const corners = mesh.getBoundingInfo().boundingBox.vectorsWorld;
      for (const corner of corners) {
        min.minimizeInPlace(corner);
        max.maximizeInPlace(corner);
      }
    }

    if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) {
      return {
        min: new Vector3(-1, -1, -1),
        max: new Vector3(1, 1, 1),
        center: Vector3.Zero(),
      };
    }

    return {
      min,
      max,
      center: min.add(max).scale(0.5),
    };
  }

  private applyPlayerShipMaterialStyle(material: Material | null): void {
    if (!material) return;

    if (material instanceof MultiMaterial) {
      for (const subMaterial of material.subMaterials) {
        this.applyPlayerShipMaterialStyle(subMaterial);
      }
      return;
    }

    if (!(material instanceof StandardMaterial)) return;

    const name = material.name.toLowerCase();
    material.disableLighting = false;
    material.diffuseColor = new Color3(0.92, 0.96, 1.0);
    material.ambientColor = new Color3(0.34, 0.38, 0.44);
    material.specularColor = new Color3(0.82, 0.86, 0.9);
    material.emissiveColor = new Color3(0.014, 0.016, 0.019);

    if (name.includes("body")) {
      material.diffuseTexture = this.createPlayerShipTexture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Body_BaseColor.png`,
      );
      material.bumpTexture = new Texture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Body_Normal.png`,
        this.scene,
      );
      material.diffuseColor = new Color3(1.02, 1.04, 1.06);
      material.emissiveColor = new Color3(0.026, 0.028, 0.033);
      material.specularPower = 110;
      return;
    }

    if (name.includes("front")) {
      material.diffuseTexture = this.createPlayerShipTexture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Front_BaseColor.png`,
      );
      material.bumpTexture = new Texture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Front_Normal.png`,
        this.scene,
      );
      material.emissiveTexture = new Texture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Front_Emissive.png`,
        this.scene,
      );
      material.diffuseColor = new Color3(0.96, 1.0, 1.04);
      material.emissiveColor = new Color3(0.018, 0.032, 0.052);
      material.specularPower = 160;
      return;
    }

    if (name.includes("rear")) {
      material.diffuseTexture = this.createPlayerShipTexture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Rear_BaseColor.png`,
      );
      material.bumpTexture = new Texture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Rear_Normal.png`,
        this.scene,
      );
      material.emissiveTexture = new Texture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Rear_Emissive.png`,
        this.scene,
      );
      material.diffuseColor = new Color3(0.96, 0.98, 1.0);
      material.emissiveColor = new Color3(0.055, 0.02, 0.012);
      material.specularPower = 150;
      return;
    }

    if (name.includes("windows")) {
      material.diffuseTexture = this.createPlayerShipTexture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Windows_BaseColor.png`,
      );
      material.bumpTexture = new Texture(
        `${PLAYER_SHIP_MODEL_ROOT}textures/Fighter_01_Windows_Normal.png`,
        this.scene,
      );
      material.diffuseColor = new Color3(0.95, 1.0, 1.05);
      material.emissiveColor = new Color3(0.035, 0.08, 0.095);
      material.specularPower = 180;
    }
  }

  private createPlayerShipTexture(url: string, level = 1.35): Texture {
    const texture = new Texture(url, this.scene);
    texture.level = level;
    return texture;
  }

  private createPlayerShipReadabilityLight(): void {
    if (!this.playerShipRoot || this.playerShipLight) return;

    this.playerShipLight = new PointLight(
      "playerShipSoftFill",
      new Vector3(0, 7, -9),
      this.scene,
    );
    this.playerShipLight.parent = this.playerShipRoot;
    this.playerShipLight.intensity = 0.9;
    this.playerShipLight.range = 34;
    this.playerShipLight.diffuse = new Color3(0.64, 0.7, 0.78);
    this.playerShipLight.specular = new Color3(0.72, 0.78, 0.86);
  }

  private createPlayerShipAccents(
    parent: TransformNode,
    bounds: { min: Vector3; max: Vector3; center: Vector3 },
  ): void {
    if (!this.playerShipRoot) return;

    const size = bounds.max.subtract(bounds.min);
    const glowDiameter = Math.max(0.18, Math.max(size.x, size.z) * 0.045);
    const zOffset = Math.max(0.45, size.z * 0.22);
    const engineX = bounds.min.x - size.x * 0.035;

    const thrusterMat = new StandardMaterial("playerShipThrusterMat", this.scene);
    thrusterMat.diffuseColor = Color3.Black();
    thrusterMat.specularColor = Color3.Black();
    thrusterMat.emissiveColor = new Color3(0.32, 0.72, 1.0).scale(2.2);
    thrusterMat.disableLighting = true;
    thrusterMat.alpha = 0.78;
    this.playerShipThrusterMaterial = thrusterMat;

    for (const z of [-zOffset, zOffset]) {
      const glow = MeshBuilder.CreateSphere(
        "playerShipThrusterGlow",
        { diameter: glowDiameter, segments: 16 },
        this.scene,
      );
      glow.parent = parent;
      glow.position.set(engineX, bounds.center.y, bounds.center.z + z);
      glow.material = thrusterMat;
      glow.isPickable = false;
      this.glowLayer.addIncludedOnlyMesh(glow);
    }

    this.playerShipLight = new PointLight(
      "playerShipInspectionLight",
      new Vector3(0, 6, -8),
      this.scene,
    );
    this.playerShipLight.parent = this.playerShipRoot;
    this.playerShipLight.intensity = 1.45;
    this.playerShipLight.range = 46;
    this.playerShipLight.diffuse = new Color3(0.54, 0.7, 1.0);
    this.playerShipLight.specular = new Color3(0.85, 0.9, 1.0);
  }

  private createFallbackPlayerShip(): void {
    if (!this.playerShipRoot) return;

    const body = MeshBuilder.CreateBox(
      "playerShipFallbackBody",
      { width: 6.8, height: 1.1, depth: 2.4 },
      this.scene,
    );
    body.parent = this.playerShipRoot;
    body.isPickable = false;

    const bodyMat = new StandardMaterial("playerShipFallbackBodyMat", this.scene);
    bodyMat.diffuseColor = new Color3(0.28, 0.33, 0.42);
    bodyMat.emissiveColor = new Color3(0.04, 0.06, 0.1);
    bodyMat.specularColor = new Color3(0.65, 0.7, 0.78);
    body.material = bodyMat;
  }

  private createRedGiantAtmosphere(starDiameter: number, starTint: Color3): void {
    if (!this.starMesh) return;

    const haze = MeshBuilder.CreateSphere(
      "redGiantHaze",
      { diameter: starDiameter * 1.5, segments: 24 },
      this.scene,
    );
    haze.parent = this.starMesh;
    haze.isPickable = false;

    const hazeMat = new StandardMaterial("redGiantHazeMat", this.scene);
    hazeMat.emissiveColor = starTint.scale(0.9);
    hazeMat.diffuseColor = Color3.Black();
    hazeMat.specularColor = Color3.Black();
    hazeMat.disableLighting = true;
    hazeMat.backFaceCulling = false;
    hazeMat.alpha = 0.22;
    haze.material = hazeMat;

    this.glowLayer.addIncludedOnlyMesh(haze);
  }

  private createPulsarBeams(starDiameter: number, starTint: Color3): void {
    if (!this.starMesh) return;

    this.pulsarBeamPivot = new TransformNode("pulsarBeamPivot", this.scene);
    this.pulsarBeamPivot.parent = this.starMesh;

    const beamLength = Math.max(18, starDiameter * 18);
    const beamRadius = Math.max(0.08, starDiameter * 0.24);

    const beamMat = new StandardMaterial("pulsarBeamMat", this.scene);
    beamMat.emissiveColor = new Color3(
      Math.min(1, starTint.r * 0.5 + 0.45),
      Math.min(1, starTint.g * 0.7 + 0.45),
      1,
    ).scale(1.8);
    beamMat.diffuseColor = Color3.Black();
    beamMat.specularColor = Color3.Black();
    beamMat.disableLighting = true;
    beamMat.alpha = 0.45;
    beamMat.backFaceCulling = false;
    this.pulsarBeamMaterial = beamMat;

    const upBeam = MeshBuilder.CreateCylinder(
      "pulsarBeamUp",
      {
        height: beamLength,
        diameterTop: 0.01,
        diameterBottom: beamRadius,
        tessellation: 18,
      },
      this.scene,
    );
    upBeam.parent = this.pulsarBeamPivot;
    upBeam.position.y = beamLength * 0.5 + starDiameter * 0.65;
    upBeam.material = beamMat;
    upBeam.isPickable = false;

    const downBeam = MeshBuilder.CreateCylinder(
      "pulsarBeamDown",
      {
        height: beamLength,
        diameterTop: 0.01,
        diameterBottom: beamRadius,
        tessellation: 18,
      },
      this.scene,
    );
    downBeam.parent = this.pulsarBeamPivot;
    downBeam.position.y = -beamLength * 0.5 - starDiameter * 0.65;
    downBeam.rotation.z = Math.PI;
    downBeam.material = beamMat;
    downBeam.isPickable = false;

    this.glowLayer.addIncludedOnlyMesh(upBeam);
    this.glowLayer.addIncludedOnlyMesh(downBeam);
  }

  private createBlackHoleFeatures(starDiameter: number): void {
    if (!this.starMesh) return;

    const outerDisk = MeshBuilder.CreateTorus(
      "blackHoleDiskOuter",
      {
        diameter: starDiameter * 4.8,
        thickness: starDiameter * 0.85,
        tessellation: 72,
      },
      this.scene,
    );
    outerDisk.parent = this.starMesh;
    outerDisk.rotation.x = Math.PI / 2.35;
    outerDisk.isPickable = false;

    const outerMat = new StandardMaterial("blackHoleDiskOuterMat", this.scene);
    outerMat.emissiveTexture = new Texture("/textures/star_surface.png", this.scene);
    outerMat.emissiveTexture.level = 2.0;
    outerMat.emissiveColor = new Color3(1.2, 0.78, 0.4);
    outerMat.diffuseColor = Color3.Black();
    outerMat.specularColor = Color3.Black();
    outerMat.disableLighting = true;
    outerMat.backFaceCulling = false;
    outerMat.alpha = 0.92;
    outerDisk.material = outerMat;

    const innerDisk = MeshBuilder.CreateTorus(
      "blackHoleDiskInner",
      {
        diameter: starDiameter * 3.3,
        thickness: starDiameter * 0.38,
        tessellation: 64,
      },
      this.scene,
    );
    innerDisk.parent = this.starMesh;
    innerDisk.rotation.x = Math.PI / 2.35;
    innerDisk.isPickable = false;

    const innerMat = new StandardMaterial("blackHoleDiskInnerMat", this.scene);
    innerMat.emissiveColor = new Color3(0.72, 0.86, 1.0).scale(1.35);
    innerMat.diffuseColor = Color3.Black();
    innerMat.specularColor = Color3.Black();
    innerMat.disableLighting = true;
    innerMat.backFaceCulling = false;
    innerMat.alpha = 0.56;
    innerDisk.material = innerMat;

    const lensRing = MeshBuilder.CreateTorus(
      "blackHoleLensRing",
      {
        diameter: starDiameter * 2.15,
        thickness: starDiameter * 0.12,
        tessellation: 56,
      },
      this.scene,
    );
    lensRing.parent = this.starMesh;
    lensRing.rotation.x = Math.PI / 2.35;
    lensRing.isPickable = false;

    const lensMat = new StandardMaterial("blackHoleLensRingMat", this.scene);
    lensMat.emissiveColor = new Color3(0.9, 0.92, 1.0);
    lensMat.diffuseColor = Color3.Black();
    lensMat.specularColor = Color3.Black();
    lensMat.disableLighting = true;
    lensMat.backFaceCulling = false;
    lensMat.alpha = 0.38;
    lensRing.material = lensMat;

    const jetMat = new StandardMaterial("blackHoleJetMat", this.scene);
    jetMat.emissiveColor = new Color3(0.65, 0.78, 1.0).scale(1.4);
    jetMat.diffuseColor = Color3.Black();
    jetMat.specularColor = Color3.Black();
    jetMat.disableLighting = true;
    jetMat.backFaceCulling = false;
    jetMat.alpha = 0.24;

    const jetLength = starDiameter * 9;
    const jetRadius = Math.max(0.04, starDiameter * 0.16);

    const topJet = MeshBuilder.CreateCylinder(
      "blackHoleJetTop",
      {
        height: jetLength,
        diameterTop: 0.01,
        diameterBottom: jetRadius,
        tessellation: 16,
      },
      this.scene,
    );
    topJet.parent = this.starMesh;
    topJet.position.y = jetLength * 0.5 + starDiameter * 0.6;
    topJet.material = jetMat;
    topJet.isPickable = false;

    const bottomJet = MeshBuilder.CreateCylinder(
      "blackHoleJetBottom",
      {
        height: jetLength,
        diameterTop: 0.01,
        diameterBottom: jetRadius,
        tessellation: 16,
      },
      this.scene,
    );
    bottomJet.parent = this.starMesh;
    bottomJet.position.y = -jetLength * 0.5 - starDiameter * 0.6;
    bottomJet.rotation.z = Math.PI;
    bottomJet.material = jetMat;
    bottomJet.isPickable = false;

    this.blackHoleDiskOuter = outerDisk;
    this.blackHoleDiskInner = innerDisk;

    this.glowLayer.addIncludedOnlyMesh(outerDisk);
    this.glowLayer.addIncludedOnlyMesh(innerDisk);
    this.glowLayer.addIncludedOnlyMesh(lensRing);
    this.glowLayer.addIncludedOnlyMesh(topJet);
    this.glowLayer.addIncludedOnlyMesh(bottomJet);
  }

  private createPlanet(index: number, planet: PlanetConfig): void {
    const planetCfg = PLANET_TYPES[planet.type];
    const textureVariantNum = planet.textureVariation + 1;
    const texturePath = `${planetCfg.texturePrefix}_0${textureVariantNum}-1024x512.png`;

    const orbitRadius = this.orbitBaseOffset + index * this.orbitSpacing + planet.orbitRadius * 1.2;
    const orbitSpeed = planet.orbitSpeed * 0.35;
    const diameter = Math.max(0.8, planet.diameter * 1.2);

    const mesh = MeshBuilder.CreateSphere(
      `systemPlanet_${index}`,
      { diameter, segments: 28 },
      this.scene,
    );

    const mat = new StandardMaterial(`systemPlanetMat_${index}`, this.scene);
    const planetTexture = new Texture(texturePath, this.scene);
    planetTexture.hasAlpha = false;
    mat.diffuseTexture = planetTexture;
    mat.specularColor = new Color3(0.12, 0.12, 0.12);
    // Keep a subtle baseline lift for readability without making planets
    // look self-illuminated or washing out the sunlit side.
    mat.emissiveColor = this.planetNightLift.scale(0.2);
    mat.alpha = 1.0;
    mat.useAlphaFromDiffuseTexture = false;
    mat.transparencyMode = Material.MATERIAL_OPAQUE;
    mat.forceDepthWrite = true;
    mesh.material = mat;
    mesh.isPickable = false;

    // Add planet as an occluder to the glow pass so the star's bloom doesn't
    // composite over planets. Planets have near-zero emissive above.
    if (this.glowLayer) {
      this.glowLayer.addIncludedOnlyMesh(mesh as Mesh);
    }

    this.createOrbitRing(index, orbitRadius);
    this.planetMeshes.push(mesh);
    this.planetDiameters.push(diameter);
    
    // Create planet label
    const labelMesh = this.createPlanetLabel(index, planet, orbitRadius);
    this.planetLabelMeshes.push(labelMesh);

    this.orbitSystem.addBody({
      mesh,
      orbitRadius,
      orbitSpeed,
      currentAngle: Math.random() * Math.PI * 2,
      axialRotationSpeed: 0.18 + Math.random() * 0.22,
    });
  }

  private createOrbitRing(index: number, radius: number): void {
    const points: Vector3[] = [];
    const segments = 144;
    const dashCount = Math.max(18, Math.round(radius * 0.4));
    const ringY = 0.03;

    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      points.push(new Vector3(Math.cos(t) * radius, ringY, Math.sin(t) * radius));
    }

    const ring = MeshBuilder.CreateDashedLines(
      `systemOrbitRing_${index}`,
      {
        points,
        dashSize: 3.4,
        gapSize: 4.2,
        dashNb: dashCount,
      },
      this.scene,
    );
    ring.color = new Color3(0.74, 0.74, 0.78);
    ring.alpha = 0.32;
    ring.renderingGroupId = 1;
    ring.alwaysSelectAsActiveMesh = true;
    ring.isPickable = false;
    this.orbitRings.push(ring);
  }

  private createPlanetLabel(index: number, planet: PlanetConfig, orbitRadius: number): Mesh {
    const labelTexture = new DynamicTexture(
      `planetLabel_${index}`,
      { width: SYSTEM_LABEL_TEXTURE_WIDTH, height: SYSTEM_LABEL_TEXTURE_HEIGHT },
      this.scene,
      false,
    );
    labelTexture.hasAlpha = true;
    labelTexture.uScale = SYSTEM_LABEL_U_SCALE;
    labelTexture.uOffset = SYSTEM_LABEL_U_OFFSET;
    const ctx = labelTexture.getContext() as unknown as CanvasRenderingContext2D;

    const isHabited = planet.isHabited ?? false;
    ctx.clearRect(0, 0, SYSTEM_LABEL_TEXTURE_WIDTH, SYSTEM_LABEL_TEXTURE_HEIGHT);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    if (isHabited) {
      this.drawSystemNameplate(ctx, SYSTEM_LABEL_TEXTURE_WIDTH, SYSTEM_LABEL_TEXTURE_HEIGHT, planet.name, "HABITED", true);
    } else {
      this.drawSimpleSystemLabel(ctx, SYSTEM_LABEL_TEXTURE_WIDTH, SYSTEM_LABEL_TEXTURE_HEIGHT, planet.name, 150);
    }

    labelTexture.update(true);

    // Create material
    const material = new StandardMaterial(`planetLabelMat_${index}`, this.scene);
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
    material.disableDepthWrite = true;
    

    // Create plane mesh - texture and plane share the same aspect ratio to avoid stretching.
    const labelMesh = MeshBuilder.CreatePlane(
      `planetLabel_mesh_${index}`,
      { width: isHabited ? 8.2 : 5.8, height: isHabited ? 2.05 : 1.45 },
      this.scene,
    );
    
    // Position label (will be updated each frame)
    labelMesh.position = new Vector3(0, 0, 0);
    labelMesh.material = material;
    labelMesh.isPickable = false;
    labelMesh.renderingGroupId = 2;
    labelMesh.alwaysSelectAsActiveMesh = true;
    labelMesh.billboardMode = Mesh.BILLBOARDMODE_NONE;
    
    return labelMesh;
  }

  private createStarLabel(): Mesh {
    const labelTexture = new DynamicTexture(
      "starLabel",
      { width: SYSTEM_LABEL_TEXTURE_WIDTH, height: SYSTEM_LABEL_TEXTURE_HEIGHT },
      this.scene,
      false,
    );
    labelTexture.hasAlpha = true;
    labelTexture.uScale = SYSTEM_LABEL_U_SCALE;
    labelTexture.uOffset = SYSTEM_LABEL_U_OFFSET;
    const ctx = labelTexture.getContext() as unknown as CanvasRenderingContext2D;

    ctx.clearRect(0, 0, SYSTEM_LABEL_TEXTURE_WIDTH, SYSTEM_LABEL_TEXTURE_HEIGHT);
    this.drawSimpleSystemLabel(ctx, SYSTEM_LABEL_TEXTURE_WIDTH, SYSTEM_LABEL_TEXTURE_HEIGHT, this.star.name, 150);

    labelTexture.update(true);

    // Create material
    const material = new StandardMaterial("starLabelMat", this.scene);
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
    material.disableDepthWrite = true;
    

    // Create plane mesh for star label
    const labelMesh = MeshBuilder.CreatePlane(
      "starLabel_mesh",
      { width: 6.2, height: 1.55 },
      this.scene,
    );
    
    labelMesh.position = new Vector3(0, this.starDiameter + 3, 0);
    labelMesh.material = material;
    labelMesh.isPickable = false;
    labelMesh.renderingGroupId = 2;
    labelMesh.alwaysSelectAsActiveMesh = true;
    labelMesh.billboardMode = Mesh.BILLBOARDMODE_NONE;
    
    return labelMesh;
  }

  private drawSimpleSystemLabel(
    ctx: CanvasRenderingContext2D,
    textureWidth: number,
    textureHeight: number,
    text: string,
    fontSize: number,
  ): void {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxTextWidth = textureWidth - 180;
    let fittedFontSize = fontSize;
    do {
      ctx.font = `800 ${fittedFontSize}px "Segoe UI", Arial, sans-serif`;
      if (ctx.measureText(text).width <= maxTextWidth) break;
      fittedFontSize -= 6;
    } while (fittedFontSize > 72);

    ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 5;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.96)";
    ctx.lineWidth = Math.max(10, fittedFontSize * 0.11);
    ctx.strokeText(text, textureWidth / 2, textureHeight / 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
    ctx.fillText(text, textureWidth / 2, textureHeight / 2);
    ctx.restore();
  }

  private drawSystemNameplate(
    ctx: CanvasRenderingContext2D,
    textureWidth: number,
    textureHeight: number,
    name: string,
    status: string,
    drawBadge: boolean,
  ): void {
    const plateW = 1120;
    const plateH = 210;
    const plateX = (textureWidth - plateW) / 2 - (drawBadge ? 115 : 0);
    const plateY = (textureHeight - plateH) / 2;
    const badgeX = plateX + plateW + 125;
    const badgeY = textureHeight / 2;
    const badgeR = 110;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.82)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = "rgba(5, 45, 39, 0.94)";
    ctx.strokeStyle = "rgba(152, 240, 219, 0.86)";
    ctx.lineWidth = 12;
    this.drawSystemRoundedRect(ctx, plateX, plateY, plateW, plateH, 12);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(35, 137, 116, 0.34)";
    ctx.fillRect(plateX + 24, plateY + 24, plateW - 48, 24);
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxTextWidth = plateW - 90;
    let nameFontSize = 112;
    do {
      ctx.font = `900 ${nameFontSize}px "Segoe UI", Arial, sans-serif`;
      if (ctx.measureText(name).width <= maxTextWidth) break;
      nameFontSize -= 5;
    } while (nameFontSize > 58);

    ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
    ctx.shadowBlur = 14;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.95)";
    ctx.lineWidth = Math.max(7, nameFontSize * 0.07);
    ctx.strokeText(name, plateX + plateW / 2, plateY + 92, maxTextWidth);
    ctx.fillStyle = "rgba(230, 255, 250, 0.98)";
    ctx.fillText(name, plateX + plateW / 2, plateY + 92, maxTextWidth);

    ctx.font = `800 42px "Segoe UI", Arial, sans-serif`;
    ctx.fillStyle = "rgba(114, 230, 139, 0.9)";
    ctx.fillText(status, plateX + plateW / 2, plateY + 158);
    ctx.restore();

    if (drawBadge) {
      this.drawSystemHexBadge(ctx, badgeX, badgeY, badgeR);
    }
  }

  private drawSystemRoundedRect(
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

  private drawSystemHexBadge(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
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
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 12;
    drawHex(radius);
    ctx.fillStyle = "rgba(224, 239, 235, 0.98)";
    ctx.fill();
    ctx.lineWidth = 20;
    ctx.strokeStyle = "rgba(66, 86, 82, 0.96)";
    ctx.stroke();

    drawHex(radius * 0.64);
    ctx.fillStyle = "rgba(245, 252, 250, 1)";
    ctx.fill();
    ctx.lineWidth = 10;
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
    ctx.lineWidth = 14;
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

  private createFallbackPlanets(kind: StarVisualKind): PlanetConfig[] {
    if (kind === "black-hole") {
      return [
        { type: PlanetType.Barren, textureVariation: 0, diameter: 1.2, orbitRadius: 12, orbitSpeed: 0.32, name: `${this.star.name} I` },
        { type: PlanetType.Methane, textureVariation: 0, diameter: 2.8, orbitRadius: 20, orbitSpeed: 0.2, name: `${this.star.name} II` },
      ];
    }
    if (kind === "neutron-star" || kind === "pulsar") {
      return [
        { type: PlanetType.Barren, textureVariation: 0, diameter: 1.0, orbitRadius: 9, orbitSpeed: 0.62, name: `${this.star.name} I` },
        { type: PlanetType.Snowy, textureVariation: 0, diameter: 1.1, orbitRadius: 15, orbitSpeed: 0.46, name: `${this.star.name} II` },
      ];
    }
    return [
      { type: PlanetType.Barren, textureVariation: 0, diameter: 1.4, orbitRadius: 7, orbitSpeed: 0.55, name: `${this.star.name} I` },
      { type: PlanetType.Gaseous, textureVariation: 0, diameter: 3.2, orbitRadius: 12, orbitSpeed: 0.24, name: `${this.star.name} II` },
      { type: PlanetType.Snowy, textureVariation: 0, diameter: 1.1, orbitRadius: 18, orbitSpeed: 0.4, name: `${this.star.name} III` },
    ];
  }

  private requestExit(): void {
    if (this.isExiting) return;
    this.isExiting = true;
    Promise.resolve(this.onExitSystem())
      .catch((err) => console.error("Failed to exit system view", err))
      .finally(() => {
        this.isExiting = false;
      });
  }

  getStar(): StarData {
    return this.star;
  }

  setStarsVisible(visible: boolean): void {
    this.starsVisible = visible;
    if (this.starMesh) {
      this.starMesh.setEnabled(visible);
    }
    if (this.playerShipRoot) {
      this.playerShipRoot.setEnabled(visible);
    }
  }

  setBloomEnabled(enabled: boolean): void {
    this.bloomEnabled = enabled;
    if (this.glowLayer) {
      this.glowLayer.intensity = enabled ? this.glowLayer.intensity : 0;
    }
  }

  setShipSystemPositions(positions: Record<number, { x: number; y: number; z: number }>): void {
    this.shipSystemPositions = positions;
    const position = positions[this.star.id];
    if (!position) {
      this.playerShipRoot?.setEnabled(false);
      return;
    }

    this.playerShipTargetPosition.set(position.x, position.y, position.z);
    if (!this.playerShipRoot) {
      this.playerShipBasePosition.copyFrom(this.playerShipTargetPosition);
      void this.createPlayerShipIfPresent().then(() => {
        this.playerShipRoot?.setEnabled(this.starsVisible);
      });
      return;
    }

    this.playerShipRoot.setEnabled(this.starsVisible);
  }

  setStarbaseSystemIds(starIds: Iterable<number>): void {
    this.starbaseSystemIds = new Set(starIds);
    if (this.starbaseSystemIds.has(this.star.id)) {
      if (this.starbaseRoot) {
        this.starbaseRoot.setEnabled(true);
        return;
      }
      void this.createStarbaseIfPresent();
      return;
    }

    this.starbaseRoot?.setEnabled(false);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onEscapeKey);
    this.orbitSystem.dispose();
    this.camera?.detachControl();
    this.scene.dispose();
  }
}

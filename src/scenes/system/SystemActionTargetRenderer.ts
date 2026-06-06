import {
  Color3,
  GlowLayer,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import type { SystemPosition } from "../../data/SystemCoordinates";

export type SystemActionTargetKind = "star" | "planet" | "starbase" | "hyperlane";

export interface SystemActionTarget {
  kind: SystemActionTargetKind;
  label: string;
  starId: number;
  position: SystemPosition;
  markerPosition: SystemPosition;
  planetId?: string;
  starbaseId?: string;
  connectedStarId?: number;
}

interface RenderedActionTarget {
  root: TransformNode;
  target: SystemActionTarget;
  meshes: Mesh[];
}

export class SystemActionTargetRenderer {
  private readonly targets: RenderedActionTarget[] = [];
  private material: StandardMaterial | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly glowLayer: GlowLayer,
    private readonly config: {
      color: Color3;
      pulseSpeed: number;
      rotationSpeed: number;
    },
  ) {}

  get hasTargets(): boolean {
    return this.targets.length > 0;
  }

  setTargets(
    targets: SystemActionTarget[],
    getRadius: (target: SystemActionTarget) => number,
  ): void {
    this.clear();
    if (targets.length === 0) return;

    const material = this.getMaterial();
    for (const target of targets) {
      const root = new TransformNode(`systemActionTarget_${target.kind}_${target.starId}`, this.scene);
      root.position.set(target.markerPosition.x, target.markerPosition.y, target.markerPosition.z);
      const meshes = this.createMarkerBoxes(root, material, getRadius(target));
      this.targets.push({ root, target, meshes });
    }
  }

  update(
    elapsedSeconds: number,
    resolveTarget: (target: SystemActionTarget) => SystemActionTarget,
  ): void {
    if (this.targets.length === 0) return;

    const pulse = 0.5 + 0.5 * Math.sin(elapsedSeconds * this.config.pulseSpeed);
    const scale = 0.94 + pulse * 0.12;
    if (this.material) {
      this.material.alpha = 0.42 + pulse * 0.22;
      this.material.emissiveColor = this.config.color.scale(1.6 + pulse * 1.0);
    }

    for (const item of this.targets) {
      const target = resolveTarget(item.target);
      item.target = target;
      item.root.position.set(target.markerPosition.x, target.markerPosition.y, target.markerPosition.z);
      item.root.rotation.y = -elapsedSeconds * this.config.rotationSpeed;
      item.root.scaling.set(scale, scale, scale);
    }
  }

  hasMesh(mesh: Mesh): boolean {
    return this.targets.some((item) => item.meshes.includes(mesh));
  }

  getTargetForMesh(mesh: Mesh): SystemActionTarget | null {
    return this.targets.find((item) => item.meshes.includes(mesh))?.target ?? null;
  }

  clear(): void {
    for (const item of this.targets) {
      for (const mesh of item.meshes) {
        this.glowLayer.removeIncludedOnlyMesh(mesh);
        mesh.dispose();
      }
      item.root.dispose();
    }
    this.targets.length = 0;
  }

  dispose(): void {
    this.clear();
    this.material?.dispose();
    this.material = null;
  }

  private getMaterial(): StandardMaterial {
    if (!this.material) {
      const material = new StandardMaterial("systemActionTargetMarkerMat", this.scene);
      material.diffuseColor = this.config.color.scale(0.14);
      material.emissiveColor = this.config.color.scale(2.2);
      material.specularColor = Color3.Black();
      material.disableLighting = true;
      material.backFaceCulling = false;
      material.alpha = 0.58;
      material.alphaMode = 2;
      this.material = material;
    }
    return this.material;
  }

  private createMarkerBoxes(
    parent: TransformNode,
    material: StandardMaterial,
    radius: number,
  ): Mesh[] {
    const meshes: Mesh[] = [];
    const angles = [-Math.PI / 2, Math.PI / 6, (Math.PI * 5) / 6];
    const width = Math.max(1.8, radius * 0.42);
    const depth = Math.max(1.0, radius * 0.22);
    const thickness = Math.max(0.16, radius * 0.045);

    for (let index = 0; index < angles.length; index += 1) {
      const angle = angles[index];
      const radialX = Math.cos(angle);
      const radialZ = Math.sin(angle);
      const box = MeshBuilder.CreateBox(
        `systemActionTargetRect_${index}`,
        { width, height: thickness, depth },
        this.scene,
      );
      box.parent = parent;
      box.position.set(radialX * radius, 0, radialZ * radius);
      box.rotation.y = -angle - Math.PI / 2;
      box.material = material;
      box.isPickable = true;
      box.alwaysSelectAsActiveMesh = true;
      this.glowLayer.addIncludedOnlyMesh(box);
      meshes.push(box);
    }

    return meshes;
  }
}

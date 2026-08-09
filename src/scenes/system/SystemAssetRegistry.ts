import {
  Scene,
  SceneLoader,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { AbstractMesh } from "@babylonjs/core";
import "@babylonjs/loaders/OBJ/objFileLoader";
import "@babylonjs/loaders/glTF";

export interface SystemAssetDefinition {
  key: string;
  rootUrl: string;
  fileName: string;
  targetSize: number;
  scaleMultiplier?: number;
  trailSocketName?: string;
  configureMesh?: (mesh: AbstractMesh) => void;
}

interface SourceTemplate {
  root: TransformNode;
  maxDimension: number;
}

export class SystemAssetRegistry {
  private readonly templates = new Map<string, TransformNode>();
  private readonly pendingTemplates = new Map<string, Promise<TransformNode | null>>();
  private readonly sources = new Map<string, SourceTemplate>();
  private readonly pendingSources = new Map<string, Promise<SourceTemplate | null>>();

  constructor(private readonly scene: Scene) {}

  async loadTemplate(definition: SystemAssetDefinition): Promise<TransformNode | null> {
    const existing = this.templates.get(definition.key);
    if (existing) return existing;

    const pending = this.pendingTemplates.get(definition.key);
    if (pending) return pending;

    const promise = this.createTemplate(definition)
      .then((template) => {
        if (template) this.templates.set(definition.key, template);
        return template;
      })
      .finally(() => {
        this.pendingTemplates.delete(definition.key);
      });

    this.pendingTemplates.set(definition.key, promise);
    return promise;
  }

  async instantiate(definition: SystemAssetDefinition, instanceName: string): Promise<TransformNode | null> {
    const template = await this.loadTemplate(definition);
    if (!template) return null;
    return this.cloneTemplate(definition.key, instanceName);
  }

  cloneTemplate(key: string, instanceName: string): TransformNode | null {
    const template = this.templates.get(key);
    if (!template) return null;
    const clone = template.clone(instanceName, null);
    clone?.setEnabled(true);
    return clone ?? null;
  }

  dispose(): void {
    for (const template of this.templates.values()) {
      template.dispose();
    }
    this.templates.clear();
    this.pendingTemplates.clear();
    for (const source of this.sources.values()) {
      source.root.dispose();
    }
    this.sources.clear();
    this.pendingSources.clear();
  }

  private async createTemplate(definition: SystemAssetDefinition): Promise<TransformNode | null> {
    const source = await this.loadSource(definition);
    if (!source) return null;

    const templateRoot = source.root.clone(`${definition.key}-template`, null);
    if (!templateRoot) return null;
    for (const mesh of templateRoot.getChildMeshes()) {
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      definition.configureMesh?.(mesh);
    }
    templateRoot.scaling.setAll(
      (definition.targetSize / source.maxDimension) * (definition.scaleMultiplier ?? 1),
    );
    templateRoot.setEnabled(false);
    return templateRoot;
  }

  private loadSource(definition: SystemAssetDefinition): Promise<SourceTemplate | null> {
    const sourceKey = `${definition.rootUrl}\0${definition.fileName}\0${definition.trailSocketName ?? ""}`;
    const existing = this.sources.get(sourceKey);
    if (existing) return Promise.resolve(existing);

    const pending = this.pendingSources.get(sourceKey);
    if (pending) return pending;

    const promise = this.createSource(definition, sourceKey)
      .then((source) => {
        if (source) this.sources.set(sourceKey, source);
        return source;
      })
      .finally(() => {
        this.pendingSources.delete(sourceKey);
      });
    this.pendingSources.set(sourceKey, promise);
    return promise;
  }

  private async createSource(
    definition: SystemAssetDefinition,
    sourceKey: string,
  ): Promise<SourceTemplate | null> {
    const result = await SceneLoader.ImportMeshAsync(
      "",
      definition.rootUrl,
      definition.fileName,
      this.scene,
    );

    for (const mesh of result.meshes) {
      mesh.setEnabled(false);
      mesh.isPickable = false;
    }

    const renderableMeshes = result.meshes.filter((mesh) => (
      typeof mesh.getTotalVertices === "function" && mesh.getTotalVertices() > 0
    ));
    if (renderableMeshes.length === 0) return null;

    const bounds = this.computeMeshBounds(renderableMeshes);
    const maxDimension = Math.max(
      0.001,
      bounds.max.x - bounds.min.x,
      bounds.max.y - bounds.min.y,
      bounds.max.z - bounds.min.z,
    );
    const sourceRoot = new TransformNode(`${sourceKey}-source`, this.scene);
    const assetRoot = new TransformNode(`${sourceKey}-asset`, this.scene);
    assetRoot.parent = sourceRoot;
    assetRoot.position = bounds.center.scale(-1);

    for (const mesh of renderableMeshes) {
      mesh.parent = assetRoot;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.setEnabled(true);
    }

    if (definition.trailSocketName) {
      const socket = this.scene.getNodeByName(definition.trailSocketName) as TransformNode | null;
      if (socket) {
        socket.parent = assetRoot;
      }
    }

    sourceRoot.setEnabled(false);
    return { root: sourceRoot, maxDimension };
  }

  private computeMeshBounds(meshes: AbstractMesh[]): { min: Vector3; max: Vector3; center: Vector3 } {
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
      min.set(-0.5, -0.5, -0.5);
      max.set(0.5, 0.5, 0.5);
    }

    return {
      min,
      max,
      center: min.add(max).scale(0.5),
    };
  }
}

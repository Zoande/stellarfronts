import {
  Mesh,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { AbstractMesh, PickingInfo } from "@babylonjs/core";

export type SystemRenderableKind =
  | "star"
  | "planet"
  | "fleet"
  | "ship"
  | "starbase"
  | "hyperlane"
  | (string & {});

export interface SystemRenderableDefinition {
  id: string;
  kind: SystemRenderableKind;
  assetKey: string;
  position: Vector3;
  scale?: number | Vector3;
  orientation?: Vector3;
  pickRadius?: number;
  label?: string;
  ownerId?: number;
  visible?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SystemRenderableEntry {
  definition: SystemRenderableDefinition;
  root: TransformNode;
  meshes: AbstractMesh[];
  targetPosition: Vector3;
}

export interface SystemRenderableFactoryContext {
  scene: Scene;
  root: TransformNode;
  definition: SystemRenderableDefinition;
}

export type SystemRenderableFactory = (context: SystemRenderableFactoryContext) => Iterable<AbstractMesh>;

export class SystemObjectRenderer {
  private readonly entries = new Map<string, SystemRenderableEntry>();
  private readonly meshOwners = new Map<AbstractMesh, string>();
  private readonly factories = new Map<string, SystemRenderableFactory>();

  constructor(private readonly scene: Scene) {}

  registerFactory(assetKey: string, factory: SystemRenderableFactory): void {
    this.factories.set(assetKey, factory);
  }

  reconcile(
    definitions: SystemRenderableDefinition[],
    options: { scopeKinds?: Iterable<SystemRenderableKind> } = {},
  ): void {
    const liveIds = new Set(definitions.map((definition) => definition.id));
    const scopeKinds = options.scopeKinds ? new Set(options.scopeKinds) : null;

    for (const [id, entry] of Array.from(this.entries.entries())) {
      if (liveIds.has(id)) continue;
      if (scopeKinds && !scopeKinds.has(entry.definition.kind)) continue;
      this.disposeEntry(id, entry);
    }

    for (const definition of definitions) {
      const existing = this.entries.get(definition.id);
      if (!existing || existing.definition.assetKey !== definition.assetKey || existing.definition.kind !== definition.kind) {
        if (existing) this.disposeEntry(definition.id, existing);
        const entry = this.createEntry(definition);
        if (!entry) continue;
        this.entries.set(definition.id, entry);
        continue;
      }
      this.applyDefinition(existing, definition);
    }
  }

  update(deltaTime: number, smoothing = 4): void {
    const t = Math.min(1, Math.max(0, deltaTime * smoothing));
    for (const entry of this.entries.values()) {
      entry.root.position.x += (entry.targetPosition.x - entry.root.position.x) * t;
      entry.root.position.y += (entry.targetPosition.y - entry.root.position.y) * t;
      entry.root.position.z += (entry.targetPosition.z - entry.root.position.z) * t;
    }
  }

  getRoot(id: string): TransformNode | null {
    return this.entries.get(id)?.root ?? null;
  }

  getEntry(id: string): SystemRenderableEntry | null {
    return this.entries.get(id) ?? null;
  }

  setVisibleForKind(kind: SystemRenderableKind, visible: boolean): void {
    for (const entry of this.entries.values()) {
      if (entry.definition.kind === kind) entry.root.setEnabled(visible);
    }
  }

  pick(
    canvasX: number,
    canvasY: number,
    predicate?: (definition: SystemRenderableDefinition) => boolean,
  ): { entry: SystemRenderableEntry; mesh: AbstractMesh; pick: PickingInfo } | null {
    const pick = this.scene.pick(canvasX, canvasY, (mesh) => {
      const id = this.meshOwners.get(mesh as AbstractMesh);
      if (!id) return false;
      const entry = this.entries.get(id);
      return !!entry && (!predicate || predicate(entry.definition));
    });
    if (!pick?.hit || !pick.pickedMesh) return null;
    const id = this.meshOwners.get(pick.pickedMesh as AbstractMesh);
    if (!id) return null;
    const entry = this.entries.get(id);
    if (!entry) return null;
    return { entry, mesh: pick.pickedMesh, pick };
  }

  dispose(): void {
    for (const [id, entry] of Array.from(this.entries.entries())) {
      this.disposeEntry(id, entry);
    }
  }

  private createEntry(definition: SystemRenderableDefinition): SystemRenderableEntry | null {
    const factory = this.factories.get(definition.assetKey);
    if (!factory) {
      console.warn(`No system renderable factory registered for "${definition.assetKey}".`);
      return null;
    }

    const root = new TransformNode(`systemRenderable-${definition.id}`, this.scene);
    const meshes = Array.from(factory({ scene: this.scene, root, definition }));
    const entry: SystemRenderableEntry = {
      definition,
      root,
      meshes,
      targetPosition: definition.position.clone(),
    };
    root.position.copyFrom(definition.position);
    this.applyDefinition(entry, definition);
    return entry;
  }

  private applyDefinition(entry: SystemRenderableEntry, definition: SystemRenderableDefinition): void {
    entry.definition = definition;
    entry.targetPosition.copyFrom(definition.position);
    if (definition.orientation) {
      entry.root.rotation.copyFrom(definition.orientation);
    }
    if (definition.scale instanceof Vector3) {
      entry.root.scaling.copyFrom(definition.scale);
    } else if (typeof definition.scale === "number") {
      entry.root.scaling.setAll(definition.scale);
    }
    entry.root.setEnabled(definition.visible !== false);

    const metadata = {
      ...(entry.root.metadata as Record<string, unknown> | null ?? {}),
      ...(definition.metadata ?? {}),
      renderableId: definition.id,
      renderableKind: definition.kind,
      assetKey: definition.assetKey,
      ownerId: definition.ownerId,
      label: definition.label,
    };
    entry.root.metadata = metadata;
    for (const mesh of entry.meshes) {
      mesh.metadata = metadata;
      this.meshOwners.set(mesh, definition.id);
    }
  }

  private disposeEntry(id: string, entry: SystemRenderableEntry): void {
    for (const mesh of entry.meshes) {
      this.meshOwners.delete(mesh);
    }
    entry.root.dispose();
    this.entries.delete(id);
  }
}

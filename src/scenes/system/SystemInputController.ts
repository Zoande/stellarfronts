import {
  Matrix,
  Mesh,
  Scene,
  Vector3,
} from "@babylonjs/core";
import type { Camera, PickingInfo } from "@babylonjs/core";
import { getCanvasPoint } from "../shared/pointerMath";
import type { CanvasPoint } from "../shared/pointerMath";

export type CanvasPointerPoint = CanvasPoint;

export class SystemInputController {
  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly getCanvas: () => HTMLCanvasElement | null,
  ) {}

  getCanvasPoint(event: PointerEvent): CanvasPointerPoint | null {
    return getCanvasPoint(this.getCanvas(), event);
  }

  pick(
    event: PointerEvent,
    predicate: (mesh: Mesh) => boolean,
  ): PickingInfo | null {
    const point = this.getCanvasPoint(event);
    if (!point) return null;
    const pick = this.scene.pick(point.canvasX, point.canvasY, (mesh) => predicate(mesh as Mesh));
    return pick?.hit ? pick : null;
  }

  /**
   * Pick like {@link pick}, but if the exact ray misses, sample an expanding
   * ring of nearby canvas points so small or moving objects (planet spheres,
   * ships) are forgiving to click. Returns the first hit found closest to the
   * cursor.
   */
  pickWithTolerance(
    event: PointerEvent,
    predicate: (mesh: Mesh) => boolean,
    radiusPx = 14,
  ): PickingInfo | null {
    const point = this.getCanvasPoint(event);
    if (!point) return null;
    const test = (x: number, y: number): PickingInfo | null => {
      const pick = this.scene.pick(x, y, (mesh) => predicate(mesh as Mesh));
      return pick?.hit ? pick : null;
    };
    const direct = test(point.canvasX, point.canvasY);
    if (direct) return direct;
    const rings = [radiusPx * 0.5, radiusPx];
    const angles = 8;
    for (const radius of rings) {
      for (let i = 0; i < angles; i += 1) {
        const angle = (i / angles) * Math.PI * 2;
        const hit = test(point.canvasX + Math.cos(angle) * radius, point.canvasY + Math.sin(angle) * radius);
        if (hit) return hit;
      }
    }
    return null;
  }

  pickFromPoint(
    point: CanvasPointerPoint,
    predicate: (mesh: Mesh) => boolean,
  ): PickingInfo | null {
    const pick = this.scene.pick(point.canvasX, point.canvasY, (mesh) => predicate(mesh as Mesh));
    return pick?.hit ? pick : null;
  }

  getSystemPlanePosition(event: PointerEvent, planeY: number): Vector3 | null {
    const point = this.getCanvasPoint(event);
    if (!point) return null;
    const ray = this.scene.createPickingRay(point.canvasX, point.canvasY, Matrix.Identity(), this.camera);
    if (Math.abs(ray.direction.y) < 0.0001) return null;
    const t = (planeY - ray.origin.y) / ray.direction.y;
    if (t < 0) return null;
    return ray.origin.add(ray.direction.scale(t));
  }
}

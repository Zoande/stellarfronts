import {
  Matrix,
  Mesh,
  Scene,
  Vector3,
} from "@babylonjs/core";
import type { Camera, PickingInfo } from "@babylonjs/core";

export interface CanvasPointerPoint {
  canvasX: number;
  canvasY: number;
}

export class SystemInputController {
  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly getCanvas: () => HTMLCanvasElement | null,
  ) {}

  getCanvasPoint(event: PointerEvent): CanvasPointerPoint | null {
    const canvas = this.getCanvas();
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      canvasX: (event.clientX - rect.left) * (canvas.width / rect.width),
      canvasY: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
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

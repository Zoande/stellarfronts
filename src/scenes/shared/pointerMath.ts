export interface CanvasPoint {
  canvasX: number;
  canvasY: number;
}

/**
 * Convert a DOM pointer event into canvas-local coordinates suitable for
 * Babylon's `scene.pick` / `scene.createPickingRay`.
 *
 * Single source of truth for pointer→canvas mapping, shared by every scene so
 * left-click picking, right-click menus and ground-plane projection all agree.
 * The engine runs with `adaptToDeviceRatio: false` (hardware scaling level 1),
 * so the canvas backing store tracks CSS pixels; the `width / rect.width` ratio
 * stays correct (and dpr-safe) if that ever changes.
 */
export function getCanvasPoint(
  canvas: HTMLCanvasElement | null | undefined,
  event: { clientX: number; clientY: number },
): CanvasPoint | null {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    canvasX: (event.clientX - rect.left) * (canvas.width / rect.width),
    canvasY: (event.clientY - rect.top) * (canvas.height / rect.height),
  };
}

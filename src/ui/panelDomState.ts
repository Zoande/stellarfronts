export interface ScrollSnapshot {
  selector: string;
  index: number;
  top: number;
  left: number;
}

export function captureScrollState(
  root: HTMLElement | null,
  selectors: readonly string[],
): ScrollSnapshot[] {
  if (!root) return [];
  return selectors.flatMap((selector) => (
    Array.from(root.querySelectorAll<HTMLElement>(selector)).map((element, index) => ({
      selector,
      index,
      top: element.scrollTop,
      left: element.scrollLeft,
    }))
  ));
}

export function restoreScrollState(
  root: HTMLElement | null,
  snapshots: readonly ScrollSnapshot[],
): void {
  if (!root || snapshots.length === 0) return;
  for (const snapshot of snapshots) {
    const element = root.querySelectorAll<HTMLElement>(snapshot.selector)[snapshot.index];
    if (!element) continue;
    element.scrollTop = snapshot.top;
    element.scrollLeft = snapshot.left;
  }
}

export function restoreScrollStateSoon(
  root: HTMLElement | null,
  snapshots: readonly ScrollSnapshot[],
): void {
  restoreScrollState(root, snapshots);
  if (typeof window === "undefined" || snapshots.length === 0) return;
  window.requestAnimationFrame(() => restoreScrollState(root, snapshots));
}

export function hasFocusedFormControl(root: HTMLElement | null): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement
    && !!root
    && root.contains(active)
    && (active.matches("input, select, textarea") || active.isContentEditable);
}

export class PanelInteractionGate {
  private root: HTMLElement | null = null;
  private holdUntilMs = 0;

  bind(root: HTMLElement): void {
    if (this.root === root) return;
    this.root = root;
    root.addEventListener("pointerdown", this.holdForClick, { capture: true });
    root.addEventListener("pointerup", this.holdForRelease, { capture: true });
    root.addEventListener("pointercancel", this.holdForRelease, { capture: true });
    root.addEventListener("click", this.holdForRelease, { capture: true });
  }

  isBusy(root: HTMLElement | null): boolean {
    return hasFocusedFormControl(root) || this.now() < this.holdUntilMs;
  }

  clear(): void {
    this.root = null;
    this.holdUntilMs = 0;
  }

  private readonly holdForClick = (): void => {
    this.deferFor(260);
  };

  private readonly holdForRelease = (): void => {
    this.deferFor(120);
  };

  private deferFor(durationMs: number): void {
    this.holdUntilMs = Math.max(this.holdUntilMs, this.now() + durationMs);
  }

  private now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }
}

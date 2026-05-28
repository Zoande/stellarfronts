export interface FloatingTooltipManagerOptions {
  selector: string;
  datasetKey: string;
  className: string;
  width?: number;
  viewportPadding?: number;
  offset?: number;
  showDelayMs?: number;
  stickyDelayMs?: number;
}

export class FloatingTooltipManager {
  private readonly selector: string;
  private readonly datasetKey: string;
  private readonly className: string;
  private readonly width: number;
  private readonly viewportPadding: number;
  private readonly offset: number;
  private readonly showDelayMs: number;
  private readonly stickyDelayMs: number;
  private readonly boundElements = new WeakSet<HTMLElement>();
  private readonly elements: HTMLDivElement[] = [];
  private readonly anchors: Array<HTMLElement | null> = [];
  private readonly stickyDepths = new Set<number>();
  private showTimer: number | null = null;
  private stickyTimer: number | null = null;
  private hideTimer: number | null = null;
  private pendingAnchor: HTMLElement | null = null;
  private pendingDepth = 0;

  private readonly onViewportChange = (): void => {
    this.repositionVisibleTooltips();
  };

  constructor(options: FloatingTooltipManagerOptions) {
    this.selector = options.selector;
    this.datasetKey = options.datasetKey;
    this.className = options.className;
    this.width = options.width ?? 320;
    this.viewportPadding = options.viewportPadding ?? 8;
    this.offset = options.offset ?? 12;
    this.showDelayMs = options.showDelayMs ?? 180;
    this.stickyDelayMs = options.stickyDelayMs ?? 850;

    window.addEventListener("resize", this.onViewportChange);
    window.addEventListener("scroll", this.onViewportChange, true);
  }

  bind(root: ParentNode | null): void {
    if (!root) return;
    const anchors: HTMLElement[] = [];
    if (root instanceof HTMLElement && root.matches(this.selector)) anchors.push(root);
    root.querySelectorAll<HTMLElement>(this.selector).forEach((anchor) => anchors.push(anchor));

    anchors.forEach((anchor) => {
      if (this.boundElements.has(anchor)) return;
      this.boundElements.add(anchor);
      anchor.addEventListener("pointerenter", () => this.schedule(anchor));
      anchor.addEventListener("pointerleave", () => this.scheduleHide());
      anchor.addEventListener("focus", () => this.schedule(anchor));
      anchor.addEventListener("blur", () => this.scheduleHide());
    });
  }

  hide(): void {
    this.clearTimers();
    this.removeFromDepth(0);
    this.anchors.length = 0;
    this.pendingAnchor = null;
    this.pendingDepth = 0;
    this.stickyDepths.clear();
  }

  dispose(): void {
    this.hide();
    window.removeEventListener("resize", this.onViewportChange);
    window.removeEventListener("scroll", this.onViewportChange, true);
  }

  private schedule(anchor: HTMLElement): void {
    this.clearTimers();
    const depth = this.getDepth(anchor);
    this.pendingAnchor = anchor;
    this.pendingDepth = depth;
    this.anchors[depth] = anchor;
    this.anchors.length = depth + 1;
    this.removeFromDepth(depth + 1);
    if (depth === 0) this.stickyDepths.clear();

    this.showTimer = window.setTimeout(() => {
      if (this.pendingAnchor !== anchor || this.pendingDepth !== depth) return;
      this.show(anchor, depth);
    }, this.showDelayMs);

    this.stickyTimer = window.setTimeout(() => {
      if (this.pendingAnchor !== anchor || this.pendingDepth !== depth) return;
      this.stickyDepths.add(depth);
      this.elements[depth]?.classList.add("sticky");
    }, this.stickyDelayMs);
  }

  private scheduleHide(): void {
    this.clearTimers();
    this.hideTimer = window.setTimeout(() => {
      if (this.isHoveringTooltipChain()) {
        this.scheduleHide();
        return;
      }
      this.hide();
    }, this.stickyDepths.size > 0 ? 120 : 60);
  }

  private show(anchor: HTMLElement, depth: number): void {
    const content = anchor.dataset[this.datasetKey];
    if (!content) return;

    this.removeFromDepth(depth + 1);
    const element = this.ensureElement(depth);
    element.innerHTML = content;
    element.dataset.floatingTooltipDepth = String(depth);
    element.classList.toggle("sticky", this.stickyDepths.has(depth));
    this.bind(element);
    this.positionElement(element, anchor);
    element.classList.add("visible");
  }

  private ensureElement(depth: number): HTMLDivElement {
    const existing = this.elements[depth];
    if (existing) return existing;

    const element = document.createElement("div");
    element.className = this.className;
    element.dataset.floatingTooltipDepth = String(depth);
    element.addEventListener("pointerenter", () => {
      if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    });
    element.addEventListener("pointerleave", () => this.scheduleHide());
    document.body.appendChild(element);
    this.elements[depth] = element;
    return element;
  }

  private removeFromDepth(depth: number): void {
    for (let index = depth; index < this.elements.length; index += 1) {
      this.elements[index]?.remove();
      this.anchors[index] = null;
      this.stickyDepths.delete(index);
    }
    this.elements.length = Math.min(this.elements.length, depth);
    this.anchors.length = Math.min(this.anchors.length, depth);
  }

  private getDepth(anchor: HTMLElement): number {
    const parentTooltip = anchor.closest<HTMLElement>(`.${this.className}[data-floating-tooltip-depth]`);
    if (!parentTooltip) return 0;
    const parentDepth = Number(parentTooltip.dataset.floatingTooltipDepth ?? "-1");
    return Number.isFinite(parentDepth) ? Math.max(0, parentDepth + 1) : 0;
  }

  private positionElement(element: HTMLDivElement, anchor: HTMLElement): void {
    const padding = this.viewportPadding;
    const viewportWidth = Math.max(0, window.innerWidth);
    const viewportHeight = Math.max(0, window.innerHeight);
    const availableWidth = Math.max(120, viewportWidth - padding * 2);
    const availableHeight = Math.max(80, viewportHeight - padding * 2);
    const width = Math.min(this.width, availableWidth);
    const anchorRect = anchor.getBoundingClientRect();

    element.style.width = `${width}px`;
    element.style.maxWidth = `${availableWidth}px`;
    element.style.maxHeight = `${availableHeight}px`;
    element.style.left = `${padding}px`;
    element.style.top = `${padding}px`;
    element.style.visibility = "hidden";
    element.classList.add("visible");

    const measuredHeight = Math.min(element.getBoundingClientRect().height, availableHeight);
    const rightLeft = anchorRect.right + this.offset;
    const leftLeft = anchorRect.left - width - this.offset;
    const rightFits = rightLeft + width <= viewportWidth - padding;
    const leftFits = leftLeft >= padding;
    const preferredLeft = rightFits || !leftFits ? rightLeft : leftLeft;
    const left = this.clamp(preferredLeft, padding, Math.max(padding, viewportWidth - width - padding));
    const preferredTop = anchorRect.top;
    const top = this.clamp(
      preferredTop + measuredHeight > viewportHeight - padding
        ? viewportHeight - padding - measuredHeight
        : preferredTop,
      padding,
      Math.max(padding, viewportHeight - measuredHeight - padding),
    );

    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.visibility = "";
  }

  private repositionVisibleTooltips(): void {
    this.elements.forEach((element, depth) => {
      const anchor = this.anchors[depth];
      if (!anchor || !document.body.contains(anchor)) {
        this.removeFromDepth(depth);
        return;
      }
      this.positionElement(element, anchor);
    });
  }

  private isHoveringTooltipChain(): boolean {
    const activeElement = document.activeElement;
    return this.anchors.some((anchor) => Boolean(
      anchor && document.body.contains(anchor) && (anchor.matches(":hover") || activeElement === anchor),
    )) || this.elements.some((element) => Boolean(
      element
        && document.body.contains(element)
        && (element.matches(":hover") || (activeElement instanceof Node && element.contains(activeElement))),
    ));
  }

  private clearTimers(): void {
    if (this.showTimer !== null) window.clearTimeout(this.showTimer);
    if (this.stickyTimer !== null) window.clearTimeout(this.stickyTimer);
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    this.showTimer = null;
    this.stickyTimer = null;
    this.hideTimer = null;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

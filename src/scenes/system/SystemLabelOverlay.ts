import { Vector3 } from "@babylonjs/core";

export interface SystemLabelOverlayItem {
  key: string;
  kind: "star" | "planet" | "fleet" | "starbase" | "hyperlane";
  anchor: Vector3;
  text: string;
  detail?: string;
  icon?: string;
  accent?: string;
  priority?: number;
  offsetY?: number;
  onClick?: (event: MouseEvent) => void;
}

export type SystemLabelProjector = (anchor: Vector3) => { x: number; y: number } | null;

export class SystemLabelOverlay {
  private static styleInstalled = false;
  private readonly root: HTMLDivElement;
  private readonly nodes = new Map<string, HTMLElement>();
  private items: SystemLabelOverlayItem[] = [];
  private visible = true;

  constructor(parent: HTMLElement = document.getElementById("spaceHudRoot") ?? document.body) {
    SystemLabelOverlay.installStyles();
    this.root = document.createElement("div");
    this.root.className = "systemLabelOverlay";
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.style.display = visible ? "" : "none";
  }

  setItems(items: SystemLabelOverlayItem[]): void {
    this.items = items;
    const liveKeys = new Set(items.map((item) => item.key));
    for (const [key, node] of Array.from(this.nodes.entries())) {
      if (liveKeys.has(key)) continue;
      node.remove();
      this.nodes.delete(key);
    }

    for (const item of items) {
      const node = this.nodes.get(item.key) ?? this.createNode(item);
      this.nodes.set(item.key, node);
      if (!node.parentElement) this.root.appendChild(node);
      this.renderNode(node, item);
    }
  }

  update(project: SystemLabelProjector): void {
    if (!this.visible) return;
    const candidates = this.items
      .map((item) => ({ item, projected: project(item.anchor) }))
      .filter((entry): entry is { item: SystemLabelOverlayItem; projected: { x: number; y: number } } => entry.projected !== null)
      .sort((a, b) => (b.item.priority ?? 0) - (a.item.priority ?? 0));

    const placed: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    for (const { item, projected } of candidates) {
      const node = this.nodes.get(item.key);
      if (!node) continue;
      node.style.display = "grid";
      const width = Math.max(1, node.offsetWidth || 132);
      const height = Math.max(1, node.offsetHeight || 34);
      const baseX = projected.x - width / 2;
      const baseY = projected.y + (item.offsetY ?? 0) - height / 2;
      let left = baseX;
      let top = baseY;
      let rect = { left, top, right: left + width, bottom: top + height };
      let placedWithoutCollision = false;

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const collision = placed.find((other) => this.rectsOverlap(rect, other));
        if (!collision) {
          placedWithoutCollision = true;
          break;
        }
        top = collision.bottom + 4;
        rect = { left, top, right: left + width, bottom: top + height };
      }

      if (!placedWithoutCollision && (item.priority ?? 0) < 50) {
        node.style.display = "none";
        continue;
      }

      placed.push(rect);
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
    }

    for (const [key, node] of this.nodes) {
      if (candidates.some((candidate) => candidate.item.key === key)) continue;
      node.style.display = "none";
    }
  }

  dispose(): void {
    this.root.remove();
    this.nodes.clear();
    this.items = [];
  }

  private createNode(item: SystemLabelOverlayItem): HTMLElement {
    const node = item.onClick ? document.createElement("button") : document.createElement("div");
    node.className = "systemLabelNode";
    if (item.onClick && node instanceof HTMLButtonElement) {
      node.type = "button";
    }
    node.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    return node;
  }

  private renderNode(node: HTMLElement, item: SystemLabelOverlayItem): void {
    const signature = [
      item.kind,
      item.text,
      item.detail ?? "",
      item.icon ?? "",
      item.accent ?? "",
      item.onClick ? "click" : "static",
    ].join("|");
    node.className = `systemLabelNode ${item.kind}`;
    node.style.setProperty("--label-accent", item.accent ?? "rgba(125, 218, 255, 0.92)");
    if (node.dataset.signature !== signature) {
      node.innerHTML = `
        ${item.icon ? `<span class="systemLabelIcon">${this.escapeHtml(item.icon)}</span>` : ""}
        <span class="systemLabelCopy">
          <strong>${this.escapeHtml(item.text)}</strong>
          ${item.detail ? `<small>${this.escapeHtml(item.detail)}</small>` : ""}
        </span>
      `;
      node.dataset.signature = signature;
    }
    node.onclick = item.onClick ?? null;
  }

  private rectsOverlap(
    a: { left: number; top: number; right: number; bottom: number },
    b: { left: number; top: number; right: number; bottom: number },
  ): boolean {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private static installStyles(): void {
    if (SystemLabelOverlay.styleInstalled || document.getElementById("systemLabelOverlayStyles")) return;
    const style = document.createElement("style");
    style.id = "systemLabelOverlayStyles";
    style.textContent = `
.systemLabelOverlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 43;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
}

.systemLabelNode {
  --label-accent: rgba(125, 218, 255, 0.92);
  position: fixed;
  min-width: 88px;
  max-width: 190px;
  min-height: 26px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  padding: 5px 8px;
  border: 1px solid color-mix(in srgb, var(--label-accent) 58%, rgba(255, 255, 255, 0.12));
  border-radius: 4px;
  background: rgba(5, 12, 20, 0.76);
  color: rgba(235, 247, 255, 0.95);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28), inset 0 0 0 1px rgba(255, 255, 255, 0.035);
  pointer-events: auto;
  transform: translateZ(0);
}

button.systemLabelNode {
  cursor: pointer;
  font: inherit;
  text-align: left;
}

button.systemLabelNode:hover {
  border-color: var(--label-accent);
  background: rgba(8, 20, 32, 0.88);
}

.systemLabelNode.star,
.systemLabelNode.planet {
  background: rgba(5, 12, 20, 0.58);
}

.systemLabelNode.hyperlane {
  min-width: 78px;
  opacity: 0.76;
}

.systemLabelNode.fleet,
.systemLabelNode.starbase {
  background: rgba(4, 10, 18, 0.9);
}

.systemLabelIcon {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--label-accent) 62%, transparent);
  color: #fff;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0;
}

.systemLabelCopy {
  min-width: 0;
  display: grid;
  gap: 1px;
}

.systemLabelCopy strong,
.systemLabelCopy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.systemLabelCopy strong {
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.systemLabelCopy small {
  color: rgba(204, 220, 235, 0.72);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
`;
    document.head.appendChild(style);
    SystemLabelOverlay.styleInstalled = true;
  }
}

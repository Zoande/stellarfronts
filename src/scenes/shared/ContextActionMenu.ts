const CONTEXT_MENU_STYLE_ID = "sf-context-action-menu-styles";

export interface ContextMenuItem {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

export interface ContextMenuOptions {
  /** Screen position (clientX/clientY) where the menu should appear. */
  x: number;
  y: number;
  title: string;
  items: ContextMenuItem[];
}

export function ensureContextActionMenuStyles(): void {
  if (document.getElementById(CONTEXT_MENU_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = CONTEXT_MENU_STYLE_ID;
  style.textContent = `
.spaceActionMenu {
  position: fixed;
  z-index: 80;
  min-width: 150px;
  border: 1px solid rgba(150, 200, 230, 0.72);
  border-radius: 5px;
  background: linear-gradient(180deg, rgba(16, 22, 30, 0.98), rgba(8, 12, 18, 0.98));
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.46);
  padding: 6px;
  pointer-events: auto;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
}

.spaceActionMenuTitle {
  padding: 6px 8px 8px;
  color: rgba(214, 226, 242, 0.94);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-bottom: 1px solid rgba(136, 151, 171, 0.38);
  margin-bottom: 5px;
}

.spaceActionMenuBtn {
  width: 100%;
  min-height: 30px;
  border: 1px solid rgba(136, 151, 171, 0.42);
  border-radius: 4px;
  background: rgba(18, 25, 33, 0.96);
  color: #c4d1e2;
  cursor: pointer;
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-top: 5px;
}

.spaceActionMenuBtn:hover {
  border-color: rgba(90, 220, 255, 0.86);
  color: #edfaff;
  background: rgba(29, 43, 57, 0.98);
}

.spaceActionMenuBtn:disabled {
  cursor: default;
  opacity: 0.45;
  border-color: rgba(90, 100, 112, 0.38);
  color: rgba(160, 168, 178, 0.58);
}
`;
  document.head.appendChild(style);
}

/**
 * Shared floating right-click action menu used by both the Galaxy and System
 * views. Owns its DOM element, screen positioning, and outside-click / Escape
 * dismissal. Callers supply a title and a capability-filtered item list.
 */
export class ContextActionMenu {
  private element: HTMLDivElement | null = null;
  private readonly onDismiss = (event: Event): void => {
    if (this.element && event.target instanceof Node && this.element.contains(event.target)) return;
    this.close();
  };
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.close();
  };

  get isOpen(): boolean {
    return this.element !== null;
  }

  open(options: ContextMenuOptions): void {
    ensureContextActionMenuStyles();
    this.close();
    if (options.items.length === 0) return;

    const menu = document.createElement("div");
    menu.className = "spaceActionMenu";
    menu.style.left = `${Math.min(options.x, window.innerWidth - 170)}px`;
    menu.style.top = `${Math.min(options.y, window.innerHeight - (60 + options.items.length * 36))}px`;
    menu.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    menu.addEventListener("contextmenu", (ev) => ev.preventDefault());

    const title = document.createElement("div");
    title.className = "spaceActionMenuTitle";
    title.textContent = options.title;
    menu.appendChild(title);

    for (const item of options.items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "spaceActionMenuBtn";
      button.textContent = item.label;
      button.disabled = item.disabled === true;
      button.addEventListener("click", (clickEv) => {
        clickEv.stopPropagation();
        if (item.disabled) return;
        this.close();
        item.onSelect();
      });
      menu.appendChild(button);
    }

    document.body.appendChild(menu);
    this.element = menu;
    // Defer global listeners so the opening click doesn't immediately dismiss.
    setTimeout(() => {
      window.addEventListener("pointerdown", this.onDismiss, true);
      window.addEventListener("keydown", this.onKeyDown, true);
    }, 0);
  }

  close(): void {
    if (!this.element) return;
    this.element.remove();
    this.element = null;
    window.removeEventListener("pointerdown", this.onDismiss, true);
    window.removeEventListener("keydown", this.onKeyDown, true);
  }

  dispose(): void {
    this.close();
  }
}

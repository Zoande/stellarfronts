import type { FactionInfo, GalaxyPerspective } from "../data/Factions";
import { colorToCss } from "../data/Factions";

const STYLE_ID = "space-login-overlay-style";

const LOGIN_STYLE = `
#spaceLoginRoot {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 50% 42%, rgba(54, 70, 92, 0.28), rgba(0, 0, 0, 0) 36rem),
    rgba(0, 0, 0, 0.94);
  color: #d6dde7;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
}

#spaceLoginPanel {
  width: min(760px, calc(100vw - 40px));
  border: 1px solid rgba(168, 182, 200, 0.72);
  border-radius: 6px;
  background: linear-gradient(180deg, rgba(16, 22, 30, 0.98), rgba(8, 12, 18, 0.98));
  padding: 22px;
  box-shadow: 0 20px 80px rgba(0, 0, 0, 0.55);
}

#spaceLoginTitle {
  font-size: 18px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  margin-bottom: 16px;
}

#spaceLoginGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 10px;
}

.spaceLoginChoice {
  min-height: 52px;
  border: 1px solid rgba(136, 151, 171, 0.52);
  border-radius: 5px;
  background: rgba(14, 20, 28, 0.96);
  color: #c4d1e2;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 11px;
}

.spaceLoginChoice:hover {
  border-color: rgba(214, 221, 231, 0.88);
  background: rgba(28, 38, 50, 0.98);
}

.spaceLoginSwatch {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.72);
  background: var(--login-color);
  box-shadow: 0 0 16px var(--login-color);
  flex: 0 0 auto;
}

.spaceLoginObserver {
  grid-column: 1 / -1;
  justify-content: center;
}
`;

function ensureLoginStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = LOGIN_STYLE;
  document.head.appendChild(style);
}

export class LoginOverlay {
  private readonly factions: FactionInfo[];
  private root: HTMLDivElement | null = null;

  constructor(factions: FactionInfo[]) {
    this.factions = factions;
    ensureLoginStyles();
  }

  show(): Promise<GalaxyPerspective> {
    this.dispose();

    this.root = document.createElement("div");
    this.root.id = "spaceLoginRoot";

    const panel = document.createElement("div");
    panel.id = "spaceLoginPanel";

    const title = document.createElement("div");
    title.id = "spaceLoginTitle";
    title.textContent = "Choose Perspective";

    const grid = document.createElement("div");
    grid.id = "spaceLoginGrid";

    panel.appendChild(title);
    panel.appendChild(grid);
    this.root.appendChild(panel);
    document.body.appendChild(this.root);

    return new Promise((resolve) => {
      for (const faction of this.factions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "spaceLoginChoice";
        button.style.setProperty("--login-color", colorToCss(faction.color));

        const swatch = document.createElement("span");
        swatch.className = "spaceLoginSwatch";

        const label = document.createElement("span");
        label.textContent = faction.name;

        button.appendChild(swatch);
        button.appendChild(label);
        button.addEventListener("click", () => {
          resolve({ mode: "faction", factionId: faction.id });
        });
        grid.appendChild(button);
      }

      const observer = document.createElement("button");
      observer.type = "button";
      observer.className = "spaceLoginChoice spaceLoginObserver";
      observer.textContent = "Observer";
      observer.addEventListener("click", () => {
        resolve({ mode: "observer" });
      });
      grid.appendChild(observer);
    });
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
  }
}

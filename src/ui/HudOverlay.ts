import type { GameClock } from "../game/GameProtocol";

export type HudToggleKey = "hyperlanes" | "bloom" | "centerCloud" | "stars" | "ownership";

export type HudVisualToggles = Record<HudToggleKey, boolean>;

export interface HudConnectedSystem {
  id: number;
  name: string;
}

export interface HudState {
  title: string;
  canExitSystem: boolean;
  connectedSystems: HudConnectedSystem[];
  toggles: HudVisualToggles;
  clock?: GameClock;
}

export interface HudCallbacks {
  onExitSystem: () => void;
  onNavigateConnectedSystem: (systemId: number) => void;
  onToggleVisual: (key: HudToggleKey, enabled: boolean) => void;
}

const STYLE_ID = "space-rts-hud-style";

const HUD_STYLE = `
#spaceHudRoot {
  --hud-ink: #d6dde7;
  --hud-muted: #8f9cae;
  --hud-line: rgba(136, 151, 171, 0.52);
  --hud-line-strong: rgba(168, 182, 200, 0.72);
  --hud-danger-line: rgba(202, 126, 138, 0.74);
  --hud-panel: rgba(10, 14, 20, 0.96);
  --hud-panel-alt: rgba(16, 22, 30, 0.96);
  --hud-panel-soft: rgba(20, 27, 36, 0.9);
  position: fixed;
  inset: 0;
  z-index: 50;
  pointer-events: none;
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
  color: var(--hud-ink);
}

#spaceHudBottom {
  position: absolute;
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
  display: flex;
  align-items: flex-end;
  gap: 8px;
  pointer-events: auto;
}

#spaceHudBottom::before,
#spaceHudBottom::after {
  content: "";
  position: absolute;
  bottom: 0;
  width: 18px;
  height: 18px;
  border-bottom: 2px solid var(--hud-line-strong);
}

#spaceHudBottom::before {
  left: -6px;
  border-left: 2px solid var(--hud-line-strong);
  border-bottom-left-radius: 4px;
}

#spaceHudBottom::after {
  right: -6px;
  border-right: 2px solid var(--hud-line-strong);
  border-bottom-right-radius: 4px;
}

#spaceHudConnected {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 44vw;
  overflow-x: auto;
  scrollbar-width: thin;
  padding: 0 10px 10px 0;
  margin-right: 4px;
  border-right: 1px solid var(--hud-line);
}

#spaceHudConnected::-webkit-scrollbar {
  height: 6px;
}

#spaceHudConnected::-webkit-scrollbar-thumb {
  background: rgba(136, 151, 171, 0.55);
  border-radius: 999px;
}

.spaceHudConnectedBtn {
  border: 1px solid var(--hud-line);
  background: linear-gradient(180deg, rgba(26, 34, 44, 0.96) 0%, rgba(14, 20, 28, 0.96) 100%);
  color: #c4d1e2;
  border-radius: 5px 5px 0 0;
  padding: 8px 12px;
  min-height: 40px;
  font-size: 11px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  line-height: 1;
  cursor: pointer;
  max-width: 150px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  transition: background-color 0.14s ease, border-color 0.14s ease, transform 0.14s ease;
}

.spaceHudConnectedBtn:hover:not(:disabled) {
  background: linear-gradient(180deg, rgba(34, 44, 58, 0.98) 0%, rgba(20, 28, 37, 0.98) 100%);
  border-color: var(--hud-line-strong);
  transform: translateY(-1px);
}

.spaceHudConnectedBtn:disabled {
  cursor: default;
  opacity: 0.52;
}

#spaceHudTitle {
  position: relative;
  pointer-events: none;
  min-height: 52px;
  min-width: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 26px;
  border-radius: 6px 6px 0 0;
  border: 1px solid var(--hud-line-strong);
  border-bottom: none;
  background: linear-gradient(180deg, var(--hud-panel-alt) 0%, var(--hud-panel) 100%);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  color: var(--hud-ink);
}

#spaceHudTitle::before {
  content: "";
  position: absolute;
  left: 12px;
  right: 12px;
  top: 10px;
  border-top: 1px solid rgba(184, 197, 215, 0.36);
}

#spaceHudTitle::after {
  content: "";
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 8px;
  border-bottom: 1px solid rgba(84, 96, 111, 0.44);
}

#spaceHudExitBtn {
  pointer-events: auto;
  min-height: 52px;
  min-width: 52px;
  border-radius: 6px 6px 0 0;
  border: 1px solid var(--hud-danger-line);
  border-bottom: none;
  background: linear-gradient(180deg, rgba(60, 30, 38, 0.96) 0%, rgba(28, 16, 20, 0.96) 100%);
  color: #e6c5cb;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  font-weight: 600;
  transition: background-color 0.14s ease, border-color 0.14s ease, transform 0.14s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

#spaceHudExitBtn:hover:not(:disabled) {
  background: linear-gradient(180deg, rgba(72, 36, 45, 0.98) 0%, rgba(37, 20, 26, 0.98) 100%);
  border-color: rgba(222, 150, 160, 0.88);
  transform: translateY(-1px);
}

#spaceHudExitBtn:disabled {
  cursor: default;
  border-color: rgba(116, 94, 98, 0.46);
  background: linear-gradient(180deg, rgba(43, 37, 39, 0.88) 0%, rgba(31, 26, 28, 0.86) 100%);
  color: rgba(155, 142, 146, 0.7);
  opacity: 0.88;
}

#spaceHudToggles {
  position: absolute;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  width: 168px;
  padding: 10px 10px 12px;
  border-radius: 8px 0 0 0;
  border-top: 1px solid var(--hud-line);
  border-left: 1px solid var(--hud-line);
  background: linear-gradient(180deg, rgba(18, 24, 33, 0.96) 0%, rgba(10, 14, 20, 0.98) 100%);
  pointer-events: auto;
}

#spaceHudToggles::before {
  content: "Visual Filters";
  display: block;
  margin-bottom: 4px;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--hud-muted);
}

#spaceHudClock {
  position: absolute;
  top: 18px;
  right: 18px;
  min-width: 190px;
  border: 1px solid var(--hud-line);
  border-radius: 6px;
  background: linear-gradient(180deg, rgba(16, 22, 30, 0.96) 0%, rgba(8, 12, 18, 0.98) 100%);
  padding: 10px 12px;
  pointer-events: none;
  text-align: right;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.34);
}

.spaceHudClockLabel {
  display: block;
  color: var(--hud-muted);
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.spaceHudClockValue {
  display: block;
  color: #edf4ff;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.spaceHudClockSpeed {
  display: block;
  margin-top: 3px;
  color: rgba(150, 210, 255, 0.92);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.spaceHudToggleBtn {
  min-height: 30px;
  border-radius: 4px;
  border: 1px solid var(--hud-line);
  background: linear-gradient(180deg, rgba(29, 38, 49, 0.96) 0%, rgba(18, 25, 33, 0.96) 100%);
  color: #c4d1e2;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background-color 0.14s ease, border-color 0.14s ease, transform 0.14s ease;
  font-weight: 600;
}

.spaceHudToggleBtn:hover {
  background: linear-gradient(180deg, rgba(40, 50, 63, 0.98) 0%, rgba(24, 31, 40, 0.98) 100%);
  border-color: var(--hud-line-strong);
  transform: translateY(-1px);
}

.spaceHudToggleBtn[data-enabled="true"] {
  border-color: rgba(190, 205, 224, 0.82);
  color: #edf4ff;
}

.spaceHudToggleBtn.off {
  background: linear-gradient(180deg, rgba(31, 36, 42, 0.82) 0%, rgba(22, 26, 31, 0.82) 100%);
  border-color: rgba(97, 108, 122, 0.52);
  color: rgba(145, 156, 169, 0.76);
  opacity: 0.78;
}

.spaceHudToggleBtn.off:hover {
  background: linear-gradient(180deg, rgba(40, 46, 54, 0.9) 0%, rgba(27, 32, 38, 0.9) 100%);
  border-color: rgba(112, 124, 140, 0.64);
  opacity: 0.9;
}

@media (max-width: 980px) {
  #spaceHudBottom {
    width: calc(100vw - 24px);
    max-width: 760px;
    justify-content: center;
    padding-bottom: 0;
  }

  #spaceHudConnected {
    max-width: 45vw;
  }

  #spaceHudTitle {
    min-width: 240px;
  }
}

@media (max-width: 760px) {
  #spaceHudBottom {
    flex-wrap: wrap;
    row-gap: 8px;
    align-items: stretch;
  }

  #spaceHudConnected {
    order: 2;
    width: 100%;
    max-width: none;
    margin-right: 0;
    padding: 8px 0 8px;
    border-right: none;
    border-top: 1px solid var(--hud-line);
    justify-content: center;
  }

  #spaceHudTitle {
    min-height: 46px;
    min-width: 190px;
    font-size: 11px;
    letter-spacing: 0.12em;
  }

  #spaceHudExitBtn {
    min-height: 46px;
    min-width: 46px;
  }

  #spaceHudToggles {
    right: 0;
    bottom: 0;
    width: 132px;
    padding: 8px 8px 10px;
    gap: 6px;
  }

  .spaceHudConnectedBtn {
    font-size: 10px;
    max-width: 136px;
    min-height: 36px;
  }

  .spaceHudToggleBtn {
    min-height: 29px;
    font-size: 10px;
  }
}
`;

function ensureHudStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = HUD_STYLE;
  document.head.appendChild(style);
}

function truncateLabel(name: string, maxLength = 18): string {
  if (name.length <= maxLength) return name;
  return `${name.slice(0, maxLength - 1)}...`;
}

export class HudOverlay {
  private readonly callbacks: HudCallbacks;
  private readonly root: HTMLDivElement;
  private readonly connectedContainer: HTMLDivElement;
  private readonly clockEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly exitButton: HTMLButtonElement;
  private readonly toggleButtons: Record<HudToggleKey, HTMLButtonElement>;

  constructor(callbacks: HudCallbacks) {
    this.callbacks = callbacks;
    ensureHudStyles();

    this.root = document.createElement("div");
    this.root.id = "spaceHudRoot";

    const bottom = document.createElement("div");
    bottom.id = "spaceHudBottom";

    this.connectedContainer = document.createElement("div");
    this.connectedContainer.id = "spaceHudConnected";

    this.clockEl = document.createElement("div");
    this.clockEl.id = "spaceHudClock";

    this.titleEl = document.createElement("div");
    this.titleEl.id = "spaceHudTitle";

    this.exitButton = document.createElement("button");
    this.exitButton.id = "spaceHudExitBtn";
    this.exitButton.type = "button";
    this.exitButton.textContent = "X";
    this.exitButton.addEventListener("click", () => {
      if (this.exitButton.disabled) return;
      this.callbacks.onExitSystem();
    });

    bottom.appendChild(this.connectedContainer);
    bottom.appendChild(this.titleEl);
    bottom.appendChild(this.exitButton);

    const toggles = document.createElement("div");
    toggles.id = "spaceHudToggles";

    const createToggleButton = (
      key: HudToggleKey,
      label: string,
    ): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "spaceHudToggleBtn";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        const enabledNow = btn.dataset.enabled === "true";
        this.callbacks.onToggleVisual(key, !enabledNow);
      });
      toggles.appendChild(btn);
      return btn;
    };

    this.toggleButtons = {
      hyperlanes: createToggleButton("hyperlanes", "Hyperlanes"),
      bloom: createToggleButton("bloom", "Bloom"),
      centerCloud: createToggleButton("centerCloud", "Center Cloud"),
      stars: createToggleButton("stars", "Stars"),
      ownership: createToggleButton("ownership", "Ownership"),
    };

    this.root.appendChild(bottom);
    this.root.appendChild(this.clockEl);
    this.root.appendChild(toggles);
    document.body.appendChild(this.root);
  }

  update(state: HudState): void {
    this.titleEl.textContent = state.title;
    if (state.clock) {
      this.clockEl.innerHTML = `
        <span class="spaceHudClockLabel">Game Clock</span>
        <span class="spaceHudClockValue">Year ${state.clock.year.toFixed(1)}</span>
        <span class="spaceHudClockSpeed">${state.clock.speedMultiplier}x Simulation</span>
      `;
    } else {
      this.clockEl.innerHTML = "";
    }
    this.exitButton.disabled = !state.canExitSystem;

    this.connectedContainer.innerHTML = "";
    if (state.connectedSystems.length === 0) {
      const none = document.createElement("button");
      none.type = "button";
      none.className = "spaceHudConnectedBtn";
      none.textContent = "No Linked Systems";
      none.disabled = true;
      this.connectedContainer.appendChild(none);
    } else {
      for (const target of state.connectedSystems) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "spaceHudConnectedBtn";
        btn.textContent = `> ${truncateLabel(target.name)}`;
        btn.title = target.name;
        btn.addEventListener("click", () => {
          this.callbacks.onNavigateConnectedSystem(target.id);
        });
        this.connectedContainer.appendChild(btn);
      }
    }

    const toggleOrder: HudToggleKey[] = ["hyperlanes", "bloom", "centerCloud", "stars", "ownership"];
    for (const key of toggleOrder) {
      const enabled = state.toggles[key];
      const btn = this.toggleButtons[key];
      btn.dataset.enabled = enabled ? "true" : "false";
      btn.classList.toggle("off", !enabled);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

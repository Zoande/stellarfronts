import type { GameClock } from "../game/GameProtocol";
import { RESOURCE_KINDS, RESOURCE_LABELS } from "../data/Economy";
import type { FactionEconomyState } from "../data/Economy";
import {
  GAME_HOURS_PER_MONTH,
  gameYearToDateTime,
  estimateClockYear,
} from "../game/GameTime";
import { createFlagDesign } from "../flags/flagGenerator";
import { renderFlagSvg } from "../flags/renderFlagSvg";

export type HudToggleKey = "hyperlanes" | "bloom" | "centerCloud" | "stars" | "ownership";
export type HudSidebarItemKey =
  | "government"
  | "society"
  | "technology"
  | "leaders"
  | "planets"
  | "fleets"
  | "diplomacy"
  | "espionage"
  | "market";

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
  economy?: FactionEconomyState | null;
}

export interface HudCallbacks {
  onExitSystem: () => void;
  onNavigateConnectedSystem: (systemId: number) => void;
  onToggleVisual: (key: HudToggleKey, enabled: boolean) => void;
  onSidebarItem?: (key: HudSidebarItemKey) => void;
}

const STYLE_ID = "space-rts-hud-style";
const RESOURCE_ICON_LABELS: Record<string, string> = {
  food: "FD",
  minerals: "MN",
  energy: "EN",
  goods: "GD",
  alloys: "AL",
  research: "RS",
};

const SIDEBAR_ITEMS: Array<{ key: HudSidebarItemKey; label: string; icon: string }> = [
  { key: "government", label: "Government", icon: "GV" },
  { key: "society", label: "Society", icon: "SC" },
  { key: "technology", label: "Technology", icon: "TC" },
  { key: "leaders", label: "Leaders", icon: "LD" },
  { key: "planets", label: "Planets", icon: "PL" },
  { key: "fleets", label: "Fleets", icon: "FL" },
  { key: "diplomacy", label: "Diplomacy", icon: "DP" },
  { key: "espionage", label: "Espionage", icon: "ES" },
  { key: "market", label: "Market", icon: "MK" },
] as const;

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

#spaceHudSidebar {
  position: absolute;
  left: 0;
  top: 92px;
  bottom: 86px;
  width: 54px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 7px;
  padding: 8px 5px;
  pointer-events: auto;
}

#spaceHudSidebar::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 7px;
  border-right: 1px solid rgba(94, 173, 142, 0.44);
  background:
    linear-gradient(180deg, rgba(5, 28, 25, 0), rgba(6, 45, 39, 0.86) 16%, rgba(6, 45, 39, 0.86) 84%, rgba(5, 28, 25, 0)),
    radial-gradient(circle at 100% 50%, rgba(108, 255, 218, 0.18), transparent 4rem);
}

.spaceHudSidebarBtn {
  position: relative;
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  margin-left: 3px;
  border: 1px solid rgba(94, 173, 142, 0.44);
  border-left-color: rgba(94, 173, 142, 0.72);
  background:
    linear-gradient(135deg, rgba(9, 46, 39, 0.92), rgba(3, 14, 16, 0.96)),
    radial-gradient(circle at 35% 20%, rgba(127, 255, 220, 0.16), transparent 2.6rem);
  color: #dffff5;
  font: inherit;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  cursor: pointer;
  clip-path: polygon(0 0, calc(100% - 5px) 0, 100% 5px, 100% 100%, 0 100%);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.28), inset 0 0 0 1px rgba(255, 255, 255, 0.03);
  transition: transform 0.14s ease, border-color 0.14s ease, background-color 0.14s ease;
}

.spaceHudSidebarBtn::before {
  content: "";
  position: absolute;
  left: 5px;
  top: 5px;
  right: 5px;
  height: 2px;
  background: rgba(127, 255, 220, 0.26);
}

.spaceHudSidebarBtn::after {
  content: attr(aria-label);
  position: absolute;
  left: 48px;
  top: 50%;
  transform: translateY(-50%) translateX(-4px);
  min-width: 116px;
  padding: 7px 10px;
  border: 1px solid rgba(94, 173, 142, 0.52);
  background: linear-gradient(90deg, rgba(5, 28, 25, 0.96), rgba(6, 18, 20, 0.96));
  color: #dffff5;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  opacity: 0;
  pointer-events: none;
  white-space: nowrap;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.34);
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.spaceHudSidebarBtn:hover {
  transform: translateX(3px);
  border-color: rgba(127, 255, 220, 0.82);
  background:
    linear-gradient(135deg, rgba(14, 66, 56, 0.98), rgba(4, 19, 21, 0.98)),
    radial-gradient(circle at 35% 20%, rgba(127, 255, 220, 0.2), transparent 2.6rem);
}

.spaceHudSidebarBtn:hover::after {
  opacity: 1;
  transform: translateY(-50%) translateX(0);
}

.spaceHudSidebarBtn span {
  position: relative;
  z-index: 1;
}

#spaceHudClock {
  position: absolute;
  top: 0;
  right: 0;
  transform: scale(1.3);
  transform-origin: top right;
  min-width: 286px;
  min-height: 39px;
  border-left: 1px solid rgba(94, 173, 142, 0.72);
  border-bottom: 1px solid rgba(94, 173, 142, 0.48);
  background:
    linear-gradient(180deg, rgba(9, 34, 25, 0.96), rgba(4, 13, 12, 0.98)),
    radial-gradient(circle at 12% 0%, rgba(246, 170, 77, 0.16), transparent 9rem);
  padding: 5px 12px 7px;
  pointer-events: none;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.34), inset 0 -1px 0 rgba(117, 255, 208, 0.08);
}

.spaceHudClockGrid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
}

#spaceHudResources {
  position: absolute;
  top: 0;
  left: 0;
  transform: scale(1.3);
  transform-origin: top left;
  display: flex;
  align-items: stretch;
  gap: 0;
  max-width: calc(100vw - 250px);
  min-height: 34px;
  padding-left: 64px;
  border-right: 1px solid rgba(94, 173, 142, 0.72);
  border-bottom: 1px solid rgba(94, 173, 142, 0.48);
  background:
    linear-gradient(180deg, rgba(8, 33, 24, 0.96), rgba(4, 13, 12, 0.98)),
    radial-gradient(circle at 30% 0%, rgba(90, 255, 195, 0.12), transparent 18rem);
  pointer-events: none;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28), inset 0 -1px 0 rgba(117, 255, 208, 0.08);
}

.spaceHudFactionFlag {
  position: absolute;
  left: 6px;
  top: -5px;
  width: 50px;
  height: 50px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.58));
  z-index: 2;
}

.spaceHudFactionFlag svg {
  width: 50px;
  height: 50px;
  display: block;
  overflow: visible;
}

.spaceHudResourceItem {
  min-width: 112px;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  border-right: 1px solid rgba(94, 173, 142, 0.35);
  background: linear-gradient(90deg, rgba(16, 58, 43, 0.26), rgba(4, 12, 12, 0.12));
  padding: 3px 8px 3px 7px;
}

.spaceHudResourceIcon {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  clip-path: polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
  border: 1px solid rgba(152, 255, 219, 0.48);
  background: rgba(11, 44, 38, 0.88);
  color: #eafff7;
  font-size: 8px;
  font-weight: 900;
}

.spaceHudResourceIcon.food { color: #91ff75; background: rgba(37, 83, 28, 0.72); }
.spaceHudResourceIcon.minerals { color: #f49a75; background: rgba(83, 38, 28, 0.72); }
.spaceHudResourceIcon.energy { color: #f2e85b; background: rgba(78, 75, 18, 0.72); }
.spaceHudResourceIcon.goods { color: #b9d2ff; background: rgba(36, 53, 84, 0.72); }
.spaceHudResourceIcon.alloys { color: #c9d0d3; background: rgba(67, 72, 74, 0.72); }
.spaceHudResourceIcon.research { color: #8ee8ff; background: rgba(24, 68, 78, 0.72); }

.spaceHudResourceText {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 6px;
}

.spaceHudResourceLabel {
  grid-column: 1 / span 2;
  color: rgba(175, 208, 197, 0.72);
  font-size: 7px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  white-space: nowrap;
}

.spaceHudResourceValue {
  color: #edf4ff;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}

.spaceHudResourceDelta {
  font-size: 9px;
  color: rgba(112, 235, 172, 0.92);
  white-space: nowrap;
}

.spaceHudResourceDelta.negative {
  color: rgba(255, 129, 111, 0.95);
}

.spaceHudClockLabel {
  display: block;
  grid-column: 1 / span 2;
  grid-row: 1;
  color: rgba(175, 208, 197, 0.72);
  font-size: 7px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  text-align: right;
}

.spaceHudClockValue {
  display: block;
  grid-column: 1;
  grid-row: 2;
  color: #edf4ff;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-align: right;
}

.spaceHudClockTime {
  display: block;
  grid-column: 2;
  grid-row: 2;
  color: rgba(246, 170, 77, 0.95);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-align: right;
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

  #spaceHudResources {
    max-width: calc(100vw - 24px);
    flex-wrap: wrap;
  }

  .spaceHudResourceItem {
    min-width: 94px;
  }

  #spaceHudSidebar {
    top: 112px;
    bottom: 132px;
    width: 46px;
  }

  .spaceHudSidebarBtn {
    width: 36px;
    height: 36px;
    font-size: 9px;
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

function formatCompactNumber(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs.toFixed(abs >= 100 ? 0 : 1)}`;
}

function formatDelta(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${formatCompactNumber(value)}/hr`;
}

export class HudOverlay {
  private readonly callbacks: HudCallbacks;
  private readonly root: HTMLDivElement;
  private readonly connectedContainer: HTMLDivElement;
  private readonly clockEl: HTMLDivElement;
  private readonly resourceEl: HTMLDivElement;
  private readonly sidebarEl: HTMLDivElement;
  private readonly factionFlagSvg: string;
  private readonly titleEl: HTMLDivElement;
  private readonly exitButton: HTMLButtonElement;
  private readonly toggleButtons: Record<HudToggleKey, HTMLButtonElement>;
  private currentClock: GameClock | null = null;
  private clockFrame: number | null = null;
  private clockShellVisible = false;
  private connectedSignature: string | null = null;
  private resourceSignature = "";

  constructor(callbacks: HudCallbacks) {
    this.callbacks = callbacks;
    ensureHudStyles();
    const flagDesign = createFlagDesign({ seed: `${Date.now()}-${Math.random()}` });
    this.factionFlagSvg = renderFlagSvg(flagDesign, {
      size: 34,
      className: "spaceHudFactionFlagSvg",
      title: "Faction flag",
      idPrefix: "hud-faction-flag",
    });

    this.root = document.createElement("div");
    this.root.id = "spaceHudRoot";

    const bottom = document.createElement("div");
    bottom.id = "spaceHudBottom";

    this.connectedContainer = document.createElement("div");
    this.connectedContainer.id = "spaceHudConnected";

    this.clockEl = document.createElement("div");
    this.clockEl.id = "spaceHudClock";

    this.resourceEl = document.createElement("div");
    this.resourceEl.id = "spaceHudResources";

    this.sidebarEl = document.createElement("div");
    this.sidebarEl.id = "spaceHudSidebar";
    for (const item of SIDEBAR_ITEMS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "spaceHudSidebarBtn";
      button.setAttribute("aria-label", item.label);
      button.title = item.label;
      button.innerHTML = `<span>${item.icon}</span>`;
      button.addEventListener("click", () => {
        this.callbacks.onSidebarItem?.(item.key);
      });
      this.sidebarEl.appendChild(button);
    }

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
    this.root.appendChild(this.resourceEl);
    this.root.appendChild(this.sidebarEl);
    this.root.appendChild(toggles);
    document.body.appendChild(this.root);
  }

  update(state: HudState): void {
    this.titleEl.textContent = state.title;
    if (state.clock) {
      this.currentClock = state.clock;
      if (!this.clockShellVisible) {
        this.clockEl.innerHTML = `
          <div class="spaceHudClockGrid">
            <span class="spaceHudClockLabel">Galactic Standard</span>
            <span class="spaceHudClockValue" data-clock-date></span>
            <span class="spaceHudClockTime" data-clock-time></span>
          </div>
        `;
        this.clockShellVisible = true;
      }
      this.renderClock();
      this.ensureClockAnimation();
    } else {
      this.currentClock = null;
      this.stopClockAnimation();
      if (this.clockShellVisible) {
        this.clockEl.innerHTML = "";
        this.clockShellVisible = false;
      }
    }
    if (state.economy) {
      const nextResourceSignature = JSON.stringify({
        stockpiles: state.economy.stockpiles,
        monthlyDelta: state.economy.monthlyDelta,
      });
      if (this.resourceSignature !== nextResourceSignature) {
        const flag = `<div class="spaceHudFactionFlag">${this.factionFlagSvg}</div>`;
        const resources = RESOURCE_KINDS.map((resource) => {
          const stockpile = state.economy?.stockpiles[resource] ?? 0;
          const delta = (state.economy?.monthlyDelta[resource] ?? 0) / GAME_HOURS_PER_MONTH;
          return `
            <div class="spaceHudResourceItem">
              <span class="spaceHudResourceIcon ${resource}">${RESOURCE_ICON_LABELS[resource]}</span>
              <span class="spaceHudResourceText">
                <span class="spaceHudResourceLabel">${RESOURCE_LABELS[resource]}</span>
                <span class="spaceHudResourceValue">${formatCompactNumber(stockpile)}</span>
                <span class="spaceHudResourceDelta ${delta < 0 ? "negative" : ""}">${formatDelta(delta)}</span>
              </span>
            </div>
          `;
        }).join("");
        this.resourceEl.innerHTML = `${flag}${resources}`;
        this.resourceSignature = nextResourceSignature;
      }
    } else {
      if (this.resourceSignature) {
        this.resourceEl.innerHTML = "";
        this.resourceSignature = "";
      }
    }
    this.exitButton.disabled = !state.canExitSystem;

    const nextConnectedSignature = state.connectedSystems
      .map((system) => `${system.id}:${system.name}`)
      .join("|");
    if (this.connectedSignature !== nextConnectedSignature) {
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
      this.connectedSignature = nextConnectedSignature;
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
    this.stopClockAnimation();
    this.root.remove();
  }

  private ensureClockAnimation(): void {
    if (this.clockFrame !== null) return;
    const tick = (): void => {
      this.renderClock();
      this.clockFrame = window.requestAnimationFrame(tick);
    };
    this.clockFrame = window.requestAnimationFrame(tick);
  }

  private stopClockAnimation(): void {
    if (this.clockFrame === null) return;
    window.cancelAnimationFrame(this.clockFrame);
    this.clockFrame = null;
  }

  private renderClock(): void {
    if (!this.currentClock) return;
    const estimatedYear = estimateClockYear(
      this.currentClock.year,
      this.currentClock.syncedAtMs,
      this.currentClock.speedMultiplier,
    );
    const date = gameYearToDateTime(estimatedYear);
    const dateEl = this.clockEl.querySelector<HTMLElement>("[data-clock-date]");
    const timeEl = this.clockEl.querySelector<HTMLElement>("[data-clock-time]");
    if (dateEl) {
      dateEl.textContent = `${date.year} / ${String(date.month).padStart(2, "0")} / ${String(date.day).padStart(2, "0")}`;
    }
    if (timeEl) {
      timeEl.textContent = `${String(date.hour).padStart(2, "0")}:${String(date.minute).padStart(2, "0")}:${String(date.second).padStart(2, "0")}`;
    }
  }
}

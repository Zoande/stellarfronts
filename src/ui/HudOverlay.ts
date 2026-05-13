import type { GameClock } from '../game/GameProtocol';
import { RESOURCE_KINDS, RESOURCE_LABELS } from '../data/Economy';
import type { FactionEconomyState } from '../data/Economy';
import { createFlagDesign } from '../flags/flagGenerator';
import { renderFlagSvg } from '../flags/renderFlagSvg';

export type HudToggleKey = 'hyperlanes' | 'bloom' | 'centerCloud' | 'stars' | 'ownership';
export type HudSidebarItemKey =
  | 'government'
  | 'society'
  | 'technology'
  | 'leaders'
  | 'planets'
  | 'fleets'
  | 'diplomacy'
  | 'espionage'
  | 'market';

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

const STYLE_ID = 'space-rts-hud-style';
const GAME_DAYS_PER_YEAR = 360;

const RESOURCE_ICON_LABELS: Record<string, string> = {
  food: 'FD',
  minerals: 'MN',
  energy: 'EN',
  goods: 'GD',
  alloys: 'AL',
  research: 'RS',
};

const SIDEBAR_ITEMS: Array<{ key: HudSidebarItemKey; label: string; icon: string }> = [
  { key: 'government', label: 'Government', icon: 'GV' },
  { key: 'society', label: 'Society', icon: 'SC' },
  { key: 'technology', label: 'Technology', icon: 'TC' },
  { key: 'leaders', label: 'Leaders', icon: 'LD' },
  { key: 'planets', label: 'Planets', icon: 'PL' },
  { key: 'fleets', label: 'Fleets', icon: 'FL' },
  { key: 'diplomacy', label: 'Diplomacy', icon: 'DP' },
  { key: 'espionage', label: 'Espionage', icon: 'ES' },
  { key: 'market', label: 'Market', icon: 'MK' },
] as const;

const HUD_STYLE = `
#spaceHudRoot {
  --hud-ink: #edf6ff;
  --hud-muted: rgba(197, 219, 243, 0.66);
  --hud-line: rgba(96, 161, 234, 0.2);
  --hud-line-strong: rgba(118, 191, 255, 0.42);
  --hud-panel: rgba(4, 12, 22, 0.76);
  --hud-panel-strong: rgba(4, 12, 22, 0.9);
  --hud-panel-soft: rgba(6, 17, 31, 0.68);
  --hud-blue: #6fcfff;
  --hud-blue-strong: #3398ff;
  position: fixed;
  inset: 0;
  z-index: 50;
  pointer-events: none;
  color: var(--hud-ink);
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
}

#spaceHudRoot * {
  box-sizing: border-box;
}

#spaceHudResources {
  position: absolute;
  left: 18px;
  top: 82px;
  display: flex;
  align-items: stretch;
  min-height: 58px;
  max-width: min(56vw, 980px);
  background: var(--hud-panel-strong);
  border: 1px solid var(--hud-line);
  backdrop-filter: blur(14px);
  box-shadow: 0 16px 28px rgba(0, 0, 0, 0.24);
  overflow: hidden;
  pointer-events: none;
}

.spaceHudFactionFlag {
  width: 64px;
  display: grid;
  place-items: center;
  border-right: 1px solid var(--hud-line);
  background: linear-gradient(180deg, rgba(17, 60, 116, 0.42), rgba(4, 12, 22, 0.92));
}

.spaceHudFactionFlag svg {
  width: 44px;
  height: 44px;
  display: block;
}

.spaceHudResourceItem {
  min-width: 124px;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 9px 12px;
  border-right: 1px solid var(--hud-line);
  background: linear-gradient(180deg, rgba(8, 21, 38, 0.9), rgba(4, 12, 22, 0.96));
}

.spaceHudResourceIcon {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(122, 194, 255, 0.34);
  background: rgba(11, 37, 67, 0.82);
  color: #eff8ff;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 0.08em;
}

.spaceHudResourceIcon.food { color: #92ffbc; }
.spaceHudResourceIcon.minerals { color: #ffb897; }
.spaceHudResourceIcon.energy { color: #ffe980; }
.spaceHudResourceIcon.goods { color: #bfd8ff; }
.spaceHudResourceIcon.alloys { color: #dde6f0; }
.spaceHudResourceIcon.research { color: #8fdcff; }

.spaceHudResourceText {
  display: grid;
  gap: 2px;
}

.spaceHudResourceLabel,
.spaceHudMiniLabel,
.spaceHudPanelTitle,
.spaceHudTag {
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.spaceHudResourceLabel,
.spaceHudMiniLabel,
.spaceHudTag {
  color: var(--hud-muted);
}

.spaceHudResourceValue,
.spaceHudMiniValue {
  color: var(--hud-ink);
  font-size: 15px;
  font-weight: 700;
}

.spaceHudResourceDelta {
  color: #79cfff;
  font-size: 10px;
}

.spaceHudResourceDelta.negative {
  color: #ff9198;
}

#spaceHudClock {
  position: absolute;
  right: 18px;
  top: 82px;
  min-width: 284px;
  padding: 12px 14px;
  border: 1px solid var(--hud-line);
  background: var(--hud-panel-strong);
  backdrop-filter: blur(14px);
  box-shadow: 0 16px 28px rgba(0, 0, 0, 0.24);
}

.spaceHudClockGrid {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
  grid-template-rows: auto auto 6px;
  gap: 4px 12px;
  align-items: end;
}

.spaceHudClockSpeed {
  grid-row: 1 / span 2;
  align-self: center;
  display: grid;
  place-items: center;
  min-height: 54px;
  border: 1px solid rgba(118, 191, 255, 0.24);
  background: linear-gradient(180deg, rgba(17, 60, 116, 0.4), rgba(4, 12, 22, 0.88));
  color: var(--hud-blue);
  font-size: 10px;
  line-height: 1.5;
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.spaceHudClockLabel {
  color: var(--hud-muted);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.spaceHudClockValue {
  color: var(--hud-ink);
  font-size: 14px;
  letter-spacing: 0.12em;
}

.spaceHudClockProgress {
  grid-column: 2;
  display: block;
  height: 6px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.spaceHudClockProgressFill {
  display: block;
  width: 100%;
  height: 100%;
  transform-origin: left center;
  background: linear-gradient(90deg, var(--hud-blue-strong), var(--hud-blue));
  animation: spaceHudDayProgress var(--clock-day-duration, 30s) linear infinite;
  animation-delay: var(--clock-day-delay, 0s);
}

@keyframes spaceHudDayProgress {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}

#spaceHudSidebar {
  position: absolute;
  left: 18px;
  top: 154px;
  display: grid;
  gap: 10px;
  pointer-events: auto;
}

.spaceHudSidebarBtn {
  position: relative;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 1px solid var(--hud-line);
  background: var(--hud-panel-soft);
  color: #e9f6ff;
  font: inherit;
  font-size: 10px;
  font-weight: 900;
  cursor: pointer;
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.spaceHudSidebarBtn:hover {
  transform: translateX(2px);
  border-color: var(--hud-line-strong);
  background: rgba(8, 24, 42, 0.92);
}

.spaceHudSidebarBtn::after {
  content: attr(aria-label);
  position: absolute;
  left: calc(100% + 10px);
  top: 50%;
  transform: translateY(-50%);
  padding: 7px 10px;
  border: 1px solid var(--hud-line);
  background: rgba(4, 12, 22, 0.94);
  color: var(--hud-ink);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.16s ease;
  pointer-events: none;
}

.spaceHudSidebarBtn:hover::after {
  opacity: 1;
}

#spaceHudOutliner,
#spaceHudIntel,
#spaceHudToggles {
  position: absolute;
  border: 1px solid var(--hud-line);
  background: var(--hud-panel);
  backdrop-filter: blur(14px);
  box-shadow: 0 16px 28px rgba(0, 0, 0, 0.24);
  pointer-events: auto;
}

#spaceHudOutliner {
  left: 76px;
  top: 154px;
  width: min(300px, 25vw);
  max-height: calc(100vh - 250px);
  padding: 14px;
  overflow: auto;
}

#spaceHudIntel {
  right: 18px;
  top: 154px;
  width: min(330px, 27vw);
  display: grid;
  gap: 14px;
  padding: 14px;
}

#spaceHudToggles {
  right: 18px;
  bottom: 96px;
  width: min(330px, 27vw);
  display: grid;
  gap: 8px;
  padding: 14px;
}

.spaceHudPanelTitle {
  margin-bottom: 12px;
  color: var(--hud-blue);
}

.spaceHudOutlinerList,
.spaceHudTagList {
  display: grid;
  gap: 8px;
}

.spaceHudOutlinerBtn {
  width: 100%;
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid rgba(118, 191, 255, 0.14);
  background: rgba(6, 17, 31, 0.82);
  color: var(--hud-ink);
  text-align: left;
  cursor: pointer;
  font: inherit;
  transition: border-color 0.16s ease, transform 0.16s ease;
}

.spaceHudOutlinerBtn:hover {
  transform: translateX(2px);
  border-color: rgba(118, 191, 255, 0.3);
}

.spaceHudOutlinerBtn strong {
  font-size: 13px;
  font-weight: 600;
}

.spaceHudOutlinerBtn span {
  color: var(--hud-muted);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.spaceHudEmpty {
  padding: 12px;
  border: 1px solid rgba(118, 191, 255, 0.1);
  background: rgba(6, 17, 31, 0.66);
  color: var(--hud-muted);
  font-size: 12px;
  line-height: 1.6;
}

.spaceHudSystemName {
  margin: 0 0 6px;
  color: var(--hud-ink);
  font-size: 22px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.spaceHudSystemMeta {
  margin: 0 0 14px;
  color: var(--hud-muted);
  line-height: 1.6;
  font-size: 13px;
}

.spaceHudStatGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.spaceHudStatCard {
  padding: 10px;
  border: 1px solid rgba(118, 191, 255, 0.12);
  background: rgba(6, 17, 31, 0.76);
}

.spaceHudTagList {
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
}

.spaceHudTag {
  display: grid;
  place-items: center;
  min-height: 34px;
  border: 1px solid rgba(118, 191, 255, 0.14);
  background: rgba(6, 17, 31, 0.76);
}

.spaceHudToggleBtn {
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid rgba(118, 191, 255, 0.12);
  background: rgba(6, 17, 31, 0.82);
  color: var(--hud-ink);
  font: inherit;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.spaceHudToggleBtn[data-enabled="true"] {
  border-color: rgba(118, 191, 255, 0.34);
  background: linear-gradient(90deg, rgba(15, 70, 135, 0.86), rgba(7, 28, 56, 0.92));
}

.spaceHudToggleBtn.off {
  color: var(--hud-muted);
}

#spaceHudBottom {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  display: flex;
  align-items: flex-end;
  gap: 10px;
  pointer-events: auto;
}

#spaceHudConnected {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 44vw;
  padding: 10px 12px;
  border: 1px solid var(--hud-line);
  background: var(--hud-panel-strong);
  overflow-x: auto;
}

.spaceHudConnectedBtn {
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid rgba(118, 191, 255, 0.12);
  background: rgba(6, 17, 31, 0.82);
  color: var(--hud-ink);
  font: inherit;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  white-space: nowrap;
  cursor: pointer;
}

.spaceHudConnectedBtn:disabled {
  opacity: 0.6;
  cursor: default;
}

#spaceHudTitle,
#spaceHudExitBtn {
  min-height: 60px;
  border: 1px solid var(--hud-line);
  background: var(--hud-panel-strong);
}

#spaceHudTitle {
  min-width: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 24px;
  color: var(--hud-ink);
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  text-align: center;
}

#spaceHudExitBtn {
  min-width: 60px;
  color: #ffd8dc;
  font: inherit;
  font-size: 18px;
  cursor: pointer;
}

#spaceHudExitBtn:disabled {
  opacity: 0.5;
  cursor: default;
}

#spaceHudTabs {
  position: absolute;
  left: 18px;
  bottom: 18px;
  display: flex;
  gap: 0;
  border: 1px solid var(--hud-line);
  background: var(--hud-panel-strong);
  pointer-events: auto;
}

.spaceHudTab {
  min-height: 34px;
  padding: 0 18px;
  border-right: 1px solid var(--hud-line);
  display: flex;
  align-items: center;
  color: var(--hud-muted);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.spaceHudTab:last-child {
  border-right: 0;
}

.spaceHudTab.is-active {
  color: var(--hud-ink);
  background: linear-gradient(180deg, rgba(13, 63, 123, 0.74), rgba(4, 12, 22, 0.96));
}

@media (max-width: 1200px) {
  #spaceHudResources,
  #spaceHudClock {
    top: 126px;
  }

  #spaceHudSidebar,
  #spaceHudOutliner,
  #spaceHudIntel {
    top: 198px;
  }
}

@media (max-width: 980px) {
  #spaceHudOutliner,
  #spaceHudIntel,
  #spaceHudToggles,
  #spaceHudTabs {
    display: none;
  }

  #spaceHudResources {
    left: 10px;
    top: 118px;
    max-width: calc(100vw - 20px);
  }

  #spaceHudClock {
    right: 10px;
    top: 10px;
  }

  #spaceHudSidebar {
    left: 10px;
    top: 186px;
  }

  #spaceHudBottom {
    left: 10px;
    right: 10px;
    transform: none;
    justify-content: center;
    flex-wrap: wrap;
  }

  #spaceHudConnected {
    max-width: calc(100vw - 20px);
  }
}

@media (max-width: 640px) {
  #spaceHudResources {
    flex-wrap: wrap;
  }

  .spaceHudResourceItem {
    min-width: calc(50% - 0px);
  }

  #spaceHudTitle {
    min-width: 220px;
    font-size: 10px;
  }

  #spaceHudConnected {
    width: 100%;
  }
}
`;

function ensureHudStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = HUD_STYLE;
  document.head.appendChild(style);
}

function truncateLabel(name: string, maxLength = 18): string {
  if (name.length <= maxLength) return name;
  return `${name.slice(0, maxLength - 1)}...`;
}

function formatCompactNumber(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs.toFixed(abs >= 100 ? 0 : 1)}`;
}

function formatDelta(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${formatCompactNumber(value)}/mo`;
}

function formatGameDate(yearValue: number): { year: number; month: number; day: number } {
  const year = Math.floor(yearValue);
  const dayOfYear = Math.max(0, Math.min(GAME_DAYS_PER_YEAR - 1, Math.floor((yearValue - year) * GAME_DAYS_PER_YEAR)));
  return {
    year,
    month: Math.floor(dayOfYear / 30) + 1,
    day: (dayOfYear % 30) + 1,
  };
}

function getDayProgress(yearValue: number): number {
  const year = Math.floor(yearValue);
  const exactDayOfYear = Math.max(0, Math.min(GAME_DAYS_PER_YEAR, (yearValue - year) * GAME_DAYS_PER_YEAR));
  return exactDayOfYear - Math.floor(exactDayOfYear);
}

export class HudOverlay {
  private readonly callbacks: HudCallbacks;
  private readonly root: HTMLDivElement;
  private readonly connectedContainer: HTMLDivElement;
  private readonly clockEl: HTMLDivElement;
  private readonly resourceEl: HTMLDivElement;
  private readonly sidebarEl: HTMLDivElement;
  private readonly outlinerEl: HTMLDivElement;
  private readonly intelEl: HTMLDivElement;
  private readonly factionFlagSvg: string;
  private readonly titleEl: HTMLDivElement;
  private readonly exitButton: HTMLButtonElement;
  private readonly toggleButtons: Record<HudToggleKey, HTMLButtonElement>;

  constructor(callbacks: HudCallbacks) {
    this.callbacks = callbacks;
    ensureHudStyles();
    const flagDesign = createFlagDesign({ seed: `${Date.now()}-${Math.random()}` });
    this.factionFlagSvg = renderFlagSvg(flagDesign, {
      size: 34,
      className: 'spaceHudFactionFlagSvg',
      title: 'Faction flag',
      idPrefix: 'hud-faction-flag',
    });

    this.root = document.createElement('div');
    this.root.id = 'spaceHudRoot';

    this.resourceEl = document.createElement('div');
    this.resourceEl.id = 'spaceHudResources';

    this.clockEl = document.createElement('div');
    this.clockEl.id = 'spaceHudClock';

    this.sidebarEl = document.createElement('div');
    this.sidebarEl.id = 'spaceHudSidebar';

    for (const item of SIDEBAR_ITEMS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'spaceHudSidebarBtn';
      button.setAttribute('aria-label', item.label);
      button.title = item.label;
      button.innerHTML = `<span>${item.icon}</span>`;
      button.addEventListener('click', () => {
        this.callbacks.onSidebarItem?.(item.key);
      });
      this.sidebarEl.appendChild(button);
    }

    this.outlinerEl = document.createElement('div');
    this.outlinerEl.id = 'spaceHudOutliner';

    this.intelEl = document.createElement('div');
    this.intelEl.id = 'spaceHudIntel';

    const toggles = document.createElement('div');
    toggles.id = 'spaceHudToggles';

    const createToggleButton = (key: HudToggleKey, label: string): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'spaceHudToggleBtn';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        const enabledNow = btn.dataset.enabled === 'true';
        this.callbacks.onToggleVisual(key, !enabledNow);
      });
      toggles.appendChild(btn);
      return btn;
    };

    this.toggleButtons = {
      hyperlanes: createToggleButton('hyperlanes', 'Hyperlanes'),
      bloom: createToggleButton('bloom', 'Bloom'),
      centerCloud: createToggleButton('centerCloud', 'Center Cloud'),
      stars: createToggleButton('stars', 'Stars'),
      ownership: createToggleButton('ownership', 'Ownership'),
    };

    const bottom = document.createElement('div');
    bottom.id = 'spaceHudBottom';

    this.connectedContainer = document.createElement('div');
    this.connectedContainer.id = 'spaceHudConnected';

    this.titleEl = document.createElement('div');
    this.titleEl.id = 'spaceHudTitle';

    this.exitButton = document.createElement('button');
    this.exitButton.id = 'spaceHudExitBtn';
    this.exitButton.type = 'button';
    this.exitButton.textContent = 'X';
    this.exitButton.addEventListener('click', () => {
      if (this.exitButton.disabled) return;
      this.callbacks.onExitSystem();
    });

    bottom.appendChild(this.connectedContainer);
    bottom.appendChild(this.titleEl);
    bottom.appendChild(this.exitButton);

    const tabs = document.createElement('div');
    tabs.id = 'spaceHudTabs';
    ['Galaxy', 'Economy', 'Research', 'Factions'].forEach((label, index) => {
      const tab = document.createElement('div');
      tab.className = `spaceHudTab ${index === 0 ? 'is-active' : ''}`;
      tab.textContent = label;
      tabs.appendChild(tab);
    });

    this.root.appendChild(this.resourceEl);
    this.root.appendChild(this.clockEl);
    this.root.appendChild(this.sidebarEl);
    this.root.appendChild(this.outlinerEl);
    this.root.appendChild(this.intelEl);
    this.root.appendChild(toggles);
    this.root.appendChild(bottom);
    this.root.appendChild(tabs);
    document.body.appendChild(this.root);
  }

  update(state: HudState): void {
    this.titleEl.textContent = state.title;

    if (state.clock) {
      const date = formatGameDate(state.clock.year);
      const daysPerThirtySeconds = state.clock.speedMultiplier;
      const dayProgress = getDayProgress(state.clock.year);
      const dayDuration = 30 / Math.max(0.01, daysPerThirtySeconds);
      const delay = -dayProgress * dayDuration;
      this.clockEl.innerHTML = `
        <div class="spaceHudClockGrid" style="--clock-day-duration: ${dayDuration}s; --clock-day-delay: ${delay}s;">
          <span class="spaceHudClockSpeed">${daysPerThirtySeconds} ${daysPerThirtySeconds === 1 ? 'day' : 'days'}<br>/ 30 sec</span>
          <span class="spaceHudClockLabel">Galactic Standard</span>
          <span class="spaceHudClockValue">${date.year} / ${String(date.month).padStart(2, '0')} / ${String(date.day).padStart(2, '0')}</span>
          <span class="spaceHudClockProgress" aria-hidden="true"><span class="spaceHudClockProgressFill"></span></span>
        </div>
      `;
    } else {
      this.clockEl.innerHTML = '';
    }

    if (state.economy) {
      const flag = `<div class="spaceHudFactionFlag">${this.factionFlagSvg}</div>`;
      const resources = RESOURCE_KINDS.map((resource) => {
        const stockpile = state.economy?.stockpiles[resource] ?? 0;
        const delta = state.economy?.monthlyDelta[resource] ?? 0;
        return `
          <div class="spaceHudResourceItem">
            <span class="spaceHudResourceIcon ${resource}">${RESOURCE_ICON_LABELS[resource]}</span>
            <span class="spaceHudResourceText">
              <span class="spaceHudResourceLabel">${RESOURCE_LABELS[resource]}</span>
              <span class="spaceHudResourceValue">${formatCompactNumber(stockpile)}</span>
              <span class="spaceHudResourceDelta ${delta < 0 ? 'negative' : ''}">${formatDelta(delta)}</span>
            </span>
          </div>
        `;
      }).join('');
      this.resourceEl.innerHTML = `${flag}${resources}`;
    } else {
      this.resourceEl.innerHTML = '';
    }

    this.exitButton.disabled = !state.canExitSystem;

    this.connectedContainer.innerHTML = '';
    if (state.connectedSystems.length === 0) {
      const none = document.createElement('button');
      none.type = 'button';
      none.className = 'spaceHudConnectedBtn';
      none.textContent = 'No Linked Systems';
      none.disabled = true;
      this.connectedContainer.appendChild(none);
    } else {
      state.connectedSystems.forEach((target) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'spaceHudConnectedBtn';
        btn.textContent = `> ${truncateLabel(target.name)}`;
        btn.title = target.name;
        btn.addEventListener('click', () => {
          this.callbacks.onNavigateConnectedSystem(target.id);
        });
        this.connectedContainer.appendChild(btn);
      });
    }

    this.renderOutliner(state);
    this.renderIntel(state);

    const toggleOrder: HudToggleKey[] = ['hyperlanes', 'bloom', 'centerCloud', 'stars', 'ownership'];
    for (const key of toggleOrder) {
      const enabled = state.toggles[key];
      const btn = this.toggleButtons[key];
      btn.dataset.enabled = enabled ? 'true' : 'false';
      btn.classList.toggle('off', !enabled);
    }
  }

  private renderOutliner(state: HudState): void {
    this.outlinerEl.innerHTML = `<div class="spaceHudPanelTitle">Outliner</div>`;

    const list = document.createElement('div');
    list.className = 'spaceHudOutlinerList';

    if (state.connectedSystems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'spaceHudEmpty';
      empty.textContent = 'No linked systems are available from this view.';
      list.appendChild(empty);
    } else {
      state.connectedSystems.slice(0, 8).forEach((target, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'spaceHudOutlinerBtn';
        btn.innerHTML = `
          <strong>${truncateLabel(target.name, 22)}</strong>
          <span>${index === 0 ? 'Primary route' : 'Connected system'}</span>
        `;
        btn.addEventListener('click', () => {
          this.callbacks.onNavigateConnectedSystem(target.id);
        });
        list.appendChild(btn);
      });
    }

    this.outlinerEl.appendChild(list);
  }

  private renderIntel(state: HudState): void {
    const enabledFilters = Object.entries(state.toggles)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key);

    const energy = state.economy?.stockpiles.energy ?? 0;
    const minerals = state.economy?.stockpiles.minerals ?? 0;
    const research = state.economy?.stockpiles.research ?? 0;
    const date = state.clock ? formatGameDate(state.clock.year) : null;

    this.intelEl.innerHTML = `
      <section>
        <div class="spaceHudPanelTitle">Selected System</div>
        <div class="spaceHudSystemName">${state.title}</div>
        <div class="spaceHudSystemMeta">${state.canExitSystem ? 'Tactical orbit active' : 'Galaxy overview active'} • ${state.connectedSystems.length} linked systems</div>
        <div class="spaceHudStatGrid">
          <div class="spaceHudStatCard">
            <div class="spaceHudMiniLabel">Energy Reserve</div>
            <div class="spaceHudMiniValue">${formatCompactNumber(energy)}</div>
          </div>
          <div class="spaceHudStatCard">
            <div class="spaceHudMiniLabel">Mineral Reserve</div>
            <div class="spaceHudMiniValue">${formatCompactNumber(minerals)}</div>
          </div>
          <div class="spaceHudStatCard">
            <div class="spaceHudMiniLabel">Research Pool</div>
            <div class="spaceHudMiniValue">${formatCompactNumber(research)}</div>
          </div>
          <div class="spaceHudStatCard">
            <div class="spaceHudMiniLabel">Date</div>
            <div class="spaceHudMiniValue">${date ? `${date.year}.${String(date.month).padStart(2, '0')}.${String(date.day).padStart(2, '0')}` : '--'}</div>
          </div>
        </div>
      </section>
      <section>
        <div class="spaceHudPanelTitle">Active Filters</div>
        <div class="spaceHudTagList">
          ${(enabledFilters.length > 0
            ? enabledFilters.map((filter) => `<div class="spaceHudTag">${filter}</div>`).join('')
            : '<div class="spaceHudEmpty">No visual filters are active.</div>')}
        </div>
      </section>
    `;
  }

  dispose(): void {
    this.root.remove();
  }
}

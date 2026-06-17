/**
 * Shared design system for every in-game overlay window.
 *
 * All windows were originally built in isolation, each injecting its own
 * hardcoded chrome. This module captures the canonical "Fleet Manager" look as
 * a single accent-driven stylesheet (the `sf*` classes) plus a small shell
 * builder, so every window shares one frame/header/section/button/scrollbar
 * language while keeping its own accent colour and content.
 *
 * Usage in a panel:
 *   import { ensurePanelThemeStyles, createPanelShell, PANEL_ACCENTS } from "./panelTheme";
 *   ensurePanelThemeStyles();
 *   const shell = createPanelShell({ accent: PANEL_ACCENTS.market, title: "Galactic Market", ... });
 *   shell.body.append(...content...);
 *   document.body.appendChild(shell.root);
 */

const THEME_STYLE_ID = "sf-panel-theme";

/** Per-window accent colours. Each window sets `--panel-accent` from here. */
export const PANEL_ACCENTS = {
  fleet: "rgba(114, 226, 255, 0.95)",
  planet: "rgba(120, 236, 168, 0.95)",
  market: "rgba(247, 203, 110, 0.95)",
  technology: "rgba(167, 150, 255, 0.95)",
  leaders: "rgba(214, 150, 255, 0.95)",
  government: "rgba(54, 214, 255, 0.95)",
  diplomacy: "rgba(255, 158, 110, 0.95)",
  society: "rgba(110, 236, 199, 0.95)",
  celestial: "rgba(102, 236, 199, 0.95)",
  starbase: "rgba(150, 196, 230, 0.95)",
  selection: "rgba(114, 226, 255, 0.95)",
  admin: "rgba(255, 120, 150, 0.95)",
} as const;

export type PanelAccent = keyof typeof PANEL_ACCENTS;

export function ensurePanelThemeStyles(): void {
  if (document.getElementById(THEME_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = THEME_STYLE_ID;
  style.textContent = `
.sfPanel {
  --panel-accent: ${PANEL_ACCENTS.fleet};
  --panel-ink: #e9fff8;
  --panel-muted: rgba(206, 232, 226, 0.68);
  --panel-pane: color-mix(in srgb, var(--panel-accent) 7%, rgba(4, 14, 17, 0.82));
  --panel-line: color-mix(in srgb, var(--panel-accent) 30%, transparent);
  position: fixed;
  z-index: 80;
  pointer-events: auto;
  display: grid;
  grid-template-rows: 58px minmax(0, 1fr) auto;
  overflow: hidden;
  color: var(--panel-ink);
  font-family: "Orbitron", "Rajdhani", "Trebuchet MS", sans-serif;
  border: 1px solid color-mix(in srgb, var(--panel-accent) 76%, transparent);
  background:
    radial-gradient(circle at 70% 18%, color-mix(in srgb, var(--panel-accent) 12%, transparent), transparent 20rem),
    linear-gradient(180deg, rgba(7, 20, 24, 0.985), rgba(2, 9, 12, 0.99));
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.58), inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}

/* Centered modal variant (windows that are not free-dragged). */
.sfPanel--centered {
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}

.sfPanel__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--panel-accent) 28%, transparent);
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--panel-accent) 26%, rgba(6, 20, 23, 0.92)),
    rgba(3, 11, 14, 0.94));
}

.sfPanel__header--drag { cursor: grab; }
.sfPanel__header--drag:active { cursor: grabbing; }

.sfPanel__badge {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  clip-path: polygon(50% 0, 94% 25%, 94% 75%, 50% 100%, 6% 75%, 6% 25%);
  background: color-mix(in srgb, var(--panel-accent) 24%, rgba(2, 12, 15, 0.6));
  border: 1px solid color-mix(in srgb, var(--panel-accent) 70%, transparent);
  color: #eaffff;
  font-weight: 900;
  font-size: 12px;
  text-transform: uppercase;
}

.sfPanel__titles { min-width: 0; display: flex; flex-direction: column; }
.sfPanel__title { font-size: 19px; font-weight: 900; line-height: 1.05; }
.sfPanel__subtitle {
  margin-top: 2px;
  color: var(--panel-muted);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.sfPanel__headerExtra { margin-left: auto; display: flex; align-items: center; gap: 8px; }

.sfPanel__close {
  margin-left: auto;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--panel-accent) 60%, transparent);
  background: color-mix(in srgb, var(--panel-accent) 12%, rgba(4, 16, 19, 0.7));
  color: var(--panel-ink);
  font: inherit;
  font-size: 16px;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.sfPanel__headerExtra .sfPanel__close { margin-left: 0; }
.sfPanel__close:hover {
  background: color-mix(in srgb, var(--panel-accent) 26%, rgba(4, 16, 19, 0.7));
  border-color: color-mix(in srgb, var(--panel-accent) 85%, transparent);
}

.sfPanel__body { min-height: 0; overflow: hidden; padding: 8px; }
.sfPanel__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid color-mix(in srgb, var(--panel-accent) 22%, transparent);
  color: var(--panel-muted);
  font-size: 11px;
}

/* ---- content primitives ---- */
.sfPane {
  min-height: 0;
  border: 1px solid color-mix(in srgb, var(--panel-accent) 24%, transparent);
  background: var(--panel-pane);
  padding: 8px;
}
.sfPane__title, .sfSectionTitle {
  margin: 0 0 7px;
  color: #eafef8;
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.sfStatGrid { display: grid; gap: 6px; }
.sfStat {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--panel-accent) 12%, transparent);
}
.sfStat span { color: var(--panel-muted); font-size: 11px; text-transform: uppercase; }
.sfStat strong { color: #ffffff; font-size: 13px; }

.sfChip {
  display: inline-grid;
  place-items: center;
  gap: 1px;
  min-height: 30px;
  padding: 4px 9px;
  border: 1px solid color-mix(in srgb, var(--panel-accent) 30%, transparent);
  background: color-mix(in srgb, var(--panel-accent) 10%, rgba(3, 13, 16, 0.7));
  text-align: center;
}
.sfChip small { color: color-mix(in srgb, var(--panel-accent) 80%, #ffffff); font-size: 9px; text-transform: uppercase; }
.sfChip strong { color: #ffffff; font-size: 13px; }

.sfButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 30px;
  padding: 6px 12px;
  border: 1px solid color-mix(in srgb, var(--panel-accent) 42%, transparent);
  background: color-mix(in srgb, var(--panel-accent) 10%, rgba(8, 22, 26, 0.85));
  color: var(--panel-ink);
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.sfButton:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--panel-accent) 85%, transparent);
  background: color-mix(in srgb, var(--panel-accent) 22%, rgba(8, 22, 26, 0.85));
}
.sfButton:disabled { opacity: 0.42; cursor: default; }
.sfButton--primary {
  border-color: color-mix(in srgb, var(--panel-accent) 90%, transparent);
  background: color-mix(in srgb, var(--panel-accent) 30%, rgba(8, 22, 26, 0.85));
  color: #f6ffff;
}
.sfButton--danger {
  border-color: rgba(255, 120, 120, 0.6);
  background: rgba(120, 24, 30, 0.5);
  color: #ffd9d9;
}

.sfTabs { display: flex; gap: 4px; }
.sfTab {
  padding: 6px 12px;
  border: 1px solid color-mix(in srgb, var(--panel-accent) 26%, transparent);
  border-bottom: none;
  background: color-mix(in srgb, var(--panel-accent) 7%, rgba(4, 14, 17, 0.7));
  color: var(--panel-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  cursor: pointer;
}
.sfTab.active {
  color: #f4ffff;
  background: color-mix(in srgb, var(--panel-accent) 22%, rgba(4, 14, 17, 0.7));
  box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--panel-accent) 90%, transparent);
}

.sfEmpty {
  display: grid;
  place-items: center;
  height: 100%;
  min-height: 80px;
  padding: 16px;
  color: var(--panel-muted);
  font-size: 12px;
  text-align: center;
}

/* ---- scrollbars (apply .sfScroll to any scroll container) ---- */
.sfScroll { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--panel-accent) 45%, transparent) transparent; }
.sfScroll::-webkit-scrollbar { width: 7px; height: 7px; }
.sfScroll::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--panel-accent) 40%, transparent); border-radius: 999px; }
.sfScroll::-webkit-scrollbar-track { background: transparent; }
`;
  document.head.appendChild(style);
}

export interface PanelShellOptions {
  /** CSS colour for `--panel-accent` (use a value from PANEL_ACCENTS). */
  accent: string;
  title: string;
  subtitle?: string;
  /** Short text for the hex badge (e.g. initials). Omit for no badge. */
  badge?: string;
  /** Extra class names added to the root (e.g. the window's own class). */
  className?: string;
  /** When true the header is a drag handle (caller wires pointer events). */
  draggable?: boolean;
  /** When true the panel is centered on screen. */
  centered?: boolean;
  onClose?: () => void;
}

export interface PanelShell {
  root: HTMLDivElement;
  header: HTMLDivElement;
  headerExtra: HTMLDivElement;
  body: HTMLDivElement;
  footer: HTMLDivElement;
  titleEl: HTMLDivElement;
  subtitleEl: HTMLDivElement;
  closeButton: HTMLButtonElement;
  setTitle(title: string, subtitle?: string): void;
}

/**
 * Build the standard window shell (frame + header with badge/title/subtitle/close
 * + body + footer). The footer is empty/hidden until content is added.
 */
export function createPanelShell(options: PanelShellOptions): PanelShell {
  ensurePanelThemeStyles();

  const root = document.createElement("div");
  root.className = ["sfPanel", options.centered ? "sfPanel--centered" : "", options.className ?? ""]
    .filter(Boolean)
    .join(" ");
  root.style.setProperty("--panel-accent", options.accent);

  const header = document.createElement("div");
  header.className = options.draggable ? "sfPanel__header sfPanel__header--drag" : "sfPanel__header";

  if (options.badge) {
    const badge = document.createElement("div");
    badge.className = "sfPanel__badge";
    badge.textContent = options.badge;
    header.appendChild(badge);
  }

  const titles = document.createElement("div");
  titles.className = "sfPanel__titles";
  const titleEl = document.createElement("div");
  titleEl.className = "sfPanel__title";
  titleEl.textContent = options.title;
  const subtitleEl = document.createElement("div");
  subtitleEl.className = "sfPanel__subtitle";
  subtitleEl.textContent = options.subtitle ?? "";
  subtitleEl.style.display = options.subtitle ? "" : "none";
  titles.append(titleEl, subtitleEl);
  header.appendChild(titles);

  const headerExtra = document.createElement("div");
  headerExtra.className = "sfPanel__headerExtra";
  header.appendChild(headerExtra);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "sfPanel__close";
  closeButton.setAttribute("aria-label", "Close");
  closeButton.textContent = "✕";
  closeButton.addEventListener("click", (ev) => {
    ev.stopPropagation();
    options.onClose?.();
  });
  headerExtra.appendChild(closeButton);

  const body = document.createElement("div");
  body.className = "sfPanel__body";

  const footer = document.createElement("div");
  footer.className = "sfPanel__footer";
  footer.style.display = "none";

  root.append(header, body, footer);

  return {
    root,
    header,
    headerExtra,
    body,
    footer,
    titleEl,
    subtitleEl,
    closeButton,
    setTitle(title: string, subtitle?: string): void {
      titleEl.textContent = title;
      if (subtitle !== undefined) {
        subtitleEl.textContent = subtitle;
        subtitleEl.style.display = subtitle ? "" : "none";
      }
    },
  };
}

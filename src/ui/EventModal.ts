import type { ActiveEvent, EventCategory } from "../data/Events";
import { GAME_DAYS_PER_YEAR } from "../game/GameTime";
import { createPanelShell, PANEL_ACCENTS } from "./panelTheme";
import type { PanelAccent, PanelShell } from "./panelTheme";

const EVENT_STYLE_ID = "sf-event-modal-style";

const CATEGORY_ACCENT: Record<EventCategory, PanelAccent> = {
  economic: "market",
  military: "fleet",
  diplomatic: "diplomacy",
  anomaly: "technology",
  leader: "leaders",
  crisis: "admin",
};

const CATEGORY_BADGE: Record<EventCategory, string> = {
  economic: "$",
  military: "⚔",
  diplomatic: "✉",
  anomaly: "✦",
  leader: "★",
  crisis: "!",
};

export interface EventModalCallbacks {
  onResolve: (eventId: string, choiceId: string) => void;
  /** Close to the notification strip without deciding. */
  onDismiss?: (eventId: string) => void;
}

function ensureEventModalStyles(): void {
  if (document.getElementById(EVENT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = EVENT_STYLE_ID;
  style.textContent = `
.sfEventModal {
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 60px);
  grid-template-rows: 58px minmax(0, 1fr) auto;
  z-index: 120;
}
.sfEventBody { display: flex; flex-direction: column; gap: 12px; overflow: auto; }
.sfEventImage {
  width: 100%;
  height: 168px;
  object-fit: cover;
  border: 1px solid color-mix(in srgb, var(--panel-accent) 32%, transparent);
  background: rgba(0, 0, 0, 0.4);
}
.sfEventText { color: #dfeef0; font-size: 13px; line-height: 1.5; }
.sfEventChoices { display: grid; gap: 8px; }
.sfEventChoice { width: 100%; justify-content: flex-start; text-align: left; padding: 10px 12px; }
.sfEventChoiceDefault { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--panel-accent) 60%, transparent); }
.sfEventCountdown { color: var(--panel-muted); font-size: 11px; }
.sfEventCountdown strong { color: #fff; }
`;
  document.head.appendChild(style);
}

/**
 * Popup card for an active event. Non-blocking (the game never pauses): shows a
 * live countdown to the auto-resolve timeout and highlights the default choice.
 */
export class EventModal {
  private shell: PanelShell | null = null;
  private event: ActiveEvent | null = null;
  private clockYear = 0;
  private readonly countdownEl: HTMLDivElement;

  constructor(private readonly callbacks: EventModalCallbacks) {
    ensureEventModalStyles();
    this.countdownEl = document.createElement("div");
    this.countdownEl.className = "sfEventCountdown";
  }

  get currentEventId(): string | null {
    return this.event?.id ?? null;
  }

  get isOpen(): boolean {
    return this.shell !== null;
  }

  show(event: ActiveEvent, clockYear: number): void {
    this.event = event;
    this.clockYear = clockYear;
    const accent = PANEL_ACCENTS[CATEGORY_ACCENT[event.category] ?? "fleet"];
    if (this.shell) this.shell.root.remove();

    const shell = createPanelShell({
      accent,
      title: event.title,
      subtitle: event.category.toUpperCase(),
      badge: CATEGORY_BADGE[event.category] ?? "!",
      className: "sfEventModal",
      centered: true,
      onClose: () => {
        const id = this.event?.id;
        this.close();
        if (id) this.callbacks.onDismiss?.(id);
      },
    });
    shell.body.classList.add("sfEventBody");

    if (event.imageUrl) {
      const img = document.createElement("img");
      img.className = "sfEventImage";
      img.src = event.imageUrl;
      img.alt = "";
      shell.body.appendChild(img);
    }

    const text = document.createElement("div");
    text.className = "sfEventText";
    text.textContent = event.body;
    shell.body.appendChild(text);

    const choices = document.createElement("div");
    choices.className = "sfEventChoices";
    for (const choice of event.choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `sfButton sfEventChoice${choice.id === event.defaultChoiceId ? " sfButton--primary sfEventChoiceDefault" : ""}`;
      button.textContent = choice.label;
      if (choice.tooltip) button.title = choice.tooltip;
      button.addEventListener("click", () => {
        const id = this.event?.id;
        this.close();
        if (id) this.callbacks.onResolve(id, choice.id);
      });
      choices.appendChild(button);
    }
    shell.body.appendChild(choices);

    shell.footer.style.display = "";
    shell.footer.replaceChildren(this.countdownEl);

    document.body.appendChild(shell.root);
    this.shell = shell;
    this.renderCountdown();
  }

  setClockYear(year: number): void {
    this.clockYear = year;
    if (this.shell) this.renderCountdown();
  }

  /** Update the displayed event in place (e.g. on a fresh snapshot). */
  sync(event: ActiveEvent, clockYear: number): void {
    if (this.event?.id !== event.id) return;
    this.event = event;
    this.setClockYear(clockYear);
  }

  close(): void {
    this.shell?.root.remove();
    this.shell = null;
    this.event = null;
  }

  dispose(): void {
    this.close();
  }

  private renderCountdown(): void {
    if (!this.event) return;
    const defaultLabel = this.event.choices.find((choice) => choice.id === this.event?.defaultChoiceId)?.label ?? "default";
    const daysLeft = Math.max(0, Math.round((this.event.expiresAtYear - this.clockYear) * GAME_DAYS_PER_YEAR));
    this.countdownEl.innerHTML = `Auto-resolves (<strong>${escapeHtml(defaultLabel)}</strong>) in <strong>${daysLeft}</strong> day${daysLeft === 1 ? "" : "s"}`;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => (
    char === "&" ? "&amp;"
      : char === "<" ? "&lt;"
        : char === ">" ? "&gt;"
          : char === '"' ? "&quot;"
            : "&#39;"
  ));
}

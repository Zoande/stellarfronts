import type { ActiveSituation } from "../data/Situations";
import { getSituationDefinition } from "../data/Situations";
import { RESOURCE_KINDS, RESOURCE_LABELS } from "../data/Economy";
import type { ResourceKind } from "../data/Economy";
import { createPanelShell, PANEL_ACCENTS } from "./panelTheme";
import type { PanelShell } from "./panelTheme";

const SITUATION_STYLE_ID = "sf-situation-modal-style";

export interface SituationAction {
  id: string;
  label: string;
  tooltip?: string;
}

export interface SituationModalCallbacks {
  /** Optional situation actions (none yet for the shortage situation). */
  onAction?: (situationId: string, actionId: string) => void;
}

function ensureSituationModalStyles(): void {
  if (document.getElementById(SITUATION_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SITUATION_STYLE_ID;
  style.textContent = `
.sfSituationModal {
  width: min(460px, calc(100vw - 32px));
  grid-template-rows: 58px minmax(0, 1fr) auto;
  z-index: 118;
}
.sfSituationBody { display: flex; flex-direction: column; gap: 12px; overflow: auto; }
.sfSituationMeter {
  position: relative;
  height: 22px;
  border: 1px solid color-mix(in srgb, var(--panel-accent) 40%, transparent);
  background: rgba(0, 0, 0, 0.4);
  overflow: hidden;
}
.sfSituationMeterFill {
  height: 100%;
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--panel-accent) 55%, transparent),
    color-mix(in srgb, var(--panel-accent) 90%, transparent));
  transition: width 0.2s ease;
}
.sfSituationMeterValue {
  position: absolute; inset: 0; display: grid; place-items: center;
  font-size: 12px; font-weight: 800; color: #fff; text-shadow: 0 0 4px rgba(0,0,0,0.6);
}
.sfSituationText { color: #dfeef0; font-size: 13px; line-height: 1.5; }
.sfSituationActions { display: grid; gap: 8px; }
`;
  document.head.appendChild(style);
}

/**
 * Detail window for a situation (opened from its notification-strip icon):
 * progress meter, description, and any applicable actions. Sibling to EventModal.
 */
export class SituationModal {
  private shell: PanelShell | null = null;
  private situationId: string | null = null;

  constructor(private readonly callbacks: SituationModalCallbacks = {}) {
    ensureSituationModalStyles();
  }

  get currentSituationId(): string | null {
    return this.situationId;
  }

  get isOpen(): boolean {
    return this.shell !== null;
  }

  show(situation: ActiveSituation, actions: SituationAction[] = []): void {
    const def = getSituationDefinition(situation.defId);
    const accent = situation.progress >= 100 ? PANEL_ACCENTS.admin : PANEL_ACCENTS.market;
    const subjectLabel = situation.subject && isResourceKind(situation.subject)
      ? RESOURCE_LABELS[situation.subject]
      : situation.subject ?? "";
    const title = subjectLabel ? `${def?.title ?? situation.defId}: ${subjectLabel}` : def?.title ?? situation.defId;

    this.shell?.root.remove();
    const shell = createPanelShell({
      accent,
      title,
      subtitle: "SITUATION",
      badge: def?.icon ?? "!",
      className: "sfSituationModal",
      centered: true,
      onClose: () => this.close(),
    });
    shell.body.classList.add("sfSituationBody");

    const meter = document.createElement("div");
    meter.className = "sfSituationMeter";
    const fill = document.createElement("div");
    fill.className = "sfSituationMeterFill";
    fill.style.width = `${Math.round(situation.progress)}%`;
    const value = document.createElement("div");
    value.className = "sfSituationMeterValue";
    value.textContent = `${Math.round(situation.progress)} / ${def?.max ?? 100}`;
    meter.append(fill, value);
    shell.body.appendChild(meter);

    const text = document.createElement("div");
    text.className = "sfSituationText";
    text.textContent = def?.description ?? "";
    shell.body.appendChild(text);

    if (actions.length > 0) {
      const actionWrap = document.createElement("div");
      actionWrap.className = "sfSituationActions";
      for (const action of actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sfButton";
        button.textContent = action.label;
        if (action.tooltip) button.title = action.tooltip;
        button.addEventListener("click", () => this.callbacks.onAction?.(situation.id, action.id));
        actionWrap.appendChild(button);
      }
      shell.body.appendChild(actionWrap);
    }

    document.body.appendChild(shell.root);
    this.shell = shell;
    this.situationId = situation.id;
  }

  /** Re-render in place if showing this situation (live progress). */
  sync(situation: ActiveSituation, actions: SituationAction[] = []): void {
    if (this.situationId !== situation.id || !this.shell) return;
    this.show(situation, actions);
  }

  close(): void {
    this.shell?.root.remove();
    this.shell = null;
    this.situationId = null;
  }

  dispose(): void {
    this.close();
  }
}

function isResourceKind(value: string): value is ResourceKind {
  return (RESOURCE_KINDS as string[]).includes(value);
}

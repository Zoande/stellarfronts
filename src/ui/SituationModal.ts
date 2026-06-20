import type { ActiveSituation } from "../data/Situations";
import { getSituationDefinition, SHORTAGE_SITUATION_ID } from "../data/Situations";
import { RESOURCE_KINDS, RESOURCE_LABELS } from "../data/Economy";
import type { ResourceKind } from "../data/Economy";
import {
  getShortageEffects,
  getShortageRecovery,
  getShortageTier,
  formatShortageEffectValue,
  formatShortageEffectCap,
} from "../data/ShortageConsequences";
import type { ShortageEffect } from "../data/ShortageConsequences";
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
  width: min(480px, calc(100vw - 32px));
  grid-template-rows: 58px minmax(0, 1fr) auto;
  z-index: 118;
}
.sfSituationBody { display: flex; flex-direction: column; gap: 12px; overflow: auto; }
.sfSituationMeter {
  position: relative;
  height: 24px;
  border: 1px solid color-mix(in srgb, var(--panel-accent) 40%, transparent);
  background: rgba(0, 0, 0, 0.4);
  overflow: hidden;
}
.sfSituationMeterFill {
  height: 100%;
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--panel-accent) 55%, transparent),
    color-mix(in srgb, var(--panel-accent) 90%, transparent));
  transition: width 0.25s ease;
}
.sfSituationMeterValue {
  position: absolute; inset: 0; display: grid; place-items: center;
  font-size: 12px; font-weight: 800; color: #fff; text-shadow: 0 0 4px rgba(0,0,0,0.6);
  letter-spacing: 0.04em;
}
.sfSituationTier {
  display: flex; align-items: baseline; gap: 8px;
}
.sfSituationTierBadge {
  font-size: 11px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--panel-accent) 55%, transparent);
  color: color-mix(in srgb, var(--panel-accent) 92%, white 8%);
  background: color-mix(in srgb, var(--panel-accent) 14%, transparent);
}
.sfSituationTierBlurb { font-size: 12px; color: rgba(223, 238, 240, 0.78); line-height: 1.4; }
.sfSituationText { color: #dfeef0; font-size: 13px; line-height: 1.5; }
.sfSituationSectionTitle {
  margin-top: 4px;
  font-size: 11px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;
  color: rgba(176, 205, 199, 0.82);
}
.sfSituationEffects { display: grid; gap: 5px; }
.sfSituationEffectRow {
  display: grid; grid-template-columns: minmax(0, 1fr) auto;
  align-items: center; gap: 10px;
  padding: 6px 9px;
  border: 1px solid rgba(120, 150, 150, 0.22);
  background: rgba(8, 20, 22, 0.5);
}
.sfSituationEffectRow.scope-fleet { border-left: 2px solid rgba(120, 200, 255, 0.55); }
.sfSituationEffectRow.scope-empire { border-left: 2px solid rgba(120, 236, 168, 0.5); }
.sfSituationEffectLabel { font-size: 12px; color: #e7f4f3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sfSituationEffectValue { font-size: 13px; font-weight: 800; color: #ff8a7a; white-space: nowrap; }
.sfSituationEffectCap { font-size: 10px; color: rgba(180, 200, 200, 0.6); font-weight: 600; }
.sfSituationRecovery {
  padding: 9px 11px;
  border: 1px solid rgba(120, 236, 168, 0.4);
  background: rgba(10, 36, 26, 0.5);
  color: #d6f5e4; font-size: 12px; line-height: 1.45;
}
.sfSituationRecovery strong { color: #aef0c8; }
.sfSituationCrisis {
  padding: 9px 11px;
  border: 1px solid rgba(255, 120, 120, 0.5);
  background: rgba(46, 14, 14, 0.5);
  color: #ffd6d6; font-size: 12px; line-height: 1.45;
}
.sfSituationActions { display: grid; gap: 8px; }
`;
  document.head.appendChild(style);
}

interface SituationModalParts {
  meterFill: HTMLDivElement;
  meterValue: HTMLDivElement;
  tierBadge: HTMLSpanElement | null;
  tierBlurb: HTMLSpanElement | null;
  effectRows: Array<{ effect: ShortageEffect; valueEl: HTMLSpanElement }>;
}

/**
 * Detail window for a situation (opened from its notification-strip icon):
 * progress meter, severity tier, the concrete penalties currently in force, and
 * recovery guidance. For resource shortages it explains exactly what is being hurt
 * and by how much (scaled to the live severity). Sibling to EventModal.
 *
 * Rendering is split into a one-time build (`show`) and cheap in-place updates
 * (`sync`) so the close button is never destroyed mid-click by per-snapshot syncs.
 */
export class SituationModal {
  private shell: PanelShell | null = null;
  private situationId: string | null = null;
  /** Identity of what is currently rendered; a change forces a full rebuild. */
  private renderKey: string | null = null;
  private parts: SituationModalParts | null = null;

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
    const key = this.computeRenderKey(situation, actions);
    // If we are already showing this exact situation/structure, just refresh values.
    if (this.shell && this.situationId === situation.id && this.renderKey === key) {
      this.applyDynamic(situation);
      return;
    }

    const def = getSituationDefinition(situation.defId);
    const crisis = situation.progress >= 100;
    const accent = crisis ? PANEL_ACCENTS.admin : PANEL_ACCENTS.market;
    const resource = situation.subject && isResourceKind(situation.subject) ? situation.subject : null;
    const subjectLabel = resource ? RESOURCE_LABELS[resource] : situation.subject ?? "";
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

    const isShortage = situation.defId === SHORTAGE_SITUATION_ID && resource !== null;
    const parts = isShortage
      ? this.buildShortageBody(shell.body, situation, resource as ResourceKind)
      : this.buildGenericBody(shell.body, situation, def?.description ?? "");

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
    this.renderKey = key;
    this.parts = parts;
    this.applyDynamic(situation);
  }

  /** Re-render in place if showing this situation (live progress; no DOM churn). */
  sync(situation: ActiveSituation, actions: SituationAction[] = []): void {
    if (this.situationId !== situation.id || !this.shell) return;
    const key = this.computeRenderKey(situation, actions);
    if (key !== this.renderKey) {
      // Structure changed (e.g. crossed the crisis threshold) → rebuild once.
      this.show(situation, actions);
      return;
    }
    this.applyDynamic(situation);
  }

  close(): void {
    this.shell?.root.remove();
    this.shell = null;
    this.situationId = null;
    this.renderKey = null;
    this.parts = null;
  }

  dispose(): void {
    this.close();
  }

  // The render key captures everything that affects DOM *structure* (not values),
  // so a value-only change updates in place while a structural change rebuilds.
  private computeRenderKey(situation: ActiveSituation, actions: SituationAction[]): string {
    const crisis = situation.progress >= 100 ? "crisis" : "normal";
    return [situation.defId, situation.subject ?? "", crisis, actions.map((a) => a.id).join(",")].join("|");
  }

  private buildMeter(body: HTMLDivElement, max: number): { fill: HTMLDivElement; value: HTMLDivElement } {
    const meter = document.createElement("div");
    meter.className = "sfSituationMeter";
    const fill = document.createElement("div");
    fill.className = "sfSituationMeterFill";
    const value = document.createElement("div");
    value.className = "sfSituationMeterValue";
    value.dataset.max = String(max);
    meter.append(fill, value);
    body.appendChild(meter);
    return { fill, value };
  }

  private buildGenericBody(body: HTMLDivElement, situation: ActiveSituation, description: string): SituationModalParts {
    const def = getSituationDefinition(situation.defId);
    const { fill, value } = this.buildMeter(body, def?.max ?? 100);

    const text = document.createElement("div");
    text.className = "sfSituationText";
    text.textContent = description;
    body.appendChild(text);

    return { meterFill: fill, meterValue: value, tierBadge: null, tierBlurb: null, effectRows: [] };
  }

  private buildShortageBody(body: HTMLDivElement, situation: ActiveSituation, resource: ResourceKind): SituationModalParts {
    const { fill, value } = this.buildMeter(body, 100);

    // Severity tier badge + blurb.
    const tier = document.createElement("div");
    tier.className = "sfSituationTier";
    const tierBadge = document.createElement("span");
    tierBadge.className = "sfSituationTierBadge";
    const tierBlurb = document.createElement("span");
    tierBlurb.className = "sfSituationTierBlurb";
    tier.append(tierBadge, tierBlurb);
    body.appendChild(tier);

    // Cause explanation.
    const cause = document.createElement("div");
    cause.className = "sfSituationText";
    cause.textContent =
      `Your ${RESOURCE_LABELS[resource]} stockpile is exhausted while consumption exceeds production. `
      + `Penalties below scale with severity and ease off once the deficit is cleared.`;
    body.appendChild(cause);

    // Active penalties, grouped empire then fleet.
    const effects = getShortageEffects(resource);
    const empireEffects = effects.filter((effect) => effect.scope === "empire");
    const fleetEffects = effects.filter((effect) => effect.scope === "fleet");
    const effectRows: SituationModalParts["effectRows"] = [];

    const addGroup = (label: string, group: ShortageEffect[]): void => {
      if (group.length === 0) return;
      const title = document.createElement("div");
      title.className = "sfSituationSectionTitle";
      title.textContent = label;
      body.appendChild(title);

      const list = document.createElement("div");
      list.className = "sfSituationEffects";
      for (const effect of group) {
        const row = document.createElement("div");
        row.className = `sfSituationEffectRow scope-${effect.scope}`;
        const labelEl = document.createElement("span");
        labelEl.className = "sfSituationEffectLabel";
        labelEl.textContent = effect.label;
        const valueEl = document.createElement("span");
        valueEl.className = "sfSituationEffectValue";
        row.append(labelEl, valueEl);
        list.appendChild(row);
        effectRows.push({ effect, valueEl });
      }
      body.appendChild(list);
    };

    addGroup("Active Penalties — Empire", empireEffects);
    addGroup("Active Penalties — Fleets", fleetEffects);

    // Crisis warning (hidden when already at crisis; the tier blurb covers that).
    if (situation.progress < 100) {
      const crisis = document.createElement("div");
      crisis.className = "sfSituationCrisis";
      crisis.innerHTML = "<strong>At 100%:</strong> a shortage crisis event fires, forcing a hard decision with lasting effects.";
      body.appendChild(crisis);
    }

    // Recovery guidance.
    const recovery = getShortageRecovery(resource);
    if (recovery) {
      const box = document.createElement("div");
      box.className = "sfSituationRecovery";
      box.innerHTML = `<strong>How to recover:</strong> ${escapeHtml(recovery)}`;
      body.appendChild(box);
    }

    return { meterFill: fill, meterValue: value, tierBadge, tierBlurb, effectRows };
  }

  private applyDynamic(situation: ActiveSituation): void {
    if (!this.parts) return;
    const progress = Math.round(situation.progress);
    const max = Number(this.parts.meterValue.dataset.max ?? "100");
    this.parts.meterFill.style.width = `${Math.max(0, Math.min(100, (progress / max) * 100))}%`;
    this.parts.meterValue.textContent = `${progress} / ${max}`;

    const tier = getShortageTier(situation.progress);
    if (this.parts.tierBadge) this.parts.tierBadge.textContent = tier.label;
    if (this.parts.tierBlurb) this.parts.tierBlurb.textContent = tier.blurb;

    const severity = Math.max(0, Math.min(1, situation.progress / 100));
    for (const { effect, valueEl } of this.parts.effectRows) {
      valueEl.innerHTML =
        `${escapeHtml(formatShortageEffectValue(effect, severity))} `
        + `<span class="sfSituationEffectCap">/ ${escapeHtml(formatShortageEffectCap(effect))} max</span>`;
    }
  }
}

function isResourceKind(value: string): value is ResourceKind {
  return (RESOURCE_KINDS as string[]).includes(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

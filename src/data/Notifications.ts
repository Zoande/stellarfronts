import type { FactionEconomyState, ResourceKind } from "./Economy";
import { RESOURCE_KINDS, RESOURCE_LABELS } from "./Economy";
import type { ActiveEvent, EventCategory } from "./Events";
import type { IndicatorSeverity } from "./GameEffects";
import type { ActiveSituation } from "./Situations";
import { getSituationDefinition } from "./Situations";
import type { MarketTradeAlert } from "./Market";

export type IndicatorKind = "event" | "situation" | "alert" | "tradeAlert";

export interface NotificationIndicator {
  id: string;
  kind: IndicatorKind;
  icon: string;
  severity: IndicatorSeverity;
  label: string;
  tooltip: string;
  /** 0-100 for situations (drives a small ring/fill on the icon). */
  progress?: number;
  /** id of the underlying event/situation for click handling. */
  refId?: string;
}

const EVENT_CATEGORY_ICON: Record<EventCategory, string> = {
  economic: "$",
  military: "⚔",
  diplomatic: "✉",
  anomaly: "✦",
  leader: "★",
  crisis: "!",
};

const EVENT_CATEGORY_SEVERITY: Record<EventCategory, IndicatorSeverity> = {
  economic: "info",
  military: "warn",
  diplomatic: "info",
  anomaly: "info",
  leader: "info",
  crisis: "crisis",
};

/**
 * Build the ordered list of top-bar indicators for the player's faction.
 * Combines pending events, active situations, and lightweight economy alerts.
 * Pure and side-effect free so the HUD can call it every render cheaply.
 */
export function deriveIndicators(input: {
  events: ActiveEvent[];
  situations: ActiveSituation[];
  economy?: FactionEconomyState | null;
  tradeAlerts?: MarketTradeAlert[];
}): NotificationIndicator[] {
  const indicators: NotificationIndicator[] = [];

  for (const event of input.events) {
    indicators.push({
      id: `event:${event.id}`,
      kind: "event",
      icon: EVENT_CATEGORY_ICON[event.category] ?? "!",
      severity: EVENT_CATEGORY_SEVERITY[event.category] ?? "info",
      label: event.title,
      tooltip: `${event.title} — decision required`,
      refId: event.id,
    });
  }

  for (const situation of input.situations) {
    const def = getSituationDefinition(situation.defId);
    const subjectLabel = situation.subject && isResourceKind(situation.subject)
      ? RESOURCE_LABELS[situation.subject]
      : situation.subject ?? "";
    const title = subjectLabel ? `${def?.title ?? situation.defId}: ${subjectLabel}` : def?.title ?? situation.defId;
    indicators.push({
      id: `situation:${situation.id}`,
      kind: "situation",
      icon: def?.icon ?? "!",
      severity: situation.progress >= 100 ? "crisis" : def?.severity ?? "warn",
      label: title,
      tooltip: `${title} — ${Math.round(situation.progress)}%`,
      progress: situation.progress,
      refId: situation.id,
    });
  }

  // Lightweight economy alerts (extension point for future status icons such as
  // low stability/employment). For now: a sustained income deficit on a resource
  // that hasn't yet exhausted its stockpile.
  const economy = input.economy;
  if (economy) {
    for (const resource of RESOURCE_KINDS) {
      if (resource === "research") continue;
      const delta = economy.monthlyDelta[resource] ?? 0;
      const stock = economy.stockpiles[resource] ?? 0;
      const alreadyShortage = input.situations.some((s) => s.subject === resource);
      if (delta < 0 && stock > 0 && !alreadyShortage) {
        indicators.push({
          id: `alert:deficit:${resource}`,
          kind: "alert",
          icon: "▼",
          severity: "info",
          label: `${RESOURCE_LABELS[resource]} deficit`,
          tooltip: `${RESOURCE_LABELS[resource]} income is negative; stockpile is being drawn down.`,
        });
      }
    }
  }

  for (const alert of input.tradeAlerts ?? []) {
    const resourceLabel = RESOURCE_LABELS[alert.resourceId] ?? alert.resourceId;
    const verb = alert.tradeType === "auto_sell" ? "Sale" : "Purchase";
    const requestedFmt = Math.round(alert.requestedPerHour);
    const executedFmt = Math.round(alert.executedPerHour);
    const partial = alert.executedPerHour > 0;
    const tooltip = partial
      ? `${verb} of ${resourceLabel}: only ${executedFmt}/hr of ${requestedFmt}/hr could be filled — stockpile insufficient`
      : `${verb} of ${resourceLabel}: none of the ${requestedFmt}/hr order could be filled — stockpile empty`;
    indicators.push({
      id: `tradeAlert:${alert.id}`,
      kind: "tradeAlert",
      icon: "⚠",
      severity: "warn",
      label: partial ? `${resourceLabel} ${verb.toLowerCase()} partial` : `${resourceLabel} ${verb.toLowerCase()} failed`,
      tooltip,
      refId: alert.id,
    });
  }

  return indicators;
}

function isResourceKind(value: string): value is ResourceKind {
  return (RESOURCE_KINDS as string[]).includes(value);
}

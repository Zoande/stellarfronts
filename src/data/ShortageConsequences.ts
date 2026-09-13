import type { ResourceKind } from "./Economy";

export type ShortageEffectKind = "flat" | "percent";
export type ShortageScope = "empire" | "fleet";

export interface ShortageEffect {
  /** Player-facing name of the stat that is reduced. */
  label: string;
  /** Magnitude at full severity (severity = 1.0). Negative = penalty. */
  full: number;
  /** "flat" → signed number (e.g. -50 happiness); "percent" → signed % (e.g. -80%). */
  kind: ShortageEffectKind;
  scope: ShortageScope;
}

/**
 * Player-facing breakdown of what each resource shortage does. Magnitudes MIRROR
 * the server's `getFactionShortagePlanetModifiers` / `getFactionFleetShortageEffects`
 * (server/index.ts) — keep these in sync if those penalties change. All penalties
 * scale linearly with the shortage situation's severity (progress / 100).
 */
export const SHORTAGE_EFFECTS: Partial<Record<ResourceKind, ShortageEffect[]>> = {
  food: [
    { label: "Population happiness", full: -40, kind: "flat", scope: "empire" },
    { label: "Planet stability", full: -22, kind: "flat", scope: "empire" },
    { label: "All job output", full: -0.15, kind: "percent", scope: "empire" },
    { label: "Fleet speed", full: -0.08, kind: "percent", scope: "fleet" },
    { label: "Fleet weapon damage", full: -0.08, kind: "percent", scope: "fleet" },
  ],
  goods: [
    { label: "Population happiness", full: -24, kind: "flat", scope: "empire" },
    { label: "Planet stability", full: -18, kind: "flat", scope: "empire" },
    { label: "Researcher output", full: -0.35, kind: "percent", scope: "empire" },
    { label: "Entertainer amenities", full: -0.45, kind: "percent", scope: "empire" },
    { label: "Fleet weapon damage", full: -0.15, kind: "percent", scope: "fleet" },
  ],
  energy: [
    { label: "Planet stability", full: -20, kind: "flat", scope: "empire" },
    { label: "All job output", full: -0.35, kind: "percent", scope: "empire" },
    { label: "Construction speed", full: -0.25, kind: "percent", scope: "empire" },
    { label: "Fleet shields", full: -0.75, kind: "percent", scope: "fleet" },
    { label: "Fleet weapon damage", full: -0.35, kind: "percent", scope: "fleet" },
    { label: "Fleet speed", full: -0.3, kind: "percent", scope: "fleet" },
  ],
  minerals: [
    { label: "Construction speed", full: -0.55, kind: "percent", scope: "empire" },
    { label: "Artisan goods output", full: -0.4, kind: "percent", scope: "empire" },
    { label: "Metallurgist alloy output", full: -0.4, kind: "percent", scope: "empire" },
  ],
  alloys: [
    { label: "Planet stability", full: -8, kind: "flat", scope: "empire" },
    { label: "Construction speed", full: -0.2, kind: "percent", scope: "empire" },
    { label: "Fleet weapon damage", full: -0.3, kind: "percent", scope: "fleet" },
    { label: "Fleet speed", full: -0.2, kind: "percent", scope: "fleet" },
  ],
};

/** Short, resource-specific guidance on how to recover from the shortage. */
export const SHORTAGE_RECOVERY: Partial<Record<ResourceKind, string>> = {
  food: "Build hydroponics/agricultural districts, or import food on the market. Population upkeep falls if growth stalls.",
  goods: "Add artisan jobs (industrial districts) or buy goods on the market to cover consumer demand.",
  energy: "Build solar arrays / generator districts, or trade for energy. Mothballing upkeep-heavy buildings also helps.",
  minerals: "Expand mining districts or import minerals; mineral upkeep drives goods and alloy production.",
  alloys: "Bring alloy assembly docks online or buy alloys; alloys gate construction and ship repair.",
};

export interface ShortageTier {
  key: "building" | "serious" | "severe" | "crisis";
  label: string;
  /** progress >= min selects this tier (checked high→low). */
  min: number;
  blurb: string;
}

export const SHORTAGE_TIERS: ShortageTier[] = [
  { key: "crisis", label: "Crisis", min: 100, blurb: "Penalties are at maximum and a shortage crisis event has fired. Resolve the deficit now or face cascading collapse." },
  { key: "severe", label: "Severe", min: 67, blurb: "Penalties are near maximum. At 100% a shortage crisis event triggers." },
  { key: "serious", label: "Serious", min: 34, blurb: "Penalties are climbing steadily while the deficit persists." },
  { key: "building", label: "Building", min: 1, blurb: "Early penalties have begun and will keep rising until production recovers." },
];

export function getShortageTier(progress: number): ShortageTier {
  return SHORTAGE_TIERS.find((tier) => progress >= tier.min) ?? SHORTAGE_TIERS[SHORTAGE_TIERS.length - 1];
}

export function getShortageEffects(resource: string): ShortageEffect[] {
  return SHORTAGE_EFFECTS[resource as ResourceKind] ?? [];
}

export function getShortageRecovery(resource: string): string | undefined {
  return SHORTAGE_RECOVERY[resource as ResourceKind];
}

/** Format the *current* (severity-scaled) magnitude of an effect, e.g. "-25" or "-40%". */
export function formatShortageEffectValue(effect: ShortageEffect, severity: number): string {
  const scaled = effect.full * severity;
  if (effect.kind === "percent") {
    const pct = Math.round(scaled * 100);
    return `${pct > 0 ? "+" : ""}${pct}%`;
  }
  const rounded = Math.round(scaled);
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

/** Format the magnitude at full severity (the cap), e.g. "-50" or "-80%". */
export function formatShortageEffectCap(effect: ShortageEffect): string {
  if (effect.kind === "percent") return `${Math.round(effect.full * 100)}%`;
  return `${Math.round(effect.full)}`;
}

import type {
  GalaxyIntelligenceView,
  IntelEntityKind,
  IntelEntityView,
  IntelValue,
} from "../data/Intelligence";
import { gameYearToDateTime, GAME_DAYS_PER_YEAR } from "./GameTime";

const entities = new Map<string, IntelEntityView>();
let currentYear = 0;
let commandLinkedStars = new Set<number>();

function key(kind: IntelEntityKind, id: string | number): string {
  return `${kind}:${id}`;
}

export function setClientIntelligence(view: GalaxyIntelligenceView, year?: number): void {
  entities.clear();
  if (Number.isFinite(year)) currentYear = Number(year);
  commandLinkedStars = new Set(view.sensorDebug?.commandLinkedStarIds ?? []);
  for (const entity of view.entities) entities.set(key(entity.kind, entity.id), entity);
}

export function hasClientEntityCommandLink(kind: IntelEntityKind, id: string | number): boolean {
  const fieldId = kind === "fleet" ? "currentStarId" : "starId";
  const field = getClientIntelField<number>(kind, id, fieldId);
  return field.status !== "unknown" && commandLinkedStars.has(Number(field.value));
}

export function getClientIntelYear(): number {
  return currentYear;
}

export function mergeClientIntelEntities(next: readonly IntelEntityView[]): void {
  for (const entity of next) entities.set(key(entity.kind, entity.id), entity);
}

export function getClientIntelEntity(kind: IntelEntityKind, id: string | number): IntelEntityView | null {
  return entities.get(key(kind, id)) ?? null;
}

export function getClientIntelField<T>(
  kind: IntelEntityKind,
  id: string | number,
  fieldId: string,
): IntelValue<T> {
  return (getClientIntelEntity(kind, id)?.fields[fieldId] as IntelValue<T> | undefined) ?? { status: "unknown" };
}

export function formatIntelFreshness(value: IntelValue<unknown>, currentYear: number): string | null {
  if (value.status !== "stale") return null;
  const elapsedDays = Math.max(0, (currentYear - value.observedAtYear) * GAME_DAYS_PER_YEAR);
  const age = elapsedDays < 1
    ? "less than a day ago"
    : elapsedDays < 30
      ? `${Math.floor(elapsedDays)} day${Math.floor(elapsedDays) === 1 ? "" : "s"} ago`
      : `${Math.floor(elapsedDays / 30)} month${Math.floor(elapsedDays / 30) === 1 ? "" : "s"} ago`;
  const date = gameYearToDateTime(value.observedAtYear);
  return `Last observed ${age} (${date.year} / ${String(date.month).padStart(2, "0")} / ${String(date.day).padStart(2, "0")} ${String(date.hour).padStart(2, "0")}:00)`;
}

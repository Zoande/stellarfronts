export type EmpireSystemRelation = "own" | "foreign" | "hostile" | "unowned";

export type EmpireDisplayColor = [number, number, number];

const FOREIGN_DESATURATION = 0.74;
const HOSTILE_RED_MIX = 0.76;
const HOSTILE_RED: EmpireDisplayColor = [0.96, 0.08, 0.07];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function mix(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

export function getEmpireSystemRelation(
  ownerFactionId: number,
  playerFactionId: number,
  warFactionIds: ReadonlySet<number>,
): EmpireSystemRelation {
  if (!Number.isInteger(ownerFactionId) || ownerFactionId < 0) return "unowned";
  if (ownerFactionId === playerFactionId) return "own";
  return warFactionIds.has(ownerFactionId) ? "hostile" : "foreign";
}

export function getEmpireDisplayColor(
  source: EmpireDisplayColor,
  relation: EmpireSystemRelation,
): EmpireDisplayColor {
  const color: EmpireDisplayColor = [clamp01(source[0]), clamp01(source[1]), clamp01(source[2])];
  if (relation === "own") return color;

  if (relation === "hostile") {
    return [
      mix(color[0], HOSTILE_RED[0], HOSTILE_RED_MIX),
      mix(color[1], HOSTILE_RED[1], HOSTILE_RED_MIX),
      mix(color[2], HOSTILE_RED[2], HOSTILE_RED_MIX),
    ];
  }

  const luminance = color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114;
  const grey = Math.max(0.28, Math.min(0.62, luminance * 0.58 + 0.2));
  return [
    mix(color[0], grey, FOREIGN_DESATURATION),
    mix(color[1], grey, FOREIGN_DESATURATION),
    mix(color[2], grey, FOREIGN_DESATURATION),
  ];
}

export function getEmpireBorderColor(
  source: EmpireDisplayColor,
  relation: EmpireSystemRelation,
): EmpireDisplayColor {
  const color = getEmpireDisplayColor(source, relation);
  if (relation !== "own") return color;

  const maxChannel = Math.max(...color);
  if (maxChannel <= 0) return color;

  const saturationBoost = 1.3;
  const brightnessBoost = Math.max(maxChannel, 0.94) / maxChannel;
  return color.map((channel) => (
    clamp01((maxChannel - (maxChannel - channel) * saturationBoost) * brightnessBoost)
  )) as EmpireDisplayColor;
}

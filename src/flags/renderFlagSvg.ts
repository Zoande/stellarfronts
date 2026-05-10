import type { FlagContainerShapeId, FlagDesign, FlagSymbolDefinition } from "./flagTypes";

export interface RenderFlagSvgOptions {
  size?: number;
  className?: string;
  title?: string;
  idPrefix?: string;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean.length === 3
    ? clean.split("").map((char) => char + char).join("")
    : clean,
  16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value: number): number => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: string, b: string): number {
  const light = Math.max(luminance(a), luminance(b));
  const dark = Math.min(luminance(a), luminance(b));
  return (light + 0.05) / (dark + 0.05);
}

function readableSymbolColor(background: string, accent: string): string {
  if (contrastRatio(background, accent) >= 2.35) return accent;
  return luminance(background) < 0.35 ? "#f4f7fb" : "#10202a";
}

function containerPath(shape: FlagContainerShapeId): string {
  switch (shape) {
    case "circle":
      return "M50 2a48 48 0 1 1 0 96a48 48 0 1 1 0-96Z";
    case "hexagon":
      return "M25 6h50l23 44-23 44H25L2 50 25 6Z";
    case "octagon":
      return "M31 2h38l29 29v38L69 98H31L2 69V31L31 2Z";
    case "shield":
      return "M50 2l39 10 9 28-20 57H22L2 40l9-28L50 2Z";
    case "square":
    default:
      return "M2 2h96v96H2V2Z";
  }
}

function renderPattern(patternId: string, accent: string, secondary: string): string {
  switch (patternId) {
    case "split-vertical":
      return `<rect x="47" y="0" width="6" height="100" fill="${accent}" opacity=".42"/><rect x="50" y="0" width="1.4" height="100" fill="${secondary}" opacity=".55"/>`;
    case "split-horizontal":
      return `<rect x="0" y="47" width="100" height="6" fill="${accent}" opacity=".38"/><rect x="0" y="50" width="100" height="1.4" fill="${secondary}" opacity=".5"/>`;
    case "diagonal-band":
      return `<path d="M-8 27L108 75" stroke="${accent}" stroke-width="10" opacity=".3"/><path d="M-8 21L108 69" stroke="${secondary}" stroke-width="2" opacity=".35"/>`;
    case "corner-glow":
      return `<path d="M0 0h22v22H0zM78 0h22v22H78zM0 78h22v22H0zM78 78h22v22H78z" fill="${accent}" opacity=".18"/>`;
    case "dot-grid":
      return Array.from({ length: 25 }, (_, index) => {
        const x = 13 + (index % 5) * 18;
        const y = 13 + Math.floor(index / 5) * 18;
        return `<circle cx="${x}" cy="${y}" r="1.1" fill="${secondary}" opacity=".32"/>`;
      }).join("");
    case "wave-lines":
      return `<path d="M-2 27c12-5 22 5 34 0s22-5 34 0 22 5 36 0M-2 45c12-5 22 5 34 0s22-5 34 0 22 5 36 0M-2 63c12-5 22 5 34 0s22-5 34 0 22 5 36 0" fill="none" stroke="${secondary}" stroke-width="2" opacity=".35"/>`;
    case "concentric-rings":
      return `<circle cx="50" cy="50" r="18" fill="none" stroke="${accent}" stroke-width="2" opacity=".22"/><circle cx="50" cy="50" r="32" fill="none" stroke="${secondary}" stroke-width="2.2" opacity=".24"/><circle cx="50" cy="50" r="45" fill="none" stroke="${accent}" stroke-width="2" opacity=".16"/>`;
    case "chevron-stack":
      return `<path d="M18 26l32 13 32-13M18 43l32 13 32-13M18 60l32 13 32-13" fill="none" stroke="${accent}" stroke-width="5" opacity=".24" stroke-linejoin="round"/>`;
    case "radial-sunburst":
      return Array.from({ length: 16 }, (_, index) => {
        const angle = (Math.PI * 2 * index) / 16;
        const x = 50 + Math.cos(angle) * 44;
        const y = 50 + Math.sin(angle) * 44;
        return `<path d="M50 50L${x.toFixed(1)} ${y.toFixed(1)}" stroke="${accent}" stroke-width="1.4" opacity=".2"/>`;
      }).join("");
    case "none":
    default:
      return "";
  }
}

function renderSymbol(symbol: FlagSymbolDefinition, fill: string, stroke: string, opacity = 1): string {
  const common = `fill="${fill}" stroke="${stroke}" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round" opacity="${opacity}"`;
  switch (symbol.id) {
    case "starburst":
      return `<path ${common} d="M50 20l6 21 22 3-17 11 8 21-19-13-19 13 8-21-17-11 22-3 6-21Z"/>`;
    case "twin-spires":
      return `<path ${common} d="M34 70l9-42 7 24 7-24 9 42-16-9-16 9Z"/>`;
    case "halo-anchor":
      return `<circle cx="50" cy="50" r="13" ${common}/><circle cx="50" cy="50" r="26" fill="none" stroke="${stroke}" stroke-width="3" opacity="${opacity}"/><path d="M50 31v38M37 63h26" stroke="${fill}" stroke-width="5" stroke-linecap="round" opacity="${opacity}"/>`;
    case "crest-chevron":
      return `<path ${common} d="M50 22l22 25-9 28-13-11-13 11-9-28 22-25Z"/>`;
    case "apex-wings":
      return `<path ${common} d="M50 20l23 48-17-8-6 17-6-17-17 8 23-48Z"/>`;
    case "eye-lens":
      return `<path ${common} d="M22 50l16-15h24l16 15-16 15H38L22 50Z"/><circle cx="50" cy="50" r="5" fill="${stroke}" opacity="${opacity}"/>`;
    case "beacon-crown":
      return `<path ${common} d="M32 70l8-29 10-17 10 17 8 29H32Z"/><rect x="43" y="66" width="14" height="10" fill="${stroke}" opacity="${opacity}"/>`;
    case "ring-node":
      return `<circle cx="50" cy="50" r="15" ${common}/><circle cx="50" cy="50" r="27" fill="none" stroke="${stroke}" stroke-width="3" opacity="${opacity}"/><rect x="64" y="46" width="14" height="8" fill="${stroke}" opacity="${opacity}"/>`;
    case "wave-stack":
      return `<path ${common} d="M25 39l16-6 9 6 9-6 16 6-8 10H33l-8-10ZM29 53l13-5 8 5 8-5 13 5-7 9H36l-7-9ZM34 66l10-4 6 4 6-4 10 4-6 8H40l-6-8Z"/>`;
    case "blade-pair":
      return `<path ${common} d="M30 72l12-47 8 24-7 27-13-4ZM70 72L58 25l-8 24 7 27 13-4Z"/>`;
    case "crystal-shard":
      return `<path ${common} d="M50 18l15 30-5 31H40l-5-31 15-30Z"/>`;
    case "hex-core":
      return `<path ${common} d="M50 23l23 13v28L50 77 27 64V36l23-13Z"/><rect x="44" y="44" width="12" height="12" fill="${stroke}" opacity="${opacity}"/>`;
    case "split-diamond":
      return `<path ${common} d="M50 18l25 32-25 32-25-32 25-32Z"/><path d="M35 35l30 30" stroke="${stroke}" stroke-width="3.5" opacity="${opacity}"/>`;
    case "circuit-knot":
      return `<path d="M25 41h18v20h25V31h14" fill="none" stroke="${fill}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/><circle cx="25" cy="41" r="4" fill="${stroke}" opacity="${opacity}"/><circle cx="82" cy="31" r="4" fill="${stroke}" opacity="${opacity}"/>`;
    case "solar-disk":
      return `<circle cx="50" cy="50" r="15" ${common}/><path d="M50 22v10M50 68v10M22 50h10M68 50h10M30 30l7 7M63 63l7 7M70 30l-7 7M37 63l-7 7" stroke="${stroke}" stroke-width="3" stroke-linecap="round" opacity="${opacity}"/>`;
    case "arch-gate":
      return `<path ${common} d="M31 73V43c0-13 38-13 38 0v30H31Z"/><path d="M42 73V47c0-6 16-6 16 0v26" fill="none" stroke="${stroke}" stroke-width="4" opacity="${opacity}"/>`;
    case "loop-knot":
      return `<circle cx="40" cy="50" r="13" fill="none" stroke="${fill}" stroke-width="6" opacity="${opacity}"/><circle cx="60" cy="50" r="13" fill="none" stroke="${stroke}" stroke-width="5" opacity="${opacity}"/>`;
    case "plume-triad":
      return `<path ${common} d="M29 72l11-28 10-22 10 22 11 28-21-10-21 10Z"/>`;
    case "lattice-bloom":
      return `<path ${common} d="M50 22l20 17-7 32H37l-7-32 20-17Z"/><path d="M38 50h24M50 35v30" stroke="${stroke}" stroke-width="3" opacity="${opacity}"/>`;
    case "crown-prism":
      return `<path ${common} d="M25 70l9-34 10 18 6-30 6 30 10-18 9 34H25Z"/>`;
    default:
      return `<circle cx="50" cy="50" r="20" ${common}/>`;
  }
}

export function renderFlagSvg(design: FlagDesign, options: RenderFlagSvgOptions = {}): string {
  const size = options.size ?? 48;
  const unique = `${options.idPrefix ?? "flag"}-${Math.random().toString(36).slice(2)}`;
  const path = containerPath(design.container.id);
  const background = design.backgroundColor.hex;
  const accent = design.accentColor.hex;
  const symbolColor = readableSymbolColor(background, accent);
  const rim = luminance(background) < 0.35 ? "#d9f5ee" : "#10202a";
  const secondary = symbolColor === accent ? rim : accent;
  const title = options.title ? `<title>${escapeHtml(options.title)}</title>` : "";
  const secondarySymbol = design.secondarySymbol
    ? `<g transform="translate(50 50) scale(.56) translate(-50 -50) rotate(-12 50 50)">${renderSymbol(design.secondarySymbol, rim, accent, 0.34)}</g>`
    : "";

  return `
    <svg class="${escapeHtml(options.className ?? "")}" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-hidden="${options.title ? "false" : "true"}" xmlns="http://www.w3.org/2000/svg">
      ${title}
      <defs>
        <clipPath id="${unique}-clip"><path d="${path}"/></clipPath>
        <linearGradient id="${unique}-shine" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity=".34"/>
          <stop offset=".42" stop-color="#fff" stop-opacity=".02"/>
          <stop offset="1" stop-color="#000" stop-opacity=".28"/>
        </linearGradient>
        <filter id="${unique}-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="1.8" flood-color="#000" flood-opacity=".55"/>
        </filter>
      </defs>
      <g filter="url(#${unique}-shadow)">
        <path d="${path}" fill="${background}"/>
        <g clip-path="url(#${unique}-clip)">
          <rect width="100" height="100" fill="${background}"/>
          ${renderPattern(design.pattern.id, accent, secondary)}
          <circle cx="50" cy="50" r="26" fill="${accent}" opacity=".12"/>
          ${secondarySymbol}
          <g transform="translate(50 50) scale(.74) translate(-50 -50)">
            ${renderSymbol(design.primarySymbol, symbolColor, rim, 1)}
          </g>
          <rect width="100" height="100" fill="url(#${unique}-shine)"/>
        </g>
        <path d="${path}" fill="none" stroke="${rim}" stroke-opacity=".88" stroke-width="3.8"/>
        <path d="${path}" fill="none" stroke="${accent}" stroke-opacity=".52" stroke-width="1.2"/>
      </g>
    </svg>
  `;
}

import type {
  FlagColorDefinition,
  FlagContainerDefinition,
  FlagDesign,
  FlagPatternDefinition,
  FlagSymbolDefinition,
} from "./flagTypes";

export const FLAG_SYMBOLS: FlagSymbolDefinition[] = [
  { id: "starburst", label: "Starburst", description: "A sharp radiant burst built from layered points and a strong central core." },
  { id: "twin-spires", label: "Twin Spires", description: "Two symmetric upward spires with a grounded base and a narrow crown." },
  { id: "halo-anchor", label: "Halo Anchor", description: "A central anchor form wrapped by a thin orbital ring and small accent fins." },
  { id: "crest-chevron", label: "Crest Chevron", description: "A stacked chevron crest with a clean angular peak and split base." },
  { id: "apex-wings", label: "Apex Wings", description: "A central apex with outward wing shapes that read clearly at small size." },
  { id: "eye-lens", label: "Eye Lens", description: "An oval lens shape with a precise inner mark and an enclosing arc." },
  { id: "beacon-crown", label: "Beacon Crown", description: "A crowned beacon silhouette with a bright top node and stable base." },
  { id: "ring-node", label: "Ring Node", description: "A compact node enclosed by concentric rings and one clean directional notch." },
  { id: "wave-stack", label: "Wave Stack", description: "A layered wave emblem with balanced horizontal movement and a structured base." },
  { id: "blade-pair", label: "Blade Pair", description: "Two opposing blade forms with a centered spine and sharp negative space." },
  { id: "crystal-shard", label: "Crystal Shard", description: "An angular shard with faceted sides and a tall, slender profile." },
  { id: "hex-core", label: "Hex Core", description: "A hexagonal core with a precise inner cut and a stable geometric frame." },
  { id: "split-diamond", label: "Split Diamond", description: "A diamond emblem divided into two clean halves with a strong midline." },
  { id: "circuit-knot", label: "Circuit Knot", description: "A simplified knot made from straight segments and circuit-like connectors." },
  { id: "solar-disk", label: "Solar Disk", description: "A smooth disk with short rays and a minimal central mark." },
  { id: "arch-gate", label: "Arch Gate", description: "A vaulted arch with a centered opening and symmetrical support lines." },
  { id: "loop-knot", label: "Loop Knot", description: "Two interlocking loops with a calm, balanced emblem silhouette." },
  { id: "plume-triad", label: "Plume Triad", description: "Three vertical plume shapes rising from a shared geometric base." },
  { id: "lattice-bloom", label: "Lattice Bloom", description: "A modular lattice that opens outward like a geometric flower." },
  { id: "crown-prism", label: "Crown Prism", description: "A faceted crown with a prism-like center and crisp upper points." },
];

export const FLAG_COLORS: FlagColorDefinition[] = [
  { id: "obsidian", label: "Obsidian", hex: "#0b0f14" },
  { id: "midnight", label: "Midnight", hex: "#0e1630" },
  { id: "cobalt", label: "Cobalt", hex: "#18407b" },
  { id: "azure", label: "Azure", hex: "#2d77ff" },
  { id: "teal", label: "Teal", hex: "#0f7f7a" },
  { id: "jade", label: "Jade", hex: "#1f8f5d" },
  { id: "emerald", label: "Emerald", hex: "#1e6f43" },
  { id: "olive", label: "Olive", hex: "#61702e" },
  { id: "sand", label: "Sand", hex: "#c7a769" },
  { id: "amber", label: "Amber", hex: "#d08a2d" },
  { id: "gold", label: "Gold", hex: "#b88c18" },
  { id: "copper", label: "Copper", hex: "#a75d3b" },
  { id: "crimson", label: "Crimson", hex: "#a9243d" },
  { id: "maroon", label: "Maroon", hex: "#6f1d33" },
  { id: "plum", label: "Plum", hex: "#5b2d74" },
  { id: "indigo", label: "Indigo", hex: "#352b74" },
  { id: "slate", label: "Slate", hex: "#4d5c6b" },
  { id: "silver", label: "Silver", hex: "#b7c0ca" },
  { id: "ivory", label: "Ivory", hex: "#ece7d9" },
  { id: "white", label: "White", hex: "#f4f7fb" },
];

export const FLAG_PATTERNS: FlagPatternDefinition[] = [
  { id: "none", label: "None", description: "A clean field with no overprint pattern." },
  { id: "split-vertical", label: "Split Vertical", description: "A strong vertical division between two halves of the field." },
  { id: "split-horizontal", label: "Split Horizontal", description: "A horizontal split that creates a calm upper and lower band." },
  { id: "diagonal-band", label: "Diagonal Band", description: "A single bold diagonal stripe cutting across the field." },
  { id: "corner-glow", label: "Corner Glow", description: "Soft corner radiance that frames the symbol without overwhelming it." },
  { id: "dot-grid", label: "Dot Grid", description: "A sparse geometric dot field that suggests order and precision." },
  { id: "wave-lines", label: "Wave Lines", description: "Low-profile wave lines that add motion and rhythm." },
  { id: "concentric-rings", label: "Concentric Rings", description: "Nested rings that echo orbital or ceremonial design." },
  { id: "chevron-stack", label: "Chevron Stack", description: "Layered chevrons that build upward from the base." },
  { id: "radial-sunburst", label: "Radial Sunburst", description: "Short radial spokes centered behind the main symbol." },
];

export const FLAG_CONTAINERS: FlagContainerDefinition[] = [
  {
    id: "square",
    label: "Square",
    description: "A strict square frame with no curvature.",
  },
  {
    id: "hexagon",
    label: "Hexagon",
    description: "A six-sided frame with a technical, emblematic feel.",
    clipPath: "polygon(25% 6%, 75% 6%, 100% 50%, 75% 94%, 25% 94%, 0 50%)",
  },
  {
    id: "octagon",
    label: "Octagon",
    description: "An eight-sided frame with a formal, seal-like outline.",
    clipPath: "polygon(31% 0, 69% 0, 100% 31%, 100% 69%, 69% 100%, 31% 100%, 0 69%, 0 31%)",
  },
  {
    id: "shield",
    label: "Shield",
    description: "A guarded heraldic frame with a strong point and broad shoulders.",
    clipPath: "polygon(50% 0, 90% 12%, 100% 40%, 78% 100%, 22% 100%, 0 40%, 10% 12%)",
  },
  {
    id: "circle",
    label: "Circle",
    description: "A smooth circular medallion frame.",
    borderRadius: "50%",
  },
];

export interface FlagGenerationOptions {
  seed?: string | number;
  containerId?: FlagContainerDefinition["id"];
  colorId?: FlagColorDefinition["id"];
  accentColorId?: FlagColorDefinition["id"];
  patternId?: FlagPatternDefinition["id"];
  primarySymbolId?: FlagSymbolDefinition["id"];
  secondarySymbolId?: FlagSymbolDefinition["id"];
}

function hashSeed(seed: string | number): number {
  const value = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed: string | number): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function pickById<T extends { id: string }>(items: T[], id?: string): T | undefined {
  if (id) {
    const match = items.find((item) => item.id === id);
    if (match) return match;
  }
  return undefined;
}

function pickRandom<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] ?? items[0];
}

export function createFlagDesign(options: FlagGenerationOptions = {}): FlagDesign {
  const random = createRandom(options.seed ?? "flag-generator");
  const container = pickById(FLAG_CONTAINERS, options.containerId) ?? pickRandom(FLAG_CONTAINERS, random);
  const backgroundColor = pickById(FLAG_COLORS, options.colorId) ?? pickRandom(FLAG_COLORS, random);
  const accentPool = FLAG_COLORS.filter((color) => color.id !== backgroundColor.id);
  const accentColor = pickById(FLAG_COLORS, options.accentColorId) ?? pickRandom(accentPool.length > 0 ? accentPool : FLAG_COLORS, random);
  const pattern = pickById(FLAG_PATTERNS, options.patternId) ?? pickRandom(FLAG_PATTERNS, random);
  const primarySymbol = pickById(FLAG_SYMBOLS, options.primarySymbolId) ?? pickRandom(FLAG_SYMBOLS, random);
  const secondarySymbol = options.secondarySymbolId
    ? pickById(FLAG_SYMBOLS, options.secondarySymbolId)
    : random() > 0.45
      ? pickRandom(FLAG_SYMBOLS.filter((symbol) => symbol.id !== primarySymbol.id), random)
      : undefined;

  return {
    container,
    backgroundColor,
    accentColor,
    pattern,
    primarySymbol,
    secondarySymbol,
  };
}

export function listFlagCatalog() {
  return {
    symbols: FLAG_SYMBOLS,
    colors: FLAG_COLORS,
    patterns: FLAG_PATTERNS,
    containers: FLAG_CONTAINERS,
  };
}

export function flagAssetFileName(name: string): string {
  return `${name.trim().replace(/\s+/g, "_")}.webp`;
}

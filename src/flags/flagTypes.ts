export type FlagContainerShapeId = "square" | "hexagon" | "octagon" | "shield" | "circle";

export interface FlagSymbolDefinition {
  id: string;
  label: string;
  description: string;
}

export interface FlagColorDefinition {
  id: string;
  label: string;
  hex: string;
}

export interface FlagPatternDefinition {
  id: string;
  label: string;
  description: string;
}

export interface FlagContainerDefinition {
  id: FlagContainerShapeId;
  label: string;
  description: string;
  clipPath?: string;
  borderRadius?: string;
}

export interface FlagDesign {
  container: FlagContainerDefinition;
  backgroundColor: FlagColorDefinition;
  accentColor: FlagColorDefinition;
  pattern: FlagPatternDefinition;
  primarySymbol: FlagSymbolDefinition;
  secondarySymbol?: FlagSymbolDefinition;
}

export interface FlagPreset {
  id: string;
  name: string;
  description: string;
  design: FlagDesign;
}

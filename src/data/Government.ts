import type { PlanetModifierOperation, PlanetModifierTarget } from "./Economy";
import type { LeaderClass, LeaderState } from "./Leaders";
import type { TechId } from "./Technology";

export type GovernmentLawId =
  | "economicPolicy"
  | "civilRights"
  | "speciesPolicy"
  | "policingDoctrine"
  | "researchCharter"
  | "militaryDoctrine";

export type GovernmentLawOptionId = string;

export type GovernmentPositionId =
  | "president"
  | "headOfResearch"
  | "headOfDevelopment"
  | "ministerOfDefense";

export type GovernmentFleetModifierTarget = "attack" | "speed" | "shield" | "upkeep" | "evasion";

export type GovernmentEmpireStat =
  | "administrativeEfficiency"
  | "unity"
  | "tradeValue"
  | "defenseStrength"
  | "diplomaticRelations"
  | "aiEfficiency"
  | "frontierGrowth";

export type GovernmentEffect =
  | {
      type: "planetModifier";
      target: PlanetModifierTarget;
      operation: PlanetModifierOperation;
      value: number;
    }
  | {
      type: "fleetModifier";
      target: GovernmentFleetModifierTarget;
      value: number;
    }
  | {
      type: "researchSpeed";
      value: number;
    }
  | {
      type: "researchAllocation";
      activeFraction: number;
      passiveFraction: number;
    }
  | {
      type: "empireStat";
      stat: GovernmentEmpireStat;
      value: number;
    }
  | {
      type: "flag";
      flag: string;
      enabled?: boolean;
    };

export interface GovernmentLeaderTraitEffect {
  positionId?: GovernmentPositionId | "any";
  description: string;
  effects: GovernmentEffect[];
}

export interface GovernmentLawOption {
  id: GovernmentLawOptionId;
  name: string;
  summary: string;
  description: string;
  requiresTechId?: TechId;
  effects: GovernmentEffect[];
}

export interface GovernmentLawDefinition {
  id: GovernmentLawId;
  name: string;
  icon: string;
  description: string;
  defaultOptionId: GovernmentLawOptionId;
  options: GovernmentLawOption[];
}

export interface GovernmentPositionDefinition {
  id: GovernmentPositionId;
  title: string;
  requiredClass: LeaderClass;
  summary: string;
  levelEffects: GovernmentEffect[];
  levelEffectDescription: string;
}

export interface FactionGovernmentState {
  factionId: number;
  selectedLawOptionIds: Partial<Record<GovernmentLawId, GovernmentLawOptionId>>;
}

export const GOVERNMENT_POSITION_DEFINITIONS: GovernmentPositionDefinition[] = [
  {
    id: "president",
    title: "President",
    requiredClass: "civilian",
    summary: "Sets broad administrative direction for the nation.",
    levelEffects: [
      { type: "empireStat", stat: "administrativeEfficiency", value: 0.005 },
      { type: "planetModifier", target: "stability", operation: "add", value: 0.08 },
    ],
    levelEffectDescription: "+0.5% administrative efficiency and +0.08 stability per level.",
  },
  {
    id: "headOfResearch",
    title: "Head of Research",
    requiredClass: "civilian",
    summary: "Directs national laboratories and research allocation.",
    levelEffects: [{ type: "researchSpeed", value: 0.005 }],
    levelEffectDescription: "+0.5% research speed per level.",
  },
  {
    id: "headOfDevelopment",
    title: "Head of Development",
    requiredClass: "civilian",
    summary: "Coordinates planetary construction, infrastructure, and growth programs.",
    levelEffects: [{ type: "planetModifier", target: "constructionSpeed", operation: "multiply", value: 0.005 }],
    levelEffectDescription: "+0.5% planetary construction speed per level.",
  },
  {
    id: "ministerOfDefense",
    title: "Minister of Defense",
    requiredClass: "military",
    summary: "Oversees naval doctrine, readiness, and fleet logistics.",
    levelEffects: [
      { type: "fleetModifier", target: "attack", value: 0.005 },
      { type: "fleetModifier", target: "shield", value: 0.005 },
    ],
    levelEffectDescription: "+0.5% fleet attack and shield endurance per level.",
  },
];

export const GOVERNMENT_POSITION_BY_ID: Record<GovernmentPositionId, GovernmentPositionDefinition> = Object.fromEntries(
  GOVERNMENT_POSITION_DEFINITIONS.map((position) => [position.id, position]),
) as Record<GovernmentPositionId, GovernmentPositionDefinition>;

export const GOVERNMENT_LAW_DEFINITIONS: GovernmentLawDefinition[] = [
  {
    id: "economicPolicy",
    name: "Economic Policy",
    icon: "ECO",
    description: "Defines the balance between private markets, public contracts, and industrial mobilization.",
    defaultOptionId: "mixedEconomy",
    options: [
      {
        id: "mixedEconomy",
        name: "Mixed Economy",
        summary: "Balanced state oversight and private enterprise.",
        description: "Keeps the economy flexible with modest output and stability gains.",
        effects: [
          { type: "planetModifier", target: "jobOutput", operation: "multiply", value: 0.02 },
          { type: "planetModifier", target: "stability", operation: "add", value: 1 },
          { type: "empireStat", stat: "tradeValue", value: 0.03 },
        ],
      },
      {
        id: "stateContracting",
        name: "State Contracting",
        summary: "Public procurement favors planned construction targets.",
        description: "Accelerates construction and administration at a small happiness cost.",
        requiresTechId: "logistics_accounting",
        effects: [
          { type: "planetModifier", target: "constructionSpeed", operation: "multiply", value: 0.08 },
          { type: "planetModifier", target: "happiness", operation: "add", value: -1 },
          { type: "empireStat", stat: "administrativeEfficiency", value: 0.04 },
          { type: "flag", flag: "state_contracting" },
        ],
      },
      {
        id: "industrialMobilization",
        name: "Industrial Mobilization",
        summary: "Prioritizes minerals and alloys over public comfort.",
        description: "Pushes hard industry forward but lowers happiness.",
        requiresTechId: "industrial_tooling",
        effects: [
          { type: "planetModifier", target: "jobOutput:miner:minerals", operation: "multiply", value: 0.08 },
          { type: "planetModifier", target: "jobOutput:metallurgist:alloys", operation: "multiply", value: 0.08 },
          { type: "planetModifier", target: "happiness", operation: "add", value: -4 },
          { type: "flag", flag: "industrial_mobilization" },
        ],
      },
    ],
  },
  {
    id: "civilRights",
    name: "Civil Rights",
    icon: "CIV",
    description: "Sets participation, dissent, and emergency authority standards.",
    defaultOptionId: "civicRegistry",
    options: [
      {
        id: "civicRegistry",
        name: "Civic Registry",
        summary: "Managed citizenship rolls and local representation.",
        description: "A stable baseline that improves administration without major tradeoffs.",
        effects: [
          { type: "planetModifier", target: "stability", operation: "add", value: 2 },
          { type: "empireStat", stat: "unity", value: 0.04 },
        ],
      },
      {
        id: "universalFranchise",
        name: "Universal Franchise",
        summary: "All qualified citizens may vote and participate in public life.",
        description: "Boosts happiness and unity through broad political legitimacy.",
        effects: [
          { type: "planetModifier", target: "happiness", operation: "add", value: 3 },
          { type: "planetModifier", target: "stability", operation: "add", value: 1 },
          { type: "empireStat", stat: "unity", value: 0.1 },
        ],
      },
      {
        id: "controlledDissent",
        name: "Controlled Dissent",
        summary: "Permits debate inside tightly managed institutions.",
        description: "Improves stability and reduces crime pressure while lowering unity and happiness.",
        requiresTechId: "logistics_accounting",
        effects: [
          { type: "planetModifier", target: "crime", operation: "multiply", value: -0.08 },
          { type: "planetModifier", target: "stability", operation: "add", value: 3 },
          { type: "planetModifier", target: "happiness", operation: "add", value: -5 },
          { type: "empireStat", stat: "unity", value: -0.05 },
        ],
      },
      {
        id: "martialRestrictions",
        name: "Martial Restrictions",
        summary: "Emergency powers suppress unrest under military oversight.",
        description: "Strongly suppresses crime and improves defense at a large happiness cost.",
        requiresTechId: "point_defense_networks",
        effects: [
          { type: "planetModifier", target: "crime", operation: "multiply", value: -0.18 },
          { type: "planetModifier", target: "stability", operation: "add", value: 6 },
          { type: "planetModifier", target: "happiness", operation: "add", value: -8 },
          { type: "fleetModifier", target: "attack", value: 0.03 },
          { type: "flag", flag: "martial_law_unlocked" },
        ],
      },
    ],
  },
  {
    id: "speciesPolicy",
    name: "Species Policy",
    icon: "SPC",
    description: "Controls how broadly species rights may diverge across the empire.",
    defaultOptionId: "managedResidency",
    options: [
      {
        id: "pluralistProtections",
        name: "Pluralist Protections",
        summary: "Only inclusive species rights are legal.",
        description: "Protects resident species from harsh legal categories and keeps migration relatively open.",
        effects: [
          { type: "planetModifier", target: "happiness", operation: "add", value: 2 },
          { type: "empireStat", stat: "unity", value: 0.06 },
          { type: "flag", flag: "species_pluralism" },
        ],
      },
      {
        id: "managedResidency",
        name: "Managed Residency",
        summary: "Balanced species rights with limited restrictions.",
        description: "Allows normal residency controls without legalizing forced labor standards.",
        effects: [
          { type: "planetModifier", target: "stability", operation: "add", value: 1 },
          { type: "empireStat", stat: "administrativeEfficiency", value: 0.02 },
        ],
      },
      {
        id: "stratifiedSpeciesCodes",
        name: "Stratified Species Codes",
        summary: "All non-lethal harsh rights are legal.",
        description: "Allows severe work and living standard restrictions at a happiness and diplomacy cost.",
        effects: [
          { type: "planetModifier", target: "happiness", operation: "add", value: -3 },
          { type: "planetModifier", target: "crime", operation: "multiply", value: 0.08 },
          { type: "empireStat", stat: "diplomaticRelations", value: -6 },
          { type: "flag", flag: "species_stratification" },
        ],
      },
    ],
  },
  {
    id: "policingDoctrine",
    name: "Policing Doctrine",
    icon: "SEC",
    description: "Controls how enforcers, surveillance systems, and civic patrols handle crime.",
    defaultOptionId: "standardPatrols",
    options: [
      {
        id: "standardPatrols",
        name: "Standard Patrols",
        summary: "Routine policing with clear rules of engagement.",
        description: "A reliable crime reduction policy with no major penalties.",
        effects: [{ type: "planetModifier", target: "crime", operation: "multiply", value: -0.06 }],
      },
      {
        id: "communityPolicing",
        name: "Community Policing",
        summary: "Local mediation keeps enforcement visible and trusted.",
        description: "Improves happiness and stability while reducing crime more gently.",
        effects: [
          { type: "planetModifier", target: "crime", operation: "multiply", value: -0.04 },
          { type: "planetModifier", target: "happiness", operation: "add", value: 2 },
          { type: "planetModifier", target: "stability", operation: "add", value: 1 },
        ],
      },
      {
        id: "predictivePolicing",
        name: "Predictive Policing",
        summary: "Analytics route patrols toward likely crime centers.",
        description: "Cuts crime efficiently, but citizens dislike opaque surveillance.",
        requiresTechId: "applied_research_methods",
        effects: [
          { type: "planetModifier", target: "crime", operation: "multiply", value: -0.12 },
          { type: "planetModifier", target: "happiness", operation: "add", value: -1 },
          { type: "empireStat", stat: "aiEfficiency", value: 0.05 },
          { type: "flag", flag: "predictive_policing" },
        ],
      },
      {
        id: "harshCrackdowns",
        name: "Harsh Crackdowns",
        summary: "Maximum enforcement reduces crime quickly.",
        description: "Greatly lowers crime and improves order at a sharp happiness cost.",
        requiresTechId: "point_defense_networks",
        effects: [
          { type: "planetModifier", target: "crime", operation: "multiply", value: -0.22 },
          { type: "planetModifier", target: "stability", operation: "add", value: 4 },
          { type: "planetModifier", target: "happiness", operation: "add", value: -8 },
          { type: "flag", flag: "harsh_policing" },
        ],
      },
    ],
  },
  {
    id: "researchCharter",
    name: "Research Charter",
    icon: "RES",
    description: "Determines how research is split between selected priorities and natural discovery.",
    defaultOptionId: "balancedInquiry",
    options: [
      {
        id: "balancedInquiry",
        name: "Balanced Inquiry",
        summary: "80% selected research and 20% natural research.",
        description: "Preserves the default balance while adding light coordination.",
        effects: [
          { type: "researchAllocation", activeFraction: 0.8, passiveFraction: 0.2 },
          { type: "researchSpeed", value: 0.02 },
        ],
      },
      {
        id: "openScience",
        name: "Open Science Initiative",
        summary: "65% selected research and 35% natural research.",
        description: "Shares more research into natural discovery and improves diplomatic standing.",
        effects: [
          { type: "researchAllocation", activeFraction: 0.65, passiveFraction: 0.35 },
          { type: "researchSpeed", value: 0.03 },
          { type: "empireStat", stat: "diplomaticRelations", value: 8 },
          { type: "flag", flag: "open_science" },
        ],
      },
      {
        id: "directedInnovation",
        name: "Directed Innovation",
        summary: "90% selected research and 10% natural research.",
        description: "Prioritizes applied research to accelerate national goals.",
        requiresTechId: "applied_research_methods",
        effects: [
          { type: "researchAllocation", activeFraction: 0.9, passiveFraction: 0.1 },
          { type: "researchSpeed", value: 0.08 },
          { type: "empireStat", stat: "administrativeEfficiency", value: 0.03 },
          { type: "flag", flag: "directed_research" },
        ],
      },
      {
        id: "classifiedResearch",
        name: "Classified Research",
        summary: "88% selected research and 12% natural research.",
        description: "Secures sensitive research pipelines and defense projects.",
        requiresTechId: "point_defense_networks",
        effects: [
          { type: "researchAllocation", activeFraction: 0.88, passiveFraction: 0.12 },
          { type: "researchSpeed", value: 0.06 },
          { type: "fleetModifier", target: "shield", value: 0.03 },
          { type: "empireStat", stat: "diplomaticRelations", value: -8 },
          { type: "flag", flag: "classified_research" },
        ],
      },
    ],
  },
  {
    id: "militaryDoctrine",
    name: "Military Doctrine",
    icon: "MIL",
    description: "Sets fleet readiness, posture, and logistics priorities.",
    defaultOptionId: "defensiveDoctrine",
    options: [
      {
        id: "defensiveDoctrine",
        name: "Defensive Doctrine",
        summary: "Strong defenses and measured fleet response.",
        description: "Improves fleet shields and attack with a small speed penalty.",
        effects: [
          { type: "fleetModifier", target: "shield", value: 0.08 },
          { type: "fleetModifier", target: "attack", value: 0.02 },
          { type: "fleetModifier", target: "speed", value: -0.02 },
        ],
      },
      {
        id: "rapidResponse",
        name: "Rapid Response",
        summary: "Mobile patrols and prepared logistics nodes.",
        description: "Improves fleet speed and upkeep efficiency.",
        requiresTechId: "integrated_fleet_logistics",
        effects: [
          { type: "fleetModifier", target: "speed", value: 0.1 },
          { type: "fleetModifier", target: "upkeep", value: -0.06 },
          { type: "flag", flag: "rapid_response_doctrine" },
        ],
      },
      {
        id: "powerProjection",
        name: "Power Projection",
        summary: "Aggressive force posture and forward deployments.",
        description: "Improves fleet attack at higher upkeep and diplomatic cost.",
        requiresTechId: "heavy_corvette_frames",
        effects: [
          { type: "fleetModifier", target: "attack", value: 0.1 },
          { type: "fleetModifier", target: "upkeep", value: 0.08 },
          { type: "empireStat", stat: "diplomaticRelations", value: -5 },
        ],
      },
      {
        id: "fortressDoctrine",
        name: "Fortress Doctrine",
        summary: "Hardened fleet screens and territorial defense.",
        description: "Greatly improves shield endurance with a speed penalty.",
        requiresTechId: "heavy_corvette_frames",
        effects: [
          { type: "fleetModifier", target: "shield", value: 0.16 },
          { type: "fleetModifier", target: "attack", value: 0.04 },
          { type: "fleetModifier", target: "speed", value: -0.06 },
          { type: "flag", flag: "fortress_doctrine" },
        ],
      },
    ],
  },
];

export const GOVERNMENT_LAW_BY_ID: Record<GovernmentLawId, GovernmentLawDefinition> = Object.fromEntries(
  GOVERNMENT_LAW_DEFINITIONS.map((law) => [law.id, law]),
) as Record<GovernmentLawId, GovernmentLawDefinition>;

export function getGovernmentPositionDefinition(positionId: GovernmentPositionId): GovernmentPositionDefinition | undefined {
  return GOVERNMENT_POSITION_BY_ID[positionId];
}

export function getGovernmentLawOption(
  lawId: GovernmentLawId,
  optionId: GovernmentLawOptionId | undefined,
): GovernmentLawOption | undefined {
  const law = GOVERNMENT_LAW_BY_ID[lawId];
  return law?.options.find((option) => option.id === optionId);
}

export function createInitialGovernmentState(factionId: number): FactionGovernmentState {
  return {
    factionId,
    selectedLawOptionIds: Object.fromEntries(
      GOVERNMENT_LAW_DEFINITIONS.map((law) => [law.id, law.defaultOptionId]),
    ) as Record<GovernmentLawId, GovernmentLawOptionId>,
  };
}

export function createInitialGovernmentStates(factionIds: number[]): FactionGovernmentState[] {
  return factionIds.map((factionId) => createInitialGovernmentState(factionId));
}

export function normalizeGovernmentState(
  factionId: number,
  raw: Partial<FactionGovernmentState> | undefined,
): FactionGovernmentState {
  const initial = createInitialGovernmentState(factionId);
  const selectedLawOptionIds: Partial<Record<GovernmentLawId, GovernmentLawOptionId>> = { ...initial.selectedLawOptionIds };
  const rawSelections = raw?.selectedLawOptionIds ?? {};
  for (const law of GOVERNMENT_LAW_DEFINITIONS) {
    const optionId = rawSelections[law.id];
    selectedLawOptionIds[law.id] = law.options.some((option) => option.id === optionId)
      ? optionId
      : law.defaultOptionId;
  }
  return { factionId, selectedLawOptionIds };
}

export function normalizeGovernmentStatesForFactions(
  factionIds: number[],
  rawGovernments: unknown,
): FactionGovernmentState[] {
  const rawList = Array.isArray(rawGovernments) ? rawGovernments as Partial<FactionGovernmentState>[] : [];
  const byFactionId = new Map<number, Partial<FactionGovernmentState>>();
  for (const raw of rawList) {
    if (Number.isInteger(raw?.factionId)) byFactionId.set(Number(raw.factionId), raw);
  }
  return factionIds.map((factionId) => normalizeGovernmentState(factionId, byFactionId.get(factionId)));
}

export function getSelectedGovernmentLawOptions(government: FactionGovernmentState): Array<{
  law: GovernmentLawDefinition;
  option: GovernmentLawOption;
}> {
  return GOVERNMENT_LAW_DEFINITIONS.map((law) => ({
    law,
    option: getGovernmentLawOption(law.id, government.selectedLawOptionIds[law.id]) ?? law.options[0],
  }));
}

export function getAssignedGovernmentLeader(
  leaders: LeaderState[],
  factionId: number,
  positionId: GovernmentPositionId,
): LeaderState | null {
  return leaders.find((leader) => (
    leader.factionId === factionId
    && leader.status === "recruited"
    && leader.assignment?.kind === "government"
    && leader.assignment.targetId === positionId
  )) ?? null;
}

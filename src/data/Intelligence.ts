export type IntelStatus = "unknown" | "current" | "stale";

export type IntelEntityKind =
  | "system"
  | "star"
  | "planet"
  | "starbase"
  | "fleet"
  | "ship"
  | "faction";

export type IntelFieldId = string;

export interface IntelObservation<T = unknown> {
  value: T;
  observedAtYear: number;
  sourceIds: string[];
}

export type IntelValue<T> =
  | { status: "unknown" }
  | ({ status: "current" | "stale" } & IntelObservation<T>);

export interface IntelEntityView {
  id: string;
  kind: IntelEntityKind;
  fields: Record<IntelFieldId, IntelValue<unknown>>;
}

export interface IntelLaneView {
  endpoints: [number, number];
  status: "current" | "stale";
  observedAtYear: number;
  sourceIds: string[];
}

export interface GalaxyIntelligenceView {
  entities: IntelEntityView[];
  lanes: IntelLaneView[];
  sensorDebug?: {
    sourceBands: Array<{ sourceId: string; suiteId: SensorSuiteId; starId: number; distance: number }>;
    commandLinkedStarIds: number[];
    coveredStarIds: number[];
    currentLanes: string[];
    knownLanes: string[];
    nebulaBlocks: Array<{ sourceId: string; fromStarId: number; toStarId: number }>;
  };
}

export interface StoredIntelEntity {
  kind: IntelEntityKind;
  fields: Record<IntelFieldId, IntelObservation>;
  confirmedAbsentAtYear?: number | null;
}

export interface FactionIntelligenceState {
  entities: Record<string, StoredIntelEntity>;
  lanes: Record<string, IntelObservation<[number, number]>>;
}

export type IntelligenceByFaction = Record<string, FactionIntelligenceState>;

export type IntelBundleId =
  | "stellar"
  | "topology"
  | "planetPhysical"
  | "planetIdentity"
  | "planetEnvironment"
  | "planetDemographics"
  | "planetCivilian"
  | "planetDefense"
  | "starbaseIdentity"
  | "starbaseOperations"
  | "starbaseDefense"
  | "fleetContact"
  | "fleetClassification"
  | "fleetTelemetry"
  | "factionIdentity"
  | "factionGovernment"
  | "factionTechnology"
  | "factionEconomy"
  | "factionLeadership"
  | "factionDiplomacy";

export type SensorSuiteId =
  | "planetaryCapitalSensors"
  | "listeningStationSensors"
  | "surveyArraySensors"
  | "tacticalArraySensors";

export interface SensorBandDefinition {
  bundles: IntelBundleId[];
  fields?: IntelFieldId[];
  commandLink?: boolean;
}

export interface SensorSuiteDefinition {
  id: SensorSuiteId;
  label: string;
  maxRange: number;
  bands: Record<number, SensorBandDefinition>;
}

const ALL_SPATIAL_BUNDLES: IntelBundleId[] = [
  "stellar",
  "topology",
  "planetPhysical",
  "planetIdentity",
  "planetEnvironment",
  "planetDemographics",
  "planetCivilian",
  "planetDefense",
  "starbaseIdentity",
  "starbaseOperations",
  "starbaseDefense",
  "fleetContact",
  "fleetClassification",
  "fleetTelemetry",
];

const FULL_BAND: SensorBandDefinition = {
  bundles: ALL_SPATIAL_BUNDLES,
  commandLink: true,
};

export const SENSOR_SUITE_DEFINITIONS: Record<SensorSuiteId, SensorSuiteDefinition> = {
  planetaryCapitalSensors: {
    id: "planetaryCapitalSensors",
    label: "Planetary Capital Sensors",
    maxRange: 1,
    bands: { 0: FULL_BAND, 1: FULL_BAND },
  },
  listeningStationSensors: {
    id: "listeningStationSensors",
    label: "Listening Station Sensors",
    maxRange: 3,
    bands: {
      0: FULL_BAND,
      1: FULL_BAND,
      2: {
        bundles: [
          "stellar",
          "topology",
          "planetPhysical",
          "planetIdentity",
          "starbaseIdentity",
          "fleetContact",
          "fleetClassification",
        ],
        commandLink: true,
      },
      3: { bundles: ["stellar", "topology"], commandLink: true },
    },
  },
  surveyArraySensors: {
    id: "surveyArraySensors",
    label: "Survey Array",
    maxRange: 2,
    bands: {
      0: FULL_BAND,
      1: {
        bundles: [
          "stellar",
          "topology",
          "planetPhysical",
          "planetIdentity",
          "planetEnvironment",
          "starbaseIdentity",
          "fleetContact",
        ],
        commandLink: true,
      },
      2: {
        bundles: ["stellar", "topology", "planetPhysical", "planetIdentity"],
        commandLink: true,
      },
    },
  },
  tacticalArraySensors: {
    id: "tacticalArraySensors",
    label: "Tactical Sensor Array",
    maxRange: 2,
    bands: {
      0: {
        bundles: [
          "stellar",
          "topology",
          "planetPhysical",
          "starbaseIdentity",
          "starbaseOperations",
          "starbaseDefense",
          "fleetContact",
          "fleetClassification",
          "fleetTelemetry",
        ],
        commandLink: true,
      },
      1: {
        bundles: [
          "stellar",
          "topology",
          "planetPhysical",
          "starbaseIdentity",
          "fleetContact",
          "fleetClassification",
        ],
        commandLink: true,
      },
      2: { bundles: ["stellar", "topology"], commandLink: true },
    },
  },
};

export function createEmptyFactionIntelligenceState(): FactionIntelligenceState {
  return { entities: {}, lanes: {} };
}

export function createUnknownIntelValue<T>(): IntelValue<T> {
  return { status: "unknown" };
}

export function intelEntityKey(kind: IntelEntityKind, id: string | number): string {
  return `${kind}:${id}`;
}

export function intelLaneKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

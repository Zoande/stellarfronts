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
  | "planetarySensorArray1"
  | "planetarySensorArray2"
  | "planetarySensorArray3"
  | "listeningStationSensors"
  | "starbaseSensors"
  | "militaryShipSensors"
  | "scienceShipSensors"
  | "civilianShipSensors"
  | "surveyArraySensors"
  | "tacticalArraySensors";

export interface SensorBandDefinition {
  bundles: IntelBundleId[];
  fields?: IntelFieldId[];
  fieldsByKind?: Partial<Record<IntelEntityKind, IntelFieldId[]>>;
  fleetDetection?: "all" | "militaryOnly";
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
  planetarySensorArray1: {
    id: "planetarySensorArray1",
    label: "Planetary Sensor Array I",
    maxRange: 2,
    bands: {
      0: FULL_BAND,
      1: FULL_BAND,
      2: {
        bundles: ["stellar", "topology", "planetPhysical", "planetIdentity", "starbaseIdentity", "fleetContact", "fleetClassification"],
        commandLink: true,
      },
    },
  },
  planetarySensorArray2: {
    id: "planetarySensorArray2",
    label: "Planetary Sensor Array II",
    maxRange: 3,
    bands: {
      0: FULL_BAND,
      1: FULL_BAND,
      2: {
        bundles: ["stellar", "topology", "planetPhysical", "planetIdentity", "planetDefense", "starbaseIdentity", "starbaseDefense", "fleetContact", "fleetClassification"],
        commandLink: true,
      },
      3: { bundles: ["stellar", "topology", "fleetContact", "fleetClassification"], commandLink: true },
    },
  },
  planetarySensorArray3: {
    id: "planetarySensorArray3",
    label: "Planetary Sensor Array III",
    maxRange: 4,
    bands: {
      0: FULL_BAND,
      1: FULL_BAND,
      2: FULL_BAND,
      3: {
        bundles: ["stellar", "topology", "planetPhysical", "planetIdentity", "planetDefense", "starbaseIdentity", "starbaseDefense", "fleetContact", "fleetClassification"],
        commandLink: true,
      },
      4: { bundles: ["stellar", "topology", "fleetContact", "fleetClassification"], commandLink: true },
    },
  },
  listeningStationSensors: {
    id: "listeningStationSensors",
    label: "Listening Station Sensors",
    maxRange: 3,
    bands: {
      0: {
        bundles: ALL_SPATIAL_BUNDLES.filter((bundle) => bundle !== "planetCivilian"),
        commandLink: true,
      },
      1: {
        bundles: ALL_SPATIAL_BUNDLES.filter((bundle) => bundle !== "planetCivilian"),
        commandLink: true,
      },
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
      3: { bundles: ["stellar", "topology", "fleetContact"], commandLink: true },
    },
  },
  starbaseSensors: {
    id: "starbaseSensors",
    label: "Starbase Sensor Network",
    maxRange: 1,
    bands: {
      0: {
        bundles: ALL_SPATIAL_BUNDLES.filter((bundle) => bundle !== "planetCivilian"),
        commandLink: true,
      },
      1: {
        bundles: ["stellar", "topology", "planetPhysical", "planetIdentity", "starbaseIdentity", "fleetContact", "fleetClassification"],
        commandLink: true,
      },
    },
  },
  militaryShipSensors: {
    id: "militaryShipSensors",
    label: "Military Sensor",
    maxRange: 3,
    bands: {
      0: {
        bundles: ["stellar", "topology", "planetPhysical", "planetIdentity", "starbaseIdentity", "starbaseOperations", "starbaseDefense", "fleetContact", "fleetClassification", "fleetTelemetry"],
        fleetDetection: "militaryOnly",
        commandLink: true,
      },
      1: {
        bundles: ["stellar", "topology", "planetPhysical", "planetIdentity", "starbaseIdentity", "fleetContact", "fleetClassification"],
        fleetDetection: "militaryOnly",
        commandLink: true,
      },
      2: {
        bundles: ["stellar", "topology", "planetPhysical", "fleetContact", "fleetClassification"],
        fleetDetection: "militaryOnly",
        commandLink: true,
      },
      3: {
        bundles: ["fleetContact"],
        fleetDetection: "militaryOnly",
        commandLink: true,
      },
    },
  },
  scienceShipSensors: {
    id: "scienceShipSensors",
    label: "Science Sensor",
    maxRange: 3,
    bands: {
      0: {
        bundles: ALL_SPATIAL_BUNDLES.filter((bundle) => bundle !== "planetCivilian"),
        commandLink: true,
      },
      1: { bundles: [], fieldsByKind: { star: ["existence", "type"] }, commandLink: true },
      2: { bundles: [], fieldsByKind: { star: ["existence", "type"] }, commandLink: true },
      3: { bundles: [], fieldsByKind: { star: ["existence", "type"] }, commandLink: true },
    },
  },
  civilianShipSensors: {
    id: "civilianShipSensors",
    label: "Civilian Sensor",
    maxRange: 1,
    bands: {
      0: {
        bundles: ["stellar", "topology", "planetPhysical", "planetIdentity", "starbaseIdentity", "fleetContact", "fleetClassification"],
        commandLink: true,
      },
      1: {
        bundles: [],
        fieldsByKind: {
          star: ["existence", "type"],
          system: ["starId", "planetCount"],
          planet: ["existence", "starId", "planetIndex", "type", "orbitRadius", "diameter"],
          fleet: ["existence", "currentStarId", "hyperlanePosition"],
          ship: ["existence"],
        },
        commandLink: true,
      },
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

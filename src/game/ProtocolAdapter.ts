import type {
  GameSnapshot,
  GameUpdate,
  ServerEvent,
} from "./GameProtocol";
import { SUPPORTED_SERVER_PROTOCOL_VERSIONS } from "./GameProtocol";

export class ProtocolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ProtocolValidationError(`Server message has no valid ${field}.`);
  return value;
}

export function adaptSnapshot(input: unknown): GameSnapshot {
  const raw = requireRecord(input, "snapshot");
  if (raw.type !== "snapshot") throw new ProtocolValidationError("Expected a snapshot message.");
  const protocolVersion = Number(raw.protocolVersion);
  if (!Number.isInteger(protocolVersion)) {
    throw new ProtocolValidationError("Server snapshot did not declare a wire protocol.");
  }
  if (!SUPPORTED_SERVER_PROTOCOL_VERSIONS.includes(protocolVersion)) {
    throw new ProtocolValidationError(
      `Unsupported server protocol v${protocolVersion}. Supported: ${SUPPORTED_SERVER_PROTOCOL_VERSIONS.join(", ")}.`,
    );
  }
  requireRecord(raw.perspective, "perspective");
  requireRecord(raw.clock, "clock");

  // Protocols 5 and 6 predate some current snapshot collections. Adapters
  // produce one canonical model so the rest of the client has no version checks.
  return {
    ...(raw as unknown as GameSnapshot),
    type: "snapshot",
    protocolVersion,
    intelligence: isRecord(raw.intelligence)
      ? raw.intelligence as unknown as GameSnapshot["intelligence"]
      : { entities: [], lanes: [] },
    stars: arrayOrEmpty(raw.stars),
    nebulae: arrayOrEmpty(raw.nebulae),
    planetStates: arrayOrEmpty(raw.planetStates),
    factionEconomies: arrayOrEmpty(raw.factionEconomies),
    habitedPlanetSystemIds: arrayOrEmpty(raw.habitedPlanetSystemIds),
    hyperlanes: arrayOrEmpty(raw.hyperlanes),
    factions: arrayOrEmpty(raw.factions),
    starOwnership: arrayOrEmpty(raw.starOwnership),
    visibleStarIds: Array.isArray(raw.visibleStarIds) ? raw.visibleStarIds as number[] : null,
    knownStarIds: Array.isArray(raw.knownStarIds) ? raw.knownStarIds as number[] : null,
    ships: arrayOrEmpty(raw.ships),
    shipDesigns: arrayOrEmpty(raw.shipDesigns),
    fleets: arrayOrEmpty(raw.fleets),
    starbases: arrayOrEmpty(raw.starbases),
    technologies: arrayOrEmpty(raw.technologies),
    leaders: arrayOrEmpty(raw.leaders),
    governments: arrayOrEmpty(raw.governments),
    species: arrayOrEmpty(raw.species),
    recentCombatContacts: arrayOrEmpty(raw.recentCombatContacts),
    combatProjectiles: arrayOrEmpty(raw.combatProjectiles),
    combatReports: arrayOrEmpty(raw.combatReports),
    diplomacy: isRecord(raw.diplomacy)
      ? raw.diplomacy as unknown as GameSnapshot["diplomacy"]
      : { playerFactionId: null, openBorderFactionIds: [], warFactionIds: [] },
    situations: arrayOrEmpty(raw.situations),
    events: arrayOrEmpty(raw.events),
    tradeAlerts: arrayOrEmpty(raw.tradeAlerts),
  };
}

export function adaptUpdate(input: unknown, negotiatedProtocol: number): GameUpdate {
  const raw = requireRecord(input, "update");
  if (raw.type !== "update") throw new ProtocolValidationError("Expected an update message.");
  const protocolVersion = raw.protocolVersion === undefined ? negotiatedProtocol : Number(raw.protocolVersion);
  if (protocolVersion !== negotiatedProtocol) {
    throw new ProtocolValidationError(
      `Server changed protocol mid-session (v${negotiatedProtocol} to v${protocolVersion}).`,
    );
  }
  requireRecord(raw.perspective, "perspective");
  return {
    ...(raw as unknown as GameUpdate),
    type: "update",
    protocolVersion,
    changed: arrayOrEmpty(raw.changed).filter((field): field is GameUpdate["changed"][number] => typeof field === "string"),
  };
}

const SIMPLE_EVENT_TYPES = new Set([
  "commandResult",
  "accountResources",
  "adminCommandResult",
  "serverInfo",
  "planetDetails",
  "detail",
]);

export function decodeServerEvent(input: unknown, negotiatedProtocol?: number): ServerEvent {
  const raw = requireRecord(input, "message");
  if (raw.type === "snapshot") return adaptSnapshot(raw);
  if (raw.type === "update") {
    if (!negotiatedProtocol) throw new ProtocolValidationError("Received an update before the initial snapshot.");
    return adaptUpdate(raw, negotiatedProtocol);
  }
  if (typeof raw.type !== "string" || !SIMPLE_EVENT_TYPES.has(raw.type)) {
    throw new ProtocolValidationError(`Unknown server message type "${String(raw.type)}".`);
  }
  if (raw.type === "commandResult" && (typeof raw.ok !== "boolean" || typeof raw.message !== "string")) {
    throw new ProtocolValidationError("Malformed commandResult message.");
  }
  if (
    raw.type === "commandResult"
    && raw.requestId !== undefined
    && (typeof raw.requestId !== "string" || raw.requestId.length < 1 || raw.requestId.length > 128)
  ) {
    throw new ProtocolValidationError("Malformed commandResult requestId.");
  }
  if (raw.type === "accountResources" && !Number.isFinite(Number(raw.darkMatter))) {
    throw new ProtocolValidationError("Malformed accountResources message.");
  }
  if (raw.type === "serverInfo" && typeof raw.message !== "string") {
    throw new ProtocolValidationError("Malformed serverInfo message.");
  }
  return raw as unknown as ServerEvent;
}

const SNAPSHOT_UPDATE_FIELDS: Array<Exclude<keyof GameUpdate, "type" | "protocolVersion" | "changed">> = [
  "perspective",
  "intelligence",
  "clock",
  "stars",
  "nebulae",
  "planetStates",
  "factionEconomies",
  "habitedPlanetSystemIds",
  "hyperlanes",
  "factions",
  "starOwnership",
  "visibleStarIds",
  "knownStarIds",
  "ships",
  "shipDesigns",
  "fleets",
  "starbases",
  "technologies",
  "leaders",
  "governments",
  "species",
  "recentCombatContacts",
  "combatProjectiles",
  "combatReports",
  "diplomacy",
  "situations",
  "events",
  "tradeAlerts",
];

export function reduceSnapshot(snapshot: GameSnapshot, update: GameUpdate): GameSnapshot {
  const next = { ...snapshot };
  for (const field of SNAPSHOT_UPDATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(update, field)) {
      (next as unknown as Record<string, unknown>)[field] =
        (update as unknown as Record<string, unknown>)[field];
    }
  }
  next.type = "snapshot";
  next.protocolVersion = snapshot.protocolVersion;
  return next;
}

import {
  SENSOR_SUITE_DEFINITIONS,
  createEmptyFactionIntelligenceState,
  intelEntityKey,
  intelLaneKey,
} from "../../src/data/Intelligence";
import type {
  FactionIntelligenceState,
  IntelBundleId,
  IntelEntityKind,
  IntelEntityView,
  GalaxyIntelligenceView,
  IntelFieldId,
  IntelObservation,
  IntelValue,
  SensorSuiteId,
} from "../../src/data/Intelligence";
import { BUILDING_DEFINITIONS } from "../../src/data/Economy";
import {
  TRADE_PRIVILEGE_ARTICLE_ID,
  getActiveTreatyPartnersForArticle,
} from "../../src/data/Diplomacy";
import { SHIP_MODULE_DEFINITIONS } from "../../src/data/ShipDesigns";
import { STARBASE_BUILDING_DEFINITIONS } from "../../src/data/Starbase";
import type { GalaxyPerspective } from "../../src/data/Factions";
import type { GameState } from "./types";
import { resolveShipDesign } from "./ship-designs";

interface TruthField {
  value: unknown;
  bundle: IntelBundleId;
}

interface TruthEntity {
  id: string;
  kind: IntelEntityKind;
  starId: number | null;
  fields: Record<IntelFieldId, TruthField>;
}

interface SensorSource {
  id: string;
  factionId: number;
  starId: number;
  suites: SensorSuiteId[];
  authority: boolean;
}

interface FactionEvaluation {
  factionId: number;
  truth: Map<string, TruthEntity>;
  fieldSources: Map<string, Map<IntelFieldId, Set<string>>>;
  coveredStars: Set<number>;
  knownLanes: Set<string>;
  currentLanes: Set<string>;
  commandLinkedStars: Set<number>;
  sourceBands: Array<{ sourceId: string; suiteId: SensorSuiteId; starId: number; distance: number }>;
  nebulaBlocks: Array<{ sourceId: string; fromStarId: number; toStarId: number }>;
}

const evaluationCache = new WeakMap<GameState, Map<number, FactionEvaluation>>();

const TRADE_BUNDLES = new Set<IntelBundleId>([
  "planetIdentity",
  "planetEnvironment",
  "planetDemographics",
  "planetCivilian",
]);

const OWN_AUTHORITY_BUNDLES = new Set<IntelBundleId>([
  "factionIdentity",
  "factionGovernment",
  "factionTechnology",
  "factionEconomy",
  "factionLeadership",
  "factionDiplomacy",
]);

const PUBLIC_BUNDLES = new Set<IntelBundleId>(["factionIdentity"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneIntelValue<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== "object") return value;
  return structuredClone(value);
}

function addField(
  fields: Record<IntelFieldId, TruthField>,
  fieldId: IntelFieldId,
  value: unknown,
  bundle: IntelBundleId,
): void {
  if (value === undefined) return;
  // Truth is a short-lived, synchronous projection. Keep references here and
  // clone only when persisting an observation or materializing a wire view.
  // This preserves every independently addressable field without cloning each
  // structured root again for all of its nested paths.
  fields[fieldId] = { value, bundle };
}

/** Store collections at their stable root and as individually addressable leaves. */
function addStructuredFields(
  fields: Record<IntelFieldId, TruthField>,
  prefix: string,
  value: unknown,
  bundle: IntelBundleId,
): void {
  addField(fields, prefix, value, bundle);
  if (Array.isArray(value)) {
    addField(fields, `${prefix}.length`, value.length, bundle);
    value.forEach((entry, index) => {
      const stableSegment = isRecord(entry) && typeof entry.id === "string"
        ? `id:${encodeURIComponent(entry.id)}`
        : isRecord(entry) && typeof entry.speciesId === "string" && typeof entry.job === "string"
          ? `group:${encodeURIComponent(entry.speciesId)}:${encodeURIComponent(entry.job)}:${encodeURIComponent(String(entry.livingStandard ?? ""))}`
          : String(index);
      addStructuredFields(fields, `${prefix}.${stableSegment}`, entry, bundle);
    });
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    addStructuredFields(fields, `${prefix}.${key}`, entry, bundle);
  }
}

function buildingKind(value: unknown): string | null {
  if (typeof value === "string") return value;
  return isRecord(value) && typeof value.kind === "string" ? value.kind : null;
}

function buildingEnabled(value: unknown): boolean {
  return !isRecord(value) || value.enabled !== false;
}

function buildTruth(state: GameState): Map<string, TruthEntity> {
  const truth = new Map<string, TruthEntity>();
  const planetStatesByLocation = new Map(
    state.planetStates.map((planetState) => [`${planetState.starId}:${planetState.planetIndex}`, planetState]),
  );
  const put = (entity: TruthEntity): void => {
    truth.set(intelEntityKey(entity.kind, entity.id), entity);
  };

  for (const star of state.stars) {
    const planets = star.system?.planets ?? [];
    const starFields: Record<string, TruthField> = {};
    addField(starFields, "existence", true, "stellar");
    addField(starFields, "name", star.name, "stellar");
    addField(starFields, "type", star.type, "stellar");
    addField(starFields, "x", star.x, "stellar");
    addField(starFields, "z", star.z, "stellar");
    addField(starFields, "luminosity", star.luminosity, "stellar");
    addField(starFields, "color", star.color, "stellar");
    addStructuredFields(starFields, "objectDetails", star.objectDetails, "stellar");
    put({ id: String(star.id), kind: "star", starId: star.id, fields: starFields });

    const systemFields: Record<string, TruthField> = {};
    addField(systemFields, "starId", star.id, "stellar");
    addField(systemFields, "ownerId", state.starOwnership[star.id] ?? -1, "starbaseIdentity");
    addField(systemFields, "planetCount", planets.length, "planetPhysical");
    put({ id: String(star.id), kind: "system", starId: star.id, fields: systemFields });

    planets.forEach((planet, index) => {
      const planetState = planetStatesByLocation.get(`${star.id}:${index}`);
      const id = planetState?.id ?? `${star.id}:${index}`;
      const fields: Record<string, TruthField> = {};
      addField(fields, "existence", true, "planetPhysical");
      addField(fields, "starId", star.id, "planetPhysical");
      addField(fields, "planetIndex", index, "planetPhysical");
      addField(fields, "orbitRadius", planet.orbitRadius, "planetPhysical");
      addField(fields, "diameter", planet.diameter, "planetPhysical");
      addField(fields, "type", planet.type, "planetPhysical");
      addField(fields, "textureVariation", planet.textureVariation, "planetPhysical");
      addField(fields, "orbitSpeed", planet.orbitSpeed, "planetPhysical");
      addField(fields, "orbitPhaseAtEpoch", planet.orbitPhaseAtEpoch, "planetPhysical");
      addField(fields, "orbitEpochMs", planet.orbitEpochMs, "planetPhysical");
      addField(fields, "objectDetails.size", planet.objectDetails?.size ?? planet.diameter, "planetPhysical");
      addField(fields, "objectDetails.typeName", planet.objectDetails?.typeName ?? planet.type, "planetPhysical");
      addField(fields, "objectDetails.description", planet.objectDetails?.description ?? "", "planetPhysical");
      addField(fields, "name", planet.name, "planetIdentity");
      addField(fields, "isHabited", planetState?.isHabited ?? planet.isHabited ?? false, "planetIdentity");
      addField(fields, "ownerId", planetState?.ownerId ?? null, "planetIdentity");
      addField(fields, "habitability", planetState?.habitability ?? planet.objectDetails?.habitability ?? null, "planetEnvironment");
      addStructuredFields(fields, "features", planetState?.features ?? [], "planetEnvironment");
      addStructuredFields(fields, "modifiers", planetState?.modifiers ?? [], "planetEnvironment");
      addStructuredFields(fields, "districtLimits", planet.objectDetails?.districtLimits ?? {}, "planetEnvironment");
      addField(fields, "population", planetState?.population ?? 0, "planetDemographics");
      addStructuredFields(fields, "speciesPopulations", planetState?.speciesPopulations ?? [], "planetDemographics");
      if (planetState) {
        addStructuredFields(fields, "economy", planetState.economy, "planetCivilian");
        addStructuredFields(fields, "builtDistricts", planetState.builtDistricts, "planetCivilian");
        addStructuredFields(fields, "buildings", planetState.buildings, "planetCivilian");
        addStructuredFields(fields, "urbanSubDistricts", planetState.urbanSubDistricts, "planetCivilian");
        addStructuredFields(fields, "constructionQueue", planetState.constructionQueue, "planetCivilian");
        addStructuredFields(fields, "governor", state.leaders.find((leader) => (
          leader.status !== "dead"
          && leader.assignment?.kind === "planet"
          && leader.assignment.targetId === planetState.id
        )) ?? null, "planetCivilian");
      }
      addField(fields, "defenses.armies", 0, "planetDefense");
      addField(fields, "defenses.soldiers", 0, "planetDefense");
      addField(fields, "defenses.fortification", 0, "planetDefense");
      addField(fields, "defenses.orbitalDefense", "None", "planetDefense");
      put({ id, kind: "planet", starId: star.id, fields });
    });
  }

  for (const starbase of state.starbases) {
    const fields: Record<string, TruthField> = {};
    addField(fields, "existence", true, "starbaseIdentity");
    addField(fields, "ownerId", starbase.ownerId, "starbaseIdentity");
    addField(fields, "starId", starbase.starId, "starbaseIdentity");
    addField(fields, "level", starbase.level, "starbaseIdentity");
    addStructuredFields(fields, "systemPosition", starbase.systemPosition, "starbaseIdentity");
    addField(fields, "status", starbase.status, "starbaseOperations");
    addField(fields, "buildProgress", starbase.buildProgress, "starbaseOperations");
    addStructuredFields(fields, "economy", starbase.economy, "starbaseOperations");
    addStructuredFields(fields, "buildingSlots", starbase.buildingSlots, "starbaseOperations");
    addStructuredFields(fields, "constructionQueue", starbase.constructionQueue, "starbaseOperations");
    addStructuredFields(fields, "shipQueue", starbase.shipQueue, "starbaseOperations");
    for (const field of ["shield", "maxShield", "armor", "maxArmor", "hull", "maxHull", "weaponCooldowns"] as const) {
      addStructuredFields(fields, field, starbase[field], "starbaseDefense");
    }
    put({ id: starbase.id, kind: "starbase", starId: starbase.starId, fields });
  }

  for (const fleet of state.fleets) {
    const fields: Record<string, TruthField> = {};
    addField(fields, "existence", fleet.combatStatus !== "destroyed", "fleetContact");
    addField(fields, "ownerId", fleet.ownerId, "fleetContact");
    addField(fields, "currentStarId", fleet.currentStarId, "fleetContact");
    addStructuredFields(fields, "hyperlanePosition", fleet.hyperlanePosition, "fleetContact");
    addField(fields, "formation", fleet.formation, "fleetClassification");
    addField(fields, "shipCount", fleet.shipIds.length, "fleetClassification");
    addStructuredFields(fields, "shipIds", fleet.shipIds, "fleetTelemetry");
    addStructuredFields(fields, "telemetry", fleet, "fleetTelemetry");
    put({ id: fleet.id, kind: "fleet", starId: fleet.hyperlanePosition ? null : fleet.currentStarId, fields });
  }

  for (const ship of state.ships) {
    const fleet = state.fleets.find((candidate) => candidate.id === ship.fleetId);
    const fields: Record<string, TruthField> = {};
    addField(fields, "existence", ship.hull > 0, "fleetContact");
    addField(fields, "ownerId", ship.ownerId, "fleetContact");
    addField(fields, "fleetId", ship.fleetId, "fleetClassification");
    addField(fields, "shipKind", ship.shipKind, "fleetClassification");
    addStructuredFields(fields, "telemetry", ship, "fleetTelemetry");
    put({ id: ship.id, kind: "ship", starId: fleet?.hyperlanePosition ? null : fleet?.currentStarId ?? null, fields });
  }

  for (const faction of state.factions) {
    const fields: Record<string, TruthField> = {};
    addField(fields, "name", faction.name, "factionIdentity");
    addField(fields, "color", faction.color, "factionIdentity");
    addStructuredFields(fields, "flagDesign", faction.flagDesign ?? null, "factionIdentity");
    addField(fields, "homeStarId", faction.homeStarId, "factionIdentity");
    addStructuredFields(fields, "government", state.governments.find((entry) => entry.factionId === faction.id) ?? null, "factionGovernment");
    addStructuredFields(fields, "technology", state.factionTechnologies.find((entry) => entry.factionId === faction.id) ?? null, "factionTechnology");
    addStructuredFields(fields, "economy", state.factionEconomies.find((entry) => entry.factionId === faction.id) ?? null, "factionEconomy");
    addStructuredFields(fields, "marketOrders", state.market.autoTrades.filter((entry) => entry.playerId === faction.id), "factionEconomy");
    addStructuredFields(fields, "situations", state.situations.filter((entry) => entry.factionId === faction.id), "factionEconomy");
    addStructuredFields(fields, "events", state.events.filter((entry) => entry.factionId === faction.id), "factionEconomy");
    addStructuredFields(fields, "leaders", state.leaders.filter((entry) => entry.factionId === faction.id), "factionLeadership");
    addStructuredFields(fields, "diplomacy", {
      borders: state.diplomacy.borders.filter((entry) => entry.ownerFactionId === faction.id || entry.targetFactionId === faction.id),
      wars: state.diplomacy.wars.filter((entry) => entry.attackerFactionId === faction.id || entry.defenderFactionId === faction.id),
      treaties: state.diplomacy.treaties.filter((entry) => entry.factionIds.includes(faction.id)),
      proposals: state.diplomacy.proposals.filter((entry) => entry.fromFactionId === faction.id || entry.toFactionId === faction.id),
      chatMessages: state.diplomacy.chatMessages.filter((entry) => entry.fromFactionId === faction.id || entry.toFactionId === faction.id),
    }, "factionDiplomacy");
    put({ id: String(faction.id), kind: "faction", starId: null, fields });
  }
  return truth;
}

function getShipSuites(state: GameState, shipId: string): SensorSuiteId[] {
  const ship = state.ships.find((candidate) => candidate.id === shipId);
  if (!ship || ship.hull <= 0) return [];
  const design = resolveShipDesign(state.shipDesigns, ship.ownerId, ship.shipKind, ship.designId, state.clock.year);
  const suites = new Set<SensorSuiteId>();
  for (const moduleId of design.utilityModuleIds) {
    for (const suiteId of SHIP_MODULE_DEFINITIONS[moduleId]?.sensorSuiteIds ?? []) suites.add(suiteId);
  }
  return Array.from(suites);
}

function collectSensorSources(state: GameState): SensorSource[] {
  const sources: SensorSource[] = [];
  for (const planet of state.planetStates) {
    if (planet.ownerId === null) continue;
    for (const slot of planet.buildings.city) {
      const kind = buildingKind(slot);
      if (!kind || !buildingEnabled(slot)) continue;
      const suites = BUILDING_DEFINITIONS[kind as keyof typeof BUILDING_DEFINITIONS]?.sensorSuiteIds ?? [];
      if (suites.length > 0) sources.push({ id: `planet:${planet.id}:${kind}`, factionId: planet.ownerId, starId: planet.starId, suites, authority: true });
    }
  }
  for (const starbase of state.starbases) {
    if (starbase.status !== "online") continue;
    const suites = new Set<SensorSuiteId>();
    for (const kind of starbase.buildingSlots) {
      if (!kind) continue;
      for (const suiteId of STARBASE_BUILDING_DEFINITIONS[kind].sensorSuiteIds ?? []) suites.add(suiteId);
    }
    if (suites.size > 0) sources.push({ id: `starbase:${starbase.id}`, factionId: starbase.ownerId, starId: starbase.starId, suites: Array.from(suites), authority: true });
  }
  for (const fleet of state.fleets) {
    if (fleet.combatStatus === "destroyed" || fleet.retreatState?.status === "mia") continue;
    // Fleets in a lane self-report but deliberately scan no system.
    if (fleet.hyperlanePosition) continue;
    const suites = new Set<SensorSuiteId>();
    for (const shipId of fleet.shipIds) for (const suite of getShipSuites(state, shipId)) suites.add(suite);
    if (suites.size > 0) sources.push({ id: `fleet:${fleet.id}`, factionId: fleet.ownerId, starId: fleet.currentStarId, suites: Array.from(suites), authority: false });
  }
  return sources;
}

function computeCoverage(
  state: GameState,
  source: SensorSource,
  suiteId: SensorSuiteId,
  evaluation: FactionEvaluation,
): Map<number, number> {
  const suite = SENSOR_SUITE_DEFINITIONS[suiteId];
  const covered = new Map<number, number>([[source.starId, 0]]);
  const sourceNebulaId = state.stars[source.starId]?.nebulaId;
  if (sourceNebulaId !== undefined) return covered;
  const queue = [source.starId];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const distance = covered.get(current) ?? 0;
    if (distance >= suite.maxRange) continue;
    for (const neighbor of state.adjacency[current] ?? []) {
      if (covered.has(neighbor)) continue;
      if (state.stars[neighbor]?.nebulaId !== undefined) {
        evaluation.nebulaBlocks.push({ sourceId: source.id, fromStarId: current, toStarId: neighbor });
        continue;
      }
      covered.set(neighbor, distance + 1);
      queue.push(neighbor);
    }
  }
  return covered;
}

function grantField(evaluation: FactionEvaluation, entityKey: string, fieldId: string, sourceId: string): void {
  let entityFields = evaluation.fieldSources.get(entityKey);
  if (!entityFields) {
    entityFields = new Map();
    evaluation.fieldSources.set(entityKey, entityFields);
  }
  let sources = entityFields.get(fieldId);
  if (!sources) {
    sources = new Set();
    entityFields.set(fieldId, sources);
  }
  sources.add(sourceId);
}

function grantEntityBundles(
  evaluation: FactionEvaluation,
  entity: TruthEntity,
  bundles: ReadonlySet<IntelBundleId>,
  sourceId: string,
  explicitFields: readonly IntelFieldId[] = [],
): void {
  const key = intelEntityKey(entity.kind, entity.id);
  for (const [fieldId, field] of Object.entries(entity.fields)) {
    if (bundles.has(field.bundle) || explicitFields.includes(fieldId)) grantField(evaluation, key, fieldId, sourceId);
  }
}

function createEvaluation(state: GameState, factionId: number, truth: Map<string, TruthEntity>): FactionEvaluation {
  const evaluation: FactionEvaluation = {
    factionId,
    truth,
    fieldSources: new Map(),
    coveredStars: new Set(),
    knownLanes: new Set(),
    currentLanes: new Set(),
    commandLinkedStars: new Set(),
    sourceBands: [],
    nebulaBlocks: [],
  };
  const truthByStar = new Map<number, TruthEntity[]>();
  for (const entity of truth.values()) {
    if (entity.starId === null) continue;
    const entries = truthByStar.get(entity.starId) ?? [];
    entries.push(entity);
    truthByStar.set(entity.starId, entries);
  }

  const sourceCoverage: Array<{ source: SensorSource; suiteId: SensorSuiteId; coverage: Map<number, number> }> = [];
  for (const source of collectSensorSources(state).filter((candidate) => candidate.factionId === factionId)) {
    for (const suiteId of new Set(source.suites)) {
      const coverage = computeCoverage(state, source, suiteId, evaluation);
      sourceCoverage.push({ source, suiteId, coverage });
      const suite = SENSOR_SUITE_DEFINITIONS[suiteId];
      for (const [starId, distance] of coverage) {
        const band = suite.bands[distance];
        if (!band) continue;
        evaluation.coveredStars.add(starId);
        evaluation.sourceBands.push({ sourceId: source.id, suiteId, starId, distance });
        if (band.commandLink && source.authority) evaluation.commandLinkedStars.add(starId);
        const bundles = new Set(band.bundles);
        for (const entity of truthByStar.get(starId) ?? []) {
          grantEntityBundles(evaluation, entity, bundles, `${source.id}:${suiteId}` , band.fields);
        }
      }
      // A lane is disclosed only when both endpoints belong to this same source's covered network.
      for (const [a, b] of state.hyperlanes) {
        if (!coverage.has(a) || !coverage.has(b)) continue;
        evaluation.currentLanes.add(intelLaneKey(a, b));
      }
    }
  }

  // Mobile suites relay command traffic only after their source itself is
  // connected to an authority network. Iterate to support future relay chains.
  let commandExpanded = true;
  while (commandExpanded) {
    commandExpanded = false;
    for (const entry of sourceCoverage) {
      if (entry.source.authority || !Array.from(entry.coverage.keys()).some((starId) => evaluation.commandLinkedStars.has(starId))) continue;
      for (const [starId, distance] of entry.coverage) {
        if (!SENSOR_SUITE_DEFINITIONS[entry.suiteId].bands[distance]?.commandLink) continue;
        if (!evaluation.commandLinkedStars.has(starId)) {
          evaluation.commandLinkedStars.add(starId);
          commandExpanded = true;
        }
      }
    }
  }

  // Operational ship sensors self-report their own ship and fleet in transit without scanning either endpoint.
  for (const fleet of state.fleets) {
    if (fleet.ownerId !== factionId || !fleet.hyperlanePosition) continue;
    const operational = fleet.shipIds.some((shipId) => getShipSuites(state, shipId).length > 0);
    if (!operational) continue;
    for (const entity of truth.values()) {
      if ((entity.kind === "fleet" && entity.id === fleet.id)
        || (entity.kind === "ship" && fleet.shipIds.includes(entity.id))) {
        grantEntityBundles(evaluation, entity, new Set(["fleetContact", "fleetClassification", "fleetTelemetry"]), `self-report:${fleet.id}`);
      }
    }
  }

  // Public faction identity and the faction's central, non-spatial authority ledger.
  for (const entity of truth.values()) {
    if (entity.kind !== "faction") continue;
    grantEntityBundles(evaluation, entity, PUBLIC_BUNDLES, "public-registry");
    if (Number(entity.id) === factionId) grantEntityBundles(evaluation, entity, OWN_AUTHORITY_BUNDLES, "internal-authority");
  }

  // Trade Privilege continuously shares civilian information from every partner-owned planet.
  for (const partnerId of getActiveTreatyPartnersForArticle(state.diplomacy, factionId, TRADE_PRIVILEGE_ARTICLE_ID)) {
    for (const entity of truth.values()) {
      if (entity.kind !== "planet" || entity.fields.ownerId?.value !== partnerId) continue;
      grantEntityBundles(
        evaluation,
        entity,
        TRADE_BUNDLES,
        `trade-privilege:${partnerId}`,
        ["existence", "starId", "planetIndex"],
      );
      if (entity.starId !== null) {
        const star = truth.get(intelEntityKey("star", entity.starId));
        if (star) grantEntityBundles(evaluation, star, new Set(["stellar"]), `trade-privilege:${partnerId}`);
      }
    }
  }

  // Once a star type is catalogued, the system renderer receives only the
  // physical scaffolding needed for grey silhouettes: count, orbit and size.
  for (const star of state.stars) {
    const starKey = intelEntityKey("star", star.id);
    if (!evaluation.fieldSources.get(starKey)?.has("type")) continue;
    const sourceId = "system-silhouette-scaffold";
    for (const entity of truth.values()) {
      if (entity.kind !== "planet" || entity.starId !== star.id) continue;
      const key = intelEntityKey(entity.kind, entity.id);
      for (const fieldId of ["existence", "starId", "planetIndex", "orbitRadius", "diameter"]) {
        if (entity.fields[fieldId]) grantField(evaluation, key, fieldId, sourceId);
      }
    }
  }
  return evaluation;
}

function getStore(state: GameState, factionId: number): FactionIntelligenceState {
  const key = String(factionId);
  return state.intelligenceByFaction[key] ??= createEmptyFactionIntelligenceState();
}

function rememberObservation(
  store: FactionIntelligenceState,
  entity: TruthEntity,
  fieldId: string,
  value: unknown,
  observedAtYear: number,
  sourceIds: string[],
): void {
  const key = intelEntityKey(entity.kind, entity.id);
  const stored = store.entities[key] ??= { kind: entity.kind, fields: {} };
  stored.fields[fieldId] = { value: cloneIntelValue(value), observedAtYear, sourceIds: [...sourceIds].sort() };
}

function seedStartingIntelligence(state: GameState, truth: Map<string, TruthEntity>): void {
  if (state.startingIntelligenceSeeded) return;
  for (const observer of state.factions) {
    const store = getStore(state, observer.id);
    for (const rival of state.factions) {
      if (rival.id === observer.id) continue;
      const sourceIds = [`starting-report:${rival.id}`];
      const star = truth.get(intelEntityKey("star", rival.homeStarId));
      if (star) for (const fieldId of ["existence", "name", "type", "x", "z"]) {
        const field = star.fields[fieldId];
        if (field) rememberObservation(store, star, fieldId, field.value, state.clock.year, sourceIds);
      }
      const capitalSystem = truth.get(intelEntityKey("system", rival.homeStarId));
      if (capitalSystem) for (const fieldId of ["starId", "ownerId"]) {
        const field = capitalSystem.fields[fieldId];
        if (field) rememberObservation(store, capitalSystem, fieldId, field.value, state.clock.year, sourceIds);
      }
      const capitalStarbase = Array.from(truth.values()).find((entity) => (
        entity.kind === "starbase"
        && entity.starId === rival.homeStarId
        && entity.fields.ownerId?.value === rival.id
      ));
      if (capitalStarbase) for (const [fieldId, field] of Object.entries(capitalStarbase.fields)) {
        if (field.bundle === "starbaseIdentity") {
          rememberObservation(store, capitalStarbase, fieldId, field.value, state.clock.year, sourceIds);
        }
      }
      const capitalPlanet = Array.from(truth.values()).find((entity) => (
        entity.kind === "planet"
        && entity.starId === rival.homeStarId
        && entity.fields.ownerId?.value === rival.id
        && entity.fields.isHabited?.value === true
      ));
      if (capitalPlanet) for (const fieldId of ["existence", "starId", "planetIndex", "orbitRadius", "diameter", "name", "type", "isHabited", "ownerId"]) {
        const field = capitalPlanet.fields[fieldId];
        if (field) rememberObservation(store, capitalPlanet, fieldId, field.value, state.clock.year, sourceIds);
      }
      for (const neighborId of state.adjacency[rival.homeStarId] ?? []) {
        const neighbor = truth.get(intelEntityKey("star", neighborId));
        if (neighbor) for (const fieldId of ["existence", "name", "type", "x", "z"]) {
          const field = neighbor.fields[fieldId];
          if (field) rememberObservation(store, neighbor, fieldId, field.value, state.clock.year, sourceIds);
        }
        const laneKey = intelLaneKey(rival.homeStarId, neighborId);
        store.lanes[laneKey] = { value: [rival.homeStarId, neighborId], observedAtYear: state.clock.year, sourceIds };
      }
      const scaffoldStarIds = new Set([rival.homeStarId, ...(state.adjacency[rival.homeStarId] ?? [])]);
      for (const entity of truth.values()) {
        if (entity.kind !== "planet" || entity.starId === null || !scaffoldStarIds.has(entity.starId)) continue;
        for (const fieldId of ["existence", "starId", "planetIndex", "orbitRadius", "diameter"]) {
          const field = entity.fields[fieldId];
          if (field) rememberObservation(store, entity, fieldId, field.value, state.clock.year, sourceIds);
        }
      }
    }
  }
  state.startingIntelligenceSeeded = true;
}

export function refreshIntelligence(state: GameState): void {
  const truth = buildTruth(state);
  seedStartingIntelligence(state, truth);
  const cache = new Map<number, FactionEvaluation>();
  for (const faction of state.factions) {
    const evaluation = createEvaluation(state, faction.id, truth);
    const store = getStore(state, faction.id);
    // Remove a discrete ghost only when a live source scans its last-known
    // location with a band capable of detecting that entity's existence.
    for (const [entityKey, stored] of Object.entries(store.entities)) {
      if (truth.has(entityKey) || !["fleet", "ship", "starbase"].includes(stored.kind)) continue;
      const starId = Number(stored.fields.starId?.value ?? stored.fields.currentStarId?.value);
      if (!Number.isInteger(starId)) continue;
      const requiredBundle: IntelBundleId = stored.kind === "starbase" ? "starbaseIdentity" : "fleetContact";
      const confirmedAbsent = evaluation.sourceBands.some((entry) => (
        entry.starId === starId
        && SENSOR_SUITE_DEFINITIONS[entry.suiteId].bands[entry.distance]?.bundles.includes(requiredBundle)
      ));
      if (confirmedAbsent) delete store.entities[entityKey];
    }
    for (const [entityKey, fieldMap] of evaluation.fieldSources) {
      const entity = truth.get(entityKey);
      if (!entity) continue;
      for (const [fieldId, sources] of fieldMap) {
        const field = entity.fields[fieldId];
        if (field) rememberObservation(store, entity, fieldId, field.value, state.clock.year, Array.from(sources));
      }
    }
    for (const laneKey of evaluation.currentLanes) {
      const pair = state.hyperlanes.find(([a, b]) => intelLaneKey(a, b) === laneKey);
      if (!pair) continue;
      store.lanes[laneKey] = { value: pair, observedAtYear: state.clock.year, sourceIds: ["sensor-coverage"] };
    }
    evaluation.knownLanes = new Set(Object.keys(store.lanes));
    cache.set(faction.id, evaluation);
  }
  evaluationCache.set(state, cache);
}

function ensureEvaluation(state: GameState, factionId: number): FactionEvaluation {
  let evaluation = evaluationCache.get(state)?.get(factionId);
  if (!evaluation) {
    refreshIntelligence(state);
    evaluation = evaluationCache.get(state)?.get(factionId);
  }
  if (!evaluation) throw new Error(`Unable to evaluate intelligence for faction ${factionId}.`);
  return evaluation;
}

export function getIntelEntityView(
  state: GameState,
  factionId: number,
  kind: IntelEntityKind,
  id: string | number,
): IntelEntityView | null {
  const evaluation = ensureEvaluation(state, factionId);
  const key = intelEntityKey(kind, id);
  const truthEntity = evaluation.truth.get(key);
  const storedEntity = getStore(state, factionId).entities[key];
  if (!truthEntity && !storedEntity) return null;
  // Unknown fields are omitted from the sparse wire view. This is essential:
  // enumerating truth-side array indices would leak an unknown collection's size.
  const fieldIds = new Set(Object.keys(storedEntity?.fields ?? {}));
  const fields: Record<string, IntelValue<unknown>> = {};
  for (const fieldId of fieldIds) {
    const observation = storedEntity?.fields[fieldId];
    if (!observation) {
      fields[fieldId] = { status: "unknown" };
      continue;
    }
    const sources = evaluation.fieldSources.get(key)?.get(fieldId);
    fields[fieldId] = {
      status: sources && sources.size > 0 ? "current" : "stale",
      value: cloneIntelValue(observation.value),
      observedAtYear: observation.observedAtYear,
      sourceIds: [...observation.sourceIds],
    };
  }
  return { id: String(id), kind, fields };
}

export function getAllIntelEntityViews(state: GameState, factionId: number): IntelEntityView[] {
  const evaluation = ensureEvaluation(state, factionId);
  const keys = new Set([...evaluation.truth.keys(), ...Object.keys(getStore(state, factionId).entities)]);
  const views: IntelEntityView[] = [];
  for (const key of keys) {
    const separator = key.indexOf(":");
    const kind = key.slice(0, separator) as IntelEntityKind;
    const id = key.slice(separator + 1);
    const view = getIntelEntityView(state, factionId, kind, id);
    if (view && Object.values(view.fields).some((field) => field.status !== "unknown")) views.push(view);
  }
  return views;
}

function materializeObserverEntity(state: GameState, truth: TruthEntity): IntelEntityView {
  const fields = Object.fromEntries(Object.entries(truth.fields).map(([fieldId, field]) => [fieldId, {
    status: "current" as const,
    value: cloneIntelValue(field.value),
    observedAtYear: state.clock.year,
    sourceIds: ["observer-full-truth"],
  }]));
  return { id: truth.id, kind: truth.kind, fields };
}

export function getObserverEntityView(state: GameState, kind: IntelEntityKind, id: string | number): IntelEntityView | null {
  const truth = buildTruth(state).get(intelEntityKey(kind, id));
  return truth ? materializeObserverEntity(state, truth) : null;
}

export function getKnownStarIds(state: GameState, factionId: number): Set<number> {
  const result = new Set<number>();
  for (const star of state.stars) {
    const view = getIntelEntityView(state, factionId, "star", star.id);
    if (view?.fields.type && view.fields.type.status !== "unknown") result.add(star.id);
  }
  return result;
}

export function getCurrentStarIds(state: GameState, factionId: number): Set<number> {
  return new Set(ensureEvaluation(state, factionId).coveredStars);
}

export function getKnownLanePairs(state: GameState, factionId: number): Array<[number, number]> {
  return Object.values(getStore(state, factionId).lanes).map((lane) => [...lane.value] as [number, number]);
}

export function getKnownSystemOwner(state: GameState, factionId: number, starId: number): number {
  const owner = getIntelEntityView(state, factionId, "system", starId)?.fields.ownerId;
  return owner && owner.status !== "unknown" ? Number(owner.value) : -1;
}

export function hasCommandLink(state: GameState, factionId: number, starId: number): boolean {
  return ensureEvaluation(state, factionId).commandLinkedStars.has(starId);
}

export function getOperationalCommandSourceStarIds(state: GameState, factionId: number): Set<number> {
  const evaluation = ensureEvaluation(state, factionId);
  return new Set(evaluation.sourceBands
    .filter((band) => band.distance === 0 && (band.sourceId.startsWith("planet:") || band.sourceId.startsWith("starbase:")))
    .map((band) => band.starId));
}

export function isFleetCurrentlyVisible(state: GameState, factionId: number, fleetId: string): boolean {
  const view = getIntelEntityView(state, factionId, "fleet", fleetId);
  return view?.fields.existence?.status === "current";
}

export function getSensorDebugView(state: GameState, factionId: number) {
  const evaluation = ensureEvaluation(state, factionId);
  return {
    sourceBands: evaluation.sourceBands,
    commandLinkedStarIds: Array.from(evaluation.commandLinkedStars),
    coveredStarIds: Array.from(evaluation.coveredStars),
    currentLanes: Array.from(evaluation.currentLanes),
    knownLanes: Array.from(evaluation.knownLanes),
    nebulaBlocks: evaluation.nebulaBlocks,
  };
}

export function grantOneShotIntelReport(
  state: GameState,
  factionId: number,
  kind: IntelEntityKind,
  id: string | number,
  fieldIds?: string[],
): boolean {
  const truth = buildTruth(state).get(intelEntityKey(kind, id));
  if (!truth) return false;
  const store = getStore(state, factionId);
  const selected = fieldIds?.length ? new Set(fieldIds) : null;
  for (const [fieldId, field] of Object.entries(truth.fields)) {
    if (selected && !selected.has(fieldId)) continue;
    rememberObservation(store, truth, fieldId, field.value, state.clock.year, ["admin-report"]);
  }
  evaluationCache.delete(state);
  return true;
}

export function revokeIntelReport(
  state: GameState,
  factionId: number,
  kind?: IntelEntityKind,
  id?: string | number,
): number {
  const store = getStore(state, factionId);
  if (!kind || id === undefined) {
    const count = Object.keys(store.entities).length + Object.keys(store.lanes).length;
    store.entities = {};
    store.lanes = {};
    state.startingIntelligenceSeeded = true;
    evaluationCache.delete(state);
    return count;
  }
  const deleted = delete store.entities[intelEntityKey(kind, id)] ? 1 : 0;
  evaluationCache.delete(state);
  return deleted;
}

export function getPerspectiveEntityView(
  state: GameState,
  perspective: GalaxyPerspective,
  kind: IntelEntityKind,
  id: string | number,
): IntelEntityView | null {
  return perspective.mode === "observer"
    ? getObserverEntityView(state, kind, id)
    : getIntelEntityView(state, perspective.factionId, kind, id);
}

export function getGalaxyIntelligenceView(
  state: GameState,
  perspective: GalaxyPerspective,
): GalaxyIntelligenceView {
  if (perspective.mode === "observer") {
    const truth = buildTruth(state);
    return {
      entities: Array.from(truth.values()).map((entity) => materializeObserverEntity(state, entity)),
      lanes: state.hyperlanes.map((endpoints) => ({
        endpoints,
        status: "current",
        observedAtYear: state.clock.year,
        sourceIds: ["observer-full-truth"],
      })),
    };
  }
  const evaluation = ensureEvaluation(state, perspective.factionId);
  const store = getStore(state, perspective.factionId);
  return {
    entities: getAllIntelEntityViews(state, perspective.factionId),
    lanes: Object.entries(store.lanes).map(([key, observation]) => ({
      endpoints: [...observation.value] as [number, number],
      status: evaluation.currentLanes.has(key) ? "current" : "stale",
      observedAtYear: observation.observedAtYear,
      sourceIds: [...observation.sourceIds],
    })),
    sensorDebug: getSensorDebugView(state, perspective.factionId),
  };
}
